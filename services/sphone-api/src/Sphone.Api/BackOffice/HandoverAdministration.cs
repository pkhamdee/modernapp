using System.Security.Claims;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.EntityFrameworkCore;
using Sphone.Api.Auth;
using Sphone.Api.Contracts;
using Sphone.Api.Images;
using Sphone.Data;
using Sphone.Domain.Applications;
using Sphone.Domain.Contracts;
using Sphone.Domain.Handovers;

namespace Sphone.Api.BackOffice;

/// <summary>
/// Staff hand over the goods of accepted Contracts (stories 36-39, 41). They list what's waiting (by Branch and
/// by Delivery or Store Pickup), move each Handover Preparing → Ready for pickup / Out for delivery → Handed
/// over (never skipping or going back), record any Down Payment before handing over, and look at the
/// Customer's ID card photo, which comes from the image service's private area through this endpoint only.
/// Only the Handover row changes; the Contract stays as pushed (ADR-0001, ADR-0004). A Contract cancelled in
/// the Enterprise System stops its Handover.
/// </summary>
internal static class HandoverAdministration
{
    public static void MapHandoverAdministration(this RouteGroupBuilder backOffice)
    {
        var handovers = backOffice.MapGroup("/handovers");
        handovers.MapGet("/", ListAwaiting);
        handovers.MapGet("/{number}", GetHandover);
        handovers.MapGet("/{number}/id-card-photo", GetIdCardPhoto);
        handovers.MapPost("/{number}/stage", MoveStage);
        handovers.MapPost("/{number}/down-payment", RecordDownPayment);
    }

    private static async Task<Results<Ok<List<HandoverResponse>>, ValidationProblem>> ListAwaiting(
        string? branch, string? method, SphoneDbContext db, CancellationToken cancellationToken)
    {
        HandoverMethod? handoverMethod = method switch
        {
            null or "" => null,
            "delivery" => HandoverMethod.Delivery,
            "store-pickup" => HandoverMethod.StorePickup,
            _ => (HandoverMethod)(-1),
        };
        var errors = BackOfficeEndpoints.Errors();
        errors.Require(handoverMethod is null || Enum.IsDefined(handoverMethod.Value), "method", "วิธีรับสินค้าต้องเป็น delivery หรือ store-pickup");
        if (errors.Count > 0)
        {
            return TypedResults.ValidationProblem(errors);
        }

        var query = Query(db).Where(h => h.Stage != HandoverStage.HandedOver && h.Contract.Status != ContractStatus.Cancelled);
        if (!string.IsNullOrEmpty(branch))
        {
            query = query.Where(h => h.Contract.Application.Branch != null && h.Contract.Application.Branch.Code == branch);
        }

        if (handoverMethod is { } m)
        {
            query = query.Where(h => h.Contract.Application.Handover == m);
        }

        var handovers = await query.OrderBy(h => h.Contract.AcceptedAt).ToListAsync(cancellationToken);
        return TypedResults.Ok(handovers.Select(ToResponse).ToList());
    }

    private static async Task<Results<Ok<HandoverResponse>, NotFound>> GetHandover(
        string number, SphoneDbContext db, CancellationToken cancellationToken)
    {
        var handover = await Query(db).SingleOrDefaultAsync(h => h.Contract.Number == number, cancellationToken);
        return handover is null ? TypedResults.NotFound() : TypedResults.Ok(ToResponse(handover));
    }

    private static async Task<IResult> GetIdCardPhoto(
        string number, HttpContext http, SphoneDbContext db, IImageStore images, CancellationToken cancellationToken)
    {
        var photo = await db.Contracts
            .Where(c => c.Number == number)
            .Select(c => new { c.Application.IdCardImageId })
            .SingleOrDefaultAsync(cancellationToken);
        var image = photo is null ? null : await images.GetAsync(ImageArea.Private, photo.IdCardImageId, cancellationToken);
        if (image is null)
        {
            return TypedResults.NotFound();
        }

        // Personal data: never cached by the browser or anything in between.
        http.Response.Headers.CacheControl = "no-store";
        return TypedResults.File(image.Content, image.ContentType);
    }

    private static async Task<Results<Ok<HandoverResponse>, ValidationProblem, ProblemHttpResult, NotFound>> MoveStage(
        string number, MoveStageRequest request, ClaimsPrincipal user, SphoneDbContext db, TimeProvider clock,
        CancellationToken cancellationToken)
    {
        HandoverStage? stage = request.Stage switch
        {
            "ready-for-pickup" => HandoverStage.ReadyForPickup,
            "out-for-delivery" => HandoverStage.OutForDelivery,
            "handed-over" => HandoverStage.HandedOver,
            _ => null,
        };
        if (stage is null)
        {
            var errors = BackOfficeEndpoints.Errors();
            errors.Require(false, "stage", "ขั้นตอนต้องเป็น ready-for-pickup, out-for-delivery หรือ handed-over");
            return TypedResults.ValidationProblem(errors);
        }

        var handover = await Query(db, tracking: true).SingleOrDefaultAsync(h => h.Contract.Number == number, cancellationToken);
        if (handover is null)
        {
            return TypedResults.NotFound();
        }

        var refusal = handover.MoveTo(stage.Value, StaffUsername(user), clock.GetUtcNow());
        if (refusal != HandoverRefusal.None)
        {
            return Refused(refusal);
        }

        await db.SaveChangesAsync(cancellationToken);
        return TypedResults.Ok(ToResponse(handover));
    }

    private static async Task<Results<Ok<HandoverResponse>, ValidationProblem, ProblemHttpResult, NotFound>> RecordDownPayment(
        string number, DownPaymentRequest request, ClaimsPrincipal user, SphoneDbContext db, TimeProvider clock,
        CancellationToken cancellationToken)
    {
        var handover = await Query(db, tracking: true).SingleOrDefaultAsync(h => h.Contract.Number == number, cancellationToken);
        if (handover is null)
        {
            return TypedResults.NotFound();
        }

        var refusal = handover.RecordDownPayment(request.Amount ?? 0m, StaffUsername(user), clock.GetUtcNow());
        if (refusal == HandoverRefusal.DownPaymentAmountWrong)
        {
            var errors = BackOfficeEndpoints.Errors();
            errors.Require(false, "amount", $"เงินดาวน์ของสัญญานี้คือ {handover.Contract.DownPayment:N0} บาท");
            return TypedResults.ValidationProblem(errors);
        }

        if (refusal != HandoverRefusal.None)
        {
            return Refused(refusal);
        }

        await db.SaveChangesAsync(cancellationToken);
        return TypedResults.Ok(ToResponse(handover));
    }

    private static IQueryable<Handover> Query(SphoneDbContext db, bool tracking = false)
    {
        var query = db.Handovers
            .Include(h => h.Contract).ThenInclude(c => c.Product)
            .Include(h => h.Contract).ThenInclude(c => c.Customer)
            .Include(h => h.Contract).ThenInclude(c => c.Application).ThenInclude(a => a.Branch);
        return tracking ? query : query.AsNoTracking();
    }

    private static string StaffUsername(ClaimsPrincipal user) =>
        user.FindFirst(SphoneClaims.Username)?.Value ?? throw new InvalidOperationException("Not a Staff token.");

    private static ProblemHttpResult Refused(HandoverRefusal refusal) =>
        TypedResults.Problem(
            statusCode: StatusCodes.Status409Conflict,
            title: refusal switch
            {
                HandoverRefusal.StageNotAllowed => "ข้ามขั้นตอนหรือย้อนขั้นตอนการส่งมอบไม่ได้",
                HandoverRefusal.DownPaymentNotReceived => "กรุณาบันทึกการรับเงินดาวน์ก่อนส่งมอบสินค้า",
                HandoverRefusal.Stopped => "สัญญานี้ถูกยกเลิกแล้ว จึงหยุดการส่งมอบสินค้า",
                HandoverRefusal.NoDownPayment => "สัญญานี้ไม่มีเงินดาวน์",
                _ => "บันทึกการรับเงินดาวน์ไปแล้ว",
            },
            extensions: new Dictionary<string, object?>
            {
                ["error"] = refusal switch
                {
                    HandoverRefusal.StageNotAllowed => "stage-not-allowed",
                    HandoverRefusal.DownPaymentNotReceived => "down-payment-not-received",
                    HandoverRefusal.Stopped => "handover-stopped",
                    HandoverRefusal.NoDownPayment => "no-down-payment",
                    _ => "down-payment-already-received",
                },
            });

    /// <summary>Needs the Contract with Product, Customer and Application (with Branch).</summary>
    private static HandoverResponse ToResponse(Handover h)
    {
        var c = h.Contract;
        var a = c.Application;
        return new(
            c.Number,
            ContractEndpoints.StatusCode(c.Status),
            ContractEndpoints.StageCode(h.Stage),
            h.NextStage is { } next ? [ContractEndpoints.StageCode(next)] : [],
            h.IsStopped,
            a.Handover == HandoverMethod.Delivery ? "delivery" : "store-pickup",
            a.Branch is null ? null : new HandoverBranchResponse(a.Branch.Code, a.Branch.Name),
            a.DeliveryAddress,
            a.DeliveryProvince,
            new HandoverCustomerResponse(a.FullName ?? c.Customer.FullName ?? string.Empty, c.Customer.MobileNumber, a.IdNumber),
            new HandoverProductResponse(c.Product.Id, c.Product.Name),
            c.DownPayment,
            h.DownPaymentReceived,
            h.DownPaymentReceivedAt,
            h.StageChangedAt,
            h.HandedOverAt,
            c.AcceptedAt,
            $"/api/back-office/handovers/{c.Number}/id-card-photo");
    }
}

internal sealed record MoveStageRequest(string? Stage);

internal sealed record DownPaymentRequest(decimal? Amount);

// Stage: preparing | ready-for-pickup | out-for-delivery | handed-over; NextStages: what Staff may move to now
// (empty once handed over or stopped). Stopped: the Contract was cancelled in the Enterprise System.
// IdCardPhotoUrl needs the Staff token (fetch it, don't link it).
internal sealed record HandoverResponse(
    string ContractNumber,
    string ContractStatus,
    string Stage,
    List<string> NextStages,
    bool Stopped,
    string Method,
    HandoverBranchResponse? Branch,
    string? DeliveryAddress,
    string? DeliveryProvince,
    HandoverCustomerResponse Customer,
    HandoverProductResponse Product,
    decimal DownPayment,
    decimal? DownPaymentReceived,
    DateTimeOffset? DownPaymentReceivedAt,
    DateTimeOffset StageChangedAt,
    DateTimeOffset? HandedOverAt,
    DateTimeOffset AcceptedAt,
    string IdCardPhotoUrl);

internal sealed record HandoverBranchResponse(string Code, string Name);

internal sealed record HandoverCustomerResponse(string FullName, string MobileNumber, string IdNumber);

internal sealed record HandoverProductResponse(int Id, string Name);

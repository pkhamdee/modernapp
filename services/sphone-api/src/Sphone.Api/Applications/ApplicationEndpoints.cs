using System.Security.Claims;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Sphone.Api.Auth;
using Sphone.Api.Images;
using Sphone.Data;
using Sphone.Domain.Applications;
using Sphone.Domain.Catalog;

namespace Sphone.Api.Applications;

/// <summary>
/// Eligibility and Applications (Customer only). Submitting checks Eligibility first (a failing Customer gets
/// 409 and no Application), stores the ID card photo privately and returns 202; the Credit Decision is made in
/// the background (<see cref="CreditDecisionWorker"/>) and the Customer checks back with GET.
/// </summary>
internal static partial class ApplicationEndpoints
{
    private static readonly IReadOnlySet<string> PhotoTypes =
        new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "image/jpeg", "image/png", "image/webp" };

    public static IEndpointRouteBuilder MapApplicationEndpoints(this IEndpointRouteBuilder api)
    {
        api.MapGet("/eligibility", GetEligibility).WithTags("Applications").RequireAuthorization(Roles.Customer);
        api.MapGet("/delivery-provinces", () => BangkokMetropolitanRegion.Provinces).WithTags("Applications");

        var applications = api.MapGroup("/applications").WithTags("Applications").RequireAuthorization(Roles.Customer);
        // Bearer-token API (no cookies), so antiforgery tokens are not needed for the form post.
        applications.MapPost("/", Submit).DisableAntiforgery();
        applications.MapGet("/{id:int}", GetApplication);

        return api;
    }

    private static async Task<EligibilityResponse> GetEligibility(
        ClaimsPrincipal user, SphoneDbContext db, TimeProvider clock, CancellationToken cancellationToken)
    {
        var customerId = user.RequiredCustomerId();
        var earlier = await db.Applications.Where(a => a.CustomerId == customerId).ToListAsync(cancellationToken);
        var eligibility = Eligibility.Check(earlier, clock.GetUtcNow());
        return new EligibilityResponse(eligibility.IsEligible, ReasonCode(eligibility.Reason), eligibility.ReapplyFrom);
    }

    private static async Task<Results<Accepted<ApplicationResponse>, ProblemHttpResult, NotFound>> Submit(
        [FromForm] ApplicationForm form, ClaimsPrincipal user, SphoneDbContext db, IImageStore images,
        CreditDecisionQueue decisions, TimeProvider clock, CancellationToken cancellationToken)
    {
        var customerId = user.RequiredCustomerId();

        if (form.IdNumber is not { } idNumber || !ThaiIdNumber().IsMatch(idNumber))
        {
            return Refused("id-number-invalid", "เลขประจำตัวประชาชนต้องเป็นตัวเลข 13 หลัก");
        }

        if (form.IdCardPhoto is not { Length: > 0 } photo)
        {
            return Refused("photo-required", "กรุณาแนบรูปถ่ายบัตรประชาชน");
        }

        if (!PhotoTypes.Contains(photo.ContentType) || photo.Length > ImageTypes.MaxBytes)
        {
            return Refused("photo-invalid", "รูปบัตรประชาชนต้องเป็นไฟล์ JPEG, PNG หรือ WebP ขนาดไม่เกิน 10 MB");
        }

        var product = await db.Products.Include(p => p.ProductCategory)
            .SingleOrDefaultAsync(p => p.Id == form.ProductId && !p.IsRetired, cancellationToken);
        if (product is null)
        {
            return TypedResults.NotFound();
        }

        var plan = form.Term is { } term && form.DownPayment is { } downPayment
            ? InstallmentPlan.For(product.Price, product.ProductCategory, term, downPayment)
            : null;
        if (plan is null)
        {
            return Refused("plan-not-offered", "ไม่มีแผนผ่อนชำระตามจำนวนงวดและเงินดาวน์ที่เลือก");
        }

        HandoverChoice handover;
        switch (form.Handover)
        {
            case "delivery":
                if (string.IsNullOrWhiteSpace(form.DeliveryAddress))
                {
                    return Refused("delivery-address-required", "กรุณากรอกที่อยู่สำหรับจัดส่ง");
                }

                if (!BangkokMetropolitanRegion.Contains(form.DeliveryProvince))
                {
                    return Refused("delivery-outside-bmr", "จัดส่งได้เฉพาะกรุงเทพฯ และปริมณฑล กรุณาเลือกรับสินค้าที่สาขา");
                }

                handover = HandoverChoice.Delivery(form.DeliveryAddress.Trim(), form.DeliveryProvince!.Trim());
                break;
            case "store-pickup":
                var branch = await db.Branches.SingleOrDefaultAsync(b => b.Code == form.BranchCode, cancellationToken);
                if (branch is null)
                {
                    return Refused("branch-not-found", "กรุณาเลือกสาขาที่จะรับสินค้า");
                }

                handover = HandoverChoice.StorePickup(branch);
                break;
            default:
                return Refused("handover-invalid", "กรุณาเลือกจัดส่งหรือรับสินค้าที่สาขา");
        }

        // Eligibility before anything is stored: this Customer's Applications and any made with this ID number.
        var now = clock.GetUtcNow();
        var earlier = await db.Applications
            .Where(a => a.CustomerId == customerId || a.IdNumber == idNumber)
            .ToListAsync(cancellationToken);
        var eligibility = Eligibility.Check(earlier, now);
        if (!eligibility.IsEligible)
        {
            return TypedResults.Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: IneligibleTitle(eligibility.Reason),
                extensions: new Dictionary<string, object?>
                {
                    ["error"] = ReasonCode(eligibility.Reason),
                    ["reapplyFrom"] = eligibility.ReapplyFrom,
                });
        }

        string imageId;
        await using (var content = photo.OpenReadStream())
        {
            imageId = await images.SaveAsync(ImageArea.Private, content, photo.ContentType, cancellationToken);
        }

        var customer = await db.Customers.SingleAsync(c => c.Id == customerId, cancellationToken);
        var application = Application.Submit(customer, product, plan, handover, idNumber, imageId, photo.ContentType, now);
        db.Applications.Add(application);
        await db.SaveChangesAsync(cancellationToken);
        decisions.Enqueue(application.Id);

        return TypedResults.Accepted($"/api/applications/{application.Id}", ToResponse(application));
    }

    private static async Task<Results<Ok<ApplicationResponse>, NotFound>> GetApplication(
        int id, ClaimsPrincipal user, SphoneDbContext db, CancellationToken cancellationToken)
    {
        var customerId = user.RequiredCustomerId();
        var application = await db.Applications
            .Include(a => a.Product)
            .Include(a => a.Branch)
            .AsNoTracking()
            .SingleOrDefaultAsync(a => a.Id == id && a.CustomerId == customerId, cancellationToken);

        return application is null ? TypedResults.NotFound() : TypedResults.Ok(ToResponse(application));
    }

    private static ApplicationResponse ToResponse(Application a) =>
        new(
            a.Id,
            a.Status switch
            {
                ApplicationStatus.Reviewing => "reviewing",
                ApplicationStatus.Approved => "approved",
                ApplicationStatus.Rejected => "rejected",
                _ => "not-eligible",
            },
            a.Reason switch
            {
                null => null,
                ApplicationReason.IdVerificationFailed => "id-verification-failed",
                ApplicationReason.CreditCheckFailed => "credit-check-failed",
                ApplicationReason.OverCreditLimit => "over-credit-limit",
                ApplicationReason.TimedOut => "timed-out",
                _ => "under-20",
            },
            a.ReapplyFrom,
            a.SubmittedAt,
            a.DecidedAt,
            new ApplicationProductResponse(a.Product.Id, a.Product.Name),
            a.Price,
            a.DownPayment,
            a.Term,
            a.Installment,
            a.TotalPayable,
            a.Handover == HandoverMethod.Delivery ? "delivery" : "store-pickup",
            a.DeliveryAddress,
            a.DeliveryProvince,
            a.Branch is null ? null : new ApplicationBranchResponse(a.Branch.Code, a.Branch.Name),
            a.FullName,
            a.DateOfBirth,
            a.CreditLimit);

    private static string? ReasonCode(IneligibleReason? reason) =>
        reason switch
        {
            null => null,
            IneligibleReason.ActiveContract => "active-contract",
            IneligibleReason.ApplicationInProgress => "application-in-progress",
            _ => "recently-rejected",
        };

    private static string IneligibleTitle(IneligibleReason? reason) =>
        reason switch
        {
            IneligibleReason.ActiveContract => "คุณมีสัญญาเช่าซื้อที่ยังไม่สิ้นสุด จึงยังสมัครใหม่ไม่ได้",
            IneligibleReason.ApplicationInProgress => "คำขอก่อนหน้าของคุณกำลังอยู่ระหว่างพิจารณา",
            _ => "คำขอของคุณถูกปฏิเสธเมื่อไม่ถึง 30 วันที่ผ่านมา",
        };

    private static ProblemHttpResult Refused(string error, string title) =>
        TypedResults.Problem(
            statusCode: StatusCodes.Status400BadRequest,
            title: title,
            extensions: new Dictionary<string, object?> { ["error"] = error });

    [GeneratedRegex("^[0-9]{13}$")]
    private static partial Regex ThaiIdNumber();
}

/// <summary>multipart/form-data fields of an Application. Handover: <c>delivery</c> or <c>store-pickup</c>.</summary>
internal sealed class ApplicationForm
{
    public int ProductId { get; set; }

    public int? Term { get; set; }

    public decimal? DownPayment { get; set; }

    public string? IdNumber { get; set; }

    public IFormFile? IdCardPhoto { get; set; }

    public string? Handover { get; set; }

    public string? BranchCode { get; set; }

    public string? DeliveryAddress { get; set; }

    public string? DeliveryProvince { get; set; }
}

// Reason: application-in-progress | active-contract | recently-rejected (then ReapplyFrom is set).
internal sealed record EligibilityResponse(bool Eligible, string? Reason, DateTimeOffset? ReapplyFrom);

// Status: reviewing | approved | rejected | not-eligible.
// Reason: id-verification-failed | credit-check-failed | over-credit-limit | timed-out (Rejected), under-20 (not-eligible).
// ReapplyFrom: when a Rejected Customer may apply again (null after a time-out). Price etc. are locked at submit.
internal sealed record ApplicationResponse(
    int Id,
    string Status,
    string? Reason,
    DateTimeOffset? ReapplyFrom,
    DateTimeOffset SubmittedAt,
    DateTimeOffset? DecidedAt,
    ApplicationProductResponse Product,
    decimal Price,
    decimal DownPayment,
    int Term,
    decimal Installment,
    decimal TotalPayable,
    string Handover,
    string? DeliveryAddress,
    string? DeliveryProvince,
    ApplicationBranchResponse? Branch,
    string? FullName,
    DateOnly? DateOfBirth,
    decimal? CreditLimit);

internal sealed record ApplicationProductResponse(int Id, string Name);

internal sealed record ApplicationBranchResponse(string Code, string Name);

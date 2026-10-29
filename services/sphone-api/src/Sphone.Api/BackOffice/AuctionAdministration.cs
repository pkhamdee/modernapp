using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.EntityFrameworkCore;
using Sphone.Api.Auctions;
using Sphone.Data;
using Sphone.Domain.Auctions;

namespace Sphone.Api.BackOffice;

/// <summary>
/// Staff create weekly Auctions (default Monday 10:00 to Sunday 20:00 Asia/Bangkok) and add Lots with photos
/// (uploaded with <c>POST /back-office/lot-photos</c>), condition notes and a starting price. A Lot can be edited
/// until its first Bid; Lots can be added until the Auction closes.
/// </summary>
internal static partial class AuctionAdministration
{
    private const int MaxPhotos = 10;

    public static void MapAuctionAdministration(this RouteGroupBuilder backOffice)
    {
        var auctions = backOffice.MapGroup("/auctions");
        auctions.MapGet("/", ListAuctions);
        auctions.MapPost("/", CreateAuction);
        auctions.MapGet("/{id:int}", GetAuction);
        auctions.MapPost("/{id:int}/lots", AddLot);

        backOffice.MapPut("/lots/{id:int}", EditLot);
        backOffice.MapPost("/lot-photos", ProductAdministration.UploadPhoto);
    }

    // Newest first.
    private static async Task<List<AuctionResponse>> ListAuctions(SphoneDbContext db, TimeProvider clock, CancellationToken cancellationToken)
    {
        var auctions = await db.Auctions.Include(a => a.Lots).OrderByDescending(a => a.OpensAt).ThenByDescending(a => a.Id)
            .AsNoTracking().ToListAsync(cancellationToken);
        var now = clock.GetUtcNow();
        return auctions.Select(a => AuctionResponse.Of(a, now)).ToList();
    }

    private static async Task<Results<Ok<AuctionResponse>, NotFound>> GetAuction(
        int id, SphoneDbContext db, TimeProvider clock, CancellationToken cancellationToken)
    {
        var auction = await db.Auctions.Include(a => a.Lots).AsNoTracking().SingleOrDefaultAsync(a => a.Id == id, cancellationToken);
        return auction is null ? TypedResults.NotFound() : TypedResults.Ok(AuctionResponse.Of(auction, clock.GetUtcNow()));
    }

    private static async Task<Results<Created<AuctionResponse>, ValidationProblem>> CreateAuction(
        AuctionRequest request, SphoneDbContext db, TimeProvider clock, CancellationToken cancellationToken)
    {
        var now = clock.GetUtcNow();
        var (defaultOpensAt, defaultClosesAt) = AuctionSchedule.Next(now);
        var opensAt = (request.OpensAt ?? defaultOpensAt).ToUniversalTime();
        var closesAt = (request.ClosesAt ?? (request.OpensAt is { } chosen ? chosen + AuctionSchedule.Length : defaultClosesAt)).ToUniversalTime();

        var errors = BackOfficeEndpoints.Errors();
        errors.Require(closesAt > opensAt, "closesAt", "เวลาปิดประมูลต้องอยู่หลังเวลาเปิด");
        errors.Require(closesAt > now, "closesAt", "เวลาปิดประมูลต้องเป็นเวลาในอนาคต");
        if (errors.Count > 0)
        {
            return TypedResults.ValidationProblem(errors);
        }

        var auction = new Auction { OpensAt = opensAt, ClosesAt = closesAt, CreatedAt = now };
        db.Auctions.Add(auction);
        await db.SaveChangesAsync(cancellationToken);

        return TypedResults.Created($"/api/back-office/auctions/{auction.Id}", AuctionResponse.Of(auction, now));
    }

    private static async Task<Results<Created<LotResponse>, NotFound, ValidationProblem, ProblemHttpResult>> AddLot(
        int id, LotRequest request, SphoneDbContext db, TimeProvider clock, CancellationToken cancellationToken)
    {
        var auction = await db.Auctions.SingleOrDefaultAsync(a => a.Id == id, cancellationToken);
        if (auction is null)
        {
            return TypedResults.NotFound();
        }

        var now = clock.GetUtcNow();
        if (auction.StatusAt(now) == AuctionStatus.Closed)
        {
            return AuctionClosed();
        }

        var errors = Validate(request);
        if (errors.Count > 0)
        {
            return TypedResults.ValidationProblem(errors);
        }

        var lot = new Lot { Title = string.Empty, ConditionNotes = string.Empty, AuctionId = auction.Id, Auction = auction };
        Apply(request, lot);
        db.Lots.Add(lot);
        await db.SaveChangesAsync(cancellationToken);

        return TypedResults.Created($"/api/lots/{lot.Id}", LotResponse.Of(lot, auction, now));
    }

    private static async Task<Results<Ok<LotResponse>, NotFound, ValidationProblem, ProblemHttpResult>> EditLot(
        int id, LotRequest request, SphoneDbContext db, TimeProvider clock, CancellationToken cancellationToken)
    {
        var lot = await db.Lots.Include(l => l.Auction).SingleOrDefaultAsync(l => l.Id == id, cancellationToken);
        if (lot is null)
        {
            return TypedResults.NotFound();
        }

        var now = clock.GetUtcNow();
        if (lot.Auction.StatusAt(now) == AuctionStatus.Closed)
        {
            return AuctionClosed();
        }

        // Bidders bid on what they saw; once someone has bid, the Lot (and its starting price) is fixed.
        if (lot.BidCount > 0)
        {
            return TypedResults.Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "แก้ไขรายการประมูลที่มีผู้เสนอราคาแล้วไม่ได้",
                extensions: new Dictionary<string, object?> { ["error"] = "lot-has-bids" });
        }

        var errors = Validate(request);
        if (errors.Count > 0)
        {
            return TypedResults.ValidationProblem(errors);
        }

        Apply(request, lot);
        // Optimistic check: a Bid that slipped in after the read above makes this UPDATE match no row.
        var updated = await db.Lots.Where(l => l.Id == lot.Id && l.BidCount == 0).ExecuteUpdateAsync(s => s
            .SetProperty(l => l.Title, lot.Title)
            .SetProperty(l => l.ConditionNotes, lot.ConditionNotes)
            .SetProperty(l => l.StartingPrice, lot.StartingPrice)
            .SetProperty(l => l.ImageIds, lot.ImageIds), cancellationToken);
        if (updated == 0)
        {
            return TypedResults.Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "แก้ไขรายการประมูลที่มีผู้เสนอราคาแล้วไม่ได้",
                extensions: new Dictionary<string, object?> { ["error"] = "lot-has-bids" });
        }

        return TypedResults.Ok(LotResponse.Of(lot, lot.Auction, now));
    }

    private static ProblemHttpResult AuctionClosed() =>
        TypedResults.Problem(
            statusCode: StatusCodes.Status409Conflict,
            title: "การประมูลนี้ปิดแล้ว",
            extensions: new Dictionary<string, object?> { ["error"] = "auction-closed" });

    private static Dictionary<string, string[]> Validate(LotRequest request)
    {
        var errors = BackOfficeEndpoints.Errors();
        errors.Require(!string.IsNullOrWhiteSpace(request.Title) && request.Title.Trim().Length <= 200, "title", "กรุณาระบุรุ่นของ iPhone (ไม่เกิน 200 ตัวอักษร)");
        errors.Require((request.ConditionNotes?.Length ?? 0) <= 2000, "conditionNotes", "รายละเอียดสภาพเครื่องยาวเกิน 2,000 ตัวอักษร");
        errors.Require(request.StartingPrice is > 0m and < 10_000_000m && decimal.Truncate(request.StartingPrice) == request.StartingPrice,
            "startingPrice", "ราคาเริ่มต้นต้องเป็นจำนวนเต็มบาทที่มากกว่า 0");
        var imageIds = request.ImageIds ?? [];
        errors.Require(imageIds.Count is > 0 and <= MaxPhotos && imageIds.All(i => ImageId().IsMatch(i)),
            "imageIds", $"กรุณาแนบรูปถ่าย 1 ถึง {MaxPhotos} รูป");
        return errors;
    }

    private static void Apply(LotRequest request, Lot lot)
    {
        lot.Title = request.Title!.Trim();
        lot.ConditionNotes = request.ConditionNotes?.Trim() ?? string.Empty;
        lot.StartingPrice = request.StartingPrice;
        lot.ImageIds = [.. request.ImageIds!];
    }

    [GeneratedRegex(@"^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$")]
    private static partial Regex ImageId();
}

// Both optional: OpensAt defaults to the next Monday 10:00 (Asia/Bangkok), ClosesAt to the following Sunday 20:00.
internal sealed record AuctionRequest(DateTimeOffset? OpensAt, DateTimeOffset? ClosesAt);

// ImageIds: from POST /back-office/lot-photos, in display order (1 to 10). StartingPrice: whole baht.
internal sealed record LotRequest(string? Title, string? ConditionNotes, decimal StartingPrice, List<string>? ImageIds);

using System.Security.Claims;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.EntityFrameworkCore;
using Sphone.Data;

namespace Sphone.Api.Auctions;

/// <summary>
/// Public Auction browsing: anyone may read the current Auction, its Lots and each Lot's current highest Bid
/// (Lot pages poll <c>GET /api/lots/{id}</c>). Bidding is in <see cref="BidEndpoints"/>.
/// </summary>
internal static class AuctionEndpoints
{
    public static IEndpointRouteBuilder MapAuctionEndpoints(this IEndpointRouteBuilder api)
    {
        var auctions = api.MapGroup("/auctions").WithTags("Auctions");
        auctions.MapGet("/current", GetCurrentAuction);
        auctions.MapGet("/{id:int}", GetAuction);

        api.MapGet("/lots/{id:int}", GetLot).WithTags("Auctions");

        return api;
    }

    // The open Auction (the latest-opened one if Staff made several), else the next upcoming one, else the
    // one that closed last. 404 when there has never been an Auction.
    private static async Task<Results<Ok<AuctionResponse>, NotFound>> GetCurrentAuction(
        ClaimsPrincipal user, SphoneDbContext db, TimeProvider clock, CancellationToken cancellationToken)
    {
        var now = clock.GetUtcNow();
        var auctions = db.Auctions.Include(a => a.Lots).AsNoTracking();
        var auction =
            await auctions.Where(a => a.OpensAt <= now && a.ClosesAt > now)
                .OrderByDescending(a => a.OpensAt).ThenByDescending(a => a.Id).FirstOrDefaultAsync(cancellationToken)
            ?? await auctions.Where(a => a.OpensAt > now)
                .OrderBy(a => a.OpensAt).ThenBy(a => a.Id).FirstOrDefaultAsync(cancellationToken)
            ?? await auctions.OrderByDescending(a => a.ClosesAt).ThenByDescending(a => a.Id).FirstOrDefaultAsync(cancellationToken);
        return auction is null ? TypedResults.NotFound() : TypedResults.Ok(AuctionResponse.Of(auction, now, user));
    }

    private static async Task<Results<Ok<AuctionResponse>, NotFound>> GetAuction(
        int id, ClaimsPrincipal user, SphoneDbContext db, TimeProvider clock, CancellationToken cancellationToken)
    {
        var auction = await db.Auctions.Include(a => a.Lots).AsNoTracking().SingleOrDefaultAsync(a => a.Id == id, cancellationToken);
        return auction is null ? TypedResults.NotFound() : TypedResults.Ok(AuctionResponse.Of(auction, clock.GetUtcNow(), user));
    }

    private static async Task<Results<Ok<LotResponse>, NotFound>> GetLot(
        int id, ClaimsPrincipal user, SphoneDbContext db, TimeProvider clock, CancellationToken cancellationToken)
    {
        var lot = await db.Lots.Include(l => l.Auction).AsNoTracking().SingleOrDefaultAsync(l => l.Id == id, cancellationToken);
        return lot is null ? TypedResults.NotFound() : TypedResults.Ok(LotResponse.Of(lot, lot.Auction, clock.GetUtcNow(), user));
    }
}

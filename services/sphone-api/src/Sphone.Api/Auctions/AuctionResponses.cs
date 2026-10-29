using System.Security.Claims;
using Sphone.Api.Auth;
using Sphone.Api.Images;
using Sphone.Domain.Auctions;

namespace Sphone.Api.Auctions;

// Status: upcoming | open | closed (from the clock: Bids are taken from opensAt until, not including, closesAt).
internal sealed record AuctionResponse(int Id, DateTimeOffset OpensAt, DateTimeOffset ClosesAt, string Status, List<LotResponse> Lots)
{
    public static AuctionResponse Of(Auction auction, DateTimeOffset now, ClaimsPrincipal? user = null) =>
        new(auction.Id, auction.OpensAt, auction.ClosesAt, StatusCode(auction.StatusAt(now)),
            auction.Lots.OrderBy(l => l.Id).Select(l => LotResponse.Of(l, auction, now, user)).ToList());

    public static string StatusCode(AuctionStatus status) => status switch
    {
        AuctionStatus.Upcoming => "upcoming",
        AuctionStatus.Open => "open",
        _ => "closed",
    };
}

// HighestBid is null until the first Bid; MinimumBid is the smallest Bid accepted now (starting price, or highest + ฿100).
// YouAreHighestBidder: only for a signed-in Customer (null otherwise). Pages poll GET /api/lots/{id} for these.
internal sealed record LotResponse(
    int Id,
    int AuctionId,
    string Title,
    string ConditionNotes,
    decimal StartingPrice,
    List<string> ImageIds,
    List<string> PhotoUrls,
    decimal? HighestBid,
    int BidCount,
    decimal MinimumBid,
    DateTimeOffset OpensAt,
    DateTimeOffset ClosesAt,
    string AuctionStatus,
    bool? YouAreHighestBidder)
{
    public static LotResponse Of(Lot lot, Auction auction, DateTimeOffset now, ClaimsPrincipal? user = null)
    {
        var customerId = user?.CustomerId();
        return new(lot.Id, auction.Id, lot.Title, lot.ConditionNotes, lot.StartingPrice, lot.ImageIds,
            lot.ImageIds.Select(ImageTypes.PublicUrl).ToList(), lot.HighestBid, lot.BidCount, lot.MinimumBid,
            auction.OpensAt, auction.ClosesAt, AuctionResponse.StatusCode(auction.StatusAt(now)),
            customerId is null ? null : lot.HighestBidderId == customerId);
    }
}

using Sphone.Domain.Customers;

namespace Sphone.Domain.Auctions;

/// <summary>
/// One used iPhone, complete with its box, offered in an Auction (GLOSSARY: Lot).
/// <see cref="HighestBid"/> / <see cref="HighestBidderId"/> always describe the current highest Bid; they are only ever
/// raised by a single conditional UPDATE (see sphone-api's Bid endpoint), which is what makes ties impossible.
/// </summary>
public class Lot
{
    /// <summary>Bids must beat the current highest Bid by at least this much (baht).</summary>
    public const decimal MinimumIncrement = 100m;

    public int Id { get; set; }

    public int AuctionId { get; set; }

    public Auction Auction { get; set; } = null!;

    /// <summary>Model, capacity and colour, e.g. "iPhone 15 Pro 256GB Natural Titanium".</summary>
    public required string Title { get; set; }

    /// <summary>Condition notes shown to bidders (scratches, battery health, what is in the box).</summary>
    public required string ConditionNotes { get; set; }

    /// <summary>The lowest acceptable first Bid (baht).</summary>
    public decimal StartingPrice { get; set; }

    /// <summary>IDs of the Lot's photos in the image service's public area, in display order.</summary>
    public List<string> ImageIds { get; set; } = [];

    public decimal? HighestBid { get; set; }

    public int? HighestBidderId { get; set; }

    public Customer? HighestBidder { get; set; }

    public int BidCount { get; set; }

    public List<Bid> Bids { get; set; } = [];

    // #17 (close, winner, payment, Forfeited): the winner of a closed Auction's Lot is HighestBidderId at
    // HighestBid. Add the Lot's after-close state (won / paid / Forfeited) here.

    /// <summary>The smallest Bid accepted now: the starting price for the first Bid, else highest + ฿100.</summary>
    public decimal MinimumBid => MinimumBidOver(HighestBid, StartingPrice);

    public static decimal MinimumBidOver(decimal? highestBid, decimal startingPrice) =>
        highestBid is { } highest ? highest + MinimumIncrement : startingPrice;
}

/// <summary>A Customer's offer for a Lot (GLOSSARY: Bid). Accepted Bids only; refused ones are not stored.</summary>
public class Bid
{
    public long Id { get; set; }

    public int LotId { get; set; }

    public int CustomerId { get; set; }

    public decimal Amount { get; set; }

    public DateTimeOffset PlacedAt { get; set; }
}

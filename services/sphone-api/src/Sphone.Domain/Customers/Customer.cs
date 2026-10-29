namespace Sphone.Domain.Customers;

/// <summary>
/// A person who applies for hire purchase, holds Contracts, or bids in an Auction (GLOSSARY: Customer).
/// Created automatically the first time a mobile number signs in with an SMS code.
/// </summary>
public class Customer
{
    public int Id { get; set; }

    /// <summary>10-digit Thai mobile number, e.g. <c>0812345678</c>. Unique.</summary>
    public required string MobileNumber { get; set; }

    public DateTimeOffset CreatedAt { get; set; }
}

using System.Net.Http.Json;
using Sphone.Api.Tests.Applications;

namespace Sphone.Api.Tests.Auctions;

/// <summary>
/// What the Auction screens do, through the HTTP API only: Staff create Auctions and add Lots; visitors read
/// Lots; Customers place Bids.
/// </summary>
internal static class Bidding
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    public static async Task<AuctionView> CreateAuctionAsync(this HttpClient staff, object request)
    {
        using var response = await staff.PostAsJsonAsync("/api/back-office/auctions", request, Ct);
        await response.ExpectAsync(System.Net.HttpStatusCode.Created);
        return (await response.Content.ReadFromJsonAsync<AuctionView>(Ct))!;
    }

    public static async Task<string> UploadLotPhotoAsync(this HttpClient staff, byte[] photo)
    {
        using var content = new ByteArrayContent(photo);
        content.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("image/jpeg");
        using var response = await staff.PostAsync("/api/back-office/lot-photos", content, Ct);
        await response.ExpectAsync(System.Net.HttpStatusCode.Created);
        return (await response.Content.ReadFromJsonAsync<PhotoView>(Ct))!.ImageId;
    }

    public static async Task<LotView> AddLotAsync(this HttpClient staff, int auctionId, object request)
    {
        using var response = await staff.PostAsJsonAsync($"/api/back-office/auctions/{auctionId}/lots", request, Ct);
        await response.ExpectAsync(System.Net.HttpStatusCode.Created);
        return (await response.Content.ReadFromJsonAsync<LotView>(Ct))!;
    }

    public static async Task<LotView> GetLotAsync(this HttpClient client, int lotId) =>
        (await client.GetFromJsonAsync<LotView>($"/api/lots/{lotId}", Ct))!;

    public static async Task<AuctionView> GetCurrentAuctionAsync(this HttpClient client) =>
        (await client.GetFromJsonAsync<AuctionView>("/api/auctions/current", Ct))!;

    public static async Task<AuctionView> GetAuctionAsync(this HttpClient client, int auctionId) =>
        (await client.GetFromJsonAsync<AuctionView>($"/api/auctions/{auctionId}", Ct))!;

    /// <summary>A Lot (one photo) in a new Auction that opened an hour ago and closes in a week.</summary>
    public static async Task<LotView> OpenLotAsync(this SphoneApiFactory api, decimal startingPrice)
    {
        var staff = await api.CreateStaffClientAsync();
        var now = api.Clock.GetUtcNow();
        var auction = await staff.CreateAuctionAsync(new { opensAt = now.AddHours(-1), closesAt = now.AddDays(7) });
        return await staff.AddLotAsync(auction.Id, new
        {
            title = "iPhone 14 128GB Midnight",
            conditionNotes = "สภาพดี ครบกล่อง",
            startingPrice,
            imageIds = new[] { await staff.UploadLotPhotoAsync(TestData.NewPhoto()) },
        });
    }

    /// <summary>
    /// A signed-in Customer who has passed ID Verification. The only way to pass it is to apply for hire purchase,
    /// so this applies (ID Verification passes, Credit Check fails) and waits for the Credit Decision.
    /// </summary>
    public static async Task<HttpClient> IdVerifiedCustomerAsync(this SphoneApiFactory api, string? mobileNumber = null)
    {
        var customer = await api.CreateCustomerClientAsync(mobileNumber);
        var idNumber = TestData.NewIdNumber();
        api.IdVerification.Verifies(idNumber, "สมหญิง ประมูลเก่ง", new DateOnly(1990, 4, 1));
        api.CreditCheck.Fails(idNumber);

        var application = await customer.ApplyAndWaitAsync(new ApplicationForm(await customer.IPhone17Async(), idNumber));

        Assert.Equal("credit-check-failed", application.Reason);
        Assert.True((await customer.MeAsync()).IdVerified);
        return customer;
    }

    public static Task<HttpResponseMessage> BidAsync(this HttpClient customer, int lotId, decimal amount) =>
        customer.PostAsJsonAsync($"/api/lots/{lotId}/bids", new { amount }, Ct);

    /// <summary>Expects a refusal with this status and ProblemDetails <c>error</c>, and returns the refusal.</summary>
    public static async Task<BidRefusal> ExpectRefusalAsync(this HttpResponseMessage response, System.Net.HttpStatusCode status, string error)
    {
        await response.ExpectAsync(status);
        var refusal = (await response.Content.ReadFromJsonAsync<BidRefusal>(Ct))!;
        Assert.Equal(error, refusal.Error);
        return refusal;
    }

    private sealed record PhotoView(string ImageId);

    private static async Task ExpectAsync(this HttpResponseMessage response, System.Net.HttpStatusCode expected)
    {
        if (response.StatusCode != expected)
        {
            Assert.Fail($"Expected {(int)expected}, got {(int)response.StatusCode}: {await response.Content.ReadAsStringAsync(Ct)}");
        }
    }
}

// MinimumBid: only with bid-too-low.
internal sealed record BidRefusal(string? Error, decimal? MinimumBid);

internal sealed record AuctionView(int Id, DateTimeOffset OpensAt, DateTimeOffset ClosesAt, string Status, List<LotView> Lots);

internal sealed record LotView(
    int Id,
    int AuctionId,
    string Title,
    string ConditionNotes,
    decimal StartingPrice,
    List<string> PhotoUrls,
    decimal? HighestBid,
    int BidCount,
    decimal MinimumBid,
    string AuctionStatus,
    bool? YouAreHighestBidder);

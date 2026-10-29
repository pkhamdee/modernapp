using System.Net;
using System.Net.Http.Json;
using Microsoft.Extensions.DependencyInjection;
using Sphone.Data;
using Sphone.Domain.Catalog;

namespace Sphone.Api.Tests.Applications;

// What an Application records when submitted: Product, locked price, Term, Down Payment, and Delivery
// (Bangkok Metropolitan Region only) or Store Pickup at a Branch.
public sealed class SubmitApplicationTests(SphoneApiFactory api)
{
    private static readonly DateOnly Adult = new(1992, 11, 30);

    [Fact]
    public async Task Delivery_to_an_address_in_the_Bangkok_Metropolitan_Region_is_recorded()
    {
        var customer = await api.CreateCustomerClientAsync();
        var idNumber = ScriptApproved();

        var submitted = await customer.SubmitAcceptedAsync(new ApplicationForm(await customer.IPhone17Async(), idNumber)
        {
            Handover = "delivery",
            BranchCode = null,
            DeliveryAddress = "99/9 ถนนติวานนท์ ตำบลตลาดขวัญ อำเภอเมืองนนทบุรี 11000",
            DeliveryProvince = "นนทบุรี",
        });

        Assert.Equal(("delivery", "นนทบุรี", null), (submitted.Handover, submitted.DeliveryProvince, submitted.Branch));
        Assert.StartsWith("99/9", submitted.DeliveryAddress);
    }

    [Fact]
    public async Task Delivery_outside_the_Bangkok_Metropolitan_Region_is_refused()
    {
        var customer = await api.CreateCustomerClientAsync();

        var response = await customer.SubmitAsync(new ApplicationForm(await customer.IPhone17Async(), ScriptApproved())
        {
            Handover = "delivery",
            DeliveryAddress = "1 ถนนห้วยแก้ว อำเภอเมืองเชียงใหม่",
            DeliveryProvince = "เชียงใหม่",
        });

        await AssertRefusedAsync(response, "delivery-outside-bmr");
    }

    [Fact]
    public async Task The_provinces_where_Delivery_is_offered_are_listed()
    {
        var provinces = await api.CreateClient().GetFromJsonAsync<List<string>>("/api/delivery-provinces", Applying.Ct);

        Assert.Equal(["กรุงเทพมหานคร", "นนทบุรี", "ปทุมธานี", "สมุทรปราการ", "สมุทรสาคร", "นครปฐม"], provinces);
    }

    [Fact]
    public async Task Store_Pickup_at_a_Branch_outside_Bangkok_is_fine()
    {
        var customer = await api.CreateCustomerClientAsync();

        var submitted = await customer.SubmitAcceptedAsync(
            new ApplicationForm(await customer.IPhone17Async(), ScriptApproved()) { BranchCode = "chiang-mai" });

        Assert.Equal(("store-pickup", "chiang-mai"), (submitted.Handover, submitted.Branch?.Code));
    }

    [Theory]
    [InlineData("12345", "id-number-invalid")]
    [InlineData("123456789012a", "id-number-invalid")]
    public async Task An_ID_number_must_be_13_digits(string idNumber, string error)
    {
        var customer = await api.CreateCustomerClientAsync();

        var response = await customer.SubmitAsync(new ApplicationForm(await customer.IPhone17Async(), idNumber));

        await AssertRefusedAsync(response, error);
    }

    [Fact]
    public async Task One_ID_card_photo_is_required()
    {
        var customer = await api.CreateCustomerClientAsync();

        var response = await customer.SubmitAsync(
            new ApplicationForm(await customer.IPhone17Async(), ScriptApproved()) { Photo = null });

        await AssertRefusedAsync(response, "photo-required");
    }

    [Fact]
    public async Task The_ID_card_photo_must_be_an_image()
    {
        var customer = await api.CreateCustomerClientAsync();

        var response = await customer.SubmitAsync(
            new ApplicationForm(await customer.IPhone17Async(), ScriptApproved()) { PhotoContentType = "application/pdf" });

        await AssertRefusedAsync(response, "photo-invalid");
    }

    [Theory]
    [InlineData(9, 0)]          // not a Term S Phone offers
    [InlineData(12, 29_900)]    // Down Payment reaches the price
    public async Task A_plan_that_is_not_offered_is_refused(int term, int downPayment)
    {
        var customer = await api.CreateCustomerClientAsync();

        var response = await customer.SubmitAsync(
            new ApplicationForm(await customer.IPhone17Async(), ScriptApproved()) { Term = term, DownPayment = downPayment });

        await AssertRefusedAsync(response, "plan-not-offered");
    }

    [Fact]
    public async Task An_unknown_Branch_is_refused()
    {
        var customer = await api.CreateCustomerClientAsync();

        var response = await customer.SubmitAsync(
            new ApplicationForm(await customer.IPhone17Async(), ScriptApproved()) { BranchCode = "nowhere" });

        await AssertRefusedAsync(response, "branch-not-found");
    }

    [Fact]
    public async Task The_price_is_locked_when_the_Application_is_submitted()
    {
        var customer = await api.CreateCustomerClientAsync();
        var productId = await AddProductAsync(price: 20_000m);
        var idNumber = TestData.NewIdNumber();
        api.IdVerification.NeverAnswers(idNumber); // still being reviewed when the price changes

        var submitted = await customer.SubmitAcceptedAsync(new ApplicationForm(productId, idNumber) { Term = 10 });
        await ChangePriceAsync(productId, 25_000m);

        var application = await customer.GetApplicationAsync(submitted.Id);
        // 20,000 × (1 + 0.015 × 10) / 10 = 2,300.
        Assert.Equal((20_000m, 2_300m, 23_000m), (application.Price, application.Installment, application.TotalPayable));
    }

    private string ScriptApproved()
    {
        var idNumber = TestData.NewIdNumber();
        api.IdVerification.Verifies(idNumber, "ทดสอบ ส่งคำขอ", Adult);
        api.CreditCheck.Passes(idNumber, 50_000m);
        return idNumber;
    }

    // Arrange-only database access: Staff catalog editing (#6) is not part of this ticket, and the demo
    // catalog's prices must stay as they are for other tests.
    private async Task<int> AddProductAsync(decimal price)
    {
        await using var scope = api.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<SphoneDbContext>();
        var phones = db.ProductCategories.Single(c => c.Code == "mobile-phone");
        var product = new Product
        {
            ProductCategoryId = phones.Id,
            Name = $"ทดสอบล็อกราคา {Guid.NewGuid():N}",
            Description = "สินค้าทดสอบ",
            Price = price,
            ImageId = "demo-iphone-17.svg",
        };
        db.Products.Add(product);
        await db.SaveChangesAsync(Applying.Ct);
        return product.Id;
    }

    private async Task ChangePriceAsync(int productId, decimal price)
    {
        await using var scope = api.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<SphoneDbContext>();
        (await db.Products.FindAsync([productId], Applying.Ct))!.Price = price;
        await db.SaveChangesAsync(Applying.Ct);
    }

    private static async Task AssertRefusedAsync(HttpResponseMessage response, string error)
    {
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal(error, (await response.ProblemAsync()).Error);
    }
}

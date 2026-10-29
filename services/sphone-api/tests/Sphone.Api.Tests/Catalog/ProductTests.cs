using System.Net;
using System.Net.Http.Json;

namespace Sphone.Api.Tests.Catalog;

public sealed class ProductTests(SphoneApiFactory api)
{
    private readonly HttpClient _client = api.CreateClient();
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Fact]
    public async Task Visitor_browses_the_Products_of_one_Product_Category_with_their_prices()
    {
        var products = await _client.GetFromJsonAsync<List<ProductSummary>>(
            "/api/product-categories/mobile-phone/products", Ct);

        Assert.NotNull(products);
        Assert.Contains(products, p => p.Name == "iPhone 17 128GB" && p.Price == 29_900m);
        Assert.All(products, p => Assert.Equal("mobile-phone", p.ProductCategoryCode));
    }

    [Theory]
    [InlineData("mobile-phone")]
    [InlineData("ipad")]
    [InlineData("electrical-appliance")]
    [InlineData("furniture")]
    [InlineData("electric-motorcycle")]
    public async Task Every_Product_Category_has_demo_Products(string category)
    {
        var products = await _client.GetFromJsonAsync<List<ProductSummary>>(
            $"/api/product-categories/{category}/products", Ct);

        Assert.NotEmpty(products!);
    }

    [Fact]
    public async Task Browsing_an_unknown_Product_Category_is_not_found()
    {
        var response = await _client.GetAsync("/api/product-categories/spaceship/products", Ct);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Visitor_opens_a_Product_and_sees_its_details_and_Product_Category_terms()
    {
        var ipads = await _client.GetFromJsonAsync<List<ProductSummary>>("/api/product-categories/ipad/products", Ct);
        var listed = ipads!.Single(p => p.Name == "iPad (A16) Wi-Fi 128GB");

        var product = await _client.GetFromJsonAsync<ProductDetail>($"/api/products/{listed.Id}", Ct);

        Assert.NotNull(product);
        Assert.Equal(listed.Id, product.Id);
        Assert.Equal("iPad (A16) Wi-Fi 128GB", product.Name);
        Assert.Equal(12_900m, product.Price);
        Assert.False(string.IsNullOrWhiteSpace(product.Description));
        Assert.Equal(("ipad", 0.015m, 24),
            (product.ProductCategory.Code, product.ProductCategory.FlatRate, product.ProductCategory.LongestTerm));
    }

    [Fact]
    public async Task Opening_an_unknown_Product_is_not_found()
    {
        var response = await _client.GetAsync("/api/products/999999", Ct);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    private sealed record ProductSummary(int Id, string Name, decimal Price, string ProductCategoryCode);

    private sealed record ProductDetail(int Id, string Name, string Description, decimal Price, CategoryTerms ProductCategory);

    private sealed record CategoryTerms(string Code, string Name, decimal FlatRate, int LongestTerm);
}

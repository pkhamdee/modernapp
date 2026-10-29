using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.EntityFrameworkCore;
using Sphone.Data;

namespace Sphone.Api.Catalog;

/// <summary>Public catalog: Product Categories and Products. No sign-in needed.</summary>
internal static class CatalogEndpoints
{
    public static IEndpointRouteBuilder MapCatalogEndpoints(this IEndpointRouteBuilder api)
    {
        var categories = api.MapGroup("/product-categories").WithTags("Catalog");
        categories.MapGet("/", ListProductCategories);
        categories.MapGet("/{code}/products", ListProductsInCategory);

        var products = api.MapGroup("/products").WithTags("Catalog");
        products.MapGet("/{id:int}", GetProduct);

        return api;
    }

    private static async Task<List<ProductCategoryResponse>> ListProductCategories(
        SphoneDbContext db, CancellationToken cancellationToken) =>
        await db.ProductCategories
            .OrderBy(c => c.SortOrder)
            .Select(c => new ProductCategoryResponse(c.Code, c.Name, c.FlatRate, c.LongestTerm))
            .ToListAsync(cancellationToken);

    private static async Task<Results<Ok<List<ProductSummaryResponse>>, NotFound>> ListProductsInCategory(
        string code, SphoneDbContext db, CancellationToken cancellationToken)
    {
        if (!await db.ProductCategories.AnyAsync(c => c.Code == code, cancellationToken))
        {
            return TypedResults.NotFound();
        }

        var products = await db.Products
            .Where(p => p.ProductCategory.Code == code && !p.IsRetired)
            .OrderBy(p => p.Price)
            .Select(p => new ProductSummaryResponse(p.Id, p.Name, p.Price, p.ProductCategory.Code))
            .ToListAsync(cancellationToken);

        return TypedResults.Ok(products);
    }

    private static async Task<Results<Ok<ProductDetailResponse>, NotFound>> GetProduct(
        int id, SphoneDbContext db, CancellationToken cancellationToken)
    {
        var product = await db.Products
            .Where(p => p.Id == id && !p.IsRetired)
            .Select(p => new ProductDetailResponse(
                p.Id,
                p.Name,
                p.Description,
                p.Price,
                new ProductCategoryResponse(
                    p.ProductCategory.Code, p.ProductCategory.Name, p.ProductCategory.FlatRate, p.ProductCategory.LongestTerm)))
            .SingleOrDefaultAsync(cancellationToken);

        return product is null ? TypedResults.NotFound() : TypedResults.Ok(product);
    }
}

// FlatRate: monthly Flat Rate as a fraction (0.015 = 1.5% per month).
internal sealed record ProductCategoryResponse(string Code, string Name, decimal FlatRate, int LongestTerm);

internal sealed record ProductSummaryResponse(int Id, string Name, decimal Price, string ProductCategoryCode);

internal sealed record ProductDetailResponse(
    int Id, string Name, string Description, decimal Price, ProductCategoryResponse ProductCategory);

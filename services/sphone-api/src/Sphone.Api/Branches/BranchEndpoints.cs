using Microsoft.EntityFrameworkCore;
using Sphone.Data;

namespace Sphone.Api.Branches;

/// <summary>Public list of Branches (for Store Pickup). Staff management comes later.</summary>
internal static class BranchEndpoints
{
    public static IEndpointRouteBuilder MapBranchEndpoints(this IEndpointRouteBuilder api)
    {
        var branches = api.MapGroup("/branches").WithTags("Branches");
        branches.MapGet("/", ListBranches);

        return api;
    }

    private static async Task<List<BranchResponse>> ListBranches(
        SphoneDbContext db, CancellationToken cancellationToken) =>
        await db.Branches
            .OrderBy(b => b.Id)
            .Select(b => new BranchResponse(b.Code, b.Name, b.Address, b.Province))
            .ToListAsync(cancellationToken);
}

internal sealed record BranchResponse(string Code, string Name, string Address, string Province);

using System.Security.Claims;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.EntityFrameworkCore;
using Sphone.Api.Auth;
using Sphone.Data;
using Sphone.Domain.Applications;
using Sphone.Domain.Contracts;

namespace Sphone.Api.Contracts;

/// <summary>
/// The signed-in Customer's Contracts, by Contract number. Read-only: S Phone never edits a Contract once
/// pushed (ADR-0001); status (and later Payments) come from the Enterprise System by sync.
/// </summary>
internal static class ContractEndpoints
{
    public static IEndpointRouteBuilder MapContractEndpoints(this IEndpointRouteBuilder api)
    {
        var contracts = api.MapGroup("/contracts").WithTags("Contracts").RequireAuthorization(Roles.Customer);
        contracts.MapGet("/", ListContracts);
        contracts.MapGet("/{number}", GetContract);

        return api;
    }

    private static async Task<List<ContractSummaryResponse>> ListContracts(
        ClaimsPrincipal user, SphoneDbContext db, CancellationToken cancellationToken)
    {
        var customerId = user.RequiredCustomerId();
        var contracts = await Query(db)
            .Where(c => c.CustomerId == customerId)
            .OrderByDescending(c => c.AcceptedAt)
            .ToListAsync(cancellationToken);
        return [.. contracts.Select(c => new ContractSummaryResponse(
            c.Number, StatusCode(c.Status), c.AcceptedAt, new ContractProductResponse(c.Product.Id, c.Product.Name), c.Installment, c.Term))];
    }

    private static async Task<Results<Ok<ContractResponse>, NotFound>> GetContract(
        string number, ClaimsPrincipal user, SphoneDbContext db, CancellationToken cancellationToken)
    {
        var customerId = user.RequiredCustomerId();
        var contract = await Query(db).SingleOrDefaultAsync(c => c.Number == number && c.CustomerId == customerId, cancellationToken);
        return contract is null ? TypedResults.NotFound() : TypedResults.Ok(ToResponse(contract));
    }

    private static IQueryable<Contract> Query(SphoneDbContext db) =>
        db.Contracts
            .Include(c => c.Product)
            .Include(c => c.Application).ThenInclude(a => a.Branch)
            .AsNoTracking();

    public static string StatusCode(ContractStatus status) =>
        status switch
        {
            ContractStatus.Active => "active",
            ContractStatus.Overdue => "overdue",
            ContractStatus.PaidOff => "paid-off",
            _ => "cancelled",
        };

    /// <summary>Needs Product and Application (with Branch) loaded.</summary>
    public static ContractResponse ToResponse(Contract c) =>
        new(
            c.Number,
            StatusCode(c.Status),
            c.AcceptedAt,
            new ContractProductResponse(c.Product.Id, c.Product.Name),
            c.Price,
            c.DownPayment,
            c.Term,
            c.Installment,
            c.TotalPayable,
            c.Application.Handover == HandoverMethod.Delivery ? "delivery" : "store-pickup",
            c.Application.DeliveryAddress,
            c.Application.DeliveryProvince,
            c.Application.Branch is null ? null : new ContractBranchResponse(c.Application.Branch.Code, c.Application.Branch.Name),
            [.. c.Schedule().Select(i => new InstallmentResponse(i.Number, i.Amount, i.DueDate))]);
}

// Status: active | overdue | paid-off | cancelled (as known by the Enterprise System).
// Installments: the schedule; DueDate stays null until Handover (the first is due one month after it).
internal sealed record ContractResponse(
    string Number,
    string Status,
    DateTimeOffset AcceptedAt,
    ContractProductResponse Product,
    decimal Price,
    decimal DownPayment,
    int Term,
    decimal Installment,
    decimal TotalPayable,
    string Handover,
    string? DeliveryAddress,
    string? DeliveryProvince,
    ContractBranchResponse? Branch,
    List<InstallmentResponse> Installments);

internal sealed record ContractSummaryResponse(
    string Number, string Status, DateTimeOffset AcceptedAt, ContractProductResponse Product, decimal Installment, int Term);

internal sealed record ContractProductResponse(int Id, string Name);

internal sealed record ContractBranchResponse(string Code, string Name);

internal sealed record InstallmentResponse(int Number, decimal Amount, DateOnly? DueDate);

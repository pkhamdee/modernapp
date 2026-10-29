using System.Globalization;
using Sphone.Domain.Applications;
using Sphone.Domain.Catalog;
using Sphone.Domain.Customers;
using Sphone.Domain.Offers;

namespace Sphone.Domain.Contracts;

/// <summary>Contract status as known by the Enterprise System (story 34). S Phone only ever creates Active ones.</summary>
public enum ContractStatus
{
    Active,
    Overdue,
    PaidOff,
    Cancelled,
}

/// <summary>
/// The binding hire-purchase agreement created when a Customer accepts an Offer (GLOSSARY: Contract).
/// S Phone owns it only until sphone-sync-master has pushed it to the Enterprise System (ADR-0001); after
/// that its status and Payments arrive by sync and S Phone never edits it. A Customer holds at most one
/// active Contract.
/// </summary>
public class Contract
{
    public int Id { get; set; }

    /// <summary><c>SP-YYYYMM-NNNNNN</c>; unique, and the key the Enterprise System push is idempotent on.</summary>
    public required string Number { get; set; }

    public int OfferId { get; set; }

    public Offer Offer { get; set; } = null!;

    public int ApplicationId { get; set; }

    public Application Application { get; set; } = null!;

    public int CustomerId { get; set; }

    public Customer Customer { get; set; } = null!;

    public int ProductId { get; set; }

    public Product Product { get; set; } = null!;

    /// <summary>Locked price (from the Application).</summary>
    public decimal Price { get; set; }

    public decimal FlatRate { get; set; }

    public decimal DownPayment { get; set; }

    public int Term { get; set; }

    public decimal Installment { get; set; }

    public decimal TotalPayable { get; set; }

    public DateTimeOffset AcceptedAt { get; set; }

    public ContractStatus Status { get; set; }

    /// <summary>Active or Overdue: blocks a new Application (Eligibility) and a second accepted Offer.</summary>
    public bool IsActive => Status is ContractStatus.Active or ContractStatus.Overdue;

    internal static Contract From(Offer offer, ContractNumber number, DateTimeOffset now)
    {
        var application = offer.Application;
        return new()
        {
            Number = number.ToString(),
            Offer = offer,
            Application = application,
            CustomerId = offer.CustomerId,
            ProductId = application.ProductId,
            Product = application.Product,
            Price = application.Price,
            FlatRate = application.FlatRate,
            DownPayment = application.DownPayment,
            Term = application.Term,
            Installment = application.Installment,
            TotalPayable = application.TotalPayable,
            AcceptedAt = now,
            Status = ContractStatus.Active,
        };
    }

    /// <summary>
    /// The Installment schedule: <see cref="Term"/> equal Installments. Due dates are unknown until Handover;
    /// then Installment n falls due n months after <paramref name="handedOverOn"/> (the Handover date in
    /// Asia/Bangkok; a day missing from a shorter month becomes that month's last day).
    /// </summary>
    public IReadOnlyList<ScheduledInstallment> Schedule(DateOnly? handedOverOn) =>
        [.. Enumerable.Range(1, Term).Select(n => new ScheduledInstallment(n, Installment, handedOverOn?.AddMonths(n)))];
}

public sealed record ScheduledInstallment(int Number, decimal Amount, DateOnly? DueDate);

/// <summary>
/// <c>SP-YYYYMM-NNNNNN</c>: the month (Asia/Bangkok) the Offer was accepted and a running number that restarts
/// at 000001 each month. The running number comes from a per-month counter row that is incremented in the
/// same transaction that saves the Contract, so numbers have no gaps and never repeat.
/// </summary>
public readonly record struct ContractNumber(string Month, int Sequence)
{
    private static readonly TimeSpan Bangkok = TimeSpan.FromHours(7);

    /// <summary>The counter key (<c>YYYYMM</c>, Asia/Bangkok) for a Contract accepted at <paramref name="acceptedAt"/>.</summary>
    public static string MonthOf(DateTimeOffset acceptedAt) =>
        acceptedAt.ToOffset(Bangkok).ToString("yyyyMM", CultureInfo.InvariantCulture);

    public override string ToString() => $"SP-{Month}-{Sequence.ToString("D6", CultureInfo.InvariantCulture)}";
}

/// <summary>Per-month running number for <see cref="ContractNumber"/>.</summary>
public class ContractNumberCounter
{
    /// <summary><c>YYYYMM</c> (Asia/Bangkok).</summary>
    public required string Month { get; set; }

    public int LastNumber { get; set; }
}

/// <summary>
/// Transactional outbox row (ADR-0001): written in the same transaction that creates the Contract, so every
/// Contract is queued for sphone-sync-master exactly once. Sync-master pushes rows with
/// <see cref="PushedAt"/> null to the Enterprise System, idempotently on <see cref="ContractNumber"/>,
/// then sets <see cref="PushedAt"/>.
/// </summary>
public class ContractOutboxEntry
{
    public long Id { get; set; }

    public int ContractId { get; set; }

    public Contract Contract { get; set; } = null!;

    public required string ContractNumber { get; set; }

    public DateTimeOffset EnqueuedAt { get; set; }

    /// <summary>Set by sync-master once the Enterprise System has the Contract; S Phone stops owning it then.</summary>
    public DateTimeOffset? PushedAt { get; set; }

    public static ContractOutboxEntry For(Contract contract) =>
        new() { Contract = contract, ContractNumber = contract.Number, EnqueuedAt = contract.AcceptedAt };
}

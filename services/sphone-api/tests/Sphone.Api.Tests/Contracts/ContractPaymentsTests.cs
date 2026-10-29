using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Sphone.Api.Tests.Handovers;
using Sphone.Api.Tests.Offers;
using Sphone.Data;
using Sphone.Domain.Contracts;

namespace Sphone.Api.Tests.Contracts;

// Stories 34, 35: the Customer sees their Contract's status and Payments as known by the Enterprise System.
// Both arrive through sphone-sync-master (#10), which writes S Phone's copy; the tests do the same at that seam.
public sealed class ContractPaymentsTests(SphoneApiFactory api)
{
    private static long _lastEnterprisePaymentId = 9_000_000_000;

    [Fact]
    public async Task A_new_Contract_has_no_Payments_yet()
    {
        var accepted = await api.AcceptedContractAsync();

        var contract = await accepted.Customer.GetContractAsync(accepted.Contract.Number);

        Assert.Equal(("active", 0m), (contract.Status, contract.AmountPaid));
        Assert.Empty(contract.Payments);
        Assert.Null(contract.CancelledAt);
    }

    [Fact]
    public async Task Payments_pulled_from_the_Enterprise_System_show_on_the_Contract_oldest_first()
    {
        var accepted = await api.AcceptedContractAsync();
        var number = accepted.Contract.Number;
        var installment = accepted.Contract.Installment;
        var first = new DateTimeOffset(2026, 2, 5, 4, 0, 0, TimeSpan.Zero);
        var second = first.AddMonths(1);

        await PullAsync(number, ContractStatus.Overdue, null, (2, installment, second, "PROMPTPAY"), (1, installment, first, "COUNTER"));

        var contract = await accepted.Customer.GetContractAsync(number);
        Assert.Equal("overdue", contract.Status);
        Assert.Equal(
            [new PaymentView(1, installment, first, "counter"), new PaymentView(2, installment, second, "promptpay")],
            contract.Payments);
        Assert.Equal(installment * 2, contract.AmountPaid);
    }

    [Fact]
    public async Task A_Contract_paid_off_or_cancelled_in_the_Enterprise_System_says_so()
    {
        var paidOff = await api.AcceptedContractAsync();
        await PullAsync(paidOff.Contract.Number, ContractStatus.PaidOff, null);
        Assert.Equal("paid-off", (await paidOff.Customer.GetContractAsync(paidOff.Contract.Number)).Status);

        var cancelled = await api.AcceptedContractAsync();
        var cancelledAt = new DateTimeOffset(2026, 1, 6, 2, 30, 0, TimeSpan.Zero);
        await PullAsync(cancelled.Contract.Number, ContractStatus.Cancelled, cancelledAt);
        var contract = await cancelled.Customer.GetContractAsync(cancelled.Contract.Number);
        Assert.Equal(("cancelled", cancelledAt, "stopped"), (contract.Status, contract.CancelledAt, contract.HandoverStage));
        var summary = Assert.Single(await cancelled.Customer.GetContractsAsync());
        Assert.Equal("cancelled", summary.Status);
    }

    /// <summary>Writes S Phone's copy the way sync-master's pull does.</summary>
    private async Task PullAsync(
        string contractNumber, ContractStatus status, DateTimeOffset? cancelledAt,
        params (int Installment, decimal Amount, DateTimeOffset PaidAt, string Channel)[] payments)
    {
        await using var scope = api.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<SphoneDbContext>();
        var contract = await db.Contracts.SingleAsync(c => c.Number == contractNumber, HandingOver.Ct);
        contract.RefreshFromEnterprise(status, cancelledAt);
        foreach (var p in payments)
        {
            db.Payments.Add(new Payment
            {
                EnterprisePaymentId = Interlocked.Increment(ref _lastEnterprisePaymentId),
                Contract = contract,
                InstallmentNumber = p.Installment,
                Amount = p.Amount,
                PaidAt = p.PaidAt,
                Channel = p.Channel,
            });
        }

        await db.SaveChangesAsync(HandingOver.Ct);
    }
}

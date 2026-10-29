namespace Sphone.SyncMaster.Tests;

/// <summary>
/// Stories 34, 35, 41, 60: Contract status, cancellations and Payments that changed in the Enterprise System
/// come back to S Phone on the next sync cycle, found by a last-updated watermark.
/// </summary>
public sealed class ContractPullTests(SyncMasterFactory sync)
{
    [Fact]
    public async Task A_Payment_recorded_in_the_Enterprise_System_reaches_S_Phone()
    {
        var contract = await sync.Sphone.QueueContractAsync();
        await sync.RunSyncCycleAsync();

        await sync.Enterprise.RecordPaymentAsync(contract.Number, contract.Installment, installmentNumber: 1);
        await sync.RunSyncCycleAsync();

        var copy = await sync.Sphone.ContractAsync(contract.Number);
        Assert.Equal("Active", copy.Status);
        var payment = Assert.Single(copy.Payments);
        Assert.Equal((1, contract.Installment, "COUNTER"), (payment.InstallmentNumber, payment.Amount, payment.Channel));
    }

    [Fact]
    public async Task A_Contract_cancelled_in_the_Enterprise_System_is_cancelled_in_S_Phone_and_its_Handover_stops()
    {
        var contract = await sync.Sphone.QueueContractAsync();
        await sync.RunSyncCycleAsync();

        await sync.Enterprise.CancelAsync(contract.Number);
        await sync.RunSyncCycleAsync();

        var copy = await sync.Sphone.ContractAsync(contract.Number);
        Assert.Equal(("Cancelled", true), (copy.Status, copy.HandoverStopped));
    }

    [Fact]
    public async Task Overdue_and_paid_off_come_from_the_Enterprise_System()
    {
        var contract = await sync.Sphone.QueueContractAsync();
        await sync.RunSyncCycleAsync();

        await sync.Enterprise.SetStatusAsync(contract.Number, "OVERDUE");
        await sync.RunSyncCycleAsync();
        Assert.Equal("Overdue", (await sync.Sphone.ContractAsync(contract.Number)).Status);

        await sync.Enterprise.SetStatusAsync(contract.Number, "PAID_OFF");
        await sync.RunSyncCycleAsync();
        Assert.Equal("PaidOff", (await sync.Sphone.ContractAsync(contract.Number)).Status);
    }

    [Fact]
    public async Task Rows_unchanged_since_the_last_pull_are_not_pulled_again()
    {
        var contract = await sync.Sphone.QueueContractAsync();
        await sync.RunSyncCycleAsync();
        await sync.Enterprise.RecordPaymentAsync(contract.Number, contract.Installment, installmentNumber: 1);
        await sync.Enterprise.SetStatusAsync(contract.Number, "OVERDUE");
        await sync.RunSyncCycleAsync();

        // If the next cycle re-read these unchanged Enterprise rows, it would restore the S Phone copy.
        await sync.Sphone.TamperAsync(contract.Number);
        await sync.RunSyncCycleAsync();

        var copy = await sync.Sphone.ContractAsync(contract.Number);
        Assert.Equal("Active", copy.Status);
        Assert.Empty(copy.Payments);
    }

    [Fact]
    public async Task A_second_Payment_is_added_beside_the_first()
    {
        var contract = await sync.Sphone.QueueContractAsync();
        await sync.RunSyncCycleAsync();
        await sync.Enterprise.RecordPaymentAsync(contract.Number, contract.Installment, installmentNumber: 1);
        await sync.RunSyncCycleAsync();

        await sync.Enterprise.RecordPaymentAsync(contract.Number, contract.Installment, installmentNumber: 2);
        await sync.RunSyncCycleAsync();

        var copy = await sync.Sphone.ContractAsync(contract.Number);
        Assert.Equal([1, 2], copy.Payments.Select(p => p.InstallmentNumber));
    }
}

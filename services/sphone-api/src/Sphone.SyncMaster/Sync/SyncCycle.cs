namespace Sphone.SyncMaster.Sync;

/// <summary>
/// One sync run between S Phone (PostgreSQL) and the Enterprise System (SQL Server): first push the queued
/// Contracts, then (#10) pull Contract status and Payments changed since the last run. <see cref="SyncWorker"/>
/// runs it every 30 seconds; Seam-2 tests run it once. Resolve it from a fresh DI scope per run.
/// </summary>
public sealed class SyncCycle
{
    private readonly ContractPush _push;

    internal SyncCycle(ContractPush push) => _push = push;

    public async Task RunAsync(CancellationToken cancellationToken)
    {
        await _push.RunAsync(cancellationToken);
        // #10: pull changed Contracts and Payments here, after the push, so a Contract pushed in this
        // cycle can already come back with its Enterprise state.
    }
}

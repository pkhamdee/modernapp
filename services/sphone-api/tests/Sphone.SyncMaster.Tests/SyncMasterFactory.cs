using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Sphone.Data;
using Sphone.SyncMaster.Sync;
using Testcontainers.MsSql;
using Testcontainers.PostgreSql;

[assembly: AssemblyFixture(typeof(Sphone.SyncMaster.Tests.SyncMasterFactory))]

namespace Sphone.SyncMaster.Tests;

/// <summary>
/// Seam-2 harness: hosts sphone-sync-master in-process against a real PostgreSQL (S Phone's database, migrated
/// here the way sphone-api does it) and a real SQL Server holding the fake enterprise schema. The 30-second
/// timer is switched off; tests trigger one sync cycle with <see cref="RunSyncCycleAsync"/>.
/// </summary>
public sealed class SyncMasterFactory : WebApplicationFactory<Program>, IAsyncLifetime
{
    private const string EnterpriseDatabase = "enterprise_test";

    private readonly PostgreSqlContainer _postgres = new PostgreSqlBuilder("postgres:18-alpine").Build();

    private readonly MsSqlContainer _sqlServer = new MsSqlBuilder("mcr.microsoft.com/mssql/server:2022-CU27-ubuntu-22.04").Build();

    /// <summary>S Phone's PostgreSQL, as sphone-api would write it.</summary>
    public SphoneDatabase Sphone { get; private set; } = null!;

    /// <summary>The mock Enterprise System's database, as its admin tool would see it.</summary>
    public EnterpriseDatabase Enterprise { get; private set; } = null!;

    public async ValueTask InitializeAsync()
    {
        await Task.WhenAll(_postgres.StartAsync(), _sqlServer.StartAsync());
        await CreateEnterpriseDatabaseAsync();
        StartServer();

        // sphone-sync-master never migrates; sphone-api does. Play sphone-api's part here.
        await using (var scope = Services.CreateAsyncScope())
        {
            await scope.ServiceProvider.GetRequiredService<SphoneDbContext>().Database.MigrateAsync();
        }

        Sphone = new SphoneDatabase(Services);
        Enterprise = new EnterpriseDatabase(EnterpriseConnectionString);
    }

    /// <summary>Runs exactly one sync cycle, as the 30-second timer would.</summary>
    public async Task RunSyncCycleAsync()
    {
        await using var scope = Services.CreateAsyncScope();
        await scope.ServiceProvider.GetRequiredService<SyncCycle>().RunAsync(TestContext.Current.CancellationToken);
    }

    private string EnterpriseConnectionString =>
        new SqlConnectionStringBuilder(_sqlServer.GetConnectionString()) { InitialCatalog = EnterpriseDatabase }.ConnectionString;

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        builder.UseSetting("ConnectionStrings:Sphone", _postgres.GetConnectionString());
        builder.UseSetting("ConnectionStrings:Enterprise", EnterpriseConnectionString);
        builder.UseSetting("Sync:Enabled", "false");
    }

    private async Task CreateEnterpriseDatabaseAsync()
    {
        await using (var master = new SqlConnection(_sqlServer.GetConnectionString()))
        {
            await master.OpenAsync();
            await using var create = new SqlCommand($"CREATE DATABASE {EnterpriseDatabase}", master);
            await create.ExecuteNonQueryAsync();
        }

        var script = await File.ReadAllTextAsync(Path.Combine(AppContext.BaseDirectory, "enterprise-schema.sql"));
        await using var connection = new SqlConnection(EnterpriseConnectionString);
        await connection.OpenAsync();
        foreach (var batch in script.Split("\nGO", StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            await using var command = new SqlCommand(batch, connection);
            await command.ExecuteNonQueryAsync();
        }
    }

    public override async ValueTask DisposeAsync()
    {
        await base.DisposeAsync();
        await _postgres.DisposeAsync();
        await _sqlServer.DisposeAsync();
    }
}

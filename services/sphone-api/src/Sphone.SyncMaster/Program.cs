using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Sphone.Data;
using Sphone.SyncMaster.Enterprise;
using Sphone.SyncMaster.Sync;

var builder = WebApplication.CreateBuilder(args);

// Structured JSON logs to stdout (read with kubectl logs).
builder.Logging.ClearProviders();
builder.Logging.AddJsonConsole(options =>
{
    options.UseUtcTimestamp = true;
    options.TimestampFormat = "yyyy-MM-ddTHH:mm:ss.fffZ";
    options.IncludeScopes = true;
});

builder.Services.AddSingleton(TimeProvider.System);

// S Phone's PostgreSQL. sphone-api owns and migrates the schema; sync-master never migrates.
builder.Services.AddSphoneData(
    builder.Configuration.GetConnectionString("Sphone")
        ?? throw new InvalidOperationException("Connection string 'Sphone' is not configured."));

// The Enterprise System's SQL Server database (enterprise_dev / enterprise_prod).
builder.Services.AddSingleton(new EnterpriseSystem(
    builder.Configuration.GetConnectionString("Enterprise")
        ?? throw new InvalidOperationException("Connection string 'Enterprise' is not configured.")));

builder.Services.AddScoped<ContractPush>();
builder.Services.AddScoped(services => new SyncCycle(services.GetRequiredService<ContractPush>()));
builder.Services.AddHostedService<SyncWorker>();

builder.Services.AddHealthChecks()
    .AddDbContextCheck<SphoneDbContext>("sphone-db", tags: ["ready"])
    .AddCheck<EnterpriseHealthCheck>("enterprise-db", tags: ["ready"]);

var app = builder.Build();

// No HTTP surface beyond the probes.
app.MapHealthChecks("/healthz/live", new HealthCheckOptions { Predicate = _ => false });
app.MapHealthChecks("/healthz/ready", new HealthCheckOptions { Predicate = check => check.Tags.Contains("ready") });

await app.RunAsync();

public partial class Program;

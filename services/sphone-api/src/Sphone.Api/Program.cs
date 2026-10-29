using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Microsoft.EntityFrameworkCore;
using Sphone.Api.Auth;
using Sphone.Api.Branches;
using Sphone.Api.Catalog;
using Sphone.Api.ThirdParty;
using Sphone.Data;

var builder = WebApplication.CreateBuilder(args);

// Structured JSON logs to stdout (read with kubectl logs).
builder.Logging.ClearProviders();
builder.Logging.AddJsonConsole(options =>
{
    options.UseUtcTimestamp = true;
    options.TimestampFormat = "yyyy-MM-ddTHH:mm:ss.fffZ";
    options.IncludeScopes = true;
});

// Clock port: all time-dependent rules read the time from TimeProvider; tests replace it.
builder.Services.AddSingleton(TimeProvider.System);

builder.Services.AddSphoneData(
    builder.Configuration.GetConnectionString("Sphone")
        ?? throw new InvalidOperationException("Connection string 'Sphone' is not configured."));

// Third-party ports (SMS, later ID Verification and Credit Check) → thirdparty-mock; tests replace them.
builder.Services.AddThirdParties(builder.Configuration);

// sphone-api issues its own Customer and Staff tokens (Auth:SigningKey, per environment).
builder.Services.AddSphoneAuth(builder.Configuration);

builder.Services.AddHealthChecks()
    .AddDbContextCheck<SphoneDbContext>(tags: ["ready"]);

builder.Services.AddProblemDetails();

var app = builder.Build();

if (app.Configuration.GetValue<bool>("Database:MigrateOnStartup"))
{
    await using var scope = app.Services.CreateAsyncScope();
    await scope.ServiceProvider.GetRequiredService<SphoneDbContext>().Database.MigrateAsync();
}

app.UseExceptionHandler();
app.UseStatusCodePages();
app.UseAuthentication();
app.UseAuthorization();

// Probes stay outside /api so the Gateway never exposes them.
app.MapHealthChecks("/healthz/live", new HealthCheckOptions { Predicate = _ => false });
app.MapHealthChecks("/healthz/ready", new HealthCheckOptions { Predicate = check => check.Tags.Contains("ready") });

var api = app.MapGroup("/api");
api.MapCatalogEndpoints();
api.MapBranchEndpoints();
api.MapAuthEndpoints();

await app.RunAsync();

public partial class Program;

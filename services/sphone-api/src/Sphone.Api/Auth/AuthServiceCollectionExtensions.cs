using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.IdentityModel.Tokens;

namespace Sphone.Api.Auth;

internal static class AuthServiceCollectionExtensions
{
    /// <summary>
    /// Bearer-token authentication for tokens sphone-api issues itself, plus one authorization policy
    /// per role (<see cref="Roles"/>). Token lifetimes are checked against the <see cref="TimeProvider"/>
    /// clock port, so tests that move the clock also move token expiry.
    /// </summary>
    public static IServiceCollection AddSphoneAuth(this IServiceCollection services, IConfiguration configuration)
    {
        var settings = new AuthSettings(configuration);
        services.AddSingleton(settings);
        services.AddSingleton<TokenIssuer>();

        services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme).AddJwtBearer();
        services.AddOptions<JwtBearerOptions>(JwtBearerDefaults.AuthenticationScheme)
            .Configure<TimeProvider>((options, clock) =>
            {
                options.MapInboundClaims = false;
                options.TokenValidationParameters = new TokenValidationParameters
                {
                    ValidIssuer = AuthSettings.Issuer,
                    ValidAudience = AuthSettings.Audience,
                    IssuerSigningKey = settings.SigningKey,
                    ValidAlgorithms = [SecurityAlgorithms.HmacSha256],
                    NameClaimType = SphoneClaims.Subject,
                    RoleClaimType = SphoneClaims.Role,
                    LifetimeValidator = (notBefore, expires, _, _) =>
                    {
                        var now = clock.GetUtcNow().UtcDateTime;
                        return (notBefore is null || notBefore <= now) && expires > now;
                    },
                };
            });

        services.AddAuthorizationBuilder()
            .AddPolicy(Roles.Customer, policy => policy.RequireRole(Roles.Customer))
            .AddPolicy(Roles.Staff, policy => policy.RequireRole(Roles.Staff));

        return services;
    }
}

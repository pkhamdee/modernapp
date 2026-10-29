namespace Sphone.Api.ThirdParty;

/// <summary>
/// Registers the real adapters for the third-party ports. All of them talk to thirdparty-mock
/// (<c>ThirdParty:BaseUrl</c>); ID Verification and Credit Check are added here the same way.
/// </summary>
internal static class ThirdPartyServiceCollectionExtensions
{
    public static IServiceCollection AddThirdParties(this IServiceCollection services, IConfiguration configuration)
    {
        var baseUrl = new Uri(EnsureTrailingSlash(configuration["ThirdParty:BaseUrl"] ?? "http://localhost:4000/"));

        services.AddHttpClient<ISmsSender, ThirdPartyMockSmsSender>(http =>
        {
            http.BaseAddress = baseUrl;
            http.Timeout = TimeSpan.FromSeconds(10);
        });

        return services;
    }

    private static string EnsureTrailingSlash(string url) => url.EndsWith('/') ? url : url + "/";
}

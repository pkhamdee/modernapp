namespace Sphone.Api.Tests;

/// <summary>Unique test data, so tests sharing one database never collide.</summary>
public static class TestData
{
    /// <summary>A fresh 10-digit Thai mobile number (09xxxxxxxx).</summary>
    public static string NewMobileNumber() =>
        "09" + Random.Shared.NextInt64(0, 100_000_000).ToString("D8", System.Globalization.CultureInfo.InvariantCulture);
}

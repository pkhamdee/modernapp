using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace Sphone.Data;

/// <summary>Used only by <c>dotnet ef migrations add</c>; no database connection is made.</summary>
internal sealed class DesignTimeDbContextFactory : IDesignTimeDbContextFactory<SphoneDbContext>
{
    public SphoneDbContext CreateDbContext(string[] args)
    {
        var options = new DbContextOptionsBuilder<SphoneDbContext>();
        DataServiceCollectionExtensions.Configure(options, "Host=localhost;Database=sphone;Username=sphone");
        return new SphoneDbContext(options.Options);
    }
}

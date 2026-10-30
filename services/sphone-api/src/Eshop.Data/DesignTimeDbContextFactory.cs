using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace Eshop.Data;

/// <summary>Used only by <c>dotnet ef migrations add</c>; no database connection is made.</summary>
internal sealed class DesignTimeDbContextFactory : IDesignTimeDbContextFactory<EshopDbContext>
{
    public EshopDbContext CreateDbContext(string[] args)
    {
        var options = new DbContextOptionsBuilder<EshopDbContext>();
        DataServiceCollectionExtensions.Configure(options, "Host=localhost;Database=sphone;Username=sphone");
        return new EshopDbContext(options.Options);
    }
}

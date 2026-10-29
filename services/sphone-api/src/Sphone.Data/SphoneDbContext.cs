using Microsoft.EntityFrameworkCore;
using Sphone.Domain.Branches;
using Sphone.Domain.Catalog;
using Sphone.Domain.Customers;

namespace Sphone.Data;

public class SphoneDbContext(DbContextOptions<SphoneDbContext> options) : DbContext(options)
{
    public DbSet<ProductCategory> ProductCategories => Set<ProductCategory>();

    public DbSet<Product> Products => Set<Product>();

    public DbSet<Branch> Branches => Set<Branch>();

    public DbSet<Customer> Customers => Set<Customer>();

    public DbSet<SmsCode> SmsCodes => Set<SmsCode>();

    protected override void OnModelCreating(ModelBuilder modelBuilder) =>
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(SphoneDbContext).Assembly);
}

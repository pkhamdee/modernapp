using Microsoft.EntityFrameworkCore;
using Sphone.Domain.Applications;
using Sphone.Domain.Branches;
using Sphone.Domain.Catalog;
using Sphone.Domain.Customers;
using Sphone.Domain.Staff;

namespace Sphone.Data;

public class SphoneDbContext(DbContextOptions<SphoneDbContext> options) : DbContext(options)
{
    public DbSet<ProductCategory> ProductCategories => Set<ProductCategory>();

    public DbSet<Product> Products => Set<Product>();

    public DbSet<Branch> Branches => Set<Branch>();

    public DbSet<Customer> Customers => Set<Customer>();

    public DbSet<SmsCode> SmsCodes => Set<SmsCode>();

    public DbSet<Application> Applications => Set<Application>();

    public DbSet<StaffMember> StaffMembers => Set<StaffMember>();

    protected override void OnModelCreating(ModelBuilder modelBuilder) =>
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(SphoneDbContext).Assembly);
}

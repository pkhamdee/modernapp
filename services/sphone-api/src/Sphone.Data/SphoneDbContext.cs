using Microsoft.EntityFrameworkCore;
using Sphone.Domain.Applications;
using Sphone.Domain.Auctions;
using Sphone.Domain.Branches;
using Sphone.Domain.Catalog;
using Sphone.Domain.Contracts;
using Sphone.Domain.Customers;
using Sphone.Domain.Handovers;
using Sphone.Domain.Offers;
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

    public DbSet<Offer> Offers => Set<Offer>();

    public DbSet<Contract> Contracts => Set<Contract>();

    public DbSet<ContractNumberCounter> ContractNumberCounters => Set<ContractNumberCounter>();

    /// <summary>Contracts queued for sphone-sync-master to push to the Enterprise System (ADR-0001).</summary>
    public DbSet<ContractOutboxEntry> ContractOutbox => Set<ContractOutboxEntry>();

    /// <summary>The Handover of each Contract's Product: S Phone's operational record beside the Contract.</summary>
    public DbSet<Handover> Handovers => Set<Handover>();

    /// <summary>Submissions that failed Eligibility after ID Verification (under 20): never Applications.</summary>
    public DbSet<EligibilityRefusal> EligibilityRefusals => Set<EligibilityRefusal>();

    public DbSet<Auction> Auctions => Set<Auction>();

    public DbSet<Lot> Lots => Set<Lot>();

    public DbSet<Bid> Bids => Set<Bid>();

    protected override void OnModelCreating(ModelBuilder modelBuilder) =>
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(SphoneDbContext).Assembly);
}

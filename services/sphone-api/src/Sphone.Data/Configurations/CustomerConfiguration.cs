using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Sphone.Domain.Customers;

namespace Sphone.Data.Configurations;

internal sealed class CustomerConfiguration : IEntityTypeConfiguration<Customer>
{
    public void Configure(EntityTypeBuilder<Customer> builder)
    {
        builder.HasIndex(c => c.MobileNumber).IsUnique();
        builder.Property(c => c.MobileNumber).HasMaxLength(10);
    }
}

using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Sphone.Domain.Branches;

namespace Sphone.Data.Configurations;

internal sealed class BranchConfiguration : IEntityTypeConfiguration<Branch>
{
    public void Configure(EntityTypeBuilder<Branch> builder)
    {
        builder.HasIndex(b => b.Code).IsUnique();
        builder.Property(b => b.Code).HasMaxLength(50);
        builder.Property(b => b.Name).HasMaxLength(200);
        builder.Property(b => b.Address).HasMaxLength(500);
        builder.Property(b => b.Province).HasMaxLength(100);
    }
}

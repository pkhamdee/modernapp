using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Sphone.Domain.Applications;
using Sphone.Domain.Customers;

namespace Sphone.Data.Configurations;

internal sealed class EligibilityRefusalConfiguration : IEntityTypeConfiguration<EligibilityRefusal>
{
    public void Configure(EntityTypeBuilder<EligibilityRefusal> builder)
    {
        builder.HasIndex(r => new { r.CustomerId, r.SubmissionId }).IsUnique();
        builder.Property(r => r.IdNumber).HasMaxLength(13);
        builder.Property(r => r.Reason).HasConversion<string>().HasMaxLength(30);
        builder.HasOne<Customer>().WithMany().HasForeignKey(r => r.CustomerId).OnDelete(DeleteBehavior.Restrict);
    }
}

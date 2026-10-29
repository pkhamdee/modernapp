using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Sphone.Domain.Customers;

namespace Sphone.Data.Configurations;

internal sealed class SmsCodeConfiguration : IEntityTypeConfiguration<SmsCode>
{
    public void Configure(EntityTypeBuilder<SmsCode> builder)
    {
        builder.HasIndex(c => new { c.MobileNumber, c.Purpose, c.CreatedAt });
        builder.Property(c => c.MobileNumber).HasMaxLength(10);
        builder.Property(c => c.Purpose).HasConversion<string>().HasMaxLength(30);
        builder.Property(c => c.CodeHash).HasMaxLength(64);
    }
}

namespace Sphone.Domain.Applications;

/// <summary>Why a Customer can't submit an Application right now.</summary>
public enum IneligibleReason
{
    /// <summary>The Customer has an active Contract (for now: an Approved Application, which leads to one; see <see cref="Eligibility.Check"/>).</summary>
    ActiveContract,

    /// <summary>An earlier Application is still being reviewed.</summary>
    ApplicationInProgress,

    /// <summary>Within 30 days of a Rejected Application.</summary>
    RecentlyRejected,
}

/// <summary>
/// The rules a Customer must meet before an Application can be submitted (GLOSSARY: Eligibility): aged 20 or
/// over (known only after ID Verification, see <see cref="IsOldEnough"/>), no active Contract, and not within
/// 30 days of a Rejected Application. A time-out Rejection does not count.
/// </summary>
public sealed record Eligibility(bool IsEligible, IneligibleReason? Reason, DateTimeOffset? ReapplyFrom)
{
    public const int MinimumAge = 20;

    public static Eligibility Eligible { get; } = new(true, null, null);

    private static readonly TimeSpan Bangkok = TimeSpan.FromHours(7);

    /// <summary>
    /// Checks the rules that are known before ID Verification, from the Customer's earlier Applications
    /// (and any made with the same ID number).
    /// </summary>
    public static Eligibility Check(IEnumerable<Application> earlierApplications, DateTimeOffset now)
    {
        var applications = earlierApplications.ToList();

        // Until Offers and Contracts exist (#16), an Approved Application stands for the Contract it leads to.
        // #16: replace with "has an active Contract, or an Approved Application whose Offer is still open".
        if (applications.Any(a => a.Status == ApplicationStatus.Approved))
        {
            return new(false, IneligibleReason.ActiveContract, null);
        }

        if (applications.Any(a => a.Status == ApplicationStatus.Reviewing))
        {
            return new(false, IneligibleReason.ApplicationInProgress, null);
        }

        var reapplyFrom = applications.Select(a => a.ReapplyFrom).Max();
        return reapplyFrom > now ? new(false, IneligibleReason.RecentlyRejected, reapplyFrom) : Eligible;
    }

    /// <summary>Aged 20 or over today (Asia/Bangkok): a 20th birthday today counts.</summary>
    public static bool IsOldEnough(DateOnly dateOfBirth, DateTimeOffset now)
    {
        var today = DateOnly.FromDateTime(now.ToOffset(Bangkok).DateTime);
        return dateOfBirth.AddYears(MinimumAge) <= today;
    }
}

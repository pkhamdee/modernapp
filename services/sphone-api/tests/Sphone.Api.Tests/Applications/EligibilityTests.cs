using System.Net;

namespace Sphone.Api.Tests.Applications;

// Eligibility (GLOSSARY): aged 20 or over (from ID Verification), no active Contract, not within 30 days of a
// Rejected Application. Failing it creates no Application and says why (and when to reapply).
public sealed class EligibilityTests(SphoneApiFactory api)
{
    private static readonly DateOnly Adult = new(1988, 9, 1);

    [Fact]
    public async Task A_new_Customer_is_eligible()
    {
        var customer = await api.CreateCustomerClientAsync();

        Assert.Equal(new EligibilityView(true, null, null), await customer.EligibilityAsync());
    }

    [Fact]
    public async Task A_Customer_with_an_active_Contract_is_told_before_starting_and_cannot_submit()
    {
        // Until Contracts exist (#16), an Approved Application stands for the Contract it leads to.
        var customer = await api.CreateCustomerClientAsync();
        var idNumber = TestData.NewIdNumber();
        api.IdVerification.Verifies(idNumber, "สมชาย ใจดี", Adult);
        api.CreditCheck.Passes(idNumber, 50_000m);
        var iPhone = await customer.IPhone17Async();
        Assert.Equal("approved", (await customer.ApplyAndWaitAsync(new ApplicationForm(iPhone, idNumber))).Status);

        Assert.Equal(new EligibilityView(false, "active-contract", null), await customer.EligibilityAsync());

        var photo = TestData.NewPhoto();
        var again = await customer.SubmitAsync(new ApplicationForm(iPhone, idNumber) { Photo = photo });
        Assert.Equal(HttpStatusCode.Conflict, again.StatusCode);
        Assert.Equal("active-contract", (await again.ProblemAsync()).Error);
        Assert.Equal((false, false), api.Images.WhereStored(photo)); // nothing stored: no Application exists
    }

    [Fact]
    public async Task A_Customer_whose_Application_is_being_reviewed_cannot_submit_another()
    {
        var customer = await api.CreateCustomerClientAsync();
        var idNumber = TestData.NewIdNumber();
        api.IdVerification.NeverAnswers(idNumber);
        var iPhone = await customer.IPhone17Async();
        await customer.SubmitAcceptedAsync(new ApplicationForm(iPhone, idNumber));

        Assert.Equal(new EligibilityView(false, "application-in-progress", null), await customer.EligibilityAsync());
        var again = await customer.SubmitAsync(new ApplicationForm(iPhone, TestData.NewIdNumber()));
        Assert.Equal(HttpStatusCode.Conflict, again.StatusCode);
        Assert.Equal("application-in-progress", (await again.ProblemAsync()).Error);
    }

    [Fact]
    public async Task A_Customer_within_30_days_of_a_Rejected_Application_is_told_when_they_may_apply_again()
    {
        var customer = await api.CreateCustomerClientAsync();
        var idNumber = TestData.NewIdNumber();
        api.IdVerification.Verifies(idNumber, "มาลี รักไทย", Adult);
        api.CreditCheck.Fails(idNumber);
        var iPhone = await customer.IPhone17Async();
        var rejected = await customer.ApplyAndWaitAsync(new ApplicationForm(iPhone, idNumber));
        var reapplyFrom = rejected.DecidedAt!.Value + TimeSpan.FromDays(30);

        Assert.Equal(new EligibilityView(false, "recently-rejected", reapplyFrom), await customer.EligibilityAsync());

        var again = await customer.SubmitAsync(new ApplicationForm(iPhone, idNumber));
        Assert.Equal(HttpStatusCode.Conflict, again.StatusCode);
        var problem = await again.ProblemAsync();
        Assert.Equal(("recently-rejected", reapplyFrom), (problem.Error, problem.ReapplyFrom));
    }

    [Fact]
    public async Task The_30_day_wait_follows_the_ID_number_to_another_mobile_number()
    {
        var first = await api.CreateCustomerClientAsync();
        var idNumber = TestData.NewIdNumber();
        api.IdVerification.Fails(idNumber);
        var iPhone = await first.IPhone17Async();
        await first.ApplyAndWaitAsync(new ApplicationForm(iPhone, idNumber));

        var second = await api.CreateCustomerClientAsync();
        var again = await second.SubmitAsync(new ApplicationForm(iPhone, idNumber));

        Assert.Equal(HttpStatusCode.Conflict, again.StatusCode);
        Assert.Equal("recently-rejected", (await again.ProblemAsync()).Error);
    }

    [Fact]
    public async Task A_Customer_under_20_is_told_they_are_not_eligible_once_their_ID_is_verified()
    {
        var customer = await api.CreateCustomerClientAsync();
        var idNumber = TestData.NewIdNumber();
        var twentiethBirthdayTomorrow = BangkokToday().AddYears(-20).AddDays(1);
        api.IdVerification.Verifies(idNumber, "เด็กชาย ทดสอบ", twentiethBirthdayTomorrow);
        api.CreditCheck.Passes(idNumber, 50_000m);

        var result = await customer.ApplyAndWaitAsync(new ApplicationForm(await customer.IPhone17Async(), idNumber));

        Assert.Equal(("not-eligible", "under-20"), (result.Status, result.Reason));
        Assert.Null(result.ReapplyFrom);
        Assert.False(api.CreditCheck.WasAskedAbout(idNumber)); // no Credit Decision
        Assert.True((await customer.MeAsync()).IdVerified);
        Assert.Equal(new EligibilityView(true, null, null), await customer.EligibilityAsync()); // no 30-day wait
    }

    [Fact]
    public async Task A_Customer_whose_20th_birthday_is_today_is_eligible()
    {
        var customer = await api.CreateCustomerClientAsync();
        var idNumber = TestData.NewIdNumber();
        api.IdVerification.Verifies(idNumber, "สุดา ครบยี่สิบ", BangkokToday().AddYears(-20));
        api.CreditCheck.Passes(idNumber, 50_000m);

        var result = await customer.ApplyAndWaitAsync(new ApplicationForm(await customer.IPhone17Async(), idNumber));

        Assert.Equal("approved", result.Status);
    }

    private DateOnly BangkokToday() => DateOnly.FromDateTime(api.Clock.GetUtcNow().ToOffset(TimeSpan.FromHours(7)).DateTime);
}

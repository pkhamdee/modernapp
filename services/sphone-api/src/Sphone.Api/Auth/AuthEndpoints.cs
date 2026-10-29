using System.Security.Claims;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.EntityFrameworkCore;
using Sphone.Api.ThirdParty;
using Sphone.Data;
using Sphone.Domain.Customers;

namespace Sphone.Api.Auth;

/// <summary>
/// Sign-in. Customers: request an SMS code, then verify it to get a Customer token (the first sign-in
/// creates the Customer). <c>GET /auth/me</c> returns who the token belongs to, for any role.
/// </summary>
internal static partial class AuthEndpoints
{
    public static readonly TimeSpan CustomerTokenLifetime = TimeSpan.FromDays(7);

    public static IEndpointRouteBuilder MapAuthEndpoints(this IEndpointRouteBuilder api)
    {
        var auth = api.MapGroup("/auth").WithTags("Auth");
        auth.MapPost("/sms-code", RequestSmsCode);
        auth.MapPost("/sms-code/verify", VerifySmsCode);
        auth.MapGet("/me", Me).RequireAuthorization();

        return api;
    }

    private static async Task<Results<Accepted, ProblemHttpResult>> RequestSmsCode(
        SmsCodeRequest request, SphoneDbContext db, ISmsSender sms, TimeProvider clock, CancellationToken cancellationToken)
    {
        if (!IsMobileNumber(request.MobileNumber))
        {
            return InvalidMobileNumber();
        }

        var (smsCode, code) = SmsCode.Issue(request.MobileNumber, SmsCodePurpose.SignIn, clock.GetUtcNow());
        db.SmsCodes.Add(smsCode);
        await db.SaveChangesAsync(cancellationToken);

        var minutes = (int)SmsCode.Lifetime.TotalMinutes;
        await sms.SendAsync(
            request.MobileNumber,
            $"รหัสเข้าสู่ระบบ S Phone ของคุณคือ {code} (ใช้ได้ภายใน {minutes} นาที) ห้ามบอกรหัสนี้กับผู้อื่น",
            cancellationToken);

        return TypedResults.Accepted((string?)null);
    }

    private static async Task<Results<Ok<SessionResponse>, ProblemHttpResult>> VerifySmsCode(
        SmsCodeVerifyRequest request, SphoneDbContext db, TokenIssuer tokens, TimeProvider clock,
        CancellationToken cancellationToken)
    {
        if (!IsMobileNumber(request.MobileNumber))
        {
            return InvalidMobileNumber();
        }

        // Only the most recent code counts: requesting a new code replaces the old one.
        var smsCode = await db.SmsCodes
            .Where(c => c.MobileNumber == request.MobileNumber && c.Purpose == SmsCodePurpose.SignIn)
            .OrderByDescending(c => c.CreatedAt).ThenByDescending(c => c.Id)
            .FirstOrDefaultAsync(cancellationToken);

        var now = clock.GetUtcNow();
        var check = smsCode?.Check(request.Code ?? string.Empty, now) ?? SmsCodeCheck.Invalid;
        await db.SaveChangesAsync(cancellationToken);

        if (check != SmsCodeCheck.Accepted)
        {
            return CodeRefused(check);
        }

        var customer = await db.Customers.SingleOrDefaultAsync(c => c.MobileNumber == request.MobileNumber, cancellationToken);
        if (customer is null)
        {
            customer = new Customer { MobileNumber = request.MobileNumber, CreatedAt = now };
            db.Customers.Add(customer);
            await db.SaveChangesAsync(cancellationToken);
        }

        var token = tokens.Issue(
            Roles.Customer,
            customer.Id.ToString(System.Globalization.CultureInfo.InvariantCulture),
            CustomerTokenLifetime,
            [new Claim(SphoneClaims.MobileNumber, customer.MobileNumber)]);

        return TypedResults.Ok(new SessionResponse(token.Token, token.ExpiresAt, token.Role, customer.MobileNumber));
    }

    private static async Task<MeResponse> Me(ClaimsPrincipal user, SphoneDbContext db, CancellationToken cancellationToken)
    {
        var customerId = user.CustomerId();
        var idVerified = customerId is not null
            && await db.Customers.AnyAsync(c => c.Id == customerId && c.IdVerifiedAt != null, cancellationToken);
        return new(
            user.FindFirstValue(SphoneClaims.Role) ?? string.Empty, user.FindFirstValue(SphoneClaims.MobileNumber), customerId, idVerified);
    }

    private static bool IsMobileNumber([System.Diagnostics.CodeAnalysis.NotNullWhen(true)] string? value) => value is not null && ThaiMobileNumber().IsMatch(value);

    private static ProblemHttpResult InvalidMobileNumber() =>
        TypedResults.Problem(
            statusCode: StatusCodes.Status400BadRequest,
            title: "เบอร์โทรศัพท์มือถือไม่ถูกต้อง",
            extensions: new Dictionary<string, object?> { ["error"] = "mobile-number-invalid" });

    private static ProblemHttpResult CodeRefused(SmsCodeCheck check) =>
        check switch
        {
            SmsCodeCheck.Expired => Refused("code-expired", "รหัสหมดอายุแล้ว กรุณาขอรหัสใหม่"),
            SmsCodeCheck.Locked => Refused("code-locked", "ใส่รหัสผิดเกินจำนวนครั้งที่กำหนด กรุณาขอรหัสใหม่"),
            _ => Refused("code-invalid", "รหัสไม่ถูกต้อง"),
        };

    private static ProblemHttpResult Refused(string error, string title) =>
        TypedResults.Problem(
            statusCode: StatusCodes.Status400BadRequest,
            title: title,
            extensions: new Dictionary<string, object?> { ["error"] = error });

    [GeneratedRegex(@"^0[6-9][0-9]{8}$")]
    private static partial Regex ThaiMobileNumber();
}

internal sealed record SmsCodeRequest(string? MobileNumber);

internal sealed record SmsCodeVerifyRequest(string? MobileNumber, string? Code);

internal sealed record SessionResponse(string Token, DateTimeOffset ExpiresAt, string Role, string? MobileNumber);

// IdVerified: the Customer has passed ID Verification (false for Staff).
internal sealed record MeResponse(string Role, string? MobileNumber, int? CustomerId, bool IdVerified);

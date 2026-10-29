using System.Net;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Sphone.Api.Tests.Applications;
using Sphone.Api.Tests.Offers;
using Sphone.Data;

namespace Sphone.Api.Tests.Handovers;

// Story 41: a Contract cancelled in the Enterprise System stops its Handover. The cancellation arrives through
// sphone-sync-master (#10), which only sets the Contract's status; the test does the same at that seam.
public sealed class CancelledContractHandoverTests(SphoneApiFactory api)
{
    [Fact]
    public async Task A_cancelled_Contract_leaves_the_list_and_its_Handover_cannot_go_on()
    {
        var accepted = await api.AcceptedContractAsync(downPayment: 2_000m);
        var staff = await api.CreateStaffClientAsync();
        await staff.MoveThroughAsync(accepted.Number, "ready-for-pickup");

        await CancelInEnterpriseSystemAsync(accepted.Number);

        Assert.DoesNotContain(await staff.HandoversAsync(), h => h.ContractNumber == accepted.Number);
        var handover = await staff.HandoverAsync(accepted.Number);
        Assert.Equal((true, "cancelled", "ready-for-pickup"), (handover.Stopped, handover.ContractStatus, handover.Stage));
        Assert.Empty(handover.NextStages);

        using var downPayment = await staff.RecordDownPaymentAsync(accepted.Number, 2_000m);
        Assert.Equal(HttpStatusCode.Conflict, downPayment.StatusCode);
        Assert.Equal("handover-stopped", (await downPayment.ProblemAsync()).Error);
        using var handOver = await staff.MoveToAsync(accepted.Number, "handed-over");
        Assert.Equal("handover-stopped", (await handOver.ProblemAsync()).Error);

        var contract = await accepted.Customer.GetContractAsync(accepted.Number);
        Assert.Equal(("cancelled", "stopped"), (contract.Status, contract.HandoverStage));
        Assert.All(contract.Installments, i => Assert.Null(i.DueDate));
    }

    private async Task CancelInEnterpriseSystemAsync(string contractNumber)
    {
        await using var scope = api.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<SphoneDbContext>();
        var contract = await db.Contracts.SingleAsync(c => c.Number == contractNumber, HandingOver.Ct);
        contract.Status = Domain.Contracts.ContractStatus.Cancelled;
        await db.SaveChangesAsync(HandingOver.Ct);
    }
}

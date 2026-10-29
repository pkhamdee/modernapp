using Microsoft.Data.SqlClient;

namespace Sphone.SyncMaster.Enterprise;

/// <summary>A Contract as the Enterprise System receives it (fake enterprise schema, table <c>hp.contract</c>).</summary>
internal sealed record EnterpriseContract(
    string Number,
    string IdNumber,
    string CustomerName,
    string MobileNumber,
    string ProductName,
    decimal CashPrice,
    decimal DownPayment,
    decimal FlatRate,
    int Term,
    decimal Installment,
    decimal TotalPayable,
    DateTimeOffset ContractDate);

/// <summary>
/// The Enterprise System's SQL Server database (mocked by a real SQL Server, ADR-0003), reached with the
/// production driver and dialect. One connection per call; SqlClient pools them.
/// </summary>
internal sealed class EnterpriseSystem(string connectionString)
{
    /// <summary>
    /// Hands a Contract over to the Enterprise System, idempotently on its number: if the Enterprise System
    /// already has it (an earlier push whose outbox mark was lost), nothing changes, because from the first
    /// push on the Enterprise System owns the Contract (ADR-0001). Returns whether this call inserted it.
    /// </summary>
    public async Task<bool> PushContractAsync(EnterpriseContract contract, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        // HOLDLOCK: two concurrent pushes of the same number serialise on the key range instead of racing.
        await using var command = new SqlCommand(
            """
            MERGE hp.contract WITH (HOLDLOCK) AS target
            USING (SELECT @contract_no AS contract_no) AS source ON target.contract_no = source.contract_no
            WHEN NOT MATCHED THEN
                INSERT (contract_no, customer_id_no, customer_name, customer_mobile_no, product_name, cash_price,
                        down_payment, flat_rate, term_months, installment_amount, total_payable, contract_date)
                VALUES (@contract_no, @customer_id_no, @customer_name, @customer_mobile_no, @product_name, @cash_price,
                        @down_payment, @flat_rate, @term_months, @installment_amount, @total_payable, @contract_date);
            """,
            connection);
        command.Parameters.Add("@contract_no", System.Data.SqlDbType.VarChar, 16).Value = contract.Number;
        command.Parameters.Add("@customer_id_no", System.Data.SqlDbType.Char, 13).Value = contract.IdNumber;
        command.Parameters.Add("@customer_name", System.Data.SqlDbType.NVarChar, 200).Value = contract.CustomerName;
        command.Parameters.Add("@customer_mobile_no", System.Data.SqlDbType.VarChar, 10).Value = contract.MobileNumber;
        command.Parameters.Add("@product_name", System.Data.SqlDbType.NVarChar, 200).Value = contract.ProductName;
        AddMoney(command, "@cash_price", contract.CashPrice);
        AddMoney(command, "@down_payment", contract.DownPayment);
        var flatRate = command.Parameters.Add("@flat_rate", System.Data.SqlDbType.Decimal);
        flatRate.Precision = 6;
        flatRate.Scale = 4;
        flatRate.Value = contract.FlatRate;
        command.Parameters.Add("@term_months", System.Data.SqlDbType.Int).Value = contract.Term;
        AddMoney(command, "@installment_amount", contract.Installment);
        AddMoney(command, "@total_payable", contract.TotalPayable);
        command.Parameters.Add("@contract_date", System.Data.SqlDbType.DateTimeOffset).Value = contract.ContractDate;

        return await command.ExecuteNonQueryAsync(cancellationToken) == 1;
    }

    /// <summary>Readiness: the Enterprise database answers.</summary>
    public async Task CheckAsync(CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        await using var command = new SqlCommand("SELECT 1", connection);
        await command.ExecuteScalarAsync(cancellationToken);
    }

    private async Task<SqlConnection> OpenAsync(CancellationToken cancellationToken)
    {
        var connection = new SqlConnection(connectionString);
        await connection.OpenAsync(cancellationToken);
        return connection;
    }

    private static void AddMoney(SqlCommand command, string name, decimal value)
    {
        var parameter = command.Parameters.Add(name, System.Data.SqlDbType.Decimal);
        parameter.Precision = 12;
        parameter.Scale = 2;
        parameter.Value = value;
    }
}

#!/bin/bash
# Runs in the mssql pod's `schema` container: waits for SQL Server, creates enterprise_dev and enterprise_prod,
# applies the fake enterprise schema to each (idempotent), (re)creates the logins from the mssql-credentials
# Secret, then marks itself ready and idles. Re-runs on every pod start, so schema/login changes roll out by
# restarting the pod (the ConfigMap name hash does that automatically).
set -euo pipefail

sqlcmd=(/opt/mssql-tools18/bin/sqlcmd -C -S localhost -U sa -b)
export SQLCMDPASSWORD="$MSSQL_SA_PASSWORD"

until "${sqlcmd[@]}" -Q "SELECT 1" >/dev/null 2>&1; do
  echo "waiting for SQL Server"
  sleep 5
done

for db in enterprise_dev enterprise_prod; do
  "${sqlcmd[@]}" -Q "IF DB_ID(N'$db') IS NULL CREATE DATABASE [$db]"
  "${sqlcmd[@]}" -d "$db" -i /init/enterprise-schema.sql
  echo "schema applied to $db"
done

"${sqlcmd[@]}" -i /init/logins.sql \
  -v ADMIN_PASSWORD="$ADMIN_PASSWORD" SYNC_DEV_PASSWORD="$SYNC_DEV_PASSWORD" SYNC_PROD_PASSWORD="$SYNC_PROD_PASSWORD"
echo "logins applied"

touch /tmp/initialized
exec sleep infinity

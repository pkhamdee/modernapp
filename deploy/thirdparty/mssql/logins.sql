-- Logins of the mock Enterprise System (run by init.sh with sqlcmd variables from the mssql-credentials Secret).
-- Passwords are reset on every run, so the Secret stays the source of truth.
--   sphone_sync_dev / sphone_sync_prod: eshop-sync-master of each environment; read/write its own database only.
--   enterprise_admin: the admin tool in thirdparty-mock; read/write both databases.

IF SUSER_ID(N'sphone_sync_dev') IS NULL
    CREATE LOGIN sphone_sync_dev WITH PASSWORD = N'$(SYNC_DEV_PASSWORD)', DEFAULT_DATABASE = enterprise_dev, CHECK_POLICY = OFF;
ELSE
    ALTER LOGIN sphone_sync_dev WITH PASSWORD = N'$(SYNC_DEV_PASSWORD)';

IF SUSER_ID(N'sphone_sync_prod') IS NULL
    CREATE LOGIN sphone_sync_prod WITH PASSWORD = N'$(SYNC_PROD_PASSWORD)', DEFAULT_DATABASE = enterprise_prod, CHECK_POLICY = OFF;
ELSE
    ALTER LOGIN sphone_sync_prod WITH PASSWORD = N'$(SYNC_PROD_PASSWORD)';

IF SUSER_ID(N'enterprise_admin') IS NULL
    CREATE LOGIN enterprise_admin WITH PASSWORD = N'$(ADMIN_PASSWORD)', DEFAULT_DATABASE = enterprise_dev, CHECK_POLICY = OFF;
ELSE
    ALTER LOGIN enterprise_admin WITH PASSWORD = N'$(ADMIN_PASSWORD)';
GO

USE enterprise_dev;
IF USER_ID(N'sphone_sync_dev') IS NULL CREATE USER sphone_sync_dev FOR LOGIN sphone_sync_dev;
IF USER_ID(N'enterprise_admin') IS NULL CREATE USER enterprise_admin FOR LOGIN enterprise_admin;
ALTER ROLE db_datareader ADD MEMBER sphone_sync_dev;
ALTER ROLE db_datawriter ADD MEMBER sphone_sync_dev;
ALTER ROLE db_datareader ADD MEMBER enterprise_admin;
ALTER ROLE db_datawriter ADD MEMBER enterprise_admin;
GO

USE enterprise_prod;
IF USER_ID(N'sphone_sync_prod') IS NULL CREATE USER sphone_sync_prod FOR LOGIN sphone_sync_prod;
IF USER_ID(N'enterprise_admin') IS NULL CREATE USER enterprise_admin FOR LOGIN enterprise_admin;
ALTER ROLE db_datareader ADD MEMBER sphone_sync_prod;
ALTER ROLE db_datawriter ADD MEMBER sphone_sync_prod;
ALTER ROLE db_datareader ADD MEMBER enterprise_admin;
ALTER ROLE db_datawriter ADD MEMBER enterprise_admin;
GO

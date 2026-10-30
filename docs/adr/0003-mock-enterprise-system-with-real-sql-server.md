# Mock the Enterprise System with a real SQL Server

The Enterprise System is mocked by the real `mssql/server` image seeded with a fake enterprise schema, not by a Postgres stand-in or an HTTP stub, so eshop-sync-master uses the same driver, SQL dialect and port (1433) as it would in production. The image is x86-only, so on Apple Silicon it runs under Rosetta emulation in Rancher Desktop, costing about 2 GB of memory and slow start-up; we accept that, and share one instance between `sphone-dev` and `sphone-prod` (separate databases) in the `thirdparty` namespace to contain the cost.

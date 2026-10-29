# sphone-sync-master. Build context: services/sphone-api (the solution root), shared Domain/Data projects.
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY Directory.Build.props Directory.Packages.props global.json .editorconfig ./
COPY src/Sphone.Domain/Sphone.Domain.csproj src/Sphone.Domain/
COPY src/Sphone.Data/Sphone.Data.csproj src/Sphone.Data/
COPY src/Sphone.SyncMaster/Sphone.SyncMaster.csproj src/Sphone.SyncMaster/
RUN dotnet restore src/Sphone.SyncMaster/Sphone.SyncMaster.csproj
COPY src/ src/
RUN dotnet publish src/Sphone.SyncMaster/Sphone.SyncMaster.csproj -c Release -o /app --no-restore

# Chiseled: no shell or package manager, runs as non-root (uid 1654), listens on 8080 (health checks only).
# "-extra" adds ICU: Microsoft.Data.SqlClient does not support Globalization Invariant Mode.
FROM mcr.microsoft.com/dotnet/aspnet:10.0-noble-chiseled-extra
WORKDIR /app
COPY --from=build /app .
ENTRYPOINT ["dotnet", "Sphone.SyncMaster.dll"]

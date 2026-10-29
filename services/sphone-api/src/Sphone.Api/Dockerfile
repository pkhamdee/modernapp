# Build context: services/sphone-api (the solution root), so the shared Domain/Data projects are available.
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY Directory.Build.props Directory.Packages.props global.json .editorconfig ./
COPY src/Sphone.Domain/Sphone.Domain.csproj src/Sphone.Domain/
COPY src/Sphone.Data/Sphone.Data.csproj src/Sphone.Data/
COPY src/Sphone.Api/Sphone.Api.csproj src/Sphone.Api/
RUN dotnet restore src/Sphone.Api/Sphone.Api.csproj
COPY src/ src/
RUN dotnet publish src/Sphone.Api/Sphone.Api.csproj -c Release -o /app --no-restore

# Chiseled: no shell or package manager, runs as non-root (uid 1654), listens on 8080.
FROM mcr.microsoft.com/dotnet/aspnet:10.0-noble-chiseled
WORKDIR /app
COPY --from=build /app .
ENTRYPOINT ["dotnet", "Sphone.Api.dll"]

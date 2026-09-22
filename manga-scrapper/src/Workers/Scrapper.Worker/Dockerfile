FROM mcr.microsoft.com/dotnet/sdk:10.0-alpine AS build
WORKDIR /src

RUN apk add --no-cache gcompat libc6-compat

# Copy solution and project files for caching restore
COPY ["MangaScrapperStack.sln", "./"]
COPY ["src/BuildingBlocks/NovaStack.SharedKernel/NovaStack.SharedKernel.csproj", "src/BuildingBlocks/NovaStack.SharedKernel/"]
COPY ["src/BuildingBlocks/NovaStack.Infrastructure/NovaStack.Infrastructure.csproj", "src/BuildingBlocks/NovaStack.Infrastructure/"]
COPY ["src/BuildingBlocks/NovaStack.Contracts/NovaStack.Contracts.csproj", "src/BuildingBlocks/NovaStack.Contracts/"]
COPY ["src/Services/MangaScrapper/MangaScrapper.Core/MangaScrapper.Core.csproj", "src/Services/MangaScrapper/MangaScrapper.Core/"]
COPY ["src/Workers/Scrapper.Worker/Scrapper.Worker.csproj", "src/Workers/Scrapper.Worker/"]

RUN dotnet restore "src/Workers/Scrapper.Worker/Scrapper.Worker.csproj"

# Copy full source and publish
COPY . .
WORKDIR "/src/src/Workers/Scrapper.Worker"
RUN dotnet publish "Scrapper.Worker.csproj" -c Release -o /app/publish /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:10.0-alpine AS final
WORKDIR /app

# Install tzdata and icu-libs for timezone and full globalization support in Alpine
RUN apk add --no-cache tzdata icu-libs
ENV DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=false

COPY --from=build /app/publish .
ENTRYPOINT ["dotnet", "Scrapper.Worker.dll"]

using FluentAssertions;
using MangaScrapper.Core.Common.Abstractions;
using MangaScrapper.Core.Features.Mangas.GetPagedManga;
using NetArchTest.Rules;
using Xunit;

namespace ArchitectureTests;

public sealed class MangaScrapperArchitectureTests
{
    [Fact]
    public void Handlers_Should_Be_Sealed()
    {
        var result = Types.InAssembly(typeof(GetPagedMangaQuery).Assembly)
            .That()
            .HaveNameEndingWith("Handler")
            .Should()
            .BeSealed()
            .GetResult();

        result.IsSuccessful.Should().BeTrue("All MediatR handlers in MangaScrapper.Core should be sealed.");
    }

    [Fact]
    public void Endpoints_Should_Implement_IEndpointDefinition()
    {
        var result = Types.InAssembly(typeof(GetPagedMangaQuery).Assembly)
            .That()
            .HaveNameEndingWith("Endpoint")
            .Should()
            .ImplementInterface(typeof(IEndpointDefinition))
            .GetResult();

        result.IsSuccessful.Should().BeTrue("All Minimal API endpoint classes should implement IEndpointDefinition.");
    }
}

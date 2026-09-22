using MangaScrapper.Core.Common.Abstractions;
using MediatR;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using NovaStack.SharedKernel.Results;

namespace MangaScrapper.Core.Features.Providers.GetProvider;

public record GetProviderQuery(string FileName) : IQuery<string>;

internal sealed class GetProviderQueryHandler : IQueryHandler<GetProviderQuery, string>
{
    public async Task<Result<string>> Handle(GetProviderQuery query, CancellationToken ct)
    {
        var pathsToTry = new[]
        {
            Path.Combine(AppContext.BaseDirectory, "provider", query.FileName),
            Path.Combine(Directory.GetCurrentDirectory(), "provider", query.FileName)
        };

        foreach (var path in pathsToTry)
        {
            if (File.Exists(path))
            {
                var json = await File.ReadAllTextAsync(path, ct);
                return Result.Success(json);
            }
        }

        return Error.Failure("Provider.NotFound", $"Provider configuration '{query.FileName}' not found.");
    }
}

public sealed class GetProviderEndpoints : IEndpointDefinition
{
    public void DefineEndpoints(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/providers").WithTags("Providers");

        group.MapGet("/{fileName}", async (string fileName, ISender sender, CancellationToken ct) =>
        {
            var res = await sender.Send(new GetProviderQuery(fileName), ct);
            return res.IsSuccess ? Results.Content(res.Value, "application/json") : res.Error.ToHttpResult();
        }).WithName("GetProviderConfig");
    }
}

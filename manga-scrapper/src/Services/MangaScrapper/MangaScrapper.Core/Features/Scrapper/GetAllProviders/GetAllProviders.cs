using MangaScrapper.Core.Common.Abstractions;
using MediatR;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using NovaStack.Contracts.Responses;
using NovaStack.SharedKernel.Results;

namespace MangaScrapper.Core.Features.Scrapper.GetAllProviders;

public record GetAllProviderQuery : IQuery<List<ProviderInfoResponse>>;

internal sealed class GetAllProviderQueryHandler(
    [FromKeyedServices("komiku")] IProviderScrapperService komikuService)
    : IQueryHandler<GetAllProviderQuery, List<ProviderInfoResponse>>
{
    public async Task<Result<List<ProviderInfoResponse>>> Handle(GetAllProviderQuery query, CancellationToken ct)
    {
        var providers = await komikuService.GetAllProvider();
        return providers;
    }
}

public sealed class GetAllProvidersEndpoints : IEndpointDefinition
{
    public void DefineEndpoints(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/scrapper").WithTags("Scrapper");

        group.MapGet("/providers", async (ISender sender, CancellationToken ct) =>
        {
            var res = await sender.Send(new GetAllProviderQuery(), ct);
            return res.IsSuccess ? Results.Ok(ApiResponse.Ok(res.Value)) : res.Error.ToHttpResult();
        }).WithName("GetAllProviders");
    }
}

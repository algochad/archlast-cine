using MangaScrapper.Core.Common.Abstractions;
using MangaScrapper.Core.Repositories;
using Mapster;
using MediatR;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using NovaStack.Contracts.Responses;
using NovaStack.SharedKernel.Results;

namespace MangaScrapper.Core.Features.Dashboard.GetStatistics;

public record GetStatisticsQuery : IQuery<DashboardStatisticResponse>;

internal sealed class GetStatisticsQueryHandler(IMangaRepository mangaRepository)
    : IQueryHandler<GetStatisticsQuery, DashboardStatisticResponse>
{
    public async Task<Result<DashboardStatisticResponse>> Handle(GetStatisticsQuery query, CancellationToken ct)
    {
        var data = await mangaRepository.GetStatisticsAsync(ct);
        var response = data.Adapt<DashboardStatisticResponse>();

        return response;
    }
}

public sealed class GetStatisticsEndpoints : IEndpointDefinition
{
    public void DefineEndpoints(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/dashboard").WithTags("Dashboard");

        group.MapGet("/stats", async (ISender sender, CancellationToken ct) =>
        {
            var res = await sender.Send(new GetStatisticsQuery(), ct);
            return res.IsSuccess ? Results.Ok(ApiResponse.Ok(res.Value)) : res.Error.ToHttpResult();
        }).WithName("GetDashboardStats");
    }
}

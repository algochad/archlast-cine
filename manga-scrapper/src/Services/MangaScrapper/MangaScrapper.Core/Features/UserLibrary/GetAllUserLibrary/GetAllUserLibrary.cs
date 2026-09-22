using MangaScrapper.Core.Common.Abstractions;
using MangaScrapper.Core.Repositories;
using Mapster;
using MediatR;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using NovaStack.Contracts.Responses;
using NovaStack.SharedKernel.Results;

namespace MangaScrapper.Core.Features.UserLibrary.GetAllUserLibrary;

public record GetAllUserLibraryQuery(string UserId) : IQuery<List<UserLibraryResponse>>;

internal sealed class GetAllUserLibraryQueryHandler(IUserLibraryRepository libraryRepository, IMangaRepository mangaRepository)
    : IQueryHandler<GetAllUserLibraryQuery, List<UserLibraryResponse>>
{
    public async Task<Result<List<UserLibraryResponse>>> Handle(GetAllUserLibraryQuery query, CancellationToken ct)
    {
        var data = await libraryRepository.GetAllAsync(query.UserId, ct);
        if (data.Count == 0) return new List<UserLibraryResponse>();

        var mangaIds = data.Select(x => x.MangaId.Value).Distinct().ToList();
        var mangas = await mangaRepository.GetByIdsAsync(mangaIds, ct);
        var mangaDict = mangas.ToDictionary(m => m.Id);

        var mapped = data.Select(l => new UserLibraryResponse(
            l.Id, 
            l.UserId, 
            l.MangaId.Value, 
            l.AddedAt, 
            l.UpdatedAt, 
            l.Status, 
            l.IsFavorite, 
            mangaDict.TryGetValue(l.MangaId, out var m) ? m.Adapt<MangaSummaryResponse>() : null
        )).ToList();

        return mapped;
    }
}

public sealed class GetUserLibraryEndpoints : IEndpointDefinition
{
    public void DefineEndpoints(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/user-library/all").WithTags("UserLibrary");

        group.MapGet("/", async (string userId, ISender sender, CancellationToken ct) =>
        {
            var res = await sender.Send(new GetAllUserLibraryQuery(userId), ct);
            return res.IsSuccess ? Results.Ok(ApiResponse.Ok(res.Value)) : res.Error.ToHttpResult();
        }).WithName("GetAllUserLibrary")
        .RequireAuthorization()
        .Produces<ApiResponse<List<UserLibraryResponse>>>();
    }
}

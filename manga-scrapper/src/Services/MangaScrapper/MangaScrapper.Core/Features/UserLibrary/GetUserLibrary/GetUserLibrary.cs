using MangaScrapper.Core.Aggregates;
using MangaScrapper.Core.Common.Abstractions;
using MangaScrapper.Core.Repositories;
using Mapster;
using MediatR;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using NovaStack.Contracts.Responses;
using NovaStack.SharedKernel.Results;

namespace MangaScrapper.Core.Features.UserLibrary.GetUserLibrary;

public record GetUserLibraryQuery(string UserId, string? Search, string? Type, string? Status, bool? IsFavorite, string SortBy = "UpdatedAt", string OrderBy = "desc", int Page = 1, int PageSize = 10) : IQuery<PagedResponse<UserLibraryResponse>>;

internal sealed class GetUserLibraryQueryHandler(IUserLibraryRepository libraryRepository, IMangaRepository mangaRepository)
    : IQueryHandler<GetUserLibraryQuery, PagedResponse<UserLibraryResponse>>
{
    public async Task<Result<PagedResponse<UserLibraryResponse>>> Handle(GetUserLibraryQuery query, CancellationToken ct)
    {
        var paged = await libraryRepository.GetPagedByUserIdAsync(query.UserId, query.Search, query.Type, query.Status, query.IsFavorite, query.SortBy, query.OrderBy, query.Page, query.PageSize, ct);
        var mangaIds = paged.Items.Select(x => x.MangaId.Value).ToList();
        var mangas = await mangaRepository.GetByIdsAsync(mangaIds, ct);
        var mapped = paged.Items.Select(l => new UserLibraryResponse(l.Id, l.UserId, l.MangaId.Value, l.AddedAt, l.UpdatedAt, l.Status, l.IsFavorite, mangas.FirstOrDefault(x => x.Id.Equals(l.MangaId))?.Adapt<MangaSummaryResponse>()));

        return PagedResponse<UserLibraryResponse>.Create(mapped, paged.Page, paged.PageSize, paged.TotalCount);
    }
}

public sealed class GetUserLibraryEndpoints : IEndpointDefinition
{
    public void DefineEndpoints(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/user-library").WithTags("UserLibrary");

        group.MapGet("/", async (string userId, ISender sender, CancellationToken ct, string? search, string? type, string? status, bool? isFavorite, string sortBy = "UpdatedAt", string orderBy = "desc", int page = 1, int pageSize = 10) =>
        {
            var res = await sender.Send(new GetUserLibraryQuery(userId, search, type, status, isFavorite, sortBy, orderBy, page, pageSize), ct);
            return res.IsSuccess ? Results.Ok(ApiResponse.Ok(res.Value)) : res.Error.ToHttpResult();
        }).WithName("GetUserLibrary")
        .RequireAuthorization()
        .Produces<ApiResponse<PagedResponse<UserLibraryResponse>>>();
    }
}

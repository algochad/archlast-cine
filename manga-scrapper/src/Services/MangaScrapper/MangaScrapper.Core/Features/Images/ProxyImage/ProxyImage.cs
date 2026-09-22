using MangaScrapper.Core.Common.Abstractions;
using MangaScrapper.Core.RateLimiting;
using MediatR;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using NovaStack.SharedKernel.Results;

namespace MangaScrapper.Core.Features.Images.ProxyImage;

[NoLogging]
public record ProxyImageQuery(string Url) : IQuery<(byte[] Bytes, string ContentType)>;

internal sealed class ProxyImageQueryHandler(IHttpClientFactory httpClientFactory)
    : IQueryHandler<ProxyImageQuery, (byte[] Bytes, string ContentType)>
{
    public async Task<Result<(byte[] Bytes, string ContentType)>> Handle(ProxyImageQuery query, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(query.Url) || !Uri.TryCreate(query.Url, UriKind.Absolute, out var uri))
        {
            return Error.Validation("ProxyImage.InvalidUrl", "Invalid image URL provided.");
        }

        try
        {
            var client = httpClientFactory.CreateClient("ImageProxy");
            var response = await client.GetAsync(uri, ct);
            if (!response.IsSuccessStatusCode)
            {
                return Error.Failure("ProxyImage.Failed", $"Failed to fetch image: {response.StatusCode}");
            }

            var bytes = await response.Content.ReadAsByteArrayAsync(ct);
            var contentType = response.Content.Headers.ContentType?.MediaType ?? "image/jpeg";
            return (bytes, contentType);
        }
        catch (Exception ex)
        {
            return Error.Failure("ProxyImage.Exception", ex.Message);
        }
    }
}

public sealed class ProxyImageEndpoint : IEndpointDefinition
{
    public void DefineEndpoints(IEndpointRouteBuilder app)
    {
        app.MapGet("/api/v1/images/proxy", HandleAsync)
            .WithName("ProxyImage")
            .WithSummary("Proxy remote image requests")
            .WithTags("Images")
            .RequireRateLimiting(RateLimitPolicies.ImageProxy);
    }

    private static async Task<IResult> HandleAsync(string url, ISender sender, CancellationToken ct)
    {
        var result = await sender.Send(new ProxyImageQuery(url), ct);
        if (result.IsFailure) return result.Error.ToHttpResult();

        return Results.Bytes(result.Value.Bytes, result.Value.ContentType);
    }
}

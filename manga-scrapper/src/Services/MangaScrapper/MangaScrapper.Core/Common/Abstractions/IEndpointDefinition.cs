using Microsoft.AspNetCore.Routing;

namespace MangaScrapper.Core.Common.Abstractions;

public interface IEndpointDefinition
{
    void DefineEndpoints(IEndpointRouteBuilder app);
}

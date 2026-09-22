using Microsoft.AspNetCore.Http;
using NovaStack.SharedKernel.Results;

namespace MangaScrapper.Core;

public static class ErrorExtensions
{
    public static IResult ToHttpResult(this Error error)
    {
        return error.Type switch
        {
            ErrorType.NotFound => Results.NotFound(new
            {
                type = "https://tools.ietf.org/html/rfc7231#section-6.5.4",
                title = "Not Found",
                status = 404,
                detail = error.Message,
                code = error.Code
            }),
            ErrorType.Validation => Results.BadRequest(new
            {
                type = "https://tools.ietf.org/html/rfc7231#section-6.5.1",
                title = "Validation Error",
                status = 400,
                detail = error.Message,
                code = error.Code
            }),
            ErrorType.Conflict => Results.Conflict(new
            {
                type = "https://tools.ietf.org/html/rfc7231#section-6.5.8",
                title = "Conflict",
                status = 409,
                detail = error.Message,
                code = error.Code
            }),
            ErrorType.Unauthorized => Results.Unauthorized(),
            ErrorType.Forbidden => Results.Forbid(),
            _ => Results.Problem(
                error.Message,
                statusCode: StatusCodes.Status500InternalServerError,
                title: "Internal Server Error")
        };
    }
}

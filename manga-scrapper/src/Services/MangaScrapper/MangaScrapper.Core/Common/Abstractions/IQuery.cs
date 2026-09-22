using MediatR;
using NovaStack.SharedKernel.Results;

namespace MangaScrapper.Core.Common.Abstractions;

public interface IQuery<TResponse> : IRequest<Result<TResponse>>
{
}

public interface IQueryHandler<TQuery, TResponse> : IRequestHandler<TQuery, Result<TResponse>>
    where TQuery : IQuery<TResponse>
{
}

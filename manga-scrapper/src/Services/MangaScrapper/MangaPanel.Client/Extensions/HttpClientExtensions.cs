using System.Net.Http.Json;
using NovaStack.Contracts.Responses;

namespace MangaPanel.Client.Extensions;

public static class HttpClientExtensions
{
    public static async Task<T?> GetApiDataAsync<T>(this HttpClient client, string requestUri, CancellationToken cancellationToken = default)
    {
        try
        {
            var response = await client.GetFromJsonAsync<ApiResponse<T>>(requestUri, cancellationToken);
            return response != null && response.Success ? response.Data : default;
        }
        catch
        {
            return default;
        }
    }

    public static async Task<ApiResponse<TResponse>?> PostApiDataAsync<TRequest, TResponse>(this HttpClient client, string requestUri, TRequest value, CancellationToken cancellationToken = default)
    {
        try
        {
            var httpResponse = await client.PostAsJsonAsync(requestUri, value, cancellationToken);
            return await httpResponse.Content.ReadFromJsonAsync<ApiResponse<TResponse>>(cancellationToken: cancellationToken);
        }
        catch
        {
            return default;
        }
    }

    public static async Task<TResponse?> QueryApiDataAsync<TRequest, TResponse>(this HttpClient client, string requestUri, TRequest value, CancellationToken cancellationToken = default)
    {
        try
        {
            var request = new HttpRequestMessage(HttpMethod.Query, requestUri)
            {
                Content = JsonContent.Create(value)
            };
            var httpResponse = await client.SendAsync(request, cancellationToken);
            var response = await httpResponse.Content.ReadFromJsonAsync<ApiResponse<TResponse>>(cancellationToken: cancellationToken);
            return response != null && response.Success ? response.Data : default;
        }
        catch
        {
            return default;
        }
    }

    public static async Task<T?> ReadApiDataAsync<T>(this HttpResponseMessage httpResponse, CancellationToken cancellationToken = default)
    {
        try
        {
            var response = await httpResponse.Content.ReadFromJsonAsync<ApiResponse<T>>(cancellationToken: cancellationToken);
            return response != null && response.Success ? response.Data : default;
        }
        catch
        {
            return default;
        }
    }
}

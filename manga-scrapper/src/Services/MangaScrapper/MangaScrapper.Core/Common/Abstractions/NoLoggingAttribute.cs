namespace MangaScrapper.Core.Common.Abstractions;

/// <summary>
/// Marks a MediatR request as excluded from pipeline execution logging (e.g. high-frequency image proxying).
/// </summary>
[AttributeUsage(AttributeTargets.Class | AttributeTargets.Struct, AllowMultiple = false, Inherited = true)]
public sealed class NoLoggingAttribute : Attribute
{
}

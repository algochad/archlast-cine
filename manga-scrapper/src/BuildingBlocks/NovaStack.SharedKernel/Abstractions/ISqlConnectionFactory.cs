using System.Data;

namespace NovaStack.SharedKernel.Abstractions;

/// <summary>
/// Defines a factory for creating database connections.
/// Typically used with Dapper for executing raw SQL queries/commands.
/// </summary>
public interface ISqlConnectionFactory
{
    /// <summary>
    /// Creates and returns a new database connection.
    /// </summary>
    /// <returns>A new <see cref="IDbConnection"/> instance.</returns>
    IDbConnection CreateConnection();
}

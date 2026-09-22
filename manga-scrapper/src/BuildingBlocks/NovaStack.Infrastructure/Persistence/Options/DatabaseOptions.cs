namespace NovaStack.Infrastructure.Persistence.Options;

/// <summary>Supported database providers.</summary>
public enum DatabaseProvider
{
    PostgreSQL,
    SqlServer,
    MongoDB
}

/// <summary>Database connection settings loaded from configuration.</summary>
public sealed class DatabaseOptions
{
    public const string SectionName = "Database";

    public DatabaseProvider Provider { get; set; } = DatabaseProvider.PostgreSQL;
    public string ConnectionString { get; set; } = string.Empty;

    /// <summary>MongoDB database name. Only used when <see cref="Provider"/> is <see cref="DatabaseProvider.MongoDB"/>.</summary>
    public string DatabaseName { get; set; } = "novastack";

    /// <summary>Enable EF Core detailed errors (development only).</summary>
    public bool EnableDetailedErrors { get; set; }

    /// <summary>Enable EF Core sensitive data logging (development only).</summary>
    public bool EnableSensitiveDataLogging { get; set; }

    /// <summary>Enable automatic migrations on startup.</summary>
    public bool AutoMigrate { get; set; }

    /// <summary>Connection pool size limit.</summary>
    public int MaxPoolSize { get; set; } = 100;
}

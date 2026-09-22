namespace NovaStack.Infrastructure.Messaging.Options;

/// <summary>Supported message broker providers.</summary>
public enum MessagingProvider
{
    RabbitMQ,
    Kafka
}

/// <summary>Top-level messaging configuration.</summary>
public sealed class MessagingOptions
{
    public const string SectionName = "Messaging";

    public MessagingProvider Provider { get; set; } = MessagingProvider.RabbitMQ;
    public RabbitMqOptions RabbitMQ { get; set; } = new();
    public KafkaOptions Kafka { get; set; } = new();
}

/// <summary>RabbitMQ connection settings.</summary>
public sealed class RabbitMqOptions
{
    public string Host { get; set; } = "localhost";
    public ushort Port { get; set; } = 5672;
    public string VirtualHost { get; set; } = "/";
    public string Username { get; set; } = "guest";
    public string Password { get; set; } = "guest";
    public ushort PrefetchCount { get; set; } = 10;
    public bool UseSsl { get; set; }
}

/// <summary>Kafka connection settings.</summary>
public sealed class KafkaOptions
{
    public string BootstrapServers { get; set; } = "localhost:9092";
    public string GroupId { get; set; } = "novastack-consumers";
    public string SecurityProtocol { get; set; } = "PLAINTEXT";
    public string SaslUsername { get; set; } = string.Empty;
    public string SaslPassword { get; set; } = string.Empty;
    public int SessionTimeoutMs { get; set; } = 30000;
}

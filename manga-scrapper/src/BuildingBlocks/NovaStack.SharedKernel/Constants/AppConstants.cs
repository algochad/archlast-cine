namespace NovaStack.SharedKernel.Constants;

/// <summary>Application-wide constants.</summary>
public static class AppConstants
{
    public static class Api
    {
        public const string DefaultVersion = "1.0";
        public const string VersionPrefix = "v";
        public const string RoutePrefix = "api";
    }

    public static class Cache
    {
        public const int DefaultExpiryMinutes = 15;
        public const int LongExpiryMinutes = 60;
        public const int ShortExpiryMinutes = 5;
    }

    public static class Messaging
    {
        public const string RetryQueueSuffix = "_retry";
        public const string DeadLetterSuffix = "_dlq";
        public const int DefaultRetryCount = 3;
        public const int DefaultRetryDelaySeconds = 5;
    }

    public static class Claims
    {
        public const string UserId = "sub";
        public const string Email = "email";
        public const string Role = "role";
        public const string TenantId = "tenant_id";
    }

    public static class Policies
    {
        public const string Admin = "AdminPolicy";
        public const string User = "UserPolicy";
        public const string ServiceAccount = "ServiceAccountPolicy";
    }
}

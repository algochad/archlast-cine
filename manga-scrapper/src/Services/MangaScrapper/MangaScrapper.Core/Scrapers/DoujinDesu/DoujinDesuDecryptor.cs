using System.Text;
using System.Text.Json;

namespace MangaScrapper.Core.Scrapers.DoujinDesu;

public static class DoujinDesuDecryptor
{
    public const string Salt = "doujindesu-scrapers-cannot-read-this-super-secret-salt-2026-v2";
    public const string AppSecret = "dfdf72051dbfdc7d76889ebd31324e74";
    private const long TimeWindowMs = 3600000; // 1 hour

    public static string GenerateKey(long slot, string? customSalt = null)
    {
        var effectiveSalt = string.IsNullOrWhiteSpace(customSalt) ? Salt : customSalt;
        var s = $"{effectiveSalt}_{slot}";
        var l = 0;
        for (var n = 0; n < s.Length; n++)
        {
            l = (l << 5) - l + (int)s[n];
        }

        var d = Math.Abs((long)l);
        if (d == 0) d = 123456789;

        var sb = new StringBuilder(32);
        for (var n = 0; n < 32; n++)
        {
            d = (d * 1664525 + 1013904223) % 4294967296L;
            sb.Append((char)(33 + (d % 93)));
        }

        return sb.ToString();
    }

    public static string Decrypt(string encHex, string? customSalt = null)
    {
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var currentSlot = now / TimeWindowMs;
        long[] slots = [currentSlot, currentSlot - 1, currentSlot + 1, currentSlot - 2, currentSlot + 2];

        foreach (var slot in slots)
        {
            try
            {
                var key = GenerateKey(slot, customSalt);
                var byteCount = encHex.Length / 2;
                var bytes = new byte[byteCount];
                for (var i = 0; i < byteCount; i++)
                {
                    bytes[i] = Convert.ToByte(encHex.Substring(i * 2, 2), 16);
                }

                var resultBytes = new byte[byteCount];
                var n = 42;
                var keyLen = key.Length;

                for (var i = 0; i < byteCount; i++)
                {
                    var b = bytes[i];
                    var p = (int)key[i % keyLen];
                    var s = b ^ p ^ (i * 13) ^ n;
                    resultBytes[i] = (byte)(s & 255);
                    n = (n + b) % 256;
                }

                var uriEncoded = Encoding.Latin1.GetString(resultBytes);
                var jsonString = Uri.UnescapeDataString(uriEncoded);

                // Quick validation
                using var doc = JsonDocument.Parse(jsonString);
                return jsonString;
            }
            catch
            {
                // Try next slot
            }
        }

        throw new InvalidOperationException("Failed to decrypt DoujinDesu response payload.");
    }

    public static T? DecryptToObject<T>(string rawJsonOrHex, string? customSalt = null, JsonSerializerOptions? options = null)
    {
        if (string.IsNullOrWhiteSpace(rawJsonOrHex))
            return default;

        string jsonToParse;
        if (rawJsonOrHex.TrimStart().StartsWith('{'))
        {
            using var doc = JsonDocument.Parse(rawJsonOrHex);
            if (doc.RootElement.TryGetProperty("_enc_resp_", out var encProp))
            {
                var encHex = encProp.GetString();
                jsonToParse = string.IsNullOrEmpty(encHex) ? rawJsonOrHex : Decrypt(encHex, customSalt);
            }
            else
            {
                jsonToParse = rawJsonOrHex;
            }
        }
        else
        {
            jsonToParse = Decrypt(rawJsonOrHex.Trim(), customSalt);
        }

        return JsonSerializer.Deserialize<T>(jsonToParse, options ?? new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
    }
}

using System.Globalization;
using System.Text.RegularExpressions;

namespace MangaScrapper.Core.Utils;

public static class ThumbnailHelper
{
    public static string RemoveResizeParams(string url)
    {
        if (string.IsNullOrEmpty(url)) return url;
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri)) return url;

        var segments = uri.Segments;

        if (segments.Length > 0 && segments.Last().Contains('=') && !segments.Last().Contains("format=auto"))
        {
            var newPath = string.Concat(segments.Take(segments.Length - 1));
            return $"{uri.Scheme}://{uri.Host}{newPath}";
        }

        return url;
    }

    public static string RemoveQueryString(string? url)
    {
        if (string.IsNullOrWhiteSpace(url)) return url ?? string.Empty;
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri)) return url;
        return new UriBuilder(uri) { Query = string.Empty }.Uri.ToString();
    }

    public static string GetCleanTitle(string title)
    {
        var invalidChars = Path.GetInvalidFileNameChars().Union(new[] { '?', '*', ':', '|', '<', '>', '"' }).ToArray();
        var cleaned = string.Concat(title.Split(invalidChars)).TrimEnd('.', ' ');
        return string.IsNullOrEmpty(cleaned) ? "manga" : cleaned;
    }

    public static bool IsWebpUrl(string imageUrl)
    {
        if (!Uri.TryCreate(imageUrl, UriKind.Absolute, out var uri))
            return imageUrl.Contains(".webp", StringComparison.OrdinalIgnoreCase);
        return string.Equals(Path.GetExtension(uri.AbsolutePath), ".webp", StringComparison.OrdinalIgnoreCase);
    }

    public static bool IsWebp(ReadOnlySpan<byte> bytes) => ImageDimensionReader.IsWebp(bytes);

    public static bool IsAvifUrl(string imageUrl)
    {
        if (!Uri.TryCreate(imageUrl, UriKind.Absolute, out var uri))
            return imageUrl.Contains(".avif", StringComparison.OrdinalIgnoreCase);
        return string.Equals(Path.GetExtension(uri.AbsolutePath), ".avif", StringComparison.OrdinalIgnoreCase);
    }

    public static bool IsAvif(ReadOnlySpan<byte> bytes) => ImageDimensionReader.IsAvif(bytes);

    public static string ExtractImageUrl(HtmlAgilityPack.HtmlNode? imgNode, HtmlAgilityPack.HtmlNode? fallbackContainer = null)
    {
        if (imgNode != null)
        {
            var src = imgNode.GetAttributeValue("src", string.Empty)?.Trim();
            if (!string.IsNullOrWhiteSpace(src) && !src.StartsWith("data:", StringComparison.OrdinalIgnoreCase))
            {
                return NormalizeUrl(src);
            }

            // Common lazy-load attributes
            var lazyAttributes = new[]
            {
                "data-src",
                "data-lazy-src",
                "data-orig-file",
                "data-wpfc-original-src",
                "data-original",
                "data-full-url",
                "data-cfsrc"
            };

            foreach (var attr in lazyAttributes)
            {
                var val = imgNode.GetAttributeValue(attr, string.Empty)?.Trim();
                if (!string.IsNullOrWhiteSpace(val) && !val.StartsWith("data:", StringComparison.OrdinalIgnoreCase))
                {
                    return NormalizeUrl(val);
                }
            }

            // Check data-srcset or srcset (e.g. "https://example.com/img.jpg 1057w, ...")
            var srcset = imgNode.GetAttributeValue("data-srcset", string.Empty)?.Trim();
            if (string.IsNullOrWhiteSpace(srcset) || srcset.StartsWith("data:", StringComparison.OrdinalIgnoreCase))
            {
                srcset = imgNode.GetAttributeValue("srcset", string.Empty)?.Trim();
            }

            if (!string.IsNullOrWhiteSpace(srcset) && !srcset.StartsWith("data:", StringComparison.OrdinalIgnoreCase))
            {
                var firstCandidate = srcset.Split(',')[0].Trim().Split(' ')[0].Trim();
                if (!string.IsNullOrWhiteSpace(firstCandidate) && !firstCandidate.StartsWith("data:", StringComparison.OrdinalIgnoreCase))
                {
                    return NormalizeUrl(firstCandidate);
                }
            }
        }

        if (fallbackContainer != null)
        {
            var noscriptImg = fallbackContainer.SelectSingleNode(".//noscript//img");
            if (noscriptImg != null)
            {
                var noscriptSrc = noscriptImg.GetAttributeValue("src", string.Empty)?.Trim();
                if (!string.IsNullOrWhiteSpace(noscriptSrc) && !noscriptSrc.StartsWith("data:", StringComparison.OrdinalIgnoreCase))
                {
                    return NormalizeUrl(noscriptSrc);
                }
            }
        }

        return string.Empty;
    }

    public static string NormalizeUrl(string url)
    {
        if (string.IsNullOrWhiteSpace(url)) return string.Empty;
        if (url.StartsWith("//", StringComparison.Ordinal))
            return "https:" + url;
        return url;
    }
}

public static class IntHelper
{
    public static int ParseCount(string input)
    {
        if (string.IsNullOrWhiteSpace(input)) return 0;
        input = input.Trim().ToLowerInvariant();
        var match = Regex.Match(input, @"[\d\.]+");
        if (!match.Success) return 0;
        if (!double.TryParse(match.Value, NumberStyles.Any, CultureInfo.InvariantCulture, out var number)) return 0;
        if (input.EndsWith('k')) number *= 1_000;
        else if (input.EndsWith('m')) number *= 1_000_000;
        else if (input.EndsWith('b')) number *= 1_000_000_000;
        return (int)Math.Round(number);
    }
}

public static class StringHelper
{
    public static bool IsSimilar(string a, string b)
    {
        if (string.IsNullOrWhiteSpace(a) || string.IsNullOrWhiteSpace(b)) return false;
        string Clean(string input) => Regex.Replace(input.ToLower(), @"[^\w]", "");
        string cleanA = Clean(a), cleanB = Clean(b);
        return cleanA.Contains(cleanB) || cleanB.Contains(cleanA);
    }

    public static int LevenshteinDistance(string a, string b)
    {
        if (string.IsNullOrEmpty(a)) return b?.Length ?? 0;
        if (string.IsNullOrEmpty(b)) return a.Length;
        int[,] matrix = new int[a.Length + 1, b.Length + 1];
        for (int i = 0; i <= a.Length; i++) matrix[i, 0] = i;
        for (int j = 0; j <= b.Length; j++) matrix[0, j] = j;
        for (int i = 1; i <= a.Length; i++)
            for (int j = 1; j <= b.Length; j++)
            {
                int cost = a[i - 1] == b[j - 1] ? 0 : 1;
                matrix[i, j] = Math.Min(Math.Min(matrix[i - 1, j] + 1, matrix[i, j - 1] + 1), matrix[i - 1, j - 1] + cost);
            }
        return matrix[a.Length, b.Length];
    }

    public static double CalculateSimilarity(string a, string b)
    {
        int distance = LevenshteinDistance(a.ToLower(), b.ToLower());
        int maxLength = Math.Max(a.Length, b.Length);
        return maxLength == 0 ? 1.0 : 1.0 - (double)distance / maxLength;
    }

    public static string NormalizeTitle(string text)
    {
        text = text.ToLower();
        text = Regex.Replace(text, @"\([^)]*\)", "");
        text = Regex.Replace(text, @"[^a-z0-9\s]", "");
        return text.Trim();
    }

    public static string CapitalizeFirst(string input)
    {
        if (string.IsNullOrWhiteSpace(input)) return input;
        return char.ToUpper(input[0]) + input[1..];
    }
}

public static class TimeAgoHelper
{
    public static string ToTimeAgo(this DateTime dateTime)
    {
        var now = DateTime.UtcNow;
        var diff = now - dateTime.ToUniversalTime();

        if (diff.TotalSeconds < 60)
            return $"{(int)diff.TotalSeconds}s ago";

        if (diff.TotalMinutes < 60)
            return $"{(int)diff.TotalMinutes}m ago";

        if (diff.TotalHours < 24)
            return $"{(int)diff.TotalHours}h ago";

        if (diff.TotalDays < 7)
            return $"{(int)diff.TotalDays}d ago";

        if (diff.TotalDays < 30)
            return $"{(int)(diff.TotalDays / 7)}w ago";

        if (diff.TotalDays < 365)
            return $"{(int)(diff.TotalDays / 30)}mo ago";

        return $"{(int)(diff.TotalDays / 365)}y ago";
    }
}

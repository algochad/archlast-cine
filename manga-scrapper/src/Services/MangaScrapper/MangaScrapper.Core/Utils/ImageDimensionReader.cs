namespace MangaScrapper.Core.Utils;

public static class ImageDimensionReader
{
    /// <summary>
    /// Reads image dimensions directly from file header bytes (WebP, PNG, JPEG) with zero allocations.
    /// Returns (0, 0) if the format is unsupported or file cannot be read.
    /// </summary>
    public static (int Width, int Height) GetDimensions(string filePath)
    {
        try
        {
            using var stream = new FileStream(
                filePath,
                FileMode.Open,
                FileAccess.Read,
                FileShare.Read,
                bufferSize: 4096,
                FileOptions.SequentialScan);

            return GetDimensions(stream);
        }
        catch
        {
            return (0, 0);
        }
    }

    /// <summary>
    /// Reads image dimensions directly from stream header bytes (WebP, PNG, JPEG) with zero allocations.
    /// Restores stream position if stream is seekable.
    /// </summary>
    public static (int Width, int Height) GetDimensions(Stream stream)
    {
        try
        {
            long startPos = stream.CanSeek ? stream.Position : 0;
            Span<byte> buffer = stackalloc byte[64];
            int bytesRead = stream.Read(buffer);
            if (bytesRead < 10)
            {
                if (stream.CanSeek) stream.Position = startPos;
                return (0, 0);
            }

            (int Width, int Height) result = (0, 0);

            // 1. WebP (RIFF....WEBP)
            if (buffer[0] == (byte)'R' && buffer[1] == (byte)'I' && buffer[2] == (byte)'F' && buffer[3] == (byte)'F' &&
                buffer[8] == (byte)'W' && buffer[9] == (byte)'E' && buffer[10] == (byte)'B' && buffer[11] == (byte)'P')
            {
                result = GetWebpDimensions(stream, buffer, bytesRead);
            }
            // 2. PNG (89 50 4E 47 0D 0A 1A 0A)
            else if (buffer[0] == 0x89 && buffer[1] == 0x50 && buffer[2] == 0x4E && buffer[3] == 0x47 &&
                     buffer[4] == 0x0D && buffer[5] == 0x0A && buffer[6] == 0x1A && buffer[7] == 0x0A)
            {
                if (bytesRead >= 24)
                {
                    int width = (buffer[16] << 24) | (buffer[17] << 16) | (buffer[18] << 8) | buffer[19];
                    int height = (buffer[20] << 24) | (buffer[21] << 16) | (buffer[22] << 8) | buffer[23];
                    result = (width, height);
                }
            }
            // 3. JPEG (FF D8)
            else if (buffer[0] == 0xFF && buffer[1] == 0xD8)
            {
                if (stream.CanSeek) stream.Position = startPos;
                result = GetJpegDimensions(stream);
            }
            // 4. GIF (GIF87a / GIF89a)
            else if (buffer[0] == (byte)'G' && buffer[1] == (byte)'I' && buffer[2] == (byte)'F' &&
                     buffer[3] == (byte)'8' && (buffer[4] == (byte)'7' || buffer[4] == (byte)'9') && buffer[5] == (byte)'a')
            {
                int width = buffer[6] | (buffer[7] << 8);
                int height = buffer[8] | (buffer[9] << 8);
                result = (width, height);
            }
            // 5. BMP (BM)
            else if (buffer[0] == (byte)'B' && buffer[1] == (byte)'M')
            {
                if (bytesRead >= 26)
                {
                    int width = buffer[18] | (buffer[19] << 8) | (buffer[20] << 16) | (buffer[21] << 24);
                    int rawHeight = buffer[22] | (buffer[23] << 8) | (buffer[24] << 16) | (buffer[25] << 24);
                    result = (Math.Abs(width), Math.Abs(rawHeight));
                }
            }
            // 6. AVIF (....ftyp)
            else if (IsAvif(buffer.Slice(0, bytesRead)))
            {
                if (stream.CanSeek) stream.Position = startPos;
                result = GetAvifDimensions(stream);
            }

            if (stream.CanSeek) stream.Position = startPos;
            return result;
        }
        catch
        {
            return (0, 0);
        }
    }

    private static (int Width, int Height) GetWebpDimensions(Stream stream, Span<byte> buffer, int bytesRead)
    {
        // Ensure at least 30 bytes for WebP header parsing
        if (bytesRead < 30)
        {
            int needed = 30 - bytesRead;
            int additional = stream.Read(buffer.Slice(bytesRead, needed));
            bytesRead += additional;
            if (bytesRead < 30) return (0, 0);
        }

        // VP8X (Extended WebP)
        if (buffer[12] == (byte)'V' && buffer[13] == (byte)'P' && buffer[14] == (byte)'8' && buffer[15] == (byte)'X')
        {
            int width = 1 + (buffer[24] | (buffer[25] << 8) | (buffer[26] << 16));
            int height = 1 + (buffer[27] | (buffer[28] << 8) | (buffer[29] << 16));
            return (width, height);
        }

        // VP8L (Lossless WebP)
        if (buffer[12] == (byte)'V' && buffer[13] == (byte)'P' && buffer[14] == (byte)'8' && buffer[15] == (byte)'L')
        {
            if (buffer[20] == 0x2F && bytesRead >= 25)
            {
                byte b0 = buffer[21];
                byte b1 = buffer[22];
                byte b2 = buffer[23];
                byte b3 = buffer[24];
                int width = 1 + (b0 | ((b1 & 0x3F) << 8));
                int height = 1 + (((b1 >> 6) | (b2 << 2) | ((b3 & 0x0F) << 10)));
                return (width, height);
            }
        }

        // VP8 (Simple Lossy WebP)
        if (buffer[12] == (byte)'V' && buffer[13] == (byte)'P' && buffer[14] == (byte)'8' && buffer[15] == (byte)' ')
        {
            if (bytesRead >= 30 && buffer[23] == 0x9D && buffer[24] == 0x01 && buffer[25] == 0x2A)
            {
                int width = (buffer[26] | (buffer[27] << 8)) & 0x3FFF;
                int height = (buffer[28] | (buffer[29] << 8)) & 0x3FFF;
                return (width, height);
            }
        }

        return (0, 0);
    }

    private static (int Width, int Height) GetJpegDimensions(Stream stream)
    {
        if (stream.CanSeek) stream.Position = 2;

        Span<byte> markerBuffer = stackalloc byte[4];
        while (stream.Read(markerBuffer.Slice(0, 2)) == 2)
        {
            if (markerBuffer[0] != 0xFF) break;

            byte marker = markerBuffer[1];
            // Skip fill FF bytes
            while (marker == 0xFF)
            {
                int next = stream.ReadByte();
                if (next == -1) return (0, 0);
                marker = (byte)next;
            }

            if (marker is 0xD9 or 0xDA) // EOI or SOS
                break;

            if (stream.Read(markerBuffer.Slice(2, 2)) != 2) break;
            int length = (markerBuffer[2] << 8) | markerBuffer[3];
            if (length < 2) break;

            // SOF0 (0xC0), SOF1 (0xC1), SOF2 (0xC2), SOF3 (0xC3), SOF5-SOF7, SOF9-SOF11, SOF13-SOF15
            if (marker is 0xC0 or 0xC1 or 0xC2 or 0xC3 or 0xC5 or 0xC6 or 0xC7 or 0xC9 or 0xCA or 0xCB or 0xCD or 0xCE or 0xCF)
            {
                Span<byte> sofBuffer = stackalloc byte[5];
                if (stream.Read(sofBuffer) == 5)
                {
                    int height = (sofBuffer[1] << 8) | sofBuffer[2];
                    int width = (sofBuffer[3] << 8) | sofBuffer[4];
                    return (width, height);
                }
                break;
            }

            // Skip payload of this marker
            int toSkip = length - 2;
            if (stream.CanSeek)
            {
                stream.Seek(toSkip, SeekOrigin.Current);
            }
            else
            {
                while (toSkip > 0)
                {
                    int read = stream.Read(markerBuffer.Slice(0, Math.Min(toSkip, markerBuffer.Length)));
                    if (read <= 0) break;
                    toSkip -= read;
                }
            }
        }

        return (0, 0);
    }

    private static (int Width, int Height) GetAvifDimensions(Stream stream)
    {
        Span<byte> buffer = stackalloc byte[4096];
        int bytesRead = stream.Read(buffer);
        if (bytesRead < 16) return (0, 0);

        for (int i = 0; i <= bytesRead - 16; i++)
        {
            // Search for FourCC 'ispe' (0x69, 0x73, 0x70, 0x65)
            if (buffer[i] == 0x69 && buffer[i + 1] == 0x73 && buffer[i + 2] == 0x70 && buffer[i + 3] == 0x65)
            {
                int width = (buffer[i + 8] << 24) | (buffer[i + 9] << 16) | (buffer[i + 10] << 8) | buffer[i + 11];
                int height = (buffer[i + 12] << 24) | (buffer[i + 13] << 16) | (buffer[i + 14] << 8) | buffer[i + 15];
                if (width > 0 && height > 0)
                {
                    return (width, height);
                }
            }
        }

        return (0, 0);
    }

    public static bool IsAvif(ReadOnlySpan<byte> buffer)
    {
        if (buffer.Length < 12) return false;
        if (buffer[4] == (byte)'f' && buffer[5] == (byte)'t' && buffer[6] == (byte)'y' && buffer[7] == (byte)'p')
        {
            // Direct major brand check: 'avif' or 'avis'
            if (buffer[8] == (byte)'a' && buffer[9] == (byte)'v' && buffer[10] == (byte)'i' && (buffer[11] == (byte)'f' || buffer[11] == (byte)'s'))
                return true;

            // Check compatible brands if major brand is mif1, msf1, or miaf
            if ((buffer[8] == (byte)'m' && buffer[9] == (byte)'i' && buffer[10] == (byte)'f' && buffer[11] == (byte)'1') ||
                (buffer[8] == (byte)'m' && buffer[9] == (byte)'i' && buffer[10] == (byte)'a' && buffer[11] == (byte)'f') ||
                (buffer[8] == (byte)'m' && buffer[9] == (byte)'s' && buffer[10] == (byte)'f' && buffer[11] == (byte)'1'))
            {
                int boxLength = (buffer[0] << 24) | (buffer[1] << 16) | (buffer[2] << 8) | buffer[3];
                int limit = Math.Min(buffer.Length, boxLength > 0 ? boxLength : buffer.Length);
                for (int i = 16; i + 4 <= limit; i += 4)
                {
                    if (buffer[i] == (byte)'a' && buffer[i + 1] == (byte)'v' && buffer[i + 2] == (byte)'i' && (buffer[i + 3] == (byte)'f' || buffer[i + 3] == (byte)'s'))
                        return true;
                }
            }
        }
        return false;
    }

    public static bool IsWebp(ReadOnlySpan<byte> buffer)
    {
        return buffer.Length >= 12 &&
               buffer[0] == (byte)'R' && buffer[1] == (byte)'I' && buffer[2] == (byte)'F' && buffer[3] == (byte)'F' &&
               buffer[8] == (byte)'W' && buffer[9] == (byte)'E' && buffer[10] == (byte)'B' && buffer[11] == (byte)'P';
    }

    public static bool IsJpeg(ReadOnlySpan<byte> buffer)
    {
        return buffer.Length >= 2 && buffer[0] == 0xFF && buffer[1] == 0xD8;
    }

    public static bool IsPng(ReadOnlySpan<byte> buffer)
    {
        return buffer.Length >= 8 &&
               buffer[0] == 0x89 && buffer[1] == 0x50 && buffer[2] == 0x4E && buffer[3] == 0x47 &&
               buffer[4] == 0x0D && buffer[5] == 0x0A && buffer[6] == 0x1A && buffer[7] == 0x0A;
    }

    public static bool IsGif(ReadOnlySpan<byte> buffer)
    {
        return buffer.Length >= 6 &&
               buffer[0] == (byte)'G' && buffer[1] == (byte)'I' && buffer[2] == (byte)'F' &&
               buffer[3] == (byte)'8' && (buffer[4] == (byte)'7' || buffer[4] == (byte)'9') && buffer[5] == (byte)'a';
    }

    public static bool IsBmp(ReadOnlySpan<byte> buffer)
    {
        return buffer.Length >= 2 && buffer[0] == (byte)'B' && buffer[1] == (byte)'M';
    }
}

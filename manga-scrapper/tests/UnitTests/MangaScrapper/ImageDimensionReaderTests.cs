using FluentAssertions;
using MangaScrapper.Core.Utils;
using Xunit;

namespace UnitTests.MangaScrapper;

public class ImageDimensionReaderTests
{
    [Fact]
    public void GetDimensions_WithValidPngHeader_ShouldReturnCorrectWidthAndHeight()
    {
        // PNG Header with width 800 (0x0320) and height 1200 (0x04B0)
        byte[] pngHeader = new byte[]
        {
            0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
            0x00, 0x00, 0x00, 0x0D,                         // IHDR chunk size (13)
            0x49, 0x48, 0x44, 0x52,                         // "IHDR"
            0x00, 0x00, 0x03, 0x20,                         // Width: 800
            0x00, 0x00, 0x04, 0xB0,                         // Height: 1200
            0x08, 0x06, 0x00, 0x00, 0x00                    // Bit depth, color type, etc.
        };

        using var ms = new MemoryStream(pngHeader);
        var dimensions = ImageDimensionReader.GetDimensions(ms);

        dimensions.Width.Should().Be(800);
        dimensions.Height.Should().Be(1200);
    }

    [Fact]
    public void GetDimensions_WithValidWebpVp8xHeader_ShouldReturnCorrectWidthAndHeight()
    {
        // WebP VP8X header (Extended format): width 1080 (0x000438 - 1 = 0x000437), height 1920 (0x000780 - 1 = 0x00077F)
        int targetWidth = 1080;
        int targetHeight = 1920;
        int wMinus1 = targetWidth - 1; // 1079 = 0x000437 -> 0x37, 0x04, 0x00
        int hMinus1 = targetHeight - 1; // 1919 = 0x00077F -> 0x7F, 0x07, 0x00

        byte[] webpHeader = new byte[]
        {
            (byte)'R', (byte)'I', (byte)'F', (byte)'F',
            0x00, 0x00, 0x00, 0x00,                         // File size
            (byte)'W', (byte)'E', (byte)'B', (byte)'P',
            (byte)'V', (byte)'P', (byte)'8', (byte)'X',     // VP8X
            0x0A, 0x00, 0x00, 0x00,                         // Chunk size (10)
            0x00, 0x00, 0x00, 0x00,                         // Flags
            (byte)(wMinus1 & 0xFF), (byte)((wMinus1 >> 8) & 0xFF), (byte)((wMinus1 >> 16) & 0xFF),
            (byte)(hMinus1 & 0xFF), (byte)((hMinus1 >> 8) & 0xFF), (byte)((hMinus1 >> 16) & 0xFF)
        };

        using var ms = new MemoryStream(webpHeader);
        var dimensions = ImageDimensionReader.GetDimensions(ms);

        dimensions.Width.Should().Be(1080);
        dimensions.Height.Should().Be(1920);
    }

    [Fact]
    public void GetDimensions_WithValidGifHeader_ShouldReturnCorrectWidthAndHeight()
    {
        // GIF89a header: width 640 (0x0280), height 480 (0x01E0)
        byte[] gifHeader = new byte[]
        {
            (byte)'G', (byte)'I', (byte)'F', (byte)'8', (byte)'9', (byte)'a',
            0x80, 0x02, // Width: 640
            0xE0, 0x01  // Height: 480
        };

        using var ms = new MemoryStream(gifHeader);
        var dimensions = ImageDimensionReader.GetDimensions(ms);

        dimensions.Width.Should().Be(640);
        dimensions.Height.Should().Be(480);
    }

    [Fact]
    public void GetDimensions_WithValidBmpHeader_ShouldReturnCorrectWidthAndHeight()
    {
        // BMP header: 14 bytes BITMAPFILEHEADER + 12 bytes of BITMAPINFOHEADER
        byte[] bmpHeader = new byte[30];
        bmpHeader[0] = (byte)'B';
        bmpHeader[1] = (byte)'M';
        // Width at offset 18: 1920 (0x00000780)
        bmpHeader[18] = 0x80; bmpHeader[19] = 0x07; bmpHeader[20] = 0x00; bmpHeader[21] = 0x00;
        // Height at offset 22: 1080 (0x00000438)
        bmpHeader[22] = 0x38; bmpHeader[23] = 0x04; bmpHeader[24] = 0x00; bmpHeader[25] = 0x00;

        using var ms = new MemoryStream(bmpHeader);
        var dimensions = ImageDimensionReader.GetDimensions(ms);

        dimensions.Width.Should().Be(1920);
        dimensions.Height.Should().Be(1080);
    }

    [Fact]
    public void GetDimensions_WithInvalidData_ShouldReturnZero()
    {
        byte[] invalid = new byte[] { 0x01, 0x02, 0x03, 0x04 };

        using var ms = new MemoryStream(invalid);
        var dimensions = ImageDimensionReader.GetDimensions(ms);

        dimensions.Width.Should().Be(0);
        dimensions.Height.Should().Be(0);
    }
}

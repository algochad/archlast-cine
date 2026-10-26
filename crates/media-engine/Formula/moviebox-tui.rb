class MovieboxTui < Formula
  VERSION = "0.1.18"
  MACOS_SHA256 = "9416627b9139cf4d43b1b9ff4f0bf578a5de8f4d2c2685926562ef2087d204d8"
  LINUX_X64_SHA256 = "4230ed9fff815498a1de980277f6b51e69fd5bbb05873b4fc4e2d0acc958fff2"
  LINUX_ARM64_SHA256 = "eede6339d5bfb34b9419257ea56ffde53c57084e4cdae7192828ee00de10bd5a"

  desc "Stream movies, shows, anime, and live TV from your terminal"
  homepage "https://github.com/mesamirh/MovieBox-Tui"
  version VERSION
  license any_of: ["MIT", "Apache-2.0"]

  on_macos do
    url "https://github.com/mesamirh/MovieBox-Tui/releases/download/v#{VERSION}/MovieBox_macOS_Universal.tar.gz"
    sha256 MACOS_SHA256
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/mesamirh/MovieBox-Tui/releases/download/v#{VERSION}/MovieBox_Linux_arm64.tar.gz"
      sha256 LINUX_ARM64_SHA256
    else
      url "https://github.com/mesamirh/MovieBox-Tui/releases/download/v#{VERSION}/MovieBox_Linux_x64.tar.gz"
      sha256 LINUX_X64_SHA256
    end
  end

  def install
    bin.install "moviebox-tui"
  end

  test do
    system "#{bin}/moviebox-tui", "--version"
  end
end

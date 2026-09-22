# Installation

MovieBox-TUI is available across macOS, Linux, Windows, and Android (Termux).

---

## macOS & Linux

Install via the automated script:

```bash
curl -fsSL https://raw.githubusercontent.com/mesamirh/MovieBox-Tui/main/install.sh | bash
```

### macOS via Homebrew

```bash
brew tap mesamirh/moviebox-tui https://github.com/mesamirh/MovieBox-Tui
brew trust mesamirh/moviebox-tui
brew install moviebox-tui
```

---

## Windows

Install via PowerShell (run in Windows Terminal or PowerShell 5.1+):

```powershell
irm https://raw.githubusercontent.com/mesamirh/MovieBox-Tui/main/install.ps1 | iex
```

---

## Android (Termux)

Install Termux tools and the intent bridge, run the installer script to fetch the precompiled native Android ARM64 binary, and grant storage permissions:

```bash
pkg update && pkg install -y curl tar termux-tools termux-am
curl -fsSL https://raw.githubusercontent.com/mesamirh/MovieBox-Tui/main/install.sh -o install.sh && bash install.sh
termux-setup-storage
```

The installer automatically downloads the native Android ARM64 release package (`MovieBox_Android_arm64.tar.gz`) built against the Android NDK and Bionic libc, requiring zero on-device compilation.

> **Media Player Requirements**: Android streams are rendered through external Android video players (such as **VLC for Android**, **MX Player**, **Just Player**, or **MPV Android APK**) triggered via `termux-open` or `termux-am`. Command-line `mpv` installed directly in Termux (`pkg install mpv`) runs without a video output surface unless an X11 desktop environment (like Termux:X11) is configured.

To compile from source on Termux:

```bash
pkg install -y rust clang
cargo install moviebox-tui --locked
```

---

## Cargo (Crates.io)

Install directly using Cargo:

```bash
cargo install moviebox-tui --locked
```

---

## Compile from Source

Clone the repository and build the release binary:

```bash
git clone https://github.com/mesamirh/MovieBox-Tui.git
cd MovieBox-Tui
cargo build --release --locked
```

The compiled binary will be located at `target/release/moviebox-tui`.

---

## Verify Release Integrity

All release assets include cryptographically signed SHA-256 checksums and GitHub provenance attestations:

```bash
sha256sum -c SHA256SUMS --ignore-missing
gh attestation verify <archive-file> -R mesamirh/MovieBox-Tui
```

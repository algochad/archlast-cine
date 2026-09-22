#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct ReleaseAsset {
    pub name: String,
    pub download_url: String,
    pub size: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Release {
    pub version: String,
    pub tag_name: String,
    pub notes: String,
    pub assets: Vec<ReleaseAsset>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TargetPlatform {
    MacosUniversal,
    LinuxX64,
    LinuxArm64,
    WindowsX64,
    WindowsArm64,
}

impl TargetPlatform {
    pub fn current() -> Option<Self> {
        Self::detect(
            std::env::consts::OS,
            std::env::consts::ARCH,
            is_termux_environment(),
        )
    }

    pub fn detect(os: &str, arch: &str, is_termux: bool) -> Option<Self> {
        if is_termux || os == "android" {
            return None;
        }

        match os {
            "macos" | "darwin" => Some(Self::MacosUniversal),
            "linux" => match arch {
                "x86_64" | "x86-64" | "x64" | "amd64" => Some(Self::LinuxX64),
                "aarch64" | "arm64" => Some(Self::LinuxArm64),
                _ => None,
            },
            "windows" => match arch {
                "x86_64" | "x86-64" | "x64" | "amd64" => Some(Self::WindowsX64),
                "aarch64" | "arm64" => Some(Self::WindowsArm64),
                _ => None,
            },
            _ => None,
        }
    }

    pub fn expected_asset_name(self) -> &'static str {
        match self {
            Self::MacosUniversal => "MovieBox_macOS_Universal.tar.gz",
            Self::LinuxX64 => "MovieBox_Linux_x64.tar.gz",
            Self::LinuxArm64 => "MovieBox_Linux_arm64.tar.gz",
            Self::WindowsX64 => "MovieBox_Windows_x64.zip",
            Self::WindowsArm64 => "MovieBox_Windows_arm64.zip",
        }
    }

    pub fn expected_binary_name(self) -> &'static str {
        match self {
            Self::WindowsX64 | Self::WindowsArm64 => "moviebox-tui.exe",
            _ => "moviebox-tui",
        }
    }
}

pub fn is_termux_environment() -> bool {
    cfg!(target_os = "android")
        || std::env::var("TERMUX_VERSION").is_ok()
        || std::env::var("PREFIX").is_ok_and(|p| p.contains("com.termux"))
        || std::path::Path::new("/data/data/com.termux/files/usr").exists()
}

impl Release {
    pub fn find_compatible_asset(&self, platform: TargetPlatform) -> Option<ReleaseAsset> {
        let expected = platform.expected_asset_name();
        if let Some(asset) = self.assets.iter().find(|a| a.name == expected) {
            return Some(asset.clone());
        }
        if self.assets.is_empty() && !self.tag_name.is_empty() {
            return Some(ReleaseAsset {
                name: expected.to_string(),
                download_url: format!(
                    "https://github.com/mesamirh/MovieBox-Tui/releases/download/{}/{expected}",
                    self.tag_name
                ),
                size: None,
            });
        }
        None
    }

    pub fn find_checksum_asset(&self) -> Option<ReleaseAsset> {
        if let Some(asset) = self.assets.iter().find(|a| a.name == "SHA256SUMS") {
            return Some(asset.clone());
        }
        if self.assets.is_empty() && !self.tag_name.is_empty() {
            return Some(ReleaseAsset {
                name: "SHA256SUMS".to_string(),
                download_url: format!(
                    "https://github.com/mesamirh/MovieBox-Tui/releases/download/{}/SHA256SUMS",
                    self.tag_name
                ),
                size: None,
            });
        }
        None
    }

    pub fn is_compatible_with_current_platform(&self) -> bool {
        TargetPlatform::current()
            .and_then(|p| self.find_compatible_asset(p))
            .is_some()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_synthetic_asset_url_generation_on_empty_assets() {
        let empty_assets_release = Release {
            version: "0.1.16".to_string(),
            tag_name: "v0.1.16".to_string(),
            notes: "Fallback tag release".to_string(),
            assets: Vec::new(),
        };

        let linux_asset = empty_assets_release
            .find_compatible_asset(TargetPlatform::LinuxX64)
            .expect("should generate synthetic asset");
        assert_eq!(linux_asset.name, "MovieBox_Linux_x64.tar.gz");
        assert_eq!(
            linux_asset.download_url,
            "https://github.com/mesamirh/MovieBox-Tui/releases/download/v0.1.16/MovieBox_Linux_x64.tar.gz"
        );

        let mac_asset = empty_assets_release
            .find_compatible_asset(TargetPlatform::MacosUniversal)
            .expect("should generate synthetic asset");
        assert_eq!(mac_asset.name, "MovieBox_macOS_Universal.tar.gz");
        assert_eq!(
            mac_asset.download_url,
            "https://github.com/mesamirh/MovieBox-Tui/releases/download/v0.1.16/MovieBox_macOS_Universal.tar.gz"
        );

        let checksum = empty_assets_release
            .find_checksum_asset()
            .expect("should generate synthetic checksum");
        assert_eq!(checksum.name, "SHA256SUMS");
        assert_eq!(
            checksum.download_url,
            "https://github.com/mesamirh/MovieBox-Tui/releases/download/v0.1.16/SHA256SUMS"
        );
    }

    #[test]
    fn test_empty_tag_does_not_generate_synthetic_assets() {
        let untagged = Release {
            version: "0.1.16".to_string(),
            tag_name: String::new(),
            notes: String::new(),
            assets: Vec::new(),
        };
        assert!(
            untagged
                .find_compatible_asset(TargetPlatform::LinuxX64)
                .is_none()
        );
        assert!(untagged.find_checksum_asset().is_none());
    }
}

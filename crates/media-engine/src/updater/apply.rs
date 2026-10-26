use std::path::{Path, PathBuf};
use std::process::Command;

const STAGED_BINARY_FILENAME: &str = ".moviebox_update_staged.exe";
const HELPER_SCRIPT_FILENAME: &str = "moviebox_update_helper.bat";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SelfUpdateOutcome {
    Success,
    RequiresManualUpgrade(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InstallationEnvironment {
    DirectReplace,
    Homebrew,
    Termux,
    ReadOnly,
    WindowsHelper,
}

pub fn detect_environment(exe_path: &Path) -> InstallationEnvironment {
    if super::artifact::is_termux_environment() {
        return InstallationEnvironment::Termux;
    }

    if is_homebrew_managed(exe_path) {
        return InstallationEnvironment::Homebrew;
    }

    if cfg!(windows) {
        return InstallationEnvironment::WindowsHelper;
    }

    if !is_writable(exe_path) {
        return InstallationEnvironment::ReadOnly;
    }

    InstallationEnvironment::DirectReplace
}

pub fn is_homebrew_managed(exe_path: &Path) -> bool {
    let check_path = |p: &Path| -> bool {
        let s = p.to_string_lossy();
        s.contains("/Cellar/")
            || s.contains("/opt/homebrew/")
            || s.contains("/usr/local/Cellar/")
            || s.contains("/home/linuxbrew/.linuxbrew/Cellar/")
    };

    if check_path(exe_path) {
        return true;
    }

    if let Ok(canonical) = exe_path.canonicalize() {
        if check_path(&canonical) {
            return true;
        }
    }

    false
}

pub fn is_writable(exe_path: &Path) -> bool {
    let parent = match exe_path.parent() {
        Some(p) => p,
        None => return false,
    };

    let test_file = parent.join(format!(".moviebox_write_test_{}", std::process::id()));
    match std::fs::File::create(&test_file) {
        Ok(_) => {
            let _ = std::fs::remove_file(test_file);
            true
        }
        Err(_) => false,
    }
}

pub fn apply_staged_binary(
    staged_path: &Path,
    current_exe: &Path,
) -> Result<SelfUpdateOutcome, String> {
    let env = detect_environment(current_exe);

    match env {
        InstallationEnvironment::Homebrew => {
            Ok(SelfUpdateOutcome::RequiresManualUpgrade(
                "This installation is managed by Homebrew. Run: brew upgrade moviebox-tui".to_string(),
            ))
        }
        InstallationEnvironment::Termux => {
            Ok(SelfUpdateOutcome::RequiresManualUpgrade(
                "Android / Termux update: run 'curl -fsSL https://raw.githubusercontent.com/mesamirh/MovieBox-Tui/main/install.sh | bash'".to_string(),
            ))
        }
        InstallationEnvironment::ReadOnly => {
            Ok(SelfUpdateOutcome::RequiresManualUpgrade(
                "MovieBox-Tui binary is not user-writable. Please update via your system package manager.".to_string(),
            ))
        }
        InstallationEnvironment::DirectReplace => {
            replace_binary_with_backup(staged_path, current_exe)?;
            Ok(SelfUpdateOutcome::Success)
        }
        InstallationEnvironment::WindowsHelper => {
            let result = spawn_windows_helper(staged_path, current_exe);
            if result.is_err() {
                let _ = std::fs::remove_file(staged_path);
            }
            result.map(|_| SelfUpdateOutcome::Success)
        }
    }
}

pub fn persistent_staging_path(current_exe: &Path) -> PathBuf {
    current_exe.with_file_name(STAGED_BINARY_FILENAME)
}

pub fn stale_update_artifacts(current_exe: &Path) -> Vec<PathBuf> {
    vec![
        current_exe.with_file_name(STAGED_BINARY_FILENAME),
        current_exe.with_file_name(HELPER_SCRIPT_FILENAME),
    ]
}

pub fn cleanup_stale_update_artifacts(current_exe: &Path) {
    if !cfg!(windows) {
        return;
    }
    for path in stale_update_artifacts(current_exe) {
        let _ = std::fs::remove_file(path);
    }
}

fn replace_binary_with_backup(staged_path: &Path, current_exe: &Path) -> Result<(), String> {
    let backup_path = current_exe.with_extension("old");
    if backup_path.exists() {
        let _ = std::fs::remove_file(&backup_path);
    }

    if let Err(e) = std::fs::rename(current_exe, &backup_path) {
        if let Err(copy_err) = std::fs::copy(current_exe, &backup_path) {
            return Err(format!(
                "failed to backup existing binary: {e} (copy: {copy_err})"
            ));
        }
    }

    let install_result = match std::fs::rename(staged_path, current_exe) {
        Ok(_) => Ok(()),
        Err(_) => match std::fs::copy(staged_path, current_exe) {
            Ok(_) => {
                let _ = std::fs::remove_file(staged_path);
                Ok(())
            }
            Err(copy_err) => Err(format!("failed to replace binary: {copy_err}")),
        },
    };

    if let Err(err) = install_result {
        if backup_path.exists() {
            let _ = std::fs::rename(&backup_path, current_exe);
        }
        return Err(err);
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(metadata) = std::fs::metadata(current_exe) {
            let mut perms = metadata.permissions();
            perms.set_mode(0o755);
            let _ = std::fs::set_permissions(current_exe, perms);
        }
    }

    if backup_path.exists() {
        let _ = std::fs::remove_file(&backup_path);
    }

    Ok(())
}

fn render_helper_script(staged_path: &Path, current_exe: &Path, pid: u32) -> String {
    [
        "@echo off".to_string(),
        ":wait_loop".to_string(),
        format!(
            "tasklist /FI \"PID eq {pid}\" 2>NUL | %SystemRoot%\\System32\\find.exe \"{pid}\" >NUL"
        ),
        "if %ERRORLEVEL% == 0 (".to_string(),
        "    timeout /t 1 /nobreak >NUL".to_string(),
        "    goto wait_loop".to_string(),
        ")".to_string(),
        "set /a attempts=0".to_string(),
        ":move_loop".to_string(),
        format!(
            "move /y \"{}\" \"{}\" >NUL 2>&1",
            staged_path.to_string_lossy(),
            current_exe.to_string_lossy()
        ),
        "if %ERRORLEVEL% NEQ 0 (".to_string(),
        "    set /a attempts+=1".to_string(),
        "    if %attempts% LSS 5 (".to_string(),
        "        timeout /t 1 /nobreak >NUL".to_string(),
        "        goto move_loop".to_string(),
        "    )".to_string(),
        ")".to_string(),
        format!(
            "if exist \"{}\" del /f /q \"{}\"",
            staged_path.to_string_lossy(),
            staged_path.to_string_lossy()
        ),
        format!("start \"\" \"{}\"", current_exe.to_string_lossy()),
        "del \"%~f0\"".to_string(),
    ]
    .join("\r\n")
}

fn spawn_windows_helper(staged_path: &Path, current_exe: &Path) -> Result<(), String> {
    let helper_path = current_exe.with_file_name(HELPER_SCRIPT_FILENAME);
    let pid = std::process::id();

    let script_content = render_helper_script(staged_path, current_exe, pid);

    std::fs::write(&helper_path, script_content)
        .map_err(|e| format!("failed to write Windows update helper: {e}"))?;

    let mut cmd = Command::new("cmd.exe");
    cmd.args(["/C", &helper_path.to_string_lossy()]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(crate::player::CREATE_NO_WINDOW);
    }
    cmd.spawn()
        .map_err(|e| format!("failed to spawn Windows update helper: {e}"))?;

    Ok(())
}

pub fn restart_process(exe_path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        let args: Vec<String> = std::env::args().skip(1).collect();
        let err = Command::new(exe_path).args(&args).exec();
        Err(format!("failed to exec restarted process: {err}"))
    }

    #[cfg(windows)]
    {
        let _ = exe_path;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn persistent_staging_path_lives_beside_executable() {
        let exe = Path::new("/opt/tools/moviebox-tui.exe");
        let staged = persistent_staging_path(exe);
        assert_eq!(staged.parent(), Some(Path::new("/opt/tools")));
        assert!(staged.to_string_lossy().contains("moviebox_update_staged"));
    }

    #[test]
    fn stale_artifacts_cover_staging_and_helper() {
        let exe = Path::new("C:/App/moviebox-tui.exe");
        let paths = stale_update_artifacts(exe);
        assert_eq!(paths.len(), 2);
        assert!(
            paths[0]
                .to_string_lossy()
                .contains("moviebox_update_staged")
        );
        assert!(
            paths[1]
                .to_string_lossy()
                .contains("moviebox_update_helper.bat")
        );
    }

    #[test]
    fn helper_script_waits_moves_and_cleans_up() {
        let script = render_helper_script(
            Path::new("C:\\App\\update dir\\.moviebox_update_staged.exe"),
            Path::new("C:\\App\\moviebox-tui.exe"),
            4242,
        );
        let lines: Vec<&str> = script.split("\r\n").collect();
        assert_eq!(lines[0], "@echo off");
        assert!(script.contains(
            "tasklist /FI \"PID eq 4242\" 2>NUL | %SystemRoot%\\System32\\find.exe \"4242\" >NUL"
        ));
        assert!(script.contains(
            "move /y \"C:\\App\\update dir\\.moviebox_update_staged.exe\" \"C:\\App\\moviebox-tui.exe\" >NUL 2>&1"
        ));
        assert!(script.contains(":move_loop"));
        assert!(script.contains("if %attempts% LSS 5 ("));
        assert!(script.contains(
            "if exist \"C:\\App\\update dir\\.moviebox_update_staged.exe\" del /f /q \"C:\\App\\update dir\\.moviebox_update_staged.exe\""
        ));
        assert!(script.contains("start \"\" \"C:\\App\\moviebox-tui.exe\""));
        assert_eq!(*lines.last().expect("non-empty"), "del \"%~f0\"");
    }

    #[cfg(windows)]
    #[test]
    fn cleanup_removes_only_known_artifacts() {
        let dir = std::env::temp_dir().join(format!("mbx_apply_test_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let exe = dir.join("moviebox-tui.exe");
        std::fs::write(&exe, b"current").unwrap();
        let staged = persistent_staging_path(&exe);
        std::fs::write(&staged, b"staged").unwrap();
        cleanup_stale_update_artifacts(&exe);
        assert!(!staged.exists());
        assert!(exe.exists());
        let _ = std::fs::remove_dir_all(&dir);
    }
}

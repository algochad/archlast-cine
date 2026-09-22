use moviebox_tui::tui::app::App;

#[cfg(not(target_os = "android"))]
#[global_allocator]
static GLOBAL: mimalloc::MiMalloc = mimalloc::MiMalloc;

#[cfg(all(target_arch = "aarch64", target_os = "linux"))]
core::arch::global_asm!(
    ".section .tdata,\"awT\",@progbits",
    ".p2align 6",
    ".globl __bionic_tls_align_anchor",
    "__bionic_tls_align_anchor:",
    ".text",
    ".globl __bionic_tls_align_reference",
    ".type __bionic_tls_align_reference,%function",
    "__bionic_tls_align_reference:",
    "add x0, x0, :tprel_lo12_nc:__bionic_tls_align_anchor",
    "ret",
    ".size __bionic_tls_align_reference, .-__bionic_tls_align_reference",
);

#[cfg(all(target_arch = "aarch64", target_os = "linux"))]
unsafe extern "C" {
    fn __bionic_tls_align_reference();
}
struct TerminalGuard;

fn restore_terminal() {
    let _ = crossterm::execute!(
        std::io::stdout(),
        crossterm::cursor::SetCursorStyle::DefaultUserShape,
        crossterm::cursor::Show,
        crossterm::event::DisableMouseCapture,
        crossterm::event::DisableFocusChange,
        crossterm::event::PopKeyboardEnhancementFlags,
        crossterm::terminal::LeaveAlternateScreen
    );
    let _ = crossterm::terminal::disable_raw_mode();
}

fn purge_stale_subtitles() {
    tokio::task::spawn_blocking(|| {
        let max_age = 24 * 60 * 60;
        let mut dirs = vec![
            moviebox_tui::service::resolve_subtitle_dir(),
            std::env::temp_dir().join("moviebox-tui/subs"),
        ];
        if let Some(home) = dirs::home_dir() {
            let android_storage = home.join("storage/downloads/moviebox_subs");
            if home.join("storage/downloads").exists() {
                dirs.push(android_storage);
            }
        }

        for dir in dirs {
            if dir.exists()
                && let Ok(entries) = std::fs::read_dir(&dir)
            {
                for entry in entries.flatten() {
                    if let Ok(metadata) = entry.metadata()
                        && let Ok(modified) = metadata.modified()
                        && let Ok(elapsed) = modified.elapsed()
                        && elapsed.as_secs() > max_age
                    {
                        let _ = std::fs::remove_file(entry.path());
                    }
                }
            }
        }
    });
}

fn purge_stale_update_artifacts() {
    tokio::task::spawn_blocking(|| {
        if let Ok(current_exe) = std::env::current_exe() {
            moviebox_tui::updater::apply::cleanup_stale_update_artifacts(&current_exe);
        }
    });
}

impl Drop for TerminalGuard {
    fn drop(&mut self) {
        restore_terminal();
    }
}

#[tokio::main]
async fn main() -> std::io::Result<()> {
    #[cfg(all(target_arch = "aarch64", target_os = "linux"))]
    {
        core::hint::black_box(__bionic_tls_align_reference as *const ());
    }
    let args: Vec<String> = std::env::args().collect();
    if args.iter().any(|arg| arg == "--help" || arg == "-h") {
        println!("moviebox-tui {}", env!("CARGO_PKG_VERSION"));
        println!("A terminal client for finding and streaming movies, TV shows, and anime.\n");
        println!("USAGE:");
        println!("    moviebox-tui [OPTIONS]\n");
        println!("OPTIONS:");
        println!("    -h, --help           Print help information");
        println!("    -v, -V, --version    Print version information\n");
        println!("ENVIRONMENT VARIABLES:");
        println!("    MOVIEBOX_LOG            Log level (off, error, warn, info, debug, trace)");
        println!("    MOVIEBOX_THEME          Theme name (e.g. catppuccin, dracula, nord, etc.)");
        println!("    MOVIEBOX_PLAYER         Preferred player (mpv, iina, vlc, android)");
        println!("    MOVIEBOX_MPV_PATH       Custom mpv binary path");
        println!("    MOVIEBOX_VLC_PATH       Custom vlc binary path");
        println!("    MOVIEBOX_IINA_PATH      Custom iina-cli binary path");
        println!("    MOVIEBOX_FOURKHDHUB_URL Custom 4KHDHub base URL");
        println!("    MOVIEBOX_NO_IMAGE       Disable poster image queries (1/true)");
        println!(
            "    MOVIEBOX_IMAGE_PROTOCOL Force graphics protocol (kitty, sixel, iterm2, none)"
        );
        println!("    MOVIEBOX_CELL_SIZE      Override terminal cell size as WxH (e.g. 10x20)");
        return Ok(());
    }
    if args
        .iter()
        .any(|arg| arg == "--version" || arg == "-v" || arg == "-V")
    {
        println!("moviebox-tui {}", env!("CARGO_PKG_VERSION"));
        return Ok(());
    }

    moviebox_tui::logging::init();

    std::panic::set_hook(Box::new(|info| {
        log::error!("panic: {info}");
        restore_terminal();
        eprintln!("{info}");
    }));

    let stdout = std::io::stdout();
    let backend =
        ratatui::backend::CrosstermBackend::new(std::io::BufWriter::with_capacity(65536, stdout));
    let mut terminal = ratatui::Terminal::new(backend)?;
    crossterm::terminal::enable_raw_mode()?;
    let _guard = TerminalGuard;
    crossterm::execute!(
        std::io::stdout(),
        crossterm::terminal::EnterAlternateScreen,
        crossterm::event::EnableMouseCapture,
        crossterm::event::EnableFocusChange
    )?;
    let _ = crossterm::execute!(
        std::io::stdout(),
        crossterm::event::PushKeyboardEnhancementFlags(
            crossterm::event::KeyboardEnhancementFlags::DISAMBIGUATE_ESCAPE_CODES
                | crossterm::event::KeyboardEnhancementFlags::REPORT_EVENT_TYPES
        )
    );

    moviebox_tui::cache::clean_old_cache_background();
    purge_stale_subtitles();
    purge_stale_update_artifacts();

    let mut app = App::new();
    if let Err(err) = app.run(&mut terminal).await {
        log::error!("application error: {err}");
    }
    Ok(())
}

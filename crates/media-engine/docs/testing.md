# Testing & QA Architecture

This document describes the testing architecture, quality assurance procedures, and validation guidelines for MovieBox-TUI.

## 1. Test Architecture

The test suite comprises **320+ automated tests across 10 test suites** (213 unit tests in `src/lib.rs` and 110 integration tests across 9 focused suites in `tests/`), running fully offline by default without mocking or live network dependencies.
The MovieBox-TUI test architecture follows a strict separation of concerns:

```text
MovieBox-TUI/
├── src/
│   └── **/*.rs              # Pure algorithms & inline unit tests (#[cfg(test)])
└── tests/
    ├── common/
    │   └── mod.rs           # Shared test utilities & temporary directory helpers
    ├── fixtures/
    │   └── addons/
    │       └── manifest.json
    ├── settings_hub.rs        # Interactive Settings Hub modal tab navigation, choices, & option rows
    ├── tui_acceptance.rs      # Headless TUI rendering, theme rendering, and resize matrix
    ├── update_lifecycle.rs    # Update single-flight checks, modal hitboxes, & platform assets
    ├── content_pipeline.rs    # Content/metadata pipeline, stale request isolation, & cache keys
    ├── addons_manifest.rs     # Addon manifest deserialization & catalog checks
    ├── error_handling.rs      # Failure state cleanup, error toasts, and recovery
    ├── history_audit.rs       # Cross-mode watch progress, series advancement, & boundary audit
    ├── favorites_lifecycle.rs # Favorites persistence, identity, and navigation lifecycle
    ├── performance_audit.rs   # Empirical benchmark measurements (truncation, hashing, M3U, draw latency)
    └── live_stream_verification.rs # Live MovieBox CDN signed stream & resolution verification (opt-in)
```

### A. Inline Unit Tests (`src/**/*.rs`)
Inline unit tests live inside `#[cfg(test)] mod tests` blocks within their respective modules. They verify:
- Title normalization (`clean_moviebox_title`)
- HMAC-MD5 cryptographic signing and token generation (`generate_x_client_token`, `generate_x_tr_signature`)
- Segment partitioning math and byte range calculations
- Internal helper logic, parsing functions, and release asset matching
- Update modal layout geometry calculations and semver comparisons

### B. Subsystem Integration Tests (`tests/*.rs`)
Integration tests live in the `tests/` directory and test externally observable behaviors without mocking internal types:
- **`settings_hub.rs`**: Validates the interactive Settings Hub modal tabs, choices, dynamic player detection refresh, mode toggles, and appearance settings.
- **`tui_acceptance.rs`**: Validates headless TUI rendering, all theme palettes, end-to-end user journeys (search, details, navigation, mode switching), mouse click and scroll interactions, modal dismissals, and terminal resize matrices across 8 standard and boundary dimensions without panics.
- **`update_lifecycle.rs`**: Validates update single-flight concurrency barriers, error recovery on network failure, modal actions, checksum integrity verification (valid, mismatch, missing, multi-format), archive extraction with strict path traversal rejection (`..`), active work protection (playback and download guards), environment detection (Homebrew, ReadOnly, DirectReplace), and safe atomic binary replacement/rollback.
- **`content_pipeline.rs`**: Validates stale metadata response protection (`request_id` validation), cache key dimensional isolation, search failure vs empty result status distinction, mode-switch stale response isolation, poster image identity mapping, and search preview fallback metadata isolation.
- **`addons_manifest.rs`**: Validates deserialization of Cinemeta/Stremio addon manifests, multi-season episode decomposition, episode stream isolation (`parse_season_episode`), token and codec parsing, core Cinemeta protection, and addon enabling/disabling lifecycle.
- **`error_handling.rs`**: Validates active player session lifecycle, playback debounce guards, search failure cleanup, stream and download resolution failure notifications, URL scheme rejection, and authoritative player bypass protections.
- **`history_audit.rs`**: Validates cross-mode watch progress, series advancement and completion tracking, threshold boundaries for in-progress states, history disk persistence roundtrips, Lua tracker reconciliation, update precision preservation, repeated play deduplication, and `/history` search list integration.
- **`favorites_lifecycle.rs`**: Validates Favorites persistence boundaries, identity deduplication, `/favorites` loading, landing-row navigation, and independence from watch-history clearing.
- **`performance_audit.rs`**: Validates empirical performance benchmarks and regression thresholds across algorithmic hot paths (SIMD text truncation, MD5 hex table lookup, M3U capacity preallocation, and headless frame draw latencies).
- **`live_stream_verification.rs`**: Validates real-world stream link resolution across MovieBox signed CDN endpoints and 4KHDHub multi-mirror releases. The tests are `#[ignore]`-gated for offline execution; opt in with `cargo test --test live_stream_verification -- --ignored`.
---

## 2. Running Automated Tests

Run the full test suite (all unit and integration tests):

```bash
cargo test --all-features --locked
```

Run only unit tests:

```bash
cargo test --lib --all-features --locked
```

Run a specific integration test:

```bash
cargo test --test settings_hub --all-features --locked
cargo test --test tui_acceptance --all-features --locked
cargo test --test history_audit --all-features --locked
```

Run the opt-in live-network acceptance test:

```bash
MOVIEBOX_LIVE_TESTS=1 cargo test --test real_acceptance --all-features --locked -- --ignored
```

---

## 3. Code Hygiene and Static Analysis

Every commit and pull request must pass all hygiene checks:

```bash
# Check formatting
cargo fmt -- --check

# Compiler check
cargo check --all-targets --all-features --locked

# Clippy linter with warnings treated as errors
cargo clippy --all-targets --all-features --locked -- -D warnings

# Security vulnerability scan
cargo audit
```

---

## 4. Manual QA Matrix

Because TUI and media player interactions depend on terminal capabilities and external processes, manual QA testing covers:

### Terminal Emulators
- **Ghostty** (Primary testing terminal)
- **macOS Terminal.app**
- **iTerm2**
- **Windows Terminal**
- **Linux VTE / Alacritty / Kitty**
- **tmux** session & pane switching

### Supported Media Players
- **mpv** (Full IPC tracking, script options, state reconciliation)
- **VLC** (Local playback and stream forwarding)
- **IINA** (macOS native player integration)
- **termux-open / Android Intents** (Android Termux)

### Key Flows to Verify
1. **Search & Browse**: Type queries, switch between MovieBox, 4KHDHub, BDIX, Addons, and Live TV.
2. **Playback Launch & Return**: Launch stream in player, exit player, verify terminal state is cleanly restored without residual escape sequences.
3. **History & State**: Verify playback progress and watched checkmarks update accurately.
4. **Downloads**: Test single episode and batch season download queuing.

---

## 5. Performance Verification & Benchmarking Guidelines

All performance optimizations in MovieBox-TUI must be backed by empirical before-and-after measurements. Changes without quantitative verification must be classified as refactors or code cleanups, not performance improvements.

### A. Required Benchmark Measurements
When submitting or claiming a performance improvement, measure and report exact deltas:

1. **CPU & Algorithmic Hot Paths**:
   - Measure wall-clock duration using `std::time::Instant` across ≥ 1,000 iterations.
   - Run benchmarks on release builds (`cargo test --release` or isolated binary harness) to reflect production compiler optimizations.
   - Report: Baseline vs. Optimized duration in microseconds (µs) or milliseconds (ms), plus relative speedup (N×).

2. **Memory & Allocations**:
   - Count heap allocations and memory footprint deltas on hot paths (e.g., zero-copy slices vs. cloned `String` or `Vec`).
   - Report: Total allocations eliminated or reduction percentage.

3. **TUI Render Latency**:
   - Measure full frame draw cycles using headless `TestBackend`:
     ```rust
     let backend = TestBackend::new(120, 30);
     let mut terminal = Terminal::new(backend).unwrap();
     let start = std::time::Instant::now();
     for _ in 0..1_000 {
         terminal.draw(|f| app.draw(f)).unwrap();
     }
     let avg_us = start.elapsed().as_micros() as f64 / 1_000.0;
     ```
   - Report: Average draw duration per frame across standard terminal dimensions (80x24, 120x30).

4. **I/O & Syscalls**:
   - Quantify eliminated filesystem operations (e.g. cache lookups, redundant directory reads) or network roundtrips.
   - Report: Number of disk reads/writes or HTTP requests saved per action.

5. **Release Binary Footprint**:
   - Measure stripped release binary size (`target/release/moviebox-tui`).
   - Report: Baseline size, optimized size, and exact byte/kilobyte delta.

### B. Standard Performance Reporting Format
Document benchmark results in PR descriptions, commit messages, or changelog entries using this structured format:

```text
Benchmark: [Subsystem / Hot Path Name]
- Baseline:   [value] [unit] (e.g. 142.3 µs / op, 84 allocs)
- Optimized:  [value] [unit] (e.g. 12.1 µs / op, 2 allocs)
- Delta:      [multiplier]x faster (-[percentage]% allocations)
- Target:     [Architecture / OS, e.g. Apple M3 / arm64-darwin, release profile]
```

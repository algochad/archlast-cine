I need you to make implement multiple major enhancements to the movie and anime player.

## 1. On-Screen Streaming & Player Controls

### Primary Playback & Time Controls

* **Play / Pause / Replay:** Central toggle button; automatically transforms into a "Replay Episode" button upon reaching the end credits.
* **Dedicated Forward & Backward Seek Buttons:** On-screen icons for manual jumps with customizable default intervals ($5\text{s}$, $10\text{s}$, $15\text{s}$, $30\text{s}$, or $60\text{s}$).
* **Dynamic Scrubbing Bar (Timeline / Progress Bar):**
* **Timestamp Display:** Visual indicator offering toggles between $\text{Current Time} / \text{Total Duration}$ or $\text{Remaining Time}$.
* **Frame Preview / Thumbnail Seeking:** Hovering or dragging along the timeline displays precise preview thumbnails with timecodes.
* **Fine-Scrubbing Mode:** Pulling down vertically while dragging the scrubber slows down seek sensitivity ($0.5\times$ or $0.1\times$ timeline speed) for pinpoint accuracy.
* **Chapter & Marker Overlays:** Visual notches on the progress bar identifying structural segments (Intro/OP, Canon Content, Outro/ED, Post-Credits/Preview).



---

### Advanced Touch Screen Gestures

* **Double-Tap Seeking:**
* Double-tap **Left Side** $\rightarrow$ Rewind.
* Double-tap **Right Side** $\rightarrow$ Fast-Forward.
* **Multi-Tap Acceleration:** Consecutive rapid taps dynamically scale jump times (e.g., 2 taps = $10\text{s}$, 3 taps = $20\text{s}$, 4 taps = $30\text{s}$).


* **Vertical Swipe Gestures:**
* **Left Side Swipe Up/Down:** Independent display brightness adjustment.
* **Right Side Swipe Up/Down:** Independent media volume control.


* **Press-and-Hold Speed Boost:** Long-pressing anywhere on the player temporarily accelerates playback to $2\times$ (or a user-defined rate) until released.
* **Pinch-to-Zoom / Aspect Ratio Control:** Pinching outwards fills ultra-wide screens (cropping minimal top/bottom edges or removing letterboxing).

---

### Speed & Frame Precision Controls

* **Granular Speed Switcher:** Preset steps ($0.25\times$, $0.5\times$, $0.75\times$, $1.0\times$, $1.25\times$, $1.5\times$, $1.75\times$, $2.0\times$).
* **Custom Speed Slider:** Fine-grained speed tuning in increments of $0.05\times$ or $0.1\times$ (e.g., $1.15\times$).
* **Pitch Correction (Audio Pitch Lock):** Preserves natural vocal pitch when changing speeds to eliminate squeaky or deep voices.
* **Smart Speed / Silence Skip:** Automatically accelerates silent pauses or non-dialogue background segments.
* **Frame-by-Frame Stepping:** Backward/Forward step buttons ($1$ frame or $100\text{ms}$ increments) when video is paused.

---

### Audio, Volume, & Subtitle Overlays

* **Integrated Volume Controls:** On-screen volume slider, quick-mute toggle, and an optional **Volume Boost / Normalization** switch (equalizes loud action vs. quiet dialogue).
* **Audio Track Switcher:** On-screen overlay to swap audio tracks on the fly (e.g., Original Voice, Dubbed Tracks, Audio Description).
* **Quick Subtitle Toggle & Dual Subtitles:**
* One-tap subtitle toggle (ON/OFF).
* **Dual Subtitle Mode:** Simultaneous display of two subtitle streams (e.g., Learning Target Language + Native Language).


* **On-Screen Subtitle Offset & Size Adjustment:** Sliders to adjust caption size and fix out-of-sync captions ($\pm\text{ms}$ offset delay/advance).

---

### Episode Navigation & Series Controls

* **Episode Selector Drawer:** Side-panel or bottom-sheet overlay to view and switch episodes/seasons without exiting fullscreen mode.
* **Next / Previous Episode Buttons:** Direct skip icons located alongside primary playback controls.
* **Smart Skip Prompts:** Contextual, single-tap buttons for **Skip Intro / OP** and **Skip Outro / ED**.
* **Auto-Play Overlay:** End-of-video countdown card ("Next episode in 5s") with "Play Now" and "Cancel" buttons.

---

### Display, System, & Technical Overlays

* **Screen Lock / Child Lock:** Disables touch controls to prevent accidental taps while holding the device.
* **Orientation & Aspect Ratio Selector:** Toggles for Auto-Rotate, Forced Landscape, Stretch, Zoom, or Fit-to-Screen modes.
* **Video Filter & Night Mode Controls:** On-screen toggles for color presets (Anime Color Enhancer, High Contrast) and a software screen dimmer overlay for dark rooms.
* **Picture-in-Picture (PiP) & Background Audio:** One-tap minification into a floating window, or background audio mode when the device screen is off.
* **Casting Controls:** Dedicated Chromecast, AirPlay, or DLNA icons to push video to smart TVs.
* **Resolution Switcher & Stats Overlay:** Direct stream quality switcher ($360\text{p}$ to $4\text{K}$/Auto) and an optional "Stats for Nerds" overlay (real-time FPS, bitrate, codec, buffer depth, frame drops).

## 2. CC / Subtitles Controls & Support

### Track Management & Fetching Features

* **Multi-Format Parsing & Container Support:** Support for WebVTT (`.vtt`), SubRip (`.srt`), Advanced SubStation Alpha (`.ass` / `.ssa`), Timed Text Markup Language (`.ttml`), and embedded container tracks (`.mkv`/`.mp4` soft subs).
* **Provider & Scraper Integration:**
* **Auto-Extraction:** Parse soft subtitle tracks directly from HLS/DASH manifests (`.m3u8` / `.mpd`) or API responses supplied by backend scrapers and CLI engines (e.g., MovieBox-TUI endpoints).
* **Auto-Fetch via External APIs:** Query external providers (e.g., OpenSubtitles, Subscene, AnimeSkip, Jimaku) matching by hash, title, episode number, or release group.
* **Local File Side-Loading:** Drag-and-drop or file picker support to load local `.srt`, `.vtt`, or `.ass` files into active playback sessions.


* **Language Preferences & Auto-Selection:**
* **Primary & Secondary Language Defaults:** Global audio/subtitle pairings (e.g., Japanese Audio + English Subtitles for anime).
* **Forced Subtitles Handling:** Automatic activation of forced subtitle tracks for foreign dialogue or signs when audio dubs are enabled without full captions.



---

### Anime-Specific & Advanced Rendering

* **ASS / SSA Typesetting Engine:** High-performance rendering via WebAssembly (e.g., `libass` / JASSUB) to preserve complex anime typesetting—including custom embedded fonts, vector positioning, karaoke effects, rotated text, and sign overlays.
* **Dual Subtitle Mode:** Simultaneous rendering of two distinct subtitle streams (e.g., Primary/Target Language at the bottom, Secondary/Native Language at the top) for language acquisition.
* **On-Screen Signs & Song Lyrics Toggle:** Dedicated filter mode to display only background signs, logos, and opening/ending lyrics while suppressing main dialogue captions.
* **Interactive Word Lookup:** Click/hover support over subtitle text to pause playback and show dictionary definitions, romanization, or translations.

---

### On-Screen Subtitle UI & Synchronization Controls

* **Quick Subtitle Toggle & Track Switcher:** Instant ON/OFF toggle and quick-select overlay on the primary player bar.
* **Real-Time Sync Offset Adjustments ($\pm\text{ms}$):** On-screen sliders or dedicated keyboard shortcuts ($[\text{G}]$ / $[\text{H}]$) to delay or advance subtitle timing in $50\text{ms}$ to $500\text{ms}$ increments to correct desync.
* **SDH & Audio Description Filtering:** Clear badges and toggles to separate standard translations from Subtitles for the Deaf and Hard of Hearing (SDH) containing ambient sound descriptions.

---

### UI Customization & Styling Engine

* **Typography Controls:** Choice of font family (Sans-Serif, Serif, Monospace, Anime Sans), font weight, and scale settings ($50\%$ to $200\%$).
* **Color & Contrast Adjustments:**
* **Font & Stroke Colors:** Color pickers for text body, outline/stroke, and shadow depth.
* **Background Overlay & Opacity:** Toggleable solid or semi-transparent background box behind captions ($0\%$ to $100\%$ opacity).


* **Positioning & Alignment:** Vertical Y-axis adjustment slider to reposition captions and avoid overlapping hardcoded video text or player UI elements.

## 3. Streaming Engine, Chunk Prefetching & Network Optimization

### Adaptive Buffer & Chunk Prefetching Strategy

* **Dynamic Buffer Sizing (Smart Lookahead):**
* Automatically adjusts the forward buffer window based on current network throughput and playhead position (e.g., maintaining a slim $15\text{s}$ buffer on constrained mobile networks vs. an aggressive $60\text{s}$–$120\text{s}$ buffer on high-speed connections).
* **Adaptive Chunk Fetching:** Scales requested segment sizes (e.g., fetching $2\text{s}$ sub-chunks during cold startup for immediate playback, switching to $6\text{s}$–$10\text{s}$ merged chunks once playback stabilizes to reduce HTTP header overhead).


* **Smart Pre-Fetching & Next-Episode Seeding:**
* **Background Pre-Buffering:** When the current video reaches $80\%$ completion or enters the end credits, the player silently opens a background worker thread to pre-fetch the initial segment manifest and first 2–3 video chunks of the next episode.
* **Hover & Scrub Pre-Fetching:** Pre-loads low-bitrate keyframes and preview chunk manifests when hovering over the progress bar or episode list before a user actively clicks.


* **Predictive seeking & Range-Request Caching:**
* Caching already-downloaded byte ranges in local IndexedDB or persistent ServiceWorker storage to instantly eliminate re-buffering when seeking backward within a session.



---

### Adaptive Bitrate (ABR) & Network Optimization

* **Throughput-Aware Quality Switching:**
* Implements EWMA (Exponentially Weighted Moving Average) bandwidth estimation to prevent quality flickering (rapid switching between $720\text{p}$ and $1080\text{p}$) during brief network spikes.
* **Fast-Start / Zero-Latency Startup:** Forces stream playback to initialize at the lowest viable resolution ($360\text{p}$/ $480\text{p}$) for immediate frame-1 render ($<300\text{ms}$ startup time), instantly upscaling to $1080\text{p}$/ $4\text{K}$ on chunk 2 once throughput is verified.


* **Parallel Chunk Downloading & Multi-Threaded Range Requests:**
* Uses Web Workers to download non-sequential video chunks over parallel HTTP connections (HTTP/2 or HTTP/3 multiplexing) for monolithic MP4 files or unsegmented streams, merging them client-side using `SourceBuffer` append operations.


* **CDN Edge Fallback & Mirror Rotation:**
* Real-time stream health monitoring that detects slow-chunk response rates ($>1500\text{ms}$ per segment) or $403$/$504$ provider errors, automatically rotating to alternative CDN edge nodes or backend video mirrors on the fly without dropping player state.



---

### Scraper, Proxy & Transcoding Pipeline Optimizations

* **Header & Connection Keep-Alive Pooling:**
* Maintains persistent connection pools and reuses TLS handshakes between client proxy middleware and video hosts (like MovieBox/anime scrapers) to bypass cold-connection latency.


* **Edge Proxy Caching (HLS/DASH Manifest Optimizations):**
* Proxies and caches external M3U8/MPD manifests at an edge layer to rewrite segment URLs, strip tracking scripts, and resolve slow third-party DNS resolutions before delivering manifests to the client player.


* **Resource Prioritization (Fetch Priority API):**
* Assigns explicit priority tiers to network requests (`priority: "high"` for active segment $N$, `priority: "low"` for next-episode metadata, subtitles, and poster thumbnails).



---

### Low-Level Memory & Browser Thread Optimization

* **Main-Thread Offloading via Web Workers:**
* Moves segment parsing, TS-to-MP4 transmuxing (e.g., via `hls.js` or `dash.js` workers), decryption (AES-128 / DRM handling), and subtitle parsing entirely off the UI thread to guarantee 60 FPS playback and uninterrupted touch responsiveness.


* **Garbage Collection & Buffer Pruning:**
* Automatically purges played video segments behind the playhead (keeping only a rolling $15\text{s}$ reverse buffer) to prevent DOM memory leaks, browser crash errors, and RAM spikes on mobile devices during long viewing sessions.
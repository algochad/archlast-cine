package anipub

import (
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"

	"anime-scraper/curdhost"
)

// decoySegmentMarkers identify ad/decoy segments that the megap.kotocdn.site
// CDN injects into resolved HLS playlists. These segments are 1x1 PNGs (or
// 302 redirects to them) served from ByteDance ad infrastructure; mpv can
// never decode them, so playback never starts and the player sits on its idle
// "Drop files or URLs to play here." screen.
var decoySegmentMarkers = []string{
	"ibyteimg.com",
	"byteimg.com",
	"ad-site-i18n",
}

// maxPlaylistBytes bounds how much of a manifest we download during validation.
const maxPlaylistBytes = 2 << 20

// megaplayProxyHost is the first-party fallback megaplay's own client uses
// (TikTokCdnFailover proxyHost) when the direct file host 403s: it forwards
// with ?domain=<original host>, bypassing the hotlink check. Verified live:
// bb.akirax.buzz serves the same master the direct host 403s.
const megaplayProxyHost = "bb.akirax.buzz"

// rewriteDirectToProxy maps a direct megaplay file URL onto the proxy
// fallback, preserving path and adding ?domain=<original host>. Non-file
// hosts pass through unchanged.
func rewriteDirectToProxy(rawURL string) string {
	u, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || u.Scheme == "" || u.Host == "" {
		return rawURL
	}
	host := strings.ToLower(u.Host)
	if host == megaplayProxyHost || strings.HasSuffix(host, ".akirax.buzz") {
		return rawURL
	}
	q := u.Query()
	q.Set("domain", u.Host)
	u.RawQuery = q.Encode()
	u.Scheme = "https"
	u.Host = megaplayProxyHost
	return u.String()
}

// isMegaplayCDNHost reports whether the stream is hosted by the megaplay CDN,
// which is the only CDN this validation is scoped to.
func isMegaplayCDNHost(host string) bool {
	host = strings.ToLower(strings.TrimSpace(host))
	return host == "kotocdn.site" || host == "megap.kotocdn.site" || strings.HasSuffix(host, ".kotocdn.site")
}

// validateResolvedStream inspects a resolved anipub stream URL before it is
// handed to the media player. When the megaplay CDN is serving an ad-injected
// decoy playlist (or a fully decoy one), an error is returned so the caller
// can fall back to another provider instead of opening an idle mpv window.
func validateResolvedStream(rawURL string) error {
	streamURL, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || streamURL.Scheme == "" || streamURL.Host == "" {
		return fmt.Errorf("invalid anipub stream url %q", rawURL)
	}
	// Validation used to be scoped to the megaplay CDN only, but the CDN
	// rotates hosts (kotocdn.site -> nexabloom.top -> ...) and each new
	// host silently skipped validation — letting ad-injected decoy
	// playlists through to the player as infinite spinners. Validate every
	// anipub stream: real playlists are 100% .ts/.m4s, decoys reveal
	// themselves by extension on the first check.

	v := &hlsStreamValidator{
		client:   curdhost.HTTPClient(),
		referrer: megaplayBaseURL + "/",
	}

	masterBody, err := v.fetch(streamURL.String())
	if err != nil {
		return fmt.Errorf("anipub stream manifest fetch failed: %w", err)
	}
	if !strings.Contains(masterBody, "#EXTM3U") {
		return fmt.Errorf("anipub stream manifest %q is not an HLS playlist", rawURL)
	}

	mediaURLs := collectVariantPlaylists(streamURL, masterBody)
	var lastErr error
	for _, mediaURL := range mediaURLs {
		mediaBody, err := v.fetch(mediaURL)
		if err != nil {
			lastErr = fmt.Errorf("anipub stream media playlist fetch failed: %w", err)
			continue
		}

		segments := parsePlaylistSegments(mediaBody)
		if len(segments) == 0 {
			lastErr = fmt.Errorf("anipub stream %q has no media segments", rawURL)
			continue
		}

		// Extension-spoofed segments (.jpg/.html/.js/...) with MPEG-TS
		// bytes are REAL video the CDN mislabels: rewrite the playlist
		// line-by-line, dropping only segments whose magic bytes are NOT
		// video. A variant survives when at least one segment probes as
		// video; pure-ad variants (zero video segments) fall through to
		// the next variant.
		clean := make([]string, 0, len(segments))
		probedVideo := 0
		probedNonVideo := 0
		for _, segment := range segments {
			if !isDecoySegmentURI(segment) {
				clean = append(clean, segment)
				continue
			}
			data := v.fetchRange(segment, 0, 15)
			if len(data) == 0 {
				// Probe failed (network): keep the line — the player,
				// not the validator, is the final judge.
				clean = append(clean, segment)
				continue
			}
			if looksLikeDecoySegment(data) {
				probedNonVideo++
				continue
			}
			probedVideo++
			clean = append(clean, segment)
		}
		if len(clean) == 0 {
			lastErr = fmt.Errorf("anipub stream %q variant %q is an ad-injected decoy (%d video / %d non-video probed)", rawURL, mediaURL, probedVideo, probedNonVideo)
			continue
		}
		// First surviving segment may still redirect to ad content, so
		// probe its magic bytes before trusting the playlist.
		if data := v.fetchRange(clean[0], 0, 15); looksLikeDecoySegment(data) {
			lastErr = fmt.Errorf("anipub stream %q first media segment is not video content", rawURL)
			continue
		}
		return nil
	}
	if lastErr != nil {
		return lastErr
	}
	return fmt.Errorf("anipub stream %q has no playable variant", rawURL)
}

// hlsStreamValidator fetches manifests and probe bytes for a stream.
type hlsStreamValidator struct {
	client   *http.Client
	referrer string
}

func (v *hlsStreamValidator) fetch(rawURL string) (string, error) {
	if v.client == nil {
		return "", fmt.Errorf("http client not configured")
	}
	req, err := http.NewRequest(http.MethodGet, rawURL, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Referer", v.referrer)
	req.Header.Set("Accept", "application/vnd.apple.mpegurl, application/x-mpegURL, */*")

	resp, err := v.client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if !curdhost.HTTPStatusOK(resp.StatusCode) {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return "", curdhost.HTTPStatusError("megaplay hls manifest", resp.StatusCode, body)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxPlaylistBytes))
	if err != nil {
		return "", err
	}
	return string(body), nil
}

// fetchRange requests the first few bytes of a segment so its magic bytes can
// be inspected. Errors are swallowed: an unavailable probe must not reject a
// stream that mpv could still play.
func (v *hlsStreamValidator) fetchRange(rawURL string, start, end int) []byte {
	if v.client == nil {
		return nil
	}
	req, err := http.NewRequest(http.MethodGet, rawURL, nil)
	if err != nil {
		return nil
	}
	req.Header.Set("Range", fmt.Sprintf("bytes=%d-%d", start, end))
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Referer", v.referrer)

	resp, err := v.client.Do(req)
	if err != nil {
		return nil
	}
	defer resp.Body.Close()
	// Cloudflare-fronted CDNs often ignore Range and return 200 with the
	// full object: accept the bytes either way, the magic check decides.
	if resp.StatusCode != http.StatusPartialContent && !curdhost.HTTPStatusOK(resp.StatusCode) {
		return nil
	}

	buf := make([]byte, end-start+1)
	n, _ := io.ReadFull(resp.Body, buf)
	return buf[:n]
}

// collectVariantPlaylists lists every variant in a master playlist,
// highest-bandwidth first (or the master URL itself when it is already a
// media playlist). Callers try each in turn: the top variant is often an
// ad-injected decoy while a lower one serves clean video.
func collectVariantPlaylists(masterURL *url.URL, body string) []string {
	if !strings.Contains(body, "#EXT-X-STREAM-INF") {
		return []string{masterURL.String()}
	}
	type variant struct {
		bandwidth int
		uri       string
	}
	var variants []variant
	lines := strings.Split(body, "\n")
	for i := range lines {
		line := strings.TrimSpace(lines[i])
		if !strings.HasPrefix(line, "#EXT-X-STREAM-INF") {
			continue
		}
		bandwidth := parseBandwidth(line)
		for j := range len(lines)-(i+1) {
			next := strings.TrimSpace(lines[i+1+j])
			if next == "" || strings.HasPrefix(next, "#") {
				continue
			}
			variants = append(variants, variant{bandwidth: bandwidth, uri: next})
			break
		}
	}
	sort.Slice(variants, func(i, j int) bool { return variants[i].bandwidth > variants[j].bandwidth })
	var out []string
	for _, v := range variants {
		ref, err := url.Parse(v.uri)
		if err != nil {
			continue
		}
		out = append(out, masterURL.ResolveReference(ref).String())
	}
	if len(out) == 0 {
		return []string{masterURL.String()}
	}
	return out
}

// selectMediaPlaylistURL picks the highest-bandwidth variant from a master
// playlist, or returns the master URL itself when it is a media playlist.
func selectMediaPlaylistURL(masterURL *url.URL, body string) (string, error) {
	variants := collectVariantPlaylists(masterURL, body)
	if len(variants) == 0 {
		return "", fmt.Errorf("no variant playlist found in master playlist")
	}
	return variants[0], nil
}

func parseBandwidth(infLine string) int {
	upper := strings.ToUpper(infLine)
	idx := strings.Index(upper, "BANDWIDTH=")
	if idx < 0 {
		return 0
	}
	rest := upper[idx+len("BANDWIDTH="):]
	if comma := strings.IndexByte(rest, ','); comma >= 0 {
		rest = rest[:comma]
	}
	value, err := strconv.Atoi(strings.TrimSpace(rest))
	if err != nil {
		return 0
	}
	return value
}

// parsePlaylistSegments extracts media segment URIs from a playlist body.
func parsePlaylistSegments(body string) []string {
	var segments []string
	for _, raw := range strings.Split(body, "\n") {
		line := strings.TrimSpace(raw)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		segments = append(segments, line)
	}
	return segments
}

func isDecoySegmentURI(raw string) bool {
	lower := strings.ToLower(raw)
	for _, marker := range decoySegmentMarkers {
		if strings.Contains(lower, marker) {
			return true
		}
	}
	// Extension-spoofed decoys: the CDN serves ad/image content under
	// non-.ts extensions (.jpg/.html/.js/.css/.txt/.png/.webp/...). Real
	// HLS media segments are MPEG-TS (.ts), fMP4 (.m4s/.mp4/.cmfv), or
	// extensionless (opaque CDN path tokens) — the magic-byte probe below
	// is what catches image bytes hiding behind a clean name.
	if idx := strings.LastIndex(lower, "/"); idx >= 0 {
		last := lower[idx+1:]
		if q := strings.IndexAny(last, "?#"); q >= 0 {
			last = last[:q]
		}
		if !strings.Contains(last, ".") {
			return false
		}
	}
	if idx := strings.LastIndex(lower, "."); idx >= 0 {
		ext := lower[idx:]
		if q := strings.IndexAny(ext, "?#"); q >= 0 {
			ext = ext[:q]
		}
		switch ext {
		case ".ts", ".m4s", ".mp4", ".cmfv", ".cmfa", ".m4i":
			return false
		default:
			return true
		}
	}
	return false
}
// looksLikeDecoySegment reports whether probe bytes look like an image, an
// HTML error page, or other non-video content instead of an HLS media segment.
func looksLikeDecoySegment(data []byte) bool {
	// MPEG-TS sync word: real .ts segments start here 100% of the time.
	// fMP4 starts with an `ftyp` box (byte 4..8). Anything else — JPEG
	// SOI, PNG, GIF, RIFF/WEBP, HTML — is ad/decoy content, even when the
	// CDN dresses the URL in a video-looking extension.
	if len(data) == 0 {
		return false
	}
	if data[0] == 0x47 {
		return false
	}
	if len(data) >= 8 && string(data[4:8]) == "ftyp" {
		return false
	}
	return true
}

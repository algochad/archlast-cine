package anineko

import (
	"fmt"
	"strings"
)

// decoySegmentMarkers identifies ByteDance/TikTok ad infrastructure that
// anineko embeds serve as decoy playlists (HTTP 403 "domain forbidden" on
// every segment).
var decoySegmentMarkers = []string{
	"ibyteimg.com",
	"byteimg.com",
	"ad-site-i18n",
}

// isDecoySegmentURI reports whether a segment URI points at ad/decoy content.
func isDecoySegmentURI(raw string) bool {
	lowered := strings.ToLower(raw)
	for _, marker := range decoySegmentMarkers {
		if strings.Contains(lowered, marker) {
			return true
		}
	}
	return false
}

// firstMediaLine returns the first non-empty, non-directive playlist line.
func firstMediaLine(body string) string {
	for _, line := range strings.Split(strings.ReplaceAll(body, "\r\n", "\n"), "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			continue
		}
		return trimmed
	}
	return ""
}

// validateDecoyStream probes a resolved vibe-proxy master playlist before it
// is handed to the player. Some anineko embeds resolve to ad-injected decoy
// playlists whose segments live on ByteDance/TikTok ad infrastructure and
// fail with HTTP 403 {"code":1004,"error":"domain forbidden"}. Handing such
// a URL to hls.js yields "Playback unavailable / NetworkError". Returning an
// error here lets the caller fall through to the next embed/provider
// (e.g. anipub) instead.
func validateDecoyStream(proxyMasterURL, referrer string) error {
	masterBody, err := fetchString(proxyMasterURL, referrer)
	if err != nil {
		return err
	}
	variants := playlistMediaLines(masterBody)
	if len(variants) == 0 {
		return fmt.Errorf("no variants in master playlist")
	}
	playable := 0
	var lastErr error
	for _, v := range variants {
		variantURL := strings.TrimSpace(v)
		if !strings.HasPrefix(variantURL, "http://") && !strings.HasPrefix(variantURL, "https://") {
			variantURL = resolvePlaylistURL(proxyMasterURL, variantURL)
		}
		if err := validateDecoyVariant(variantURL, referrer); err != nil {
			lastErr = err
			continue
		}
		playable++
	}
	if playable == 0 {
		if lastErr != nil {
			return fmt.Errorf("unplayable stream: %v", lastErr)
		}
		return fmt.Errorf("unplayable stream: no playable variant")
	}
	return nil
}

func validateDecoyVariant(variantURL, referrer string) error {
	body, err := fetchString(variantURL, referrer)
	if err != nil {
		return err
	}
	segs := playlistMediaLines(body)
	if len(segs) == 0 {
		return fmt.Errorf("no segments in variant playlist")
	}
	segURL := strings.TrimSpace(segs[0])
	if !strings.HasPrefix(segURL, "http://") && !strings.HasPrefix(segURL, "https://") {
		segURL = resolvePlaylistURL(variantURL, segURL)
	}
	data, err := fetchBytes(segURL, referrer)
	if err != nil {
		return err
	}
	probed := stripPNGWrapper(data)
	if !looksLikeVideoSegment(probed) {
		return fmt.Errorf("first segment is not video content")
	}
	return nil
}

// playlistMediaLines returns non-empty, non-directive lines from an HLS playlist.
func playlistMediaLines(body string) []string {
	var out []string
	for _, line := range strings.Split(strings.ReplaceAll(body, "\r\n", "\n"), "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			continue
		}
		out = append(out, trimmed)
	}
	return out
}

// looksLikeVideoSegment reports whether probed segment bytes look like media.
// MPEG-TS segments start with the 0x47 sync byte; fMP4 segments start with a
// box length followed by "ftyp".
func looksLikeVideoSegment(data []byte) bool {
	if len(data) == 0 {
		return false
	}
	if data[0] == 0x47 {
		return true
	}
	return len(data) > 8 && string(data[4:8]) == "ftyp"
}

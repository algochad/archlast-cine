package anipub

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/url"
	"regexp"
	"strconv"
	"strings"

	"anime-scraper/providers"
)

var (
	// AniPub emits /video/<id>/<mode> but the details API now returns
	// /Video/<id>/<mode> (capital V): match case-insensitively.
	videoPathRE = regexp.MustCompile(`(?i)/(?:video|play)/(\d+)/(sub|dub)`)
	playPathRE  = regexp.MustCompile(`/play/(\d+)/(\d+)/(sub|dub)`)
	dataIDRE    = regexp.MustCompile(`data-id="(\d+)"`)
)

// resolveMegaplayStream resolves an anipub video link to a direct HLS URL.
// AniPub emits two link shapes: legacy https://anipub.xyz/video/<embedID>/<mode>
// and current https://anipub.xyz/play/<malID>/<epNo>/<mode> (embedID unknown
// until the play page's megaplay iframe is followed). Both are handled here.
func resolveMegaplayStream(videoLink, mode string) (string, subtitleSet, error) {
	videoLink = strings.TrimSpace(videoLink)
	if videoLink == "" {
		return "", subtitleSet{}, fmt.Errorf("empty video link")
	}

	mode = providers.NormalizeTranslationType(mode)

	streamPage, err := megaplayStreamPageURL(videoLink, mode)
	if err != nil {
		return "", subtitleSet{}, err
	}
	html, err := fetchString(streamPage, baseURL+"/")
	if err != nil {
		return "", subtitleSet{}, err
	}

	dataID := dataIDRE.FindStringSubmatch(html)
	if len(dataID) < 2 {
		return "", subtitleSet{}, fmt.Errorf("megaplay data-id not found")
	}

	// Both endpoints now return only tracks + an "enc" token: an AES-CBC
	// (key/IV from megaplay newclient.min.js) encrypted JSON blob carrying
	// {"file": "<master.m3u8>"} for browser-side WebCrypto decryption.
	// Decrypt it server-side with the standard library so resolve works
	// without a browser.
	var payload megaplaySourcesResponse
	if err := fetchJSON(megaplaySourcesURL(dataID[1], true), streamPage, &payload); err != nil {
		return "", subtitleSet{}, err
	}
	if strings.TrimSpace(payload.Sources.File) == "" && payload.Enc != "" {
		if file, err := decryptMegaplayEnc(payload.Enc); err == nil {
			payload.Sources.File = file
		}
	}
	if strings.TrimSpace(payload.Sources.File) == "" {
		var legacy megaplaySourcesResponse
		if err := fetchJSON(megaplaySourcesURL(dataID[1], false), streamPage, &legacy); err != nil {
			return "", subtitleSet{}, err
		}
		payload.Tracks = legacy.Tracks
		if payload.Sources.File == "" && legacy.Enc != "" {
			if file, err := decryptMegaplayEnc(legacy.Enc); err == nil {
				payload.Sources.File = file
			}
		}
	}

	streamURL := strings.TrimSpace(payload.Sources.File)
	if streamURL == "" {
		return "", subtitleSet{}, fmt.Errorf("megaplay stream url missing")
	}
	subs := subtitleSet{Primary: pickSubtitleTrack(payload, mode), Tracks: subtitleTracks(payload, mode)}
	return streamURL, subs, nil
}

// Megaplay "enc" token decryption: AES-256-CBC with a 32-byte zero-padded key
// and a 16-byte IV, both embedded in megaplay's newclient.min.js. The token
// is base64url; the plaintext is PKCS#7 padded JSON like {"file": "..."}.
func decryptMegaplayEnc(token string) (string, error) {
	key := make([]byte, 32)
	copy(key, "i?LMTAx0Q6,:}50U")
	iv := []byte("W0;27ToaUpl_P%'c")
	raw, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(token))
	if err != nil {
		return "", fmt.Errorf("decode enc token: %w", err)
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	if len(raw) == 0 || len(raw)%aes.BlockSize != 0 {
		return "", fmt.Errorf("bad enc length %d", len(raw))
	}
	plain := make([]byte, len(raw))
	cipher.NewCBCDecrypter(block, iv).CryptBlocks(plain, raw)
	pad := int(plain[len(plain)-1])
	if pad < 1 || pad > aes.BlockSize || pad > len(plain) {
		return "", fmt.Errorf("bad enc padding")
	}
	for _, b := range plain[len(plain)-pad:] {
		if int(b) != pad {
			return "", fmt.Errorf("bad enc padding")
		}
	}
	plain = plain[:len(plain)-pad]
	idx := bytes.IndexByte(plain, '{')
	if idx < 0 {
		return "", fmt.Errorf("enc payload has no JSON")
	}
	var out struct {
		File string `json:"file"`
	}
	if err := json.Unmarshal(plain[idx:], &out); err != nil {
		return "", err
	}
	if strings.TrimSpace(out.File) == "" {
		return "", fmt.Errorf("enc payload has no file")
	}
	return strings.TrimSpace(out.File), nil
}

// megaplayStreamPageURL maps an anipub video link to its megaplay watch page.
func megaplayStreamPageURL(videoLink, mode string) (string, error) {
	parsed, err := url.Parse(videoLink)
	if err != nil {
		return "", fmt.Errorf("parse video link: %w", err)
	}
	if strings.Contains(parsed.Host, "megaplay.buzz") {
		return videoLink, nil
	}
	if matches := videoPathRE.FindStringSubmatch(parsed.Path); len(matches) == 3 {
		embedID, linkMode := matches[1], matches[2]
		if _, err := strconv.Atoi(embedID); err != nil {
			return "", fmt.Errorf("invalid embed id %q", embedID)
		}
		if mode == "dub" {
			linkMode = "dub"
		} else {
			linkMode = "sub"
		}
		return fmt.Sprintf("%s/stream/s-2/%s/%s", megaplayBaseURL, embedID, linkMode), nil
	}
	if matches := playPathRE.FindStringSubmatch(parsed.Path); len(matches) == 4 {
		malID, epNo := matches[1], matches[2]
		linkMode := matches[3]
		if mode == "dub" {
			linkMode = "dub"
		} else {
			linkMode = "sub"
		}
		return fmt.Sprintf("%s/stream/mal/%s/%s/%s", megaplayBaseURL, malID, epNo, linkMode), nil
	}
	return "", fmt.Errorf("unsupported video link %q", videoLink)
}

func megaplaySourcesURL(dataID string, useNewEndpoint bool) string {
	if useNewEndpoint {
		return fmt.Sprintf("%s/stream/getSourcesNew?id=%s", megaplayBaseURL, dataID)
	}
	return fmt.Sprintf("%s/stream/getSources?id=%s", megaplayBaseURL, dataID)
}

func parseVideoLink(videoLink string) (embedID, mode string, err error) {
	parsed, err := url.Parse(videoLink)
	if err != nil {
		return "", "", fmt.Errorf("parse video link: %w", err)
	}
	matches := videoPathRE.FindStringSubmatch(parsed.Path)
	if len(matches) < 3 {
		return "", "", fmt.Errorf("unsupported video link %q", videoLink)
	}
	embedID = matches[1]
	mode = matches[2]
	if _, err := strconv.Atoi(embedID); err != nil {
		return "", "", fmt.Errorf("invalid embed id %q", embedID)
	}
	return embedID, mode, nil
}

func pickSubtitleTrack(payload megaplaySourcesResponse, mode string) string {
	if mode == "dub" {
		return ""
	}
	var fallback string
	for _, track := range payload.Tracks {
		file := strings.TrimSpace(track.File)
		if file == "" || !strings.EqualFold(strings.TrimSpace(track.Kind), "captions") {
			continue
		}
		label := strings.ToLower(strings.TrimSpace(track.Label))
		if track.Default || strings.Contains(label, "english") {
			return file
		}
		if fallback == "" {
			fallback = file
		}
	}
	return fallback
}

// subtitleSet is a megaplay stream's soft-sub offering: the preferred
// English file plus every track in every language.
type subtitleSet struct {
	Primary string
	Tracks  []providers.SubtitleTrack
}

// subtitleLangCodes maps megaplay's English language labels to ISO 639-1.
var subtitleLangCodes = map[string]string{
	"arabic": "ar", "chinese": "zh", "czech": "cs", "danish": "da", "dutch": "nl",
	"english": "en", "finnish": "fi", "french": "fr", "german": "de", "greek": "el",
	"hebrew": "he", "hindi": "hi", "hungarian": "hu", "indonesian": "id", "italian": "it",
	"japanese": "ja", "korean": "ko", "malay": "ms", "norwegian": "no", "polish": "pl",
	"portuguese": "pt", "romanian": "ro", "russian": "ru", "spanish": "es", "swedish": "sv",
	"thai": "th", "turkish": "tr", "ukrainian": "uk", "vietnamese": "vi",
}

// subtitleTracks lists every captions track megaplay offers, any language.
// Dub streams get none: English dub + auto-selected English subs double up.
func subtitleTracks(payload megaplaySourcesResponse, mode string) []providers.SubtitleTrack {
	if mode == "dub" {
		return nil
	}
	var tracks []providers.SubtitleTrack
	for _, track := range payload.Tracks {
		file := strings.TrimSpace(track.File)
		if file == "" || !strings.EqualFold(strings.TrimSpace(track.Kind), "captions") {
			continue
		}
		label := strings.TrimSpace(track.Label)
		lang := subtitleLangCodes[strings.ToLower(label)]
		if lang == "" {
			lang = subtitleLangCodes[strings.ToLower(strings.SplitN(label, " ", 2)[0])]
		}
		format := ""
		if i := strings.LastIndexByte(strings.SplitN(file, "?", 2)[0], '.'); i >= 0 {
			format = strings.ToLower(strings.SplitN(file, "?", 2)[0][i+1:])
		}
		tracks = append(tracks, providers.SubtitleTrack{URL: file, Label: label, Language: lang, Format: format})
	}
	return tracks
}

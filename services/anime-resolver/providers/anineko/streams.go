package anineko

import (
	"fmt"
	"strings"

	"anime-scraper/providers"
)

func getEpisodeStreamsForMode(slug string, config providers.PlaybackConfig, epNo int) ([]string, map[string]providers.StreamPlaybackHint, error) {
	slug = strings.TrimSpace(slug)
	if slug == "" {
		return nil, nil, fmt.Errorf("empty show id")
	}
	if epNo <= 0 {
		return nil, nil, fmt.Errorf("invalid episode number %d", epNo)
	}

	mode := providers.NormalizeTranslationType(config.SubOrDub)
	html, err := fetchString(watchURL(slug, epNo), baseURL+"/")
	if err != nil {
		return nil, nil, err
	}

	groups := extractLangEmbedURLs(html)
	embedURLs, err := embedURLsForMode(groups, mode, config.SubStyle)
	if err != nil {
		return nil, nil, err
	}
	if len(embedURLs) == 0 {
		return nil, nil, fmt.Errorf("no %s streams found for episode %d", mode, epNo)
	}

	for _, embedURL := range embedURLs {
		var (
			stream resolvedStream
			err    error
		)
		switch resolveEmbedHost(embedURL) {
		case "bibiemb":
			stream, err = resolveBibiemb(embedURL)
		case "vibeplayer":
			stream, err = resolveVibeplayer(embedURL)
		default:
			continue
		}
		if err != nil {
			continue
		}
		// Reject ad-injected decoy streams (ByteDance/TikTok CDN segments that
		// 403 with "domain forbidden") so the caller falls through to the
		// next embed/provider instead of returning an unplayable URL.
		if err := validateDecoyStream(stream.URL, stream.Referrer); err != nil {
			continue
		}
		return singleStreamResult(stream)
	}

	return nil, nil, fmt.Errorf("no playable streams resolved for episode %d", epNo)
}

func singleStreamResult(stream resolvedStream) ([]string, map[string]providers.StreamPlaybackHint, error) {
	if strings.TrimSpace(stream.URL) == "" {
		return nil, nil, fmt.Errorf("empty stream url")
	}
	hints := map[string]providers.StreamPlaybackHint{
		stream.URL: {
			Referrer: stream.Referrer,
			Subtitle: stream.Subtitle,
		},
	}
	return []string{stream.URL}, hints, nil
}

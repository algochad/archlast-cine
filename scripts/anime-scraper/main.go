package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"

	"anime-scraper/providers"
	_ "anime-scraper/providers/allanime"
	_ "anime-scraper/providers/animepahe"
	_ "anime-scraper/providers/anineko"
	_ "anime-scraper/providers/anipub"
	_ "anime-scraper/providers/senshi"
)

type StreamRequest struct {
	ShowID   string `json:"showId"`
	Query    string `json:"query,omitempty"`
	Episode  int    `json:"episode"`
	Mode     string `json:"mode"`     // "sub" or "dub"
	Provider string `json:"provider"` // optional: specific provider name
}

type StreamResponse struct {
	Streams []StreamInfo `json:"streams"`
	Error   string       `json:"error,omitempty"`
	// Detail carries per-provider failure causes for server logs only.
	// Web clients must render `error` and never render `detail`.
	Detail string `json:"detail,omitempty"`
}

type StreamInfo struct {
	URL      string `json:"url"`
	Quality  string `json:"quality"`
	Provider string `json:"provider"`
	Referrer string `json:"referrer,omitempty"`
}

type SearchRequest struct {
	Query string `json:"query"`
	Mode  string `json:"mode"`
}

type SearchResponse struct {
	Results []SearchResult `json:"results"`
	Error   string         `json:"error,omitempty"`
}

type SearchResult struct {
	Key       string `json:"key"`
	Label     string `json:"label"`
	Title     string `json:"title"`
	Thumbnail string `json:"thumbnail"`
	Provider  string `json:"provider"`
}

func getProviders() []providers.Provider {
	names := providers.RegisteredNames()
	// Prefer providers that resolve fast and serve playable streams:
	// anipub first (direct megaplay URLs), then allanime, then the rest.
	// anineko goes last — its embeds usually resolve to ad-injected decoy
	// playlists that burn ~35s in validation before failing.
	preferred := []string{"anipub", "allanime", "animepahe", "senshi", "anineko"}
	ordered := make([]string, 0, len(names))
	seen := map[string]bool{}
	for _, name := range preferred {
		for _, n := range names {
			if n == name && !seen[n] {
				ordered = append(ordered, n)
				seen[n] = true
			}
		}
	}
	for _, n := range names {
		if !seen[n] {
			ordered = append(ordered, n)
		}
	}
	var result []providers.Provider
	for _, name := range ordered {
		if p, err := providers.New(name); err == nil {
			result = append(result, p)
		}
	}
	return result
}

// looksLikeAllAnimeID reports whether showID has the shape of an AllAnime
// show id (long mixed-case alphanumeric token, e.g. "srGrP23qJnjsHrRYD").
// Only AllAnime (and AnimePahe session strings) accept such IDs; Senshi
// wants a numeric MAL id, AniPub a numeric show id, AniNeko a slug.
func looksLikeAllAnimeID(showID string) bool {
	if len(showID) < 10 || len(showID) > 32 {
		return false
	}
	hasLower, hasUpper := false, false
	for _, r := range showID {
		switch {
		case r >= 'a' && r <= 'z':
			hasLower = true
		case r >= 'A' && r <= 'Z':
			hasUpper = true
		case r >= '0' && r <= '9':
		default:
			return false
		}
	}
	return hasLower || hasUpper
}

func isNumericID(showID string) bool {
	if showID == "" {
		return false
	}
	for _, r := range showID {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

// providerAcceptsID skips providers whose ID format provably cannot match,
// so logs explain the skip instead of surfacing confusing downstream errors.
func providerAcceptsID(provider, showID string) (bool, string) {
	switch provider {
	case "senshi", "anipub":
		if !isNumericID(showID) {
			return false, "expects numeric id (MAL id / anipub show id)"
		}
	case "anineko":
		if isNumericID(showID) || looksLikeAllAnimeID(showID) {
			return false, "expects anineko slug (e.g. from /search provider=anineko)"
		}
	case "animepahe":
		// AnimePahe ids are "<releaseID>:<session>", a bare release id, or a
		// session token; an AllAnime-style long token without ":" is not one.
		if looksLikeAllAnimeID(showID) && len(showID) > 10 && !containsColon(showID) && !isNumericID(showID) {
			return false, "expects animepahe id, not AllAnime id (search provider=animepahe first)"
		}
	}
	return true, ""
}

func containsColon(s string) bool {
	for _, r := range s {
		if r == ':' {
			return true
		}
	}
	return false
}

func handleResolve(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req StreamRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		json.NewEncoder(w).Encode(StreamResponse{Error: "Invalid request body"})
		return
	}

	if req.Episode == 0 || (req.ShowID == "" && strings.TrimSpace(req.Query) == "") {
		json.NewEncoder(w).Encode(StreamResponse{Error: "Missing showId or episode"})
		return
	}

	if req.Mode == "" {
		req.Mode = "sub"
	}

	config := providers.PlaybackConfig{
		SubOrDub: req.Mode,
		SubStyle: "soft",
	}

	allProviders := getProviders()
	var streams []StreamInfo
	var failures []string

	// resolveViaProvider tries GetEpisodeURL on one provider and appends hits.
	tryProvider := func(p providers.Provider, showID string) bool {
		if req.Provider != "" && p.Name() != req.Provider {
			return false
		}

		if ok, reason := providerAcceptsID(p.Name(), showID); !ok {
			msg := p.Name() + ": skipped: " + reason
			log.Printf("[Resolve] Provider %s skipped for show %s: %s", p.Name(), showID, reason)
			failures = append(failures, msg)
			return false
		}

		log.Printf("[Resolve] Trying provider %s for show %s ep %d", p.Name(), showID, req.Episode)

		var urls []string
		hints := map[string]providers.StreamPlaybackHint{}
		if hr, ok := p.(providers.HintResolver); ok {
			u, h, herr := hr.GetEpisodeURLForModeWithHints(config, showID, req.Episode, config.SubOrDub)
			if herr != nil {
				log.Printf("[Resolve] Provider %s failed: %v", p.Name(), herr)
				failures = append(failures, p.Name()+": "+herr.Error())
				return false
			}
			urls, hints = u, h
		} else {
			u, err := p.GetEpisodeURL(config, showID, req.Episode)
			if err != nil {
				log.Printf("[Resolve] Provider %s failed: %v", p.Name(), err)
				failures = append(failures, p.Name()+": "+err.Error())
				return false
			}
			urls = u
		}

		for i, url := range urls {
			referrer := ""
			if h, ok := hints[url]; ok {
				referrer = h.Referrer
			}
			if referrer == "" {
				if meta, ok := providers.MetaFor(p.Name()); ok && meta.Referrer != "" {
					referrer = meta.Referrer
				}
			}
			streams = append(streams, StreamInfo{
				URL:      url,
				Quality:  fmt.Sprintf("auto-%d", i),
				Provider: p.Name(),
				Referrer: referrer,
			})
		}
		return len(urls) > 0
	}

	// Try direct showId first, unless the request only carries a query.
	if req.ShowID != "" {
		// Try specific provider if requested, otherwise try all in order
		for _, p := range allProviders {
			if tryProvider(p, req.ShowID) {
				break // Use first provider that returns results
			}
			if len(streams) > 0 {
				break
			}
		}
	}

	// Query fallback: search providers by title and resolve the first hit.
	// Covers callers that only have a title (e.g. AllAnime id -> title mapping
	// on the Rust side) or whose raw showId produced no streams.
	if len(streams) == 0 && strings.TrimSpace(req.Query) != "" {
		query := strings.TrimSpace(req.Query)
		log.Printf("[Resolve] Falling back to search for query %q ep %d", query, req.Episode)
		for _, p := range allProviders {
			if req.Provider != "" && p.Name() != req.Provider {
				continue
			}
			options, err := p.SearchAnime(query, req.Mode)
			if err != nil {
				log.Printf("[Resolve] Search via %s failed: %v", p.Name(), err)
				failures = append(failures, p.Name()+" search: "+err.Error())
				continue
			}
			if len(options) == 0 {
				continue
			}
			best := options[0]
			log.Printf("[Resolve] Search via %s matched %q (%s), resolving ep %d", p.Name(), best.Title, best.Key, req.Episode)
			if tryProvider(p, best.Key) {
				break
			}
			if len(streams) > 0 {
				break
			}
		}
	}

	if len(streams) == 0 {
		// The `error` field is rendered by web clients, so it stays generic;
		// the per-provider `detail` is for server logs and stays unrendered.
		resp := StreamResponse{Error: "This title isn't available right now. Try again or pick another source."}
		if len(failures) > 0 {
			resp.Detail = strings.Join(failures, " | ")
		}
		json.NewEncoder(w).Encode(resp)
		return
	}

	json.NewEncoder(w).Encode(StreamResponse{Streams: streams})
}

func handleSearch(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req SearchRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		json.NewEncoder(w).Encode(SearchResponse{Error: "Invalid request body"})
		return
	}

	if req.Query == "" {
		json.NewEncoder(w).Encode(SearchResponse{Error: "Missing query"})
		return
	}

	if req.Mode == "" {
		req.Mode = "sub"
	}

	allProviders := getProviders()
	var results []SearchResult

	for _, p := range allProviders {
		log.Printf("[Search] Trying provider %s for query %q", p.Name(), req.Query)

		options, err := p.SearchAnime(req.Query, req.Mode)
		if err != nil {
			log.Printf("[Search] Provider %s failed: %v", p.Name(), err)
			continue
		}

		for _, opt := range options {
			results = append(results, SearchResult{
				Key:       opt.Key,
				Label:     opt.Label,
				Title:     opt.Title,
				Thumbnail: opt.Thumbnail,
				Provider:  p.Name(),
			})
		}
	}

	json.NewEncoder(w).Encode(SearchResponse{Results: results})
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":    "ok",
		"providers": len(getProviders()),
	})
}

// corsMiddleware adds Access-Control-Allow-Origin headers to all responses
// and handles OPTIONS preflight requests. Required for hls.js to fetch
// stream segments directly from the sidecar when the master playlist
// contains absolute URLs.
func corsMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusOK)
			return
		}
		next(w, r)
	}
}

func main() {
	port := os.Getenv("SCRAPER_PORT")
	if port == "" {
		port = "9798"
	}
	host := os.Getenv("SCRAPER_HOST")
	if host == "" {
		host = "127.0.0.1"
	}

	http.HandleFunc("/resolve", corsMiddleware(handleResolve))
	http.HandleFunc("/search", corsMiddleware(handleSearch))
	http.HandleFunc("/health", corsMiddleware(handleHealth))

	addr := host + ":" + port
	log.Printf("Anime scraper sidecar (curd providers) listening on http://%s", addr)
	log.Printf("Available providers: %d", len(getProviders()))

	if err := http.ListenAndServe(addr, nil); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}

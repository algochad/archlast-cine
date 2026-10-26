package curdhost

import (
	"fmt"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"os"
	"path/filepath"
	"time"
)

var httpClient = func() *http.Client {
	jar, _ := cookiejar.New(nil)
	return &http.Client{
		Transport: &http.Transport{
			MaxIdleConns:        10,
			MaxIdleConnsPerHost: 5,
			IdleConnTimeout:     30 * time.Second,
		},
		Timeout: 15 * time.Second,
		Jar:     jar,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 10 {
				return fmt.Errorf("stopped after 10 redirects")
			}
			return nil
		},
	}
}()

func HTTPClient() *http.Client { return httpClient }

func HTTPStatusOK(code int) bool { return code >= 200 && code < 300 }

func HTTPStatusError(context string, code int, body []byte) error {
	return fmt.Errorf("%s: HTTP %d: %s", context, code, string(body[:min(len(body), 200)]))
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func Log(msg string) {
	fmt.Fprintf(os.Stderr, "[curd] %s\n", msg)
}

func Out(format string, args ...interface{}) {
	fmt.Printf(format, args...)
}

var StoragePath = func() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".local", "share", "curd")
}

var AnimeNameLanguage = func() string { return "english" }

var CurrentSubStyle = func() string { return "soft" }

var PersistSubStylePreference = func(style string) string { return style }

var SetCookiesForAnimepahe = func(u *url.URL, cookies []*http.Cookie) {}

type PromptOption struct {
	Key   string
	Label string
	Value string
}

type PromptResult struct {
	Key   string
	Value string
}

var PromptSelect = func(options []PromptOption) (PromptResult, error) {
	if len(options) > 0 {
		return PromptResult{Key: options[0].Key, Value: options[0].Value}, nil
	}
	return PromptResult{}, fmt.Errorf("no options")
}

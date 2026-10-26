package anineko

import "anime-scraper/providers"

func init() {
	providers.Register(providers.Meta{
		Name:     "anineko",
		Aliases:  []string{"ani-neko", "ani neko"},
		Referrer: "https://anineko.to/",
	}, func() providers.Provider {
		return &Provider{}
	})
}

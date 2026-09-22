package anipub

import "anime-scraper/providers"

func init() {
	providers.Register(providers.Meta{
		Name:     "anipub",
		Aliases:  []string{"anipub.xyz"},
		Referrer: "https://megaplay.buzz/",
	}, func() providers.Provider {
		return &Provider{}
	})
}

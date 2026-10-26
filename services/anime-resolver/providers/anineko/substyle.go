package anineko

import (
	"strings"

	"anime-scraper/providers/substyle"
)

func chooseSubStyle(groups map[string][]string, preference string) (string, error) {
	hasSoft := len(groups["sub"]) > 0
	hasHard := len(groups["hsub"]) > 0
	return substyle.Choose(hasSoft, hasHard, preference)
}

func embedURLsForSubStyle(groups map[string][]string, style string) []string {
	switch style {
	case "soft":
		return append([]string{}, groups["sub"]...)
	case "hard":
		return append([]string{}, groups["hsub"]...)
	default:
		return nil
	}
}

func embedURLsForMode(groups map[string][]string, mode, subStyle string) ([]string, error) {
	if strings.EqualFold(mode, "dub") {
		return groups["dub"], nil
	}

	chosen, err := chooseSubStyle(groups, subStyle)
	if err != nil {
		return nil, err
	}
	return embedURLsForSubStyle(groups, chosen), nil
}

func resetSubStyleForTest() {
	substyle.ResetForTest()
}

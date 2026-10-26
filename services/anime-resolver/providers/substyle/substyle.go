package substyle

import (
	"fmt"
	"strings"
	"sync"

	"anime-scraper/curdhost"
)

var (
	choiceMu sync.Mutex
	chosen   string
)

func Normalize(style string) string {
	switch strings.ToLower(strings.TrimSpace(style)) {
	case "soft":
		return "soft"
	case "hard":
		return "hard"
	default:
		return "ask"
	}
}

func resolvePreference(fallback string) string {
	if curdhost.CurrentSubStyle != nil {
		if live := Normalize(curdhost.CurrentSubStyle()); live != "ask" {
			return live
		}
	}

	choiceMu.Lock()
	defer choiceMu.Unlock()
	if chosen != "" {
		return chosen
	}
	return Normalize(fallback)
}

func rememberChoice(style string) {
	style = Normalize(style)
	if style != "soft" && style != "hard" {
		return
	}

	choiceMu.Lock()
	chosen = style
	choiceMu.Unlock()

	if curdhost.PersistSubStylePreference != nil {
		_ = curdhost.PersistSubStylePreference(style)
	}
}

// Choose picks soft or hard subtitle delivery for sub-mode playback.
func Choose(hasSoft, hasHard bool, preference string) (string, error) {
	preference = resolvePreference(preference)

	switch preference {
	case "soft":
		if hasSoft {
			return "soft", nil
		}
		if hasHard {
			return "hard", nil
		}
	case "hard":
		if hasHard {
			return "hard", nil
		}
		if hasSoft {
			return promptSoftFallback()
		}
	case "ask":
		if hasSoft && hasHard {
			return promptBoth()
		}
		if hasSoft {
			if curdhost.Out != nil {
				curdhost.Out("Using soft subs with external subtitles.")
			}
			rememberChoice("soft")
			return "soft", nil
		}
		if hasHard {
			return "hard", nil
		}
	}

	return "", fmt.Errorf("no sub streams found")
}

func promptBoth() (string, error) {
	if curdhost.PromptSelect == nil {
		rememberChoice("soft")
		return "soft", nil
	}
	if curdhost.Out != nil {
		curdhost.Out("Both soft-sub and hard-sub streams are available.")
	}
	selected, err := curdhost.PromptSelect([]curdhost.PromptOption{
		{Key: "soft", Label: "Soft sub (external subtitles)"},
		{Key: "hard", Label: "Hard sub (burned-in subtitles)"},
	})
	if err != nil {
		return "", err
	}
	chosenStyle := "soft"
	if selected.Key == "hard" {
		chosenStyle = "hard"
	}
	rememberChoice(chosenStyle)
	return chosenStyle, nil
}

func promptSoftFallback() (string, error) {
	if curdhost.PromptSelect == nil {
		rememberChoice("soft")
		return "soft", nil
	}
	if curdhost.Out != nil {
		curdhost.Out("Only soft subs with external subtitles are available.")
	}
	selected, err := curdhost.PromptSelect([]curdhost.PromptOption{
		{Key: "soft", Label: "Use soft subs (external subtitles)"},
		{Key: "cancel", Label: "Cancel"},
	})
	if err != nil {
		return "", err
	}
	if selected.Key != "soft" {
		return "", fmt.Errorf("no hard-sub streams found")
	}
	rememberChoice("soft")
	return "soft", nil
}

// HardOnly reports whether playback should restrict to burned-in subtitles.
func HardOnly(preference string) bool {
	return resolvePreference(preference) == "hard"
}

// SoftOnly reports whether playback should restrict to external subtitles.
func SoftOnly(preference string) bool {
	return resolvePreference(preference) == "soft"
}

// ResetForTest clears the in-session subtitle style choice.
func ResetForTest() {
	choiceMu.Lock()
	chosen = ""
	choiceMu.Unlock()
}

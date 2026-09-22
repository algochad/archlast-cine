use ratatui::{
    Frame,
    layout::Rect,
    widgets::{Scrollbar, ScrollbarOrientation, ScrollbarState},
};

use crate::tui::theme::Theme;

pub fn render_scrollbar(
    frame: &mut Frame,
    area: Rect,
    content_length: usize,
    viewport_length: usize,
    position: usize,
    theme: &Theme,
    basic_terminal: bool,
) {
    if content_length <= viewport_length || viewport_length == 0 {
        return;
    }

    let mut scrollbar_state = ScrollbarState::default()
        .content_length(content_length)
        .viewport_content_length(viewport_length)
        .position(position);

    let scrollbar = Scrollbar::default()
        .orientation(ScrollbarOrientation::VerticalRight)
        .thumb_style(theme.lavender)
        .track_style(theme.surface1)
        .begin_symbol(if basic_terminal {
            Some("^")
        } else {
            Some("▲")
        })
        .end_symbol(if basic_terminal {
            Some("v")
        } else {
            Some("▼")
        })
        .track_symbol(if basic_terminal {
            Some("|")
        } else {
            Some("│")
        })
        .thumb_symbol(if basic_terminal { "|" } else { "█" });

    frame.render_stateful_widget(scrollbar, area, &mut scrollbar_state);
}

#[cfg(test)]
mod tests {
    use super::*;
    use ratatui::{Terminal, backend::TestBackend};

    #[test]
    fn test_render_scrollbar_hidden_when_content_fits() {
        let backend = TestBackend::new(80, 10);
        let mut terminal = Terminal::new(backend).unwrap();
        let theme = Theme::default();

        terminal
            .draw(|f| {
                render_scrollbar(f, Rect::new(0, 0, 80, 10), 5, 10, 0, &theme, false);
            })
            .unwrap();
    }

    #[test]
    fn test_render_scrollbar_visible_when_overflowing() {
        let backend = TestBackend::new(80, 10);
        let mut terminal = Terminal::new(backend).unwrap();
        let theme = Theme::default();

        terminal
            .draw(|f| {
                render_scrollbar(f, Rect::new(0, 0, 80, 10), 50, 10, 12, &theme, false);
            })
            .unwrap();
    }

    #[test]
    fn test_render_scrollbar_basic_terminal() {
        let backend = TestBackend::new(80, 10);
        let mut terminal = Terminal::new(backend).unwrap();
        let theme = Theme::default();

        terminal
            .draw(|f| {
                render_scrollbar(f, Rect::new(0, 0, 80, 10), 50, 10, 12, &theme, true);
            })
            .unwrap();
    }
}

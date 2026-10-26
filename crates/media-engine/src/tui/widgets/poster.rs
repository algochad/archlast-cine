use ratatui::{
    Frame,
    layout::{Alignment, Rect},
    widgets::{Block, Borders, Paragraph},
};

use crate::tui::theme::Theme;

pub fn render_poster_placeholder(
    frame: &mut Frame,
    area: Rect,
    theme: &Theme,
    basic_terminal: bool,
    is_in_flight: bool,
    tick: u64,
) {
    if area.width < 2 || area.height < 2 {
        return;
    }
    let border_type = crate::tui::overlay::border_type(basic_terminal);
    let border_style = if is_in_flight {
        theme.lavender
    } else {
        theme.surface1
    };
    let block = Block::default()
        .borders(Borders::ALL)
        .border_type(border_type)
        .border_style(border_style);
    let inner = block.inner(area);
    frame.render_widget(block, area);

    if inner.height == 0 || inner.width == 0 {
        return;
    }

    let pad_top = inner.height.saturating_sub(1) / 2;
    let text_area = Rect {
        x: inner.x,
        y: inner.y + pad_top,
        width: inner.width,
        height: 1.min(inner.height),
    };

    if is_in_flight {
        let dots = match (tick / 4) % 4 {
            0 => "·",
            1 => "··",
            2 => "···",
            _ => "····",
        };
        let p = Paragraph::new(dots)
            .style(theme.lavender)
            .alignment(Alignment::Center);
        frame.render_widget(p, text_area);
    } else {
        let label = if inner.width >= 8 {
            if basic_terminal { "[No Art]" } else { "No Art" }
        } else if inner.width >= 6 {
            "No Art"
        } else {
            "·"
        };
        let p = Paragraph::new(label)
            .style(theme.overlay0)
            .alignment(Alignment::Center);
        frame.render_widget(p, text_area);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ratatui::{Terminal, backend::TestBackend};

    #[test]
    fn test_render_poster_placeholder_dimensions() {
        let backend = TestBackend::new(20, 10);
        let mut terminal = Terminal::new(backend).unwrap();
        let theme = Theme::default();

        terminal
            .draw(|f| {
                render_poster_placeholder(f, Rect::new(0, 0, 1, 1), &theme, false, false, 0);
            })
            .unwrap();

        terminal
            .draw(|f| {
                render_poster_placeholder(f, Rect::new(0, 0, 15, 8), &theme, false, true, 4);
                render_poster_placeholder(f, Rect::new(0, 0, 15, 8), &theme, true, false, 0);
            })
            .unwrap();
    }
}

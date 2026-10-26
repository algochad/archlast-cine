use ratatui::{
    Frame,
    layout::Rect,
    style::Modifier,
    text::{Line, Span},
    widgets::{Paragraph, Wrap},
};

use crate::tui::{text::TextInputBuffer, theme::Theme};

pub fn render_single_line_input(
    frame: &mut Frame,
    area: Rect,
    label: &str,
    buffer: &TextInputBuffer,
    theme: &Theme,
    basic_terminal: bool,
) {
    let segments = buffer.graphemes();
    let cursor = buffer.cursor();
    let prompt_symbol = if basic_terminal { " > " } else { " ❯ " };
    let prompt_width = crate::tui::text::width(prompt_symbol);
    let available_width = (area.width as usize)
        .saturating_sub(prompt_width + 1)
        .max(1);

    let cursor_grapheme = if cursor < segments.len() {
        segments[cursor]
    } else {
        " "
    };
    let cursor_w = crate::tui::text::width(cursor_grapheme).max(1);

    let max_before_w = available_width.saturating_sub(cursor_w);
    let mut start = cursor;
    let mut current_before_w = 0;
    while start > 0 {
        let prev_gw = crate::tui::text::width(segments[start - 1]);
        if current_before_w + prev_gw > max_before_w {
            break;
        }
        current_before_w += prev_gw;
        start -= 1;
    }

    let mut before_cursor: String = segments[start..cursor].concat();
    if start > 0 {
        let before_w = crate::tui::text::width(&before_cursor);
        if before_w > 3 {
            before_cursor = format!(
                "...{}",
                crate::tui::text::truncate_width(&before_cursor, before_w.saturating_sub(3))
            );
        }
    }

    let cursor_char = cursor_grapheme.to_string();

    let remaining_after_w = available_width.saturating_sub(current_before_w + cursor_w);
    let mut end = cursor.saturating_add(1).min(segments.len());
    let mut current_after_w = 0;
    while end < segments.len() {
        let next_gw = crate::tui::text::width(segments[end]);
        if current_after_w + next_gw > remaining_after_w {
            break;
        }
        current_after_w += next_gw;
        end += 1;
    }

    let after_slice = &segments[cursor.saturating_add(1).min(segments.len())..end];
    let mut after_cursor: String = after_slice.concat();
    if end < segments.len() {
        let after_w = crate::tui::text::width(&after_cursor);
        if after_w > 3 {
            let keep = crate::tui::text::truncate_width(&after_cursor, after_w.saturating_sub(3));
            after_cursor = format!("{keep}...");
        } else if !after_cursor.is_empty() {
            after_cursor = "...".to_string();
        }
    }
    let lines = vec![
        Line::from(vec![Span::raw(" "), Span::styled(label, theme.sapphire)]),
        Line::from(vec![
            Span::styled(prompt_symbol, theme.sapphire),
            Span::styled(before_cursor, theme.text),
            Span::styled(cursor_char, theme.text.add_modifier(Modifier::REVERSED)),
            Span::styled(after_cursor, theme.text),
        ]),
    ];

    frame.render_widget(Paragraph::new(lines).wrap(Wrap { trim: false }), area);
}

#[cfg(test)]
mod tests {
    use super::*;
    use ratatui::{Terminal, backend::TestBackend};

    #[test]
    fn test_render_single_line_input_empty() {
        let backend = TestBackend::new(80, 10);
        let mut terminal = Terminal::new(backend).unwrap();
        let buffer = TextInputBuffer::new();
        let theme = Theme::default();

        terminal
            .draw(|f| {
                render_single_line_input(
                    f,
                    Rect::new(0, 0, 80, 3),
                    "Enter URL:",
                    &buffer,
                    &theme,
                    false,
                );
            })
            .unwrap();
    }

    #[test]
    fn test_render_single_line_input_with_content() {
        let backend = TestBackend::new(40, 5);
        let mut terminal = Terminal::new(backend).unwrap();
        let mut buffer = TextInputBuffer::from_str("https://example.com/playlist.m3u8");
        buffer.move_home();
        let theme = Theme::default();

        terminal
            .draw(|f| {
                render_single_line_input(
                    f,
                    Rect::new(0, 0, 40, 3),
                    "Enter URL:",
                    &buffer,
                    &theme,
                    true,
                );
            })
            .unwrap();
    }
    #[test]
    fn test_render_single_line_input_cjk_no_wrap() {
        let backend = TestBackend::new(30, 5);
        let mut terminal = Terminal::new(backend).unwrap();
        let buffer = TextInputBuffer::from_str("https://example.com/电影/电视/动漫/超高清.m3u8");
        let theme = Theme::default();

        terminal
            .draw(|f| {
                render_single_line_input(
                    f,
                    Rect::new(0, 0, 30, 3),
                    "Enter URL:",
                    &buffer,
                    &theme,
                    false,
                );
            })
            .unwrap();
    }
}

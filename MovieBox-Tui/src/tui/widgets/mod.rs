pub mod badge;
pub mod input;
pub mod modal;
pub mod poster;
pub mod scrollbar;
pub mod settings;

pub use badge::{
    MediaTags, extract_media_tags, render_media_tag_spans, resolution_badge_spans, resolution_label,
};
pub use input::render_single_line_input;
pub use modal::{ModalFrame, render_modal_footer};
pub use poster::render_poster_placeholder;
pub use scrollbar::render_scrollbar;

const SPINNER_FRAMES: [&str; 10] = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

pub fn loading_spinner(tick_count: u64, basic_terminal: bool) -> &'static str {
    if basic_terminal {
        match (tick_count / 4) % 4 {
            0 => "..",
            1 => "...",
            2 => "....",
            _ => "..",
        }
    } else {
        SPINNER_FRAMES[(tick_count as usize) % SPINNER_FRAMES.len()]
    }
}

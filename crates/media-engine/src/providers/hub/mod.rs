//! Source-agnostic glue: one subtitle pipeline and one title identity for every
//! provider, so viewers never need to know which source a title came from.
//!
//! * `lang`      – ISO-639 code/name table (OpenSubtitles/Stremio codes → 639-1).
//! * `matching`  – title normalisation and scoring across providers.
//! * `opensubs`  – keyless Stremio OpenSubtitles addon client (IMDb-keyed).
//! * `captions`  – merge/dedupe/rank captions from several sources.
//! * `search`    – dedupe a cross-provider search into one list of titles.
//! * `cache`     – small TTL cache shared by the hub and the Collaps provider.

pub mod cache;
pub mod captions;
pub mod lang;
pub mod matching;
pub mod opensubs;
pub mod search;

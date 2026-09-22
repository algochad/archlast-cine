# Cache

Disk caching lives in `cache.rs`; in-memory caches live in `AppState`.

## Disk layout

```
<cache dir>/moviebox-tui/
  <provider>/            moviebox, fourkhdhub, bdix_circleftp, bdix_dhakaflix, addons
    search/<hash>_<page>.cache
    details/details_<schema><hash>.cache
    streams/<schema><hash>_<season>_<episode>.cache
    images/<hash>.img
  moviebox/
    homepage/home_<tab>_<page>.cache
    captions/captions_<hash>.cache
  addons/
    catalogs/catalog_<hash>.cache
    manifests/manifest_<hash>.cache
    streams/<hash>_<season>_<episode>.cache
  tv_playlists/<md5>.m3u       cached remote playlist snapshots
```

The cache directory is `dirs::cache_dir()/moviebox-tui` (macOS
`~/Library/Caches`, Windows `%LOCALAPPDATA%`, Linux `$XDG_CACHE_HOME`).

## Properties

- **Binary MessagePack Envelopes**: Cache entries are serialized with `rmp-serde` wrapped in a binary envelope starting with the 4-byte magic signature `MBC1` and an 8-byte TTL timestamp (`CacheEnvelope<T>`). Legacy JSON files are read and migrated on the fly.
- **Fast Table-Lookup Hex Hashing**: Cache file naming and key hashing in `md5_hex` uses static 16-byte lookup table encoding, eliminating dynamic `core::fmt::write` formatting allocations and speeding up digest encoding by 2.51x.
- **Provider namespacing**: Keys include `provider.cache_key()`, preventing collisions across sources.
- **Atomic writes**: Entries are written to a unique temp file (`path.with_extension("tmp-PID-STAMP")`) and atomically replaced (`durable_replace`), preventing truncated or corrupt files on unexpected exits.
- **Validation**: Empty search or stream results are never written or served from cache.
- **Purge**: Background cleanup runs at startup to delete entries older than 7 days. `/settings` → Maintenance → Clear Disk Cache recursively empties all cached provider responses, images, TV playlists, temporary subtitles across Android/Windows/Unix, resets in-memory LRU caches, and cancels in-flight background request tasks.

## In-memory caches (AppState)

- `image_cache` (30), `search_posters` (300), `failed_posters` (300),
  `search_poster_protocols` (300), `preview_cache` (30): `lru::LruCache` for poster
  images, negative lookup cache, and terminal image protocols; `stream_pool`:
  resolved streams per subject.

All disk access in async code is wrapped in `tokio::task::spawn_blocking` so the event
loop never blocks. Failures are logged (see [logging.md](logging.md)) and treated as
cache misses.

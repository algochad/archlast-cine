use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// Default bound on live entries.
pub const DEFAULT_MAX: usize = 512;

/// Bounded map whose entries expire `ttl` after insertion.
pub struct TtlCache<V> {
    ttl: Duration,
    max: usize,
    entries: Mutex<HashMap<String, (Instant, V)>>,
}

impl<V: Clone> TtlCache<V> {
    pub fn new(ttl: Duration) -> Self {
        Self::with_max(ttl, DEFAULT_MAX)
    }

    pub fn with_max(ttl: Duration, max: usize) -> Self {
        Self {
            ttl,
            max: max.max(1),
            entries: Mutex::new(HashMap::new()),
        }
    }

    pub fn get(&self, key: &str) -> Option<V> {
        let map = self.entries.lock().ok()?;
        let (at, value) = map.get(key)?;
        (at.elapsed() < self.ttl).then(|| value.clone())
    }

    pub fn insert(&self, key: String, value: V) {
        let Ok(mut map) = self.entries.lock() else {
            return;
        };
        if map.len() >= self.max {
            let ttl = self.ttl;
            map.retain(|_, (at, _)| at.elapsed() < ttl);
        }
        if map.len() >= self.max {
            if let Some(oldest) = map
                .iter()
                .min_by_key(|(_, (at, _))| *at)
                .map(|(k, _)| k.clone())
            {
                map.remove(&oldest);
            }
        }
        map.insert(key, (Instant::now(), value));
    }

    #[cfg(test)]
    pub fn len(&self) -> usize {
        self.entries.lock().map(|m| m.len()).unwrap_or(0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn entries_expire() {
        let cache: TtlCache<u32> = TtlCache::new(Duration::from_millis(0));
        cache.insert("a".into(), 1);
        assert_eq!(cache.get("a"), None);
    }

    #[test]
    fn stays_bounded_and_keeps_newest() {
        let cache: TtlCache<u32> = TtlCache::with_max(Duration::from_secs(60), 8);
        for i in 0..20u32 {
            cache.insert(i.to_string(), i);
        }
        assert!(cache.len() <= 8);
        assert_eq!(cache.get("19"), Some(19));
    }
}

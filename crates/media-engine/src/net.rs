use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use hickory_resolver::TokioResolver;
use hickory_resolver::config::{
    CLOUDFLARE_IPS, GOOGLE_IPS, LookupIpStrategy, NameServerConfigGroup, QUAD9_IPS, ResolverConfig,
};
use hickory_resolver::name_server::TokioConnectionProvider;
use reqwest::dns::{Addrs, Name, Resolve, Resolving};

const FALLBACK_DNS_PORT: u16 = 53;
/// How long a previously resolved address set may stand in for a host whose
/// every resolver currently fails.
const LAST_GOOD_MAX_AGE: Duration = Duration::from_secs(60 * 60);

static GLOBAL_RESOLVER: std::sync::LazyLock<Arc<TokioResolver>> =
    std::sync::LazyLock::new(|| Arc::new(build_resolver()));

/// Public resolvers queried directly. Reached only after the configured
/// resolver and getaddrinfo failed, so a local cache holding a bad answer
/// (Docker's embedded DNS, systemd-resolved) cannot mask a working name.
static PUBLIC_RESOLVER: std::sync::LazyLock<Arc<TokioResolver>> =
    std::sync::LazyLock::new(|| Arc::new(build_public_resolver()));

static LAST_GOOD: std::sync::LazyLock<LastGood> = std::sync::LazyLock::new(LastGood::default);

#[derive(Debug, Default, Clone)]
pub struct FallbackResolver;

impl FallbackResolver {
    pub fn new() -> Self {
        Self
    }
}

/// Addresses that last resolved successfully, per host.
#[derive(Default)]
struct LastGood {
    entries: Mutex<HashMap<String, (Instant, Vec<IpAddr>)>>,
}

impl LastGood {
    const MAX_HOSTS: usize = 1024;

    fn remember(&self, host: &str, addrs: &[IpAddr]) {
        if addrs.is_empty() {
            return;
        }
        let Ok(mut map) = self.entries.lock() else {
            return;
        };
        if map.len() >= Self::MAX_HOSTS && !map.contains_key(host) {
            if let Some(oldest) = map
                .iter()
                .min_by_key(|(_, (at, _))| *at)
                .map(|(k, _)| k.clone())
            {
                map.remove(&oldest);
            }
        }
        map.insert(host.to_ascii_lowercase(), (Instant::now(), addrs.to_vec()));
    }

    fn recall(&self, host: &str, max_age: Duration) -> Option<Vec<IpAddr>> {
        let map = self.entries.lock().ok()?;
        let (at, addrs) = map.get(&host.to_ascii_lowercase())?;
        (at.elapsed() <= max_age).then(|| addrs.clone())
    }
}

fn fallback_servers() -> Vec<std::net::IpAddr> {
    let mut servers = Vec::with_capacity(CLOUDFLARE_IPS.len() + GOOGLE_IPS.len() + QUAD9_IPS.len());
    servers.extend_from_slice(CLOUDFLARE_IPS);
    servers.extend_from_slice(GOOGLE_IPS);
    servers.extend_from_slice(QUAD9_IPS);
    servers
}

fn fallback_config() -> ResolverConfig {
    ResolverConfig::from_parts(
        None,
        Vec::new(),
        NameServerConfigGroup::from_ips_clear(&fallback_servers(), FALLBACK_DNS_PORT, true),
    )
}

fn build_resolver() -> TokioResolver {
    let mut builder = match TokioResolver::builder_tokio() {
        Ok(builder) => builder,
        Err(_) => TokioResolver::builder_with_config(
            fallback_config(),
            TokioConnectionProvider::default(),
        ),
    };
    builder.options_mut().ip_strategy = LookupIpStrategy::Ipv4AndIpv6;
    builder.build()
}

fn build_public_resolver() -> TokioResolver {
    let mut builder =
        TokioResolver::builder_with_config(fallback_config(), TokioConnectionProvider::default());
    let opts = builder.options_mut();
    opts.ip_strategy = LookupIpStrategy::Ipv4AndIpv6;
    opts.timeout = Duration::from_secs(3);
    opts.attempts = 2;
    // CDN zones with short TTLs answer empty now and then; do not let a
    // transient empty answer stick.
    opts.negative_max_ttl = Some(Duration::from_secs(3));
    builder.build()
}

async fn lookup_system(host: &str) -> Option<Vec<IpAddr>> {
    let host = host.to_string();
    tokio::task::spawn_blocking(move || {
        use std::net::ToSocketAddrs;
        (host.as_str(), 0)
            .to_socket_addrs()
            .ok()
            .map(|it| it.map(|a| a.ip()).collect::<Vec<_>>())
    })
    .await
    .ok()
    .flatten()
    .filter(|addrs| !addrs.is_empty())
}

/// Resolve `host`, trying independent paths in turn: the configured resolver,
/// getaddrinfo, public resolvers, then the last-known-good addresses.
async fn resolve_host(host: &str) -> Result<Vec<IpAddr>, String> {
    let first_err = match GLOBAL_RESOLVER.lookup_ip(host).await {
        Ok(lookup) => {
            let addrs: Vec<IpAddr> = lookup.iter().collect();
            if !addrs.is_empty() {
                LAST_GOOD.remember(host, &addrs);
                return Ok(addrs);
            }
            "no records".to_string()
        }
        Err(e) => e.to_string(),
    };
    if let Some(addrs) = lookup_system(host).await {
        log::debug!("dns: {host} resolved via getaddrinfo after resolver failed ({first_err})");
        LAST_GOOD.remember(host, &addrs);
        return Ok(addrs);
    }
    if let Ok(lookup) = PUBLIC_RESOLVER.lookup_ip(host).await {
        let addrs: Vec<IpAddr> = lookup.iter().collect();
        if !addrs.is_empty() {
            log::info!(
                "dns: {host} resolved via public resolvers after local resolvers failed ({first_err})"
            );
            LAST_GOOD.remember(host, &addrs);
            return Ok(addrs);
        }
    }
    if let Some(addrs) = LAST_GOOD.recall(host, LAST_GOOD_MAX_AGE) {
        log::warn!("dns: {host} unresolvable ({first_err}); using last known addresses");
        return Ok(addrs);
    }
    Err(format!("dns: could not resolve {host}: {first_err}"))
}

impl Resolve for FallbackResolver {
    fn resolve(&self, name: Name) -> Resolving {
        Box::pin(async move {
            let addrs = resolve_host(name.as_str()).await?;
            let addrs: Addrs = Box::new(
                addrs
                    .into_iter()
                    .map(|address| SocketAddr::new(address, 0))
                    .collect::<Vec<_>>()
                    .into_iter(),
            );
            Ok(addrs)
        })
    }
}

pub fn http_client_builder() -> reqwest::ClientBuilder {
    reqwest::Client::builder()
        .dns_resolver(Arc::new(FallbackResolver::new()))
        .tcp_nodelay(true)
        .tcp_keepalive(Some(std::time::Duration::from_secs(45)))
        .pool_idle_timeout(Some(std::time::Duration::from_secs(90)))
        .pool_max_idle_per_host(8)
}

pub fn is_http_url(source: &str) -> bool {
    let trimmed = source.trim();
    trimmed.starts_with("http://") || trimmed.starts_with("https://")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn last_good_returns_fresh_addresses_case_insensitively() {
        let lg = LastGood::default();
        let ip: IpAddr = "50.7.24.138".parse().unwrap();
        lg.remember("FazhZcezBdi.Interkh.com", &[ip]);
        assert_eq!(
            lg.recall("fazhzcezbdi.interkh.com", Duration::from_secs(60)),
            Some(vec![ip])
        );
        assert_eq!(lg.recall("other.example", Duration::from_secs(60)), None);
    }

    #[test]
    fn last_good_expires_and_ignores_empty_sets() {
        let lg = LastGood::default();
        let ip: IpAddr = "10.0.0.1".parse().unwrap();
        lg.remember("a.example", &[ip]);
        assert_eq!(lg.recall("a.example", Duration::ZERO), None);
        lg.remember("b.example", &[]);
        assert_eq!(lg.recall("b.example", Duration::from_secs(60)), None);
    }

    #[test]
    fn last_good_is_bounded() {
        let lg = LastGood::default();
        let ip: IpAddr = "10.0.0.1".parse().unwrap();
        for i in 0..(LastGood::MAX_HOSTS + 10) {
            lg.remember(&format!("h{i}.example"), &[ip]);
        }
        assert!(lg.entries.lock().unwrap().len() <= LastGood::MAX_HOSTS);
    }

    #[test]
    fn fallback_config_contains_public_resolvers() {
        let config = fallback_config();
        let servers = config.name_servers();
        assert!(servers.len() >= 12);
        assert!(servers.iter().any(|server| server.socket_addr.ip()
            == std::net::IpAddr::V4(std::net::Ipv4Addr::new(1, 1, 1, 1))));
        assert!(
            servers
                .iter()
                .any(|server| server.socket_addr.port() == FALLBACK_DNS_PORT)
        );
    }

    #[test]
    fn fallback_servers_deduplicate_nothing_and_cover_all_providers() {
        let servers = fallback_servers();
        assert_eq!(
            servers.len(),
            CLOUDFLARE_IPS.len() + GOOGLE_IPS.len() + QUAD9_IPS.len()
        );
    }

    #[tokio::test]
    async fn built_resolver_prefers_ipv4_and_ipv6_lookup() {
        let resolver = build_resolver();
        assert_eq!(
            resolver.options().ip_strategy,
            LookupIpStrategy::Ipv4AndIpv6
        );
    }

    #[test]
    fn clones_share_lazy_state_slot() {
        let original = FallbackResolver::new();
        let _clone = original.clone();
        let _builder = http_client_builder();
    }
    #[test]
    fn test_is_http_url() {
        assert!(is_http_url("http://example.com"));
        assert!(is_http_url("https://example.com/playlist.m3u8"));
        assert!(is_http_url("   https://example.com   "));
        assert!(!is_http_url("/local/path/file.m3u"));
        assert!(!is_http_url("stremio://addon.example.com"));
        assert!(!is_http_url(""));
    }
}

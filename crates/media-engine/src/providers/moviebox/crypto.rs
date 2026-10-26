use base64::Engine;
use hmac::{Hmac, KeyInit, Mac};
use md5::{Digest, Md5};
use std::collections::BTreeMap;
use std::time::{SystemTime, UNIX_EPOCH};
use url::Url;

const SECRET_KEY_DEFAULT: &str = "76iRl07s0xSN9jqmEWAt79EBJZulIQIsV64FZr2O";
const SIGNATURE_BODY_MAX_BYTES: usize = 102_400;

static DEFAULT_SECRET_BYTES: std::sync::LazyLock<Vec<u8>> =
    std::sync::LazyLock::new(|| b64_decode(SECRET_KEY_DEFAULT));

type HmacMd5 = Hmac<Md5>;

fn md5_hex(data: &[u8]) -> String {
    let mut hasher = Md5::new();
    hasher.update(data);
    let digest = hasher.finalize();
    let mut hex = String::with_capacity(32);
    for b in digest {
        use std::fmt::Write;
        let _ = write!(&mut hex, "{:02x}", b);
    }
    hex
}

fn b64_decode(val: &str) -> Vec<u8> {
    let mut padded = val.to_string();
    let padding = (4 - padded.len() % 4) % 4;
    padded.push_str(&"=".repeat(padding));
    base64::engine::general_purpose::STANDARD
        .decode(padded)
        .unwrap_or_default()
}

fn b64_encode(data: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(data)
}

fn insert_header(
    headers: &mut reqwest::header::HeaderMap,
    name: reqwest::header::HeaderName,
    value: &str,
) {
    match value.parse() {
        Ok(parsed) => {
            headers.insert(name, parsed);
        }
        Err(error) => {
            log::warn!("moviebox signing header skipped: {error}");
        }
    }
}

pub fn generate_x_client_token(ts: u64) -> String {
    let ts_str = ts.to_string();
    let reversed_ts: String = ts_str.chars().rev().collect();
    let hash_val = md5_hex(reversed_ts.as_bytes());
    format!("{},{}", ts_str, hash_val)
}

fn sorted_query_string(url: &str) -> String {
    let Ok(parsed) = Url::parse(url) else {
        return String::new();
    };

    let mut params = BTreeMap::new();
    for (k, v) in parsed.query_pairs() {
        params
            .entry(k.into_owned())
            .or_insert_with(Vec::new)
            .push(v.into_owned());
    }

    if params.is_empty() {
        return String::new();
    }

    let mut parts = Vec::new();
    for (key, values) in params {
        for val in values {
            parts.push(format!("{}={}", key, val));
        }
    }
    parts.join("&")
}

pub fn build_canonical_string(
    method: &str,
    accept: Option<&str>,
    content_type: Option<&str>,
    url: &str,
    body: Option<&str>,
    timestamp_ms: u64,
) -> String {
    let canonical_url = if let Ok(parsed) = Url::parse(url) {
        let path = parsed.path();
        let query = sorted_query_string(url);
        if query.is_empty() {
            path.to_string()
        } else {
            format!("{}?{}", path, query)
        }
    } else {
        url.to_string()
    };

    let body_bytes = body.map(|b| b.as_bytes());
    let (body_hash, body_length) = if let Some(bytes) = body_bytes {
        let len = bytes.len();
        let truncated = if len > SIGNATURE_BODY_MAX_BYTES {
            &bytes[..SIGNATURE_BODY_MAX_BYTES]
        } else {
            bytes
        };
        (md5_hex(truncated), len.to_string())
    } else {
        (String::new(), String::new())
    };

    format!(
        "{}\n{}\n{}\n{}\n{}\n{}\n{}",
        method.to_uppercase(),
        accept.unwrap_or(""),
        content_type.unwrap_or(""),
        body_length,
        timestamp_ms,
        body_hash,
        canonical_url
    )
}

pub fn generate_x_tr_signature(
    method: &str,
    accept: Option<&str>,
    content_type: Option<&str>,
    url: &str,
    body: Option<&str>,
    timestamp_ms: u64,
) -> String {
    let canonical = build_canonical_string(method, accept, content_type, url, body, timestamp_ms);
    let Ok(mut mac) = HmacMd5::new_from_slice(&DEFAULT_SECRET_BYTES) else {
        log::warn!("moviebox signature fallback: invalid HMAC key material");
        return format!("{}|2|", timestamp_ms);
    };
    mac.update(canonical.as_bytes());
    let sig_b64 = b64_encode(&mac.finalize().into_bytes());

    format!("{}|2|{}", timestamp_ms, sig_b64)
}

pub fn build_signed_headers(
    method: &str,
    url: &str,
    body: Option<&str>,
    auth_token: Option<&str>,
    user_agent: &str,
    client_info: &str,
    spoofed_ip: &str,
) -> reqwest::header::HeaderMap {
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;

    let accept = "application/json";
    let content_type = "application/json";

    let client_token = generate_x_client_token(ts);
    let signature =
        generate_x_tr_signature(method, Some(accept), Some(content_type), url, body, ts);

    let mut headers = reqwest::header::HeaderMap::new();

    insert_header(&mut headers, reqwest::header::USER_AGENT, user_agent);
    insert_header(&mut headers, reqwest::header::ACCEPT, accept);
    insert_header(&mut headers, reqwest::header::CONTENT_TYPE, content_type);
    insert_header(&mut headers, reqwest::header::CONNECTION, "keep-alive");
    insert_header(
        &mut headers,
        reqwest::header::HeaderName::from_static("x-client-token"),
        &client_token,
    );
    insert_header(
        &mut headers,
        reqwest::header::HeaderName::from_static("x-tr-signature"),
        &signature,
    );
    insert_header(
        &mut headers,
        reqwest::header::HeaderName::from_static("x-client-info"),
        client_info,
    );
    insert_header(
        &mut headers,
        reqwest::header::HeaderName::from_static("x-client-status"),
        "0",
    );
    insert_header(
        &mut headers,
        reqwest::header::HeaderName::from_static("x-forwarded-for"),
        spoofed_ip,
    );

    if let Some(token) = auth_token {
        let bearer = format!("Bearer {}", token);
        insert_header(&mut headers, reqwest::header::AUTHORIZATION, &bearer);
    }

    headers
}

pub(crate) fn generate_client_info_and_ua() -> (String, String) {
    use rand::RngExt;
    let mut rng = rand::rng();

    let android_versions = [
        ("9", "PQ3A.190605.03081104"),
        ("10", "QP1A.191005.007.A3"),
        ("11", "RP1A.200720.011"),
        ("12", "S1B.220414.015"),
        ("13", "TQ2A.230405.003"),
    ];
    let redmi_devices = [
        ("23078RKD5C", "Redmi"),
        ("2201117TY", "Redmi"),
        ("2201117TG", "Redmi"),
        ("22101316G", "Redmi"),
        ("21121210G", "Redmi"),
        ("M2012K11AG", "Redmi"),
        ("M2007J20CG", "Redmi"),
    ];
    let version_codes = [50020117, 50020118, 50020119, 50020120, 50020121];
    let network_types = ["NETWORK_WIFI", "NETWORK_MOBILE"];

    let region = crate::config::moviebox_region();
    // Region-matched client identity: the gateway uses these to shape market
    // shelves alongside the spoofed x-forwarded-for address.
    let (region_code, timezone, sp_code) = match region {
        "ph" => ("PH", "Asia/Manila", "51503"),
        "us" => ("US", "America/New_York", "310030"),
        "sg" => ("SG", "Asia/Singapore", "52501"),
        _ => ("IN", "Asia/Kolkata", "40401"),
    };

    let android = android_versions[rng.random_range(0..android_versions.len())];
    let device = redmi_devices[rng.random_range(0..redmi_devices.len())];
    let version_code = version_codes[rng.random_range(0..version_codes.len())];
    let network = network_types[rng.random_range(0..network_types.len())];
    let gaid = random_uuid();
    let device_id = random_hex(32);

    let user_agent = format!(
        "com.community.oneroom/{} (Linux; U; Android {}; en_US; {}; Build/{}; Cronet/135.0.7012.3)",
        version_code, android.0, device.0, android.1
    );

    let client_info = format!(
        r#"{{"package_name":"com.community.oneroom","version_name":"4.0.01.0813.03","version_code":{},"os":"android","os_version":"{}","install_ch":"ps","device_id":"{}","install_store":"ps","gaid":"{}","brand":"{}","model":"{}","system_language":"en","net":"{}","region":"{}","timezone":"{}","sp_code":"{}","X-Play-Mode":"2"}}"#,
        version_code, android.0, device_id, gaid, device.1, device.0, network, region_code, timezone, sp_code
    );

    (user_agent, client_info)
}

fn random_hex(len: usize) -> String {
    use rand::RngExt;
    let mut rng = rand::rng();
    (0..len)
        .map(|_| format!("{:x}", rng.random_range(0..16)))
        .collect()
}

fn random_uuid() -> String {
    format!(
        "{}-{}-{}-{}-{}",
        random_hex(8),
        random_hex(4),
        random_hex(4),
        random_hex(4),
        random_hex(12)
    )
}

pub(crate) fn random_spoofed_ip() -> String {
    let prefixes: &[&str] = match crate::config::moviebox_region() {
        // Globe / Smart / PLDT / Converge residential ranges (Philippines).
        "ph" => &[
            "112.198", "112.204", "112.205", "112.208", "112.209", "112.210", "49.144", "49.145",
            "49.146", "49.147", "49.150", "49.151", "119.92", "119.93", "119.94", "124.104",
            "124.105", "124.106", "124.107", "203.87", "210.4", "121.54", "103.3", "202.90",
        ],
        // Comcast / Verizon / Spectrum-style residential ranges (United States).
        "us" => &[
            "24.60", "67.160", "67.170", "73.45", "73.75", "98.102", "172.56", "174.95", "68.32",
            "75.128", "100.33", "136.52",
        ],
        // Singtel / StarHub / M1-style ranges (Singapore edge).
        "sg" => &["203.116", "203.117", "128.106", "116.14", "42.60", "36.37", "138.75"],
        // Default: Indian ISPs (BSNL / Airtel / Jio / Vi), legacy behavior.
        _ => &[
            "103.241", "49.36", "117.195", "106.198", "122.162", "157.32", "182.70", "103.58",
            "27.60", "59.90",
        ],
    };
    random_ip_from(prefixes)
}

fn random_ip_from(prefixes: &[&str]) -> String {
    use rand::RngExt;
    let mut rng = rand::rng();
    let prefix = prefixes[rng.random_range(0..prefixes.len())];
    let c: u8 = rng.random_range(1..254);
    let d: u8 = rng.random_range(1..254);
    format!("{}.{}.{}", prefix, c, d)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sorted_query_string() {
        let url = "https://api.example.com/endpoint?b=2&a=1&c=3";
        assert_eq!(sorted_query_string(url), "a=1&b=2&c=3");

        let no_query = "https://api.example.com/endpoint";
        assert_eq!(sorted_query_string(no_query), "");
    }

    #[test]
    fn test_generate_x_client_token() {
        let token = generate_x_client_token(1700000000000);
        let parts: Vec<&str> = token.split(',').collect();
        assert_eq!(parts.len(), 2);
        assert_eq!(parts[0], "1700000000000");
        assert_eq!(parts[1].len(), 32);
    }

    #[test]
    fn test_generate_x_tr_signature() {
        let sig = generate_x_tr_signature(
            "GET",
            Some("application/json"),
            Some("application/json"),
            "https://api.example.com/path?tab=1&page=2",
            None,
            1700000000000,
        );
        let parts: Vec<&str> = sig.split('|').collect();
        assert_eq!(parts.len(), 3);
        assert_eq!(parts[0], "1700000000000");
        assert_eq!(parts[1], "2");
        assert!(!parts[2].is_empty());
    }

    #[test]
    fn test_generate_client_info_and_ua() {
        let (ua, client_info) = generate_client_info_and_ua();
        assert!(ua.contains("com.community.oneroom/500201"));
        assert!(ua.contains("Cronet/135.0.7012.3"));

        let parsed: serde_json::Value =
            serde_json::from_str(&client_info).expect("valid JSON client_info");
        assert_eq!(parsed["version_name"], "4.0.01.0813.03");
        assert_eq!(parsed["package_name"], "com.community.oneroom");
        let code = parsed["version_code"]
            .as_i64()
            .expect("version_code is number");
        assert!((50020117..=50020121).contains(&code));
        assert_eq!(parsed["sp_code"], "40401");
        assert_eq!(parsed["X-Play-Mode"], "2");
    }
}

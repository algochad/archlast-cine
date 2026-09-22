use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MovieBoxSession {
    pub token: String,
    pub user_id: Option<String>,
    pub expires_at: Option<u64>,
    pub created_at: u64,
}

impl MovieBoxSession {
    pub fn new(token: String, user_id: Option<String>, expires_at: Option<u64>) -> Self {
        let created_at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        Self {
            token,
            user_id,
            expires_at,
            created_at,
        }
    }

    pub fn from_token_and_payload(token: String, explicit_uid: Option<String>) -> Self {
        let (jwt_uid, jwt_exp) = parse_jwt_claims(&token);
        let user_id = explicit_uid.or(jwt_uid);
        Self::new(token, user_id, jwt_exp)
    }

    pub fn is_valid(&self) -> bool {
        if self.token.trim().is_empty() {
            return false;
        }
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        if let Some(exp) = self.expires_at {
            now.saturating_add(60) < exp
        } else {
            now < self.created_at.saturating_add(7 * 24 * 3600)
        }
    }
}

pub fn parse_jwt_claims(token: &str) -> (Option<String>, Option<u64>) {
    let parts: Vec<&str> = token.split('.').collect();
    if parts.len() < 2 {
        return (None, None);
    }
    let payload_b64 = parts[1];
    let pad_len = (4 - (payload_b64.len() % 4)) % 4;
    let padded = format!("{}{}", payload_b64, "=".repeat(pad_len));

    let decoded = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(payload_b64)
        .or_else(|_| base64::engine::general_purpose::URL_SAFE.decode(&padded))
        .or_else(|_| base64::engine::general_purpose::STANDARD.decode(&padded))
        .ok();

    let Some(bytes) = decoded else {
        return (None, None);
    };

    let Ok(val) = serde_json::from_slice::<Value>(&bytes) else {
        return (None, None);
    };

    let uid = val
        .get("userId")
        .or_else(|| val.get("uid"))
        .or_else(|| val.get("sub"))
        .and_then(|v| {
            v.as_str()
                .map(|s| s.to_string())
                .or_else(|| v.as_i64().map(|n| n.to_string()))
                .or_else(|| v.as_u64().map(|n| n.to_string()))
        });

    let exp = val.get("exp").and_then(|v| {
        if let Some(n) = v.as_u64() {
            Some(n)
        } else if let Some(n) = v.as_i64() {
            Some(n as u64)
        } else if let Some(s) = v.as_str() {
            s.parse::<u64>().ok()
        } else {
            None
        }
    });

    (uid, exp)
}

pub fn session_cache_path() -> PathBuf {
    let region = crate::config::moviebox_region();
    if region == "in" {
        crate::config::cache_dir().join("moviebox_session.bin")
    } else {
        crate::config::cache_dir().join(format!("moviebox_session_{region}.bin"))
    }
}

pub fn load_persisted_session() -> Option<MovieBoxSession> {
    let path = session_cache_path();
    crate::cache::get_typed_cache::<MovieBoxSession>(&path, 30 * 24 * 3600)
}

pub fn save_session(session: &MovieBoxSession) {
    let path = session_cache_path();
    crate::cache::set_typed_cache(&path, 30 * 24 * 3600, session);
}

pub fn clear_persisted_session() {
    let path = session_cache_path();
    let _ = std::fs::remove_file(path);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_jwt_claims_parsing_valid() {
        let payload = r#"{"userId":"123456789","exp":1893456000,"role":"visitor"}"#;
        let b64 = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(payload.as_bytes());
        let token = format!("eyJhbGciOiJIUzI1NiJ9.{b64}.signature");

        let (uid, exp) = parse_jwt_claims(&token);
        assert_eq!(uid.as_deref(), Some("123456789"));
        assert_eq!(exp, Some(1893456000));
    }

    #[test]
    fn test_session_validity_and_expiration() {
        let valid_session = MovieBoxSession::new("valid_token".to_string(), None, Some(u64::MAX));
        assert!(valid_session.is_valid());

        let expired_session = MovieBoxSession::new("expired_token".to_string(), None, Some(100));
        assert!(!expired_session.is_valid());

        let empty_session = MovieBoxSession::new("".to_string(), None, Some(u64::MAX));
        assert!(!empty_session.is_valid());
    }

    #[test]
    fn test_session_roundtrip_cache() {
        let temp_dir = tempfile::tempdir().expect("tempdir");
        let path = temp_dir.path().join("session_test.bin");
        let session = MovieBoxSession::new(
            "test_jwt_token".to_string(),
            Some("uid_999".to_string()),
            Some(1900000000),
        );

        crate::cache::set_typed_cache(&path, 3600, &session);
        let loaded = crate::cache::get_typed_cache::<MovieBoxSession>(&path, 3600);
        assert_eq!(loaded, Some(session));
    }
}

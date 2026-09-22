use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Channel {
    pub id: String,
    pub name: String,
    pub logo: String,
    pub group: String,
    pub stream_url: String,
}

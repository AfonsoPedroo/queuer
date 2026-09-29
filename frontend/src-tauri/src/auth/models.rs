use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AuthPhase {
    Unconfigured,
    SignedOut,
    SessionAvailable,
    Authorizing,
    ExchangingCode,
    Refreshing,
    Authenticated,
    Error,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AuthStatus {
    pub phase: AuthPhase,
    pub configured: bool,
    pub authenticated: bool,
    pub has_stored_session: bool,
    pub expires_at_unix_ms: Option<u64>,
    pub scopes: Vec<String>,
    pub redirect_uri_registration: &'static str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccessTokenGrant {
    pub access_token: String,
    pub expires_at_unix_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SpotifyImage {
    pub url: String,
    pub height: Option<u32>,
    pub width: Option<u32>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SpotifyProfile {
    pub account_id: String,
    pub id: String,
    pub display_name: Option<String>,
    pub images: Vec<SpotifyImage>,
    pub product: Option<String>,
    pub uri: String,
}

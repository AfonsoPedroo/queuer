mod callback;
mod error;
mod models;
mod pkce;
mod vault;

use std::{
    env,
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use reqwest::{Client, StatusCode};
use serde::Deserialize;
use tauri::{AppHandle, Emitter, State};
use tokio::{
    net::TcpListener,
    sync::{oneshot, Mutex},
    time::timeout,
};
use url::Url;
use zeroize::Zeroizing;

use callback::CallbackOutcome;
use error::{AuthError, CommandError};
use models::{AccessTokenGrant, AuthPhase, AuthStatus, SpotifyImage, SpotifyProfile};
use pkce::PkceMaterial;
use vault::CredentialVault;

const AUTHORIZE_URL: &str = "https://accounts.spotify.com/authorize";
const TOKEN_URL: &str = "https://accounts.spotify.com/api/token";
const PROFILE_URL: &str = "https://api.spotify.com/v1/me";
const CALLBACK_PORT: u16 = 43_821;
const REDIRECT_REGISTRATION: &str = "http://127.0.0.1:43821/callback";
const LOGIN_TIMEOUT: Duration = Duration::from_secs(5 * 60);
const REFRESH_EARLY_SECONDS: u64 = 60;
const SCOPES: [&str; 11] = [
    "user-read-private",
    "user-read-email",
    "streaming",
    "user-read-playback-state",
    "user-modify-playback-state",
    "user-read-currently-playing",
    "playlist-read-private",
    "playlist-read-collaborative",
    "user-library-read",
    "user-library-modify",
    "user-read-recently-played",
];

struct AccessTokenRecord {
    value: Zeroizing<String>,
    expires_at_unix_ms: u64,
}

struct RuntimeState {
    client_id: Option<String>,
    access_token: Option<AccessTokenRecord>,
    has_stored_session: bool,
    phase: AuthPhase,
    login_cancel: Option<oneshot::Sender<()>>,
}

pub(crate) struct SpotifyAuth {
    client: Client,
    runtime: Mutex<RuntimeState>,
    refresh_lock: Mutex<()>,
    vault: CredentialVault,
}

impl SpotifyAuth {
    pub(crate) fn new() -> Self {
        let environment_client_id = env::var("SPOTIFY_CLIENT_ID")
            .ok()
            .map(|value| value.trim().to_owned())
            .filter(|value| valid_client_id(value));
        let phase = if environment_client_id.is_some() {
            AuthPhase::SignedOut
        } else {
            AuthPhase::Unconfigured
        };

        Self {
            client: Client::builder()
                .connect_timeout(Duration::from_secs(10))
                .timeout(Duration::from_secs(20))
                .user_agent("Queuer/0.1 desktop")
                .build()
                .expect("build Spotify HTTP client"),
            runtime: Mutex::new(RuntimeState {
                client_id: environment_client_id,
                access_token: None,
                has_stored_session: false,
                phase,
                login_cancel: None,
            }),
            refresh_lock: Mutex::new(()),
            vault: CredentialVault::default(),
        }
    }

    async fn status(&self) -> AuthStatus {
        let runtime = self.runtime.lock().await;
        build_status(&runtime)
    }

    async fn configure(&self, client_id: String) -> Result<AuthStatus, AuthError> {
        let client_id = client_id.trim().to_owned();
        if !valid_client_id(&client_id) {
            return Err(AuthError::InvalidClientId);
        }

        {
            let runtime = self.runtime.lock().await;
            if runtime.login_cancel.is_some() {
                return Err(AuthError::LoginInProgress);
            }
            if runtime.client_id.as_deref() != Some(client_id.as_str())
                && (runtime.access_token.is_some() || runtime.has_stored_session)
            {
                return Err(AuthError::ConfigurationLocked);
            }
        }

        let has_stored_session = self.vault.get_refresh_token(&client_id).await?.is_some();
        let mut runtime = self.runtime.lock().await;
        runtime.client_id = Some(client_id);
        runtime.has_stored_session = has_stored_session;
        runtime.phase = if has_stored_session {
            AuthPhase::SessionAvailable
        } else {
            AuthPhase::SignedOut
        };
        Ok(build_status(&runtime))
    }

    async fn start_login(&self, app: &AppHandle) -> Result<SpotifyProfile, AuthError> {
        let client_id = {
            let runtime = self.runtime.lock().await;
            if runtime.login_cancel.is_some() {
                return Err(AuthError::LoginInProgress);
            }
            runtime.client_id.clone().ok_or(AuthError::NotConfigured)?
        };

        let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, CALLBACK_PORT))
            .await
            .map_err(|_| AuthError::ListenerFailed)?;
        let redirect_uri = REDIRECT_REGISTRATION.to_owned();
        let pkce = PkceMaterial::generate()?;
        let authorize_url =
            build_authorize_url(&client_id, &redirect_uri, &pkce.challenge, &pkce.state)?;
        let (cancel_tx, cancel_rx) = oneshot::channel();

        {
            let mut runtime = self.runtime.lock().await;
            runtime.login_cancel = Some(cancel_tx);
            runtime.phase = AuthPhase::Authorizing;
        }
        emit_status(app, self).await;

        if webbrowser::open(authorize_url.as_str()).is_err() {
            self.finish_login_phase(AuthPhase::Error).await;
            emit_status(app, self).await;
            return Err(AuthError::BrowserOpenFailed);
        }

        let callback_result = tokio::select! {
          result = timeout(LOGIN_TIMEOUT, callback::wait_for_callback(listener, &pkce.state)) => {
            match result {
              Ok(value) => value,
              Err(_) => Err(AuthError::TimedOut),
            }
          }
          _ = cancel_rx => Err(AuthError::Cancelled),
        };

        {
            let mut runtime = self.runtime.lock().await;
            runtime.login_cancel = None;
        }

        let code = match callback_result {
            Ok(CallbackOutcome::Code(code)) => code,
            Ok(CallbackOutcome::Denied) => {
                self.finish_login_phase(AuthPhase::SignedOut).await;
                emit_status(app, self).await;
                return Err(AuthError::AuthorizationDenied);
            }
            Err(error) => {
                let phase = if error == AuthError::Cancelled {
                    AuthPhase::SignedOut
                } else {
                    AuthPhase::Error
                };
                self.finish_login_phase(phase).await;
                emit_status(app, self).await;
                return Err(error);
            }
        };

        {
            let mut runtime = self.runtime.lock().await;
            runtime.phase = AuthPhase::ExchangingCode;
        }
        emit_status(app, self).await;

        let token = self
            .exchange_authorization_code(&client_id, &code, &redirect_uri, &pkce.verifier)
            .await;
        let token = match token {
            Ok(token) => token,
            Err(error) => {
                self.finish_login_phase(AuthPhase::Error).await;
                emit_status(app, self).await;
                return Err(error);
            }
        };

        let persistence_result = async {
            let refresh_token = token
                .refresh_token
                .as_deref()
                .ok_or(AuthError::InvalidTokenResponse)?;
            self.vault
                .set_refresh_token(&client_id, refresh_token)
                .await?;
            self.store_access_token(token).await
        }
        .await;
        if let Err(error) = persistence_result {
            self.finish_login_phase(AuthPhase::Error).await;
            emit_status(app, self).await;
            return Err(error);
        }
        emit_status(app, self).await;

        let profile = self.fetch_profile().await;
        if profile.is_err() {
            self.finish_login_phase(AuthPhase::Error).await;
            emit_status(app, self).await;
        }
        profile
    }

    async fn cancel_login(&self) -> Result<(), AuthError> {
        let cancel = self.runtime.lock().await.login_cancel.take();
        cancel
            .ok_or(AuthError::NoActiveLogin)?
            .send(())
            .map_err(|_| AuthError::NoActiveLogin)
    }

    async fn logout(&self) -> Result<AuthStatus, AuthError> {
        let (client_id, cancel) = {
            let mut runtime = self.runtime.lock().await;
            let client_id = runtime.client_id.clone();
            let cancel = runtime.login_cancel.take();
            runtime.access_token = None;
            runtime.has_stored_session = false;
            runtime.phase = if client_id.is_some() {
                AuthPhase::SignedOut
            } else {
                AuthPhase::Unconfigured
            };
            (client_id, cancel)
        };
        if let Some(cancel) = cancel {
            let _ = cancel.send(());
        }
        if let Some(client_id) = client_id {
            self.vault.delete_refresh_token(&client_id).await?;
        }
        Ok(self.status().await)
    }

    async fn access_token(&self, app: Option<&AppHandle>) -> Result<AccessTokenGrant, AuthError> {
        if let Some(grant) = self.current_access_token().await {
            return Ok(grant);
        }

        let _refresh_guard = self.refresh_lock.lock().await;
        if let Some(grant) = self.current_access_token().await {
            return Ok(grant);
        }

        let client_id = {
            let mut runtime = self.runtime.lock().await;
            let client_id = runtime.client_id.clone().ok_or(AuthError::NotConfigured)?;
            runtime.phase = AuthPhase::Refreshing;
            client_id
        };
        if let Some(app) = app {
            emit_status(app, self).await;
        }

        let refresh_result = async {
            let refresh_token = self
                .vault
                .get_refresh_token(&client_id)
                .await?
                .ok_or(AuthError::NoStoredSession)?;
            let token = self
                .exchange_refresh_token(&client_id, &refresh_token)
                .await?;
            if let Some(replacement) = token.refresh_token.as_deref() {
                self.vault
                    .set_refresh_token(&client_id, replacement)
                    .await?;
            }
            self.store_access_token(token).await
        }
        .await;

        if let Err(error) = refresh_result {
            let session_is_invalid = matches!(
                error,
                AuthError::RefreshRejected | AuthError::NoStoredSession
            );
            if session_is_invalid {
                let _ = self.vault.delete_refresh_token(&client_id).await;
            }
            {
                let mut runtime = self.runtime.lock().await;
                runtime.access_token = None;
                if session_is_invalid {
                    runtime.has_stored_session = false;
                    runtime.phase = AuthPhase::SignedOut;
                } else {
                    runtime.phase = AuthPhase::Error;
                }
            }
            if let Some(app) = app {
                emit_status(app, self).await;
            }
            return Err(error);
        }
        if let Some(app) = app {
            emit_status(app, self).await;
        }
        self.current_access_token()
            .await
            .ok_or(AuthError::TokenRefreshFailed)
    }

    async fn current_access_token(&self) -> Option<AccessTokenGrant> {
        let runtime = self.runtime.lock().await;
        let token = runtime.access_token.as_ref()?;
        let now_with_margin = unix_ms().saturating_add(REFRESH_EARLY_SECONDS * 1_000);
        if token.expires_at_unix_ms <= now_with_margin {
            return None;
        }
        Some(AccessTokenGrant {
            access_token: token.value.to_string(),
            expires_at_unix_ms: token.expires_at_unix_ms,
        })
    }

    async fn fetch_profile(&self) -> Result<SpotifyProfile, AuthError> {
        let grant = self.access_token(None).await?;
        let access_token = Zeroizing::new(grant.access_token);
        let response = self
            .client
            .get(PROFILE_URL)
            .bearer_auth(access_token.as_str())
            .send()
            .await
            .map_err(|_| AuthError::SpotifyApiFailed)?;

        match response.status() {
            StatusCode::OK => {}
            StatusCode::UNAUTHORIZED => return Err(AuthError::Unauthorized),
            StatusCode::TOO_MANY_REQUESTS => return Err(AuthError::RateLimited),
            _ => return Err(AuthError::SpotifyApiFailed),
        }

        let payload = response
            .json::<ProfileResponse>()
            .await
            .map_err(|_| AuthError::SpotifyApiFailed)?;
        let stable_id = payload
            .account_id
            .clone()
            .or_else(|| payload.id.clone())
            .ok_or(AuthError::SpotifyApiFailed)?;
        Ok(SpotifyProfile {
            account_id: stable_id.clone(),
            id: payload.id.unwrap_or(stable_id),
            display_name: payload.display_name,
            images: payload.images,
            product: payload.product,
            uri: payload.uri.unwrap_or_default(),
        })
    }

    async fn exchange_authorization_code(
        &self,
        client_id: &str,
        code: &str,
        redirect_uri: &str,
        verifier: &str,
    ) -> Result<TokenResponse, AuthError> {
        let form = [
            ("grant_type", "authorization_code"),
            ("code", code),
            ("redirect_uri", redirect_uri),
            ("client_id", client_id),
            ("code_verifier", verifier),
        ];
        self.request_token(
            &form,
            AuthError::TokenExchangeFailed,
            AuthError::TokenExchangeFailed,
        )
        .await
    }

    async fn exchange_refresh_token(
        &self,
        client_id: &str,
        refresh_token: &str,
    ) -> Result<TokenResponse, AuthError> {
        let form = [
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token),
            ("client_id", client_id),
        ];
        self.request_token(
            &form,
            AuthError::TokenRefreshFailed,
            AuthError::RefreshRejected,
        )
        .await
    }

    async fn request_token(
        &self,
        form: &[(&str, &str)],
        fallback_error: AuthError,
        rejection_error: AuthError,
    ) -> Result<TokenResponse, AuthError> {
        let response = self
            .client
            .post(TOKEN_URL)
            .form(form)
            .send()
            .await
            .map_err(|_| fallback_error)?;
        if response.status() == StatusCode::BAD_REQUEST
            || response.status() == StatusCode::UNAUTHORIZED
        {
            return Err(rejection_error);
        }
        if !response.status().is_success() {
            return Err(fallback_error);
        }
        response
            .json::<TokenResponse>()
            .await
            .map_err(|_| AuthError::InvalidTokenResponse)
    }

    async fn store_access_token(&self, token: TokenResponse) -> Result<(), AuthError> {
        if !token.token_type.eq_ignore_ascii_case("bearer") || token.expires_in == 0 {
            return Err(AuthError::InvalidTokenResponse);
        }
        let expires_at_unix_ms = unix_ms().saturating_add(token.expires_in * 1_000);
        let mut runtime = self.runtime.lock().await;
        runtime.access_token = Some(AccessTokenRecord {
            value: token.access_token,
            expires_at_unix_ms,
        });
        runtime.has_stored_session = true;
        runtime.phase = AuthPhase::Authenticated;
        Ok(())
    }

    async fn finish_login_phase(&self, phase: AuthPhase) {
        let mut runtime = self.runtime.lock().await;
        runtime.login_cancel = None;
        runtime.phase = phase;
    }
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: Zeroizing<String>,
    token_type: String,
    expires_in: u64,
    refresh_token: Option<Zeroizing<String>>,
    #[allow(dead_code)]
    scope: Option<String>,
}

#[derive(Deserialize)]
struct ProfileResponse {
    account_id: Option<String>,
    id: Option<String>,
    display_name: Option<String>,
    #[serde(default)]
    images: Vec<SpotifyImage>,
    product: Option<String>,
    uri: Option<String>,
}

fn build_status(runtime: &RuntimeState) -> AuthStatus {
    AuthStatus {
        phase: runtime.phase,
        configured: runtime.client_id.is_some(),
        authenticated: runtime.access_token.is_some(),
        has_stored_session: runtime.has_stored_session,
        expires_at_unix_ms: runtime
            .access_token
            .as_ref()
            .map(|token| token.expires_at_unix_ms),
        scopes: SCOPES.iter().map(|scope| (*scope).to_owned()).collect(),
        redirect_uri_registration: REDIRECT_REGISTRATION,
    }
}

fn build_authorize_url(
    client_id: &str,
    redirect_uri: &str,
    challenge: &str,
    state: &str,
) -> Result<Url, AuthError> {
    let mut url = Url::parse(AUTHORIZE_URL).map_err(|_| AuthError::Internal)?;
    url.query_pairs_mut()
        .append_pair("client_id", client_id)
        .append_pair("response_type", "code")
        .append_pair("redirect_uri", redirect_uri)
        .append_pair("code_challenge_method", "S256")
        .append_pair("code_challenge", challenge)
        .append_pair("state", state)
        .append_pair("scope", &SCOPES.join(" "));
    Ok(url)
}

fn valid_client_id(value: &str) -> bool {
    (16..=128).contains(&value.len()) && value.bytes().all(|byte| byte.is_ascii_alphanumeric())
}

fn unix_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

async fn emit_status(app: &AppHandle, auth: &SpotifyAuth) {
    let _ = app.emit("spotify-auth://status", auth.status().await);
}

#[tauri::command]
pub(crate) async fn spotify_configure(
    app: AppHandle,
    auth: State<'_, Arc<SpotifyAuth>>,
    client_id: String,
) -> Result<AuthStatus, CommandError> {
    let status = auth
        .configure(client_id)
        .await
        .map_err(CommandError::from)?;
    let _ = app.emit("spotify-auth://status", &status);
    Ok(status)
}

#[tauri::command]
pub(crate) async fn spotify_auth_status(
    auth: State<'_, Arc<SpotifyAuth>>,
) -> Result<AuthStatus, CommandError> {
    Ok(auth.status().await)
}

#[tauri::command]
pub(crate) async fn spotify_start_login(
    app: AppHandle,
    auth: State<'_, Arc<SpotifyAuth>>,
) -> Result<SpotifyProfile, CommandError> {
    auth.start_login(&app).await.map_err(CommandError::from)
}

#[tauri::command]
pub(crate) async fn spotify_cancel_login(
    auth: State<'_, Arc<SpotifyAuth>>,
) -> Result<(), CommandError> {
    auth.cancel_login().await.map_err(CommandError::from)
}

#[tauri::command]
pub(crate) async fn spotify_logout(
    app: AppHandle,
    auth: State<'_, Arc<SpotifyAuth>>,
) -> Result<AuthStatus, CommandError> {
    let status = auth.logout().await.map_err(CommandError::from)?;
    let _ = app.emit("spotify-auth://status", &status);
    Ok(status)
}

#[tauri::command]
pub(crate) async fn spotify_get_valid_access_token(
    app: AppHandle,
    auth: State<'_, Arc<SpotifyAuth>>,
) -> Result<AccessTokenGrant, CommandError> {
    auth.access_token(Some(&app))
        .await
        .map_err(CommandError::from)
}

#[tauri::command]
pub(crate) async fn spotify_get_profile(
    auth: State<'_, Arc<SpotifyAuth>>,
) -> Result<SpotifyProfile, CommandError> {
    auth.fetch_profile().await.map_err(CommandError::from)
}

#[tauri::command]
pub(crate) fn open_external_url(url: String) -> Result<(), CommandError> {
    let parsed =
        Url::parse(&url).map_err(|_| CommandError::from(AuthError::ExternalUrlNotAllowed))?;
    if parsed.scheme() != "https" || parsed.host_str() != Some("open.spotify.com") {
        return Err(CommandError::from(AuthError::ExternalUrlNotAllowed));
    }
    webbrowser::open(parsed.as_str())
        .map(|_| ())
        .map_err(|_| CommandError::from(AuthError::BrowserOpenFailed))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn client_id_validation_rejects_whitespace_and_punctuation() {
        assert!(valid_client_id("unitTestClientId0123456789abcdef"));
        assert!(!valid_client_id("too-short"));
        assert!(!valid_client_id("0123456789abcdef secret"));
    }

    #[test]
    fn authorization_url_contains_pkce_and_fixed_scopes_without_a_secret() {
        let url = build_authorize_url(
            "unitTestClientId0123456789abcdef",
            REDIRECT_REGISTRATION,
            "challenge",
            "state",
        )
        .expect("valid authorization URL");
        let rendered = url.as_str();
        assert!(rendered.contains("code_challenge_method=S256"));
        assert!(rendered.contains("127.0.0.1%3A43821"));
        assert!(!rendered.contains("client_secret"));
        for scope in SCOPES {
            assert!(url.query_pairs().any(|(key, value)| {
                key == "scope" && value.split(' ').any(|item| item == scope)
            }));
        }
    }
}

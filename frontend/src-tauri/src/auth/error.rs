use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error, Clone, Copy, PartialEq, Eq)]
pub(crate) enum AuthError {
    #[error("spotify authentication is not configured")]
    NotConfigured,
    #[error("the Spotify client ID is invalid")]
    InvalidClientId,
    #[error("the Spotify client ID cannot be changed while a session exists")]
    ConfigurationLocked,
    #[error("the external URL is not allowed")]
    ExternalUrlNotAllowed,
    #[error("a login is already in progress")]
    LoginInProgress,
    #[error("there is no active login")]
    NoActiveLogin,
    #[error("login was cancelled")]
    Cancelled,
    #[error("login timed out")]
    TimedOut,
    #[error("the system browser could not be opened")]
    BrowserOpenFailed,
    #[error("the loopback callback listener could not be started")]
    ListenerFailed,
    #[error("authorization was denied")]
    AuthorizationDenied,
    #[error("the token exchange failed")]
    TokenExchangeFailed,
    #[error("the access token could not be refreshed")]
    TokenRefreshFailed,
    #[error("the saved Spotify authorization is no longer valid")]
    RefreshRejected,
    #[error("there is no saved Spotify session")]
    NoStoredSession,
    #[error("the operating system credential vault is unavailable")]
    CredentialVaultUnavailable,
    #[error("the credential could not be saved")]
    CredentialWriteFailed,
    #[error("the credential could not be removed")]
    CredentialDeleteFailed,
    #[error("Spotify returned an invalid token response")]
    InvalidTokenResponse,
    #[error("Spotify rejected the API request")]
    SpotifyApiFailed,
    #[error("Spotify rejected the access token")]
    Unauthorized,
    #[error("Spotify rate limited the request")]
    RateLimited,
    #[error("an internal authentication error occurred")]
    Internal,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    pub code: &'static str,
    pub message: &'static str,
    pub recoverable: bool,
}

impl From<AuthError> for CommandError {
    fn from(value: AuthError) -> Self {
        let (code, message, recoverable) = match value {
            AuthError::NotConfigured => (
                "spotify_not_configured",
                "Spotify is not configured on this installation.",
                true,
            ),
            AuthError::InvalidClientId => (
                "invalid_client_id",
                "The Spotify client ID is not valid.",
                true,
            ),
            AuthError::ConfigurationLocked => (
                "configuration_locked",
                "Sign out before changing the Spotify client ID.",
                true,
            ),
            AuthError::ExternalUrlNotAllowed => (
                "external_url_not_allowed",
                "Only verified Spotify links can be opened by this action.",
                false,
            ),
            AuthError::LoginInProgress => (
                "login_in_progress",
                "A Spotify sign-in is already in progress.",
                true,
            ),
            AuthError::NoActiveLogin => (
                "no_active_login",
                "There is no Spotify sign-in to cancel.",
                true,
            ),
            AuthError::Cancelled => ("login_cancelled", "Spotify sign-in was cancelled.", true),
            AuthError::TimedOut => (
                "login_timed_out",
                "Spotify sign-in took too long. Please try again.",
                true,
            ),
            AuthError::BrowserOpenFailed => (
                "browser_open_failed",
                "The system browser could not be opened.",
                true,
            ),
            AuthError::ListenerFailed => (
                "callback_listener_failed",
                "The secure local sign-in callback could not be started.",
                true,
            ),
            AuthError::AuthorizationDenied => (
                "authorization_denied",
                "Spotify authorization was not granted.",
                true,
            ),
            AuthError::TokenExchangeFailed => (
                "token_exchange_failed",
                "Spotify sign-in could not be completed.",
                true,
            ),
            AuthError::TokenRefreshFailed => (
                "token_refresh_failed",
                "The Spotify session could not be refreshed.",
                true,
            ),
            AuthError::RefreshRejected => (
                "reauthorization_required",
                "Spotify requires you to sign in again.",
                true,
            ),
            AuthError::NoStoredSession => (
                "not_authenticated",
                "Sign in with Spotify to continue.",
                true,
            ),
            AuthError::CredentialVaultUnavailable => (
                "credential_vault_unavailable",
                "The operating system credential vault is unavailable.",
                true,
            ),
            AuthError::CredentialWriteFailed => (
                "credential_save_failed",
                "The Spotify session could not be stored securely.",
                true,
            ),
            AuthError::CredentialDeleteFailed => (
                "credential_delete_failed",
                "The saved Spotify session could not be removed.",
                true,
            ),
            AuthError::InvalidTokenResponse => (
                "invalid_token_response",
                "Spotify returned an unexpected authentication response.",
                true,
            ),
            AuthError::SpotifyApiFailed => (
                "spotify_api_failed",
                "Spotify could not complete the request.",
                true,
            ),
            AuthError::Unauthorized => (
                "spotify_unauthorized",
                "Spotify no longer accepts this session.",
                true,
            ),
            AuthError::RateLimited => (
                "spotify_rate_limited",
                "Spotify is receiving too many requests. Try again shortly.",
                true,
            ),
            AuthError::Internal => (
                "auth_internal_error",
                "An internal authentication error occurred.",
                false,
            ),
        };

        Self {
            code,
            message,
            recoverable,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn public_errors_never_contain_secret_material() {
        let sentinels = [
            "authorization-code-sentinel",
            "refresh-token-sentinel",
            "verifier-sentinel",
            "http://127.0.0.1:49152/oauth/callback?code=secret",
        ];

        let all_errors = [
            AuthError::NotConfigured,
            AuthError::InvalidClientId,
            AuthError::ConfigurationLocked,
            AuthError::ExternalUrlNotAllowed,
            AuthError::LoginInProgress,
            AuthError::NoActiveLogin,
            AuthError::Cancelled,
            AuthError::TimedOut,
            AuthError::BrowserOpenFailed,
            AuthError::ListenerFailed,
            AuthError::AuthorizationDenied,
            AuthError::TokenExchangeFailed,
            AuthError::TokenRefreshFailed,
            AuthError::RefreshRejected,
            AuthError::NoStoredSession,
            AuthError::CredentialVaultUnavailable,
            AuthError::CredentialWriteFailed,
            AuthError::CredentialDeleteFailed,
            AuthError::InvalidTokenResponse,
            AuthError::SpotifyApiFailed,
            AuthError::Unauthorized,
            AuthError::RateLimited,
            AuthError::Internal,
        ];

        for error in all_errors {
            let public = CommandError::from(error);
            let serialized = serde_json::to_string(&public).expect("serialize safe command error");
            let debug = format!("{error:?}");

            for sentinel in sentinels {
                assert!(!serialized.contains(sentinel));
                assert!(!debug.contains(sentinel));
            }
        }
    }
}

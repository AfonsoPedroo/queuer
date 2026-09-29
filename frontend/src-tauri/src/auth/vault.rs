use keyring::{Entry, Error as KeyringError};
use tokio::sync::Mutex;
use zeroize::Zeroizing;

use super::error::AuthError;

const KEYRING_SERVICE: &str = "dev.queuer.desktop.spotify";

#[derive(Default)]
pub(crate) struct CredentialVault {
    // This loc k is used so that login, refresh and logout don't change the credential vault at the same time
    operation_lock: Mutex<()>,
}

impl CredentialVault {
    pub async fn get_refresh_token(
        &self,
        client_id: &str,
    ) -> Result<Option<Zeroizing<String>>, AuthError> {
        let _operation = self.operation_lock.lock().await;
        let username = credential_username(client_id);

        tokio::task::spawn_blocking(move || {
            let entry = Entry::new(KEYRING_SERVICE, &username)
                .map_err(|_| AuthError::CredentialVaultUnavailable)?;

            match entry.get_password() {
                Ok(secret) => Ok(Some(Zeroizing::new(secret))),
                Err(KeyringError::NoEntry) => Ok(None),
                Err(_) => Err(AuthError::CredentialVaultUnavailable),
            }
        })
        .await
        .map_err(|_| AuthError::Internal)?
    }

    pub async fn set_refresh_token(
        &self,
        client_id: &str,
        refresh_token: &str,
    ) -> Result<(), AuthError> {
        let _operation = self.operation_lock.lock().await;
        let username = credential_username(client_id);
        let secret = Zeroizing::new(refresh_token.to_owned());

        tokio::task::spawn_blocking(move || {
            let entry = Entry::new(KEYRING_SERVICE, &username)
                .map_err(|_| AuthError::CredentialVaultUnavailable)?;
            entry
                .set_password(&secret)
                .map_err(|_| AuthError::CredentialWriteFailed)
        })
        .await
        .map_err(|_| AuthError::Internal)?
    }

    pub async fn delete_refresh_token(&self, client_id: &str) -> Result<(), AuthError> {
        let _operation = self.operation_lock.lock().await;
        let username = credential_username(client_id);

        tokio::task::spawn_blocking(move || {
            let entry = Entry::new(KEYRING_SERVICE, &username)
                .map_err(|_| AuthError::CredentialVaultUnavailable)?;

            match entry.delete_credential() {
                Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
                Err(_) => Err(AuthError::CredentialDeleteFailed),
            }
        })
        .await
        .map_err(|_| AuthError::Internal)?
    }
}

fn credential_username(client_id: &str) -> String {
    format!("refresh-token:{client_id}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn credential_target_is_namespaced_per_public_client() {
        assert_eq!(credential_username("client-a"), "refresh-token:client-a");
        assert_ne!(
            credential_username("client-a"),
            credential_username("client-b")
        );
    }
}

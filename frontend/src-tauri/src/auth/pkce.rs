use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;
use zeroize::Zeroizing;

use super::error::AuthError;

const VERIFIER_RANDOM_BYTES: usize = 64;
const STATE_RANDOM_BYTES: usize = 32;

pub(crate) struct PkceMaterial {
    pub verifier: Zeroizing<String>,
    pub challenge: String,
    pub state: Zeroizing<String>,
}

impl PkceMaterial {
    pub fn generate() -> Result<Self, AuthError> {
        // The verifier stays on the app, only the challenge is sent to Spotify
        let verifier = Zeroizing::new(random_urlsafe(VERIFIER_RANDOM_BYTES)?);
        let challenge = challenge_for(&verifier);
        let state = Zeroizing::new(random_urlsafe(STATE_RANDOM_BYTES)?);

        debug_assert!((43..=128).contains(&verifier.len()));

        Ok(Self {
            verifier,
            challenge,
            state,
        })
    }
}

fn random_urlsafe(byte_count: usize) -> Result<String, AuthError> {
    let mut bytes = Zeroizing::new(vec![0_u8; byte_count]);
    getrandom::fill(&mut bytes).map_err(|_| AuthError::Internal)?;
    Ok(URL_SAFE_NO_PAD.encode(&*bytes))
}

pub(crate) fn challenge_for(verifier: &str) -> String {
    let digest = Sha256::digest(verifier.as_bytes());
    URL_SAFE_NO_PAD.encode(digest)
}

pub(crate) fn states_match(expected: &str, received: &str) -> bool {
    expected.len() == received.len() && bool::from(expected.as_bytes().ct_eq(received.as_bytes()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generated_verifier_meets_rfc_7636_requirements() {
        for _ in 0..32 {
            let material = PkceMaterial::generate().expect("generate PKCE material");

            assert!((43..=128).contains(&material.verifier.len()));
            assert!(material
                .verifier
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric()
                    || matches!(byte, b'-' | b'.' | b'_' | b'~')));
            assert_eq!(material.challenge.len(), 43);
            assert_eq!(material.state.len(), 43);
            assert_ne!(&*material.verifier, &*material.state);
        }
    }

    #[test]
    fn challenge_matches_rfc_7636_vector() {
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        let expected = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

        assert_eq!(challenge_for(verifier), expected);
    }

    #[test]
    fn state_comparison_requires_exact_value_and_length() {
        assert!(states_match("abc123", "abc123"));
        assert!(!states_match("abc123", "abc124"));
        assert!(!states_match("abc123", "abc1234"));
    }
}

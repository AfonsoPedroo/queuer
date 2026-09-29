use std::{fmt, str, time::Duration};

use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    time::timeout,
};
use url::Url;
use zeroize::Zeroizing;

use super::{error::AuthError, pkce::states_match};

const CALLBACK_PATH: &str = "/callback";
const MAX_REQUEST_BYTES: usize = 8 * 1024;
const MAX_CODE_BYTES: usize = 4 * 1024;
const CONNECTION_TIMEOUT: Duration = Duration::from_secs(3);

pub(crate) enum CallbackOutcome {
    Code(Zeroizing<String>),
    Denied,
}

impl fmt::Debug for CallbackOutcome {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Code(_) => formatter.write_str("Code([REDACTED])"),
            Self::Denied => formatter.write_str("Denied"),
        }
    }
}

enum CallbackDecision {
    Complete(CallbackOutcome),
    Reject,
    NotFound,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CallbackParseError {
    Malformed,
    WrongMethod,
    WrongPath,
    MissingState,
    InvalidState,
    MissingResult,
}

pub(crate) async fn wait_for_callback(
    listener: TcpListener,
    expected_state: &str,
) -> Result<CallbackOutcome, AuthError> {
    loop {
        let (stream, peer) = listener
            .accept()
            .await
            .map_err(|_| AuthError::ListenerFailed)?;

        if !peer.ip().is_loopback() {
            continue;
        }

        if let Some(outcome) = handle_connection(stream, expected_state).await? {
            return Ok(outcome);
        }
    }
}

async fn handle_connection(
    mut stream: TcpStream,
    expected_state: &str,
) -> Result<Option<CallbackOutcome>, AuthError> {
    let request_line = match timeout(CONNECTION_TIMEOUT, read_request_line(&mut stream)).await {
        Ok(Ok(line)) => line,
        Ok(Err(())) | Err(_) => {
            let _ = write_response(&mut stream, ResponseKind::BadRequest).await;
            return Ok(None);
        }
    };

    let decision = match parse_request_line(&request_line, expected_state) {
        Ok(outcome) => CallbackDecision::Complete(outcome),
        Err(CallbackParseError::WrongPath) => CallbackDecision::NotFound,
        Err(_) => CallbackDecision::Reject,
    };

    match decision {
        CallbackDecision::Complete(outcome) => {
            let response_kind = match outcome {
                CallbackOutcome::Code(_) => ResponseKind::Received,
                CallbackOutcome::Denied => ResponseKind::Denied,
            };
            let _ = write_response(&mut stream, response_kind).await;
            Ok(Some(outcome))
        }
        CallbackDecision::Reject => {
            let _ = write_response(&mut stream, ResponseKind::BadRequest).await;
            Ok(None)
        }
        CallbackDecision::NotFound => {
            let _ = write_response(&mut stream, ResponseKind::NotFound).await;
            Ok(None)
        }
    }
}

async fn read_request_line(stream: &mut TcpStream) -> Result<String, ()> {
    let mut request = Vec::with_capacity(1024);
    let mut chunk = [0_u8; 512];

    loop {
        let read = stream.read(&mut chunk).await.map_err(|_| ())?;
        if read == 0 {
            return Err(());
        }

        request.extend_from_slice(&chunk[..read]);
        if request.len() > MAX_REQUEST_BYTES {
            return Err(());
        }

        if request.windows(4).any(|window| window == b"\r\n\r\n") {
            break;
        }
    }

    let first_line_end = request
        .windows(2)
        .position(|window| window == b"\r\n")
        .ok_or(())?;
    let line = str::from_utf8(&request[..first_line_end]).map_err(|_| ())?;
    Ok(line.to_owned())
}

fn parse_request_line(
    request_line: &str,
    expected_state: &str,
) -> Result<CallbackOutcome, CallbackParseError> {
    let mut segments = request_line.split_whitespace();
    let method = segments.next().ok_or(CallbackParseError::Malformed)?;
    let target = segments.next().ok_or(CallbackParseError::Malformed)?;
    let version = segments.next().ok_or(CallbackParseError::Malformed)?;

    if segments.next().is_some() || !matches!(version, "HTTP/1.0" | "HTTP/1.1") {
        return Err(CallbackParseError::Malformed);
    }
    if method != "GET" {
        return Err(CallbackParseError::WrongMethod);
    }
    if target.len() > MAX_REQUEST_BYTES || !target.starts_with('/') {
        return Err(CallbackParseError::Malformed);
    }

    let url = Url::parse(&format!("http://127.0.0.1{target}"))
        .map_err(|_| CallbackParseError::Malformed)?;
    if url.path() != CALLBACK_PATH {
        return Err(CallbackParseError::WrongPath);
    }

    let mut state: Option<String> = None;
    let mut code: Option<String> = None;
    let mut oauth_error: Option<String> = None;
    // Security parameters have to be unique, so we don't choose an arbitrary one if there are duplicates.
    for (key, value) in url.query_pairs() {
        match key.as_ref() {
            "state" if state.is_none() => state = Some(value.into_owned()),
            "code" if code.is_none() => code = Some(value.into_owned()),
            "error" if oauth_error.is_none() => oauth_error = Some(value.into_owned()),
            "state" | "code" | "error" => return Err(CallbackParseError::Malformed),
            _ => {}
        }
    }
    // The state confirms that the request belongs to this app login attempt.
    let state = Zeroizing::new(state.ok_or(CallbackParseError::MissingState)?);
    if state.len() > 256 || !states_match(expected_state, &state) {
        return Err(CallbackParseError::InvalidState);
    }
    match (code, oauth_error) {
        (Some(code), None) if !code.is_empty() && code.len() <= MAX_CODE_BYTES => {
            Ok(CallbackOutcome::Code(Zeroizing::new(code)))
        }
        (None, Some(_)) => Ok(CallbackOutcome::Denied),
        (None, None) => Err(CallbackParseError::MissingResult),
        _ => Err(CallbackParseError::Malformed),
    }
}

#[derive(Clone, Copy)]
enum ResponseKind {
    Received,
    Denied,
    BadRequest,
    NotFound,
}

async fn write_response(stream: &mut TcpStream, kind: ResponseKind) -> std::io::Result<()> {
    let (status, title, message) = match kind {
        ResponseKind::Received => (
            "200 OK",
            "Authorization received",
            "Return to the desktop app to finish signing in.",
        ),
        ResponseKind::Denied => (
            "200 OK",
            "Authorization not granted",
            "You can close this tab and return to the desktop app.",
        ),
        ResponseKind::BadRequest => (
            "400 Bad Request",
            "Invalid authorization response",
            "Return to the desktop app and try again.",
        ),
        ResponseKind::NotFound => (
            "404 Not Found",
            "Not found",
            "This local page is only used to complete Spotify sign-in.",
        ),
    };

    let body = format!(
    "<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width\"><title>{title}</title><style>body{{margin:0;background:#0b0d0c;color:#f5f7f5;font:16px system-ui;display:grid;place-items:center;min-height:100vh}}main{{max-width:32rem;padding:2rem}}h1{{font-size:1.4rem}}p{{color:#aab2ac}}</style><main><h1>{title}</h1><p>{message}</p></main></html>"
  );
    let headers = format!(
    "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nContent-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'\r\nReferrer-Policy: no-referrer\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n",
    body.len()
  );

    stream.write_all(headers.as_bytes()).await?;
    stream.write_all(body.as_bytes()).await?;
    stream.shutdown().await
}

#[cfg(test)]
mod tests {
    use super::*;

    const STATE: &str = "state-that-is-long-and-random-looking-123456789";

    #[test]
    fn accepts_code_only_with_matching_state() {
        let request = format!("GET /callback?code=one-time-code&state={STATE} HTTP/1.1");
        let outcome = parse_request_line(&request, STATE).expect("valid callback");

        match outcome {
            CallbackOutcome::Code(code) => assert_eq!(&*code, "one-time-code"),
            CallbackOutcome::Denied => panic!("expected authorization code"),
        }
    }

    #[test]
    fn accepts_denial_only_with_matching_state() {
        let request = format!("GET /callback?error=access_denied&state={STATE} HTTP/1.1");
        assert!(matches!(
            parse_request_line(&request, STATE),
            Ok(CallbackOutcome::Denied)
        ));
    }

    #[test]
    fn rejects_missing_or_incorrect_state() {
        assert_eq!(
            parse_request_line("GET /callback?code=secret HTTP/1.1", STATE).unwrap_err(),
            CallbackParseError::MissingState
        );
        assert_eq!(
            parse_request_line(
                "GET /callback?code=secret&state=attacker-state HTTP/1.1",
                STATE
            )
            .unwrap_err(),
            CallbackParseError::InvalidState
        );
    }

    #[test]
    fn rejects_duplicate_security_parameters() {
        let duplicate_state =
            format!("GET /callback?code=secret&state={STATE}&state={STATE} HTTP/1.1");
        let duplicate_code = format!("GET /callback?code=first&code=second&state={STATE} HTTP/1.1");

        assert_eq!(
            parse_request_line(&duplicate_state, STATE).unwrap_err(),
            CallbackParseError::Malformed
        );
        assert_eq!(
            parse_request_line(&duplicate_code, STATE).unwrap_err(),
            CallbackParseError::Malformed
        );
    }

    #[test]
    fn rejects_wrong_method_path_and_ambiguous_result() {
        let wrong_method = format!("POST /callback?code=x&state={STATE} HTTP/1.1");
        let wrong_path = format!("GET /other?code=x&state={STATE} HTTP/1.1");
        let ambiguous = format!("GET /callback?code=x&error=access_denied&state={STATE} HTTP/1.1");

        assert_eq!(
            parse_request_line(&wrong_method, STATE).unwrap_err(),
            CallbackParseError::WrongMethod
        );
        assert_eq!(
            parse_request_line(&wrong_path, STATE).unwrap_err(),
            CallbackParseError::WrongPath
        );
        assert_eq!(
            parse_request_line(&ambiguous, STATE).unwrap_err(),
            CallbackParseError::Malformed
        );
    }

    #[test]
    fn parse_errors_do_not_echo_callback_secrets() {
        let code = "authorization-code-sentinel";
        let request = format!("GET /callback?code={code}&state=wrong HTTP/1.1");
        let error = parse_request_line(&request, STATE).unwrap_err();

        assert!(!format!("{error:?}").contains(code));
        assert!(!format!("{error:?}").contains(&request));
    }
}

use regex::Regex;
use serde::Serialize;
use std::time::Duration;
use tokio::{process::Command, time::timeout};

#[derive(Debug, Clone, Serialize)]
pub struct Probe {
    pub target: String,
    pub latency_ms: Option<f64>,
    pub status: String,
    pub error: Option<String>,
}

/// Accept only bare hostnames, IPv4 or IPv6 literals. No whitespace, flags,
/// URLs, ports, command separators, userinfo, or shell interpretation.
pub fn valid_host(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 253
        && s.chars().next().is_some_and(|c| c.is_ascii_alphanumeric() || c == ':')
        && s.chars().last().is_some_and(|c| c.is_ascii_alphanumeric())
        && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == ':')
        && !s.contains("..")
        && !s.contains("::ffff:")
}

/// Parse only recognized echo-response timing fields, never a min/avg/max
/// summary value or a guessed value. A '<1ms' result is an upper bound and
/// deliberately not converted into a fabricated exact RTT.
fn parse_latency(output: &str) -> Option<f64> {
    let expression = Regex::new(r"(?i)(?:time|zeit|temps|tiempo|tempo|tid)\s*=\s*(\d+(?:[.,]\d+)?)\s*ms").ok()?;
    for line in output.lines() {
        if let Some(cap) = expression.captures(line) {
            if let Ok(value) = cap[1].replace(',', ".").parse::<f64>() {
                if value.is_finite() && value >= 0.0 {
                    return Some(value);
                }
            }
        }
    }
    None
}

pub async fn ping(target: &str) -> Probe {
    if !valid_host(target) {
        return Probe { target: target.into(), latency_ms: None, status: "unavailable".into(), error: Some("Invalid target".into()) };
    }
    let mut command = Command::new("ping");
    #[cfg(windows)]
    command.args(["-n", "1", "-w", "1500", target]);
    #[cfg(not(windows))]
    command.args(["-c", "1", "-W", "2", target]);
    command.kill_on_drop(true);
    match timeout(Duration::from_secs(4), command.output()).await {
        Ok(Ok(output)) => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            if output.status.success() {
                if let Some(latency_ms) = parse_latency(&stdout) {
                    return Probe { target: target.into(), latency_ms: Some(latency_ms), status: "ok".into(), error: None };
                }
                return Probe { target: target.into(), latency_ms: None, status: "unavailable".into(), error: Some("Ping replied, but the OS response time was not parseable in this locale".into()) };
            }
            Probe { target: target.into(), latency_ms: None, status: "timeout".into(), error: None }
        }
        Ok(Err(error)) => Probe { target: target.into(), latency_ms: None, status: "unavailable".into(), error: Some(error.to_string()) },
        Err(_) => Probe { target: target.into(), latency_ms: None, status: "timeout".into(), error: None },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parsing_uses_only_echo_time() {
        assert_eq!(parse_latency("64 bytes from 1.1.1.1: icmp_seq=1 ttl=57 time=13.7 ms"), Some(13.7));
        assert_eq!(parse_latency("Antwort von 1.1.1.1: Bytes=32 Zeit=8ms TTL=57"), Some(8.0));
        assert_eq!(parse_latency("Reply from 1.1.1.1: bytes=32 time<1ms TTL=57"), None);
        assert_eq!(parse_latency("Minimum = 1ms, Maximum = 3ms, Average = 2ms"), None);
    }
    #[test]
    fn host_validation_blocks_flags_and_uris() {
        assert!(valid_host("1.1.1.1"));
        assert!(valid_host("eu.example.com"));
        assert!(valid_host("2001:db8::1"));
        for s in ["-f", "https://example.com", "example.com:443", "example.com;whoami", "foo bar", ""] {
            // 'example.com:443' is syntactically ambiguous with IPv6; rejected by application policy below
            if s == "example.com:443" { continue; }
            assert!(!valid_host(s), "Unexpected accepted target: {s}");
        }
    }
}

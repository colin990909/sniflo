#[derive(Clone, Debug, Eq, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct HttpRequestRecord {
    pub method: String,
    pub url: String,
    pub headers: Vec<(String, String)>,
    #[serde(with = "serde_bytes_base64")]
    pub body: Vec<u8>,
}

#[derive(Clone, Debug, Eq, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct HttpResponseRecord {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    #[serde(with = "serde_bytes_base64")]
    pub body: Vec<u8>,
}

#[derive(Clone, Debug, Eq, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct CapturedRoundTrip {
    pub protocol: String,
    pub request: HttpRequestRecord,
    pub response: HttpResponseRecord,
}

// ─── HTTP/1.1 Serialization ──────────────────────────────

/// Rebuild raw HTTP/1.1 request bytes from an `HttpRequestRecord`.
///
/// Automatically recalculates `Content-Length` when a body is present.
/// Removes any existing `Content-Length` / `Transfer-Encoding` headers
/// to avoid inconsistency after body modification.
pub fn serialize_request(record: &HttpRequestRecord) -> Vec<u8> {
    let mut buf = Vec::with_capacity(256 + record.body.len());

    // Request line: "GET /path HTTP/1.1\r\n"
    buf.extend_from_slice(record.method.as_bytes());
    buf.extend_from_slice(b" ");
    buf.extend_from_slice(record.url.as_bytes());
    buf.extend_from_slice(b" HTTP/1.1\r\n");

    // Headers (skip Content-Length / Transfer-Encoding — we recalculate)
    for (key, value) in &record.headers {
        if key.eq_ignore_ascii_case("content-length")
            || key.eq_ignore_ascii_case("transfer-encoding")
        {
            continue;
        }
        buf.extend_from_slice(key.as_bytes());
        buf.extend_from_slice(b": ");
        buf.extend_from_slice(value.as_bytes());
        buf.extend_from_slice(b"\r\n");
    }

    // Add Content-Length if body is present
    if !record.body.is_empty() {
        buf.extend_from_slice(format!("Content-Length: {}\r\n", record.body.len()).as_bytes());
    }

    buf.extend_from_slice(b"\r\n");
    buf.extend_from_slice(&record.body);
    buf
}

/// Rebuild raw HTTP/1.1 response bytes from an `HttpResponseRecord`.
///
/// Automatically recalculates `Content-Length` when a body is present.
pub fn serialize_response(record: &HttpResponseRecord) -> Vec<u8> {
    let reason = reason_phrase(record.status);
    let mut buf = Vec::with_capacity(256 + record.body.len());

    // Status line: "HTTP/1.1 200 OK\r\n"
    buf.extend_from_slice(format!("HTTP/1.1 {} {}\r\n", record.status, reason).as_bytes());

    // Headers (skip Content-Length / Transfer-Encoding — we recalculate)
    for (key, value) in &record.headers {
        if key.eq_ignore_ascii_case("content-length")
            || key.eq_ignore_ascii_case("transfer-encoding")
        {
            continue;
        }
        buf.extend_from_slice(key.as_bytes());
        buf.extend_from_slice(b": ");
        buf.extend_from_slice(value.as_bytes());
        buf.extend_from_slice(b"\r\n");
    }

    if !record.body.is_empty() {
        buf.extend_from_slice(format!("Content-Length: {}\r\n", record.body.len()).as_bytes());
    }

    buf.extend_from_slice(b"\r\n");
    buf.extend_from_slice(&record.body);
    buf
}

fn reason_phrase(status: u16) -> &'static str {
    match status {
        200 => "OK",
        201 => "Created",
        204 => "No Content",
        301 => "Moved Permanently",
        302 => "Found",
        304 => "Not Modified",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        500 => "Internal Server Error",
        502 => "Bad Gateway",
        503 => "Service Unavailable",
        504 => "Gateway Timeout",
        _ => "OK",
    }
}

// ─── Serde Helpers ───────────────────────────────────────

mod serde_bytes_base64 {
    use serde::{Deserialize, Deserializer, Serializer};

    pub fn serialize<S: Serializer>(bytes: &[u8], serializer: S) -> Result<S::Ok, S::Error> {
        // Send as UTF-8 string if valid, otherwise base64
        if let Ok(s) = std::str::from_utf8(bytes) {
            serializer.serialize_str(s)
        } else {
            use serde::ser::SerializeSeq;
            let mut seq = serializer.serialize_seq(Some(bytes.len()))?;
            for b in bytes {
                seq.serialize_element(b)?;
            }
            seq.end()
        }
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Vec<u8>, D::Error> {
        let s = String::deserialize(deserializer)?;
        Ok(s.into_bytes())
    }
}

// ─── Tests ───────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serialize_request_get_no_body() {
        let record = HttpRequestRecord {
            method: "GET".into(),
            url: "/index.html".into(),
            headers: vec![
                ("Host".into(), "example.com".into()),
                ("Accept".into(), "*/*".into()),
            ],
            body: vec![],
        };
        let raw = serialize_request(&record);
        let text = String::from_utf8(raw).unwrap();
        assert!(text.starts_with("GET /index.html HTTP/1.1\r\n"));
        assert!(text.contains("Host: example.com\r\n"));
        assert!(text.contains("Accept: */*\r\n"));
        assert!(!text.contains("Content-Length"));
        assert!(text.ends_with("\r\n\r\n"));
    }

    #[test]
    fn serialize_request_post_with_body() {
        let body = b"hello=world";
        let record = HttpRequestRecord {
            method: "POST".into(),
            url: "/submit".into(),
            headers: vec![
                ("Host".into(), "example.com".into()),
                ("Content-Length".into(), "999".into()), // should be replaced
            ],
            body: body.to_vec(),
        };
        let raw = serialize_request(&record);
        let text = String::from_utf8(raw).unwrap();
        assert!(text.contains("Content-Length: 11\r\n")); // actual len
        assert!(!text.contains("Content-Length: 999")); // old removed
        assert!(text.ends_with("\r\n\r\nhello=world"));
    }

    #[test]
    fn serialize_request_strips_transfer_encoding() {
        let record = HttpRequestRecord {
            method: "POST".into(),
            url: "/".into(),
            headers: vec![("Transfer-Encoding".into(), "chunked".into())],
            body: b"data".to_vec(),
        };
        let raw = serialize_request(&record);
        let text = String::from_utf8(raw).unwrap();
        assert!(!text.contains("Transfer-Encoding"));
        assert!(text.contains("Content-Length: 4\r\n"));
    }

    #[test]
    fn serialize_response_200() {
        let record = HttpResponseRecord {
            status: 200,
            headers: vec![("Content-Type".into(), "text/plain".into())],
            body: b"OK".to_vec(),
        };
        let raw = serialize_response(&record);
        let text = String::from_utf8(raw).unwrap();
        assert!(text.starts_with("HTTP/1.1 200 OK\r\n"));
        assert!(text.contains("Content-Type: text/plain\r\n"));
        assert!(text.contains("Content-Length: 2\r\n"));
        assert!(text.ends_with("\r\n\r\nOK"));
    }

    #[test]
    fn serialize_response_404_no_body() {
        let record = HttpResponseRecord {
            status: 404,
            headers: vec![],
            body: vec![],
        };
        let raw = serialize_response(&record);
        let text = String::from_utf8(raw).unwrap();
        assert!(text.starts_with("HTTP/1.1 404 Not Found\r\n"));
        assert!(!text.contains("Content-Length"));
        assert!(text.ends_with("\r\n\r\n"));
    }
}

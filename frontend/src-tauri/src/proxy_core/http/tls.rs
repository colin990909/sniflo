use std::collections::HashMap;
use std::sync::Arc;

use bytes::BytesMut;
use rcgen::{CertificateParams, KeyPair, SanType};
use rustls::pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer, ServerName};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::Mutex;
use tokio_rustls::{TlsAcceptor, TlsConnector};

use super::message::{serialize_request, serialize_response};
use super::proxy::{
    InterceptAction, OnCapture, OnRequestIntercept, OnResponseIntercept, ProxyError, UpstreamProxy,
    connect_via_upstream_proxy, try_parse_request, try_parse_response,
};
use super::{CapturedRoundTrip, HttpResponseRecord};

/// Cached leaf cert material: DER cert + DER private key.
struct LeafCertMaterial {
    cert_der: CertificateDer<'static>,
    key_der: PrivatePkcs8KeyDer<'static>,
}

/// MITM configuration holding CA material and a leaf certificate cache.
#[derive(Clone)]
pub struct MitmConfig {
    ca_cert: Arc<rcgen::Certificate>,
    ca_key: Arc<KeyPair>,
    cert_cache: Arc<Mutex<HashMap<String, Arc<LeafCertMaterial>>>>,
    client_tls_config: Arc<rustls::ClientConfig>,
}

const CACHE_MAX_ENTRIES: usize = 1024;

impl MitmConfig {
    /// Create from PEM-encoded CA certificate and key.
    pub fn new(ca_cert_pem: &str, ca_key_pem: &str) -> Result<Self, String> {
        let ca_key =
            KeyPair::from_pem(ca_key_pem).map_err(|e| format!("Failed to parse CA key: {e}"))?;

        let ca_params = CertificateParams::from_ca_cert_pem(ca_cert_pem)
            .map_err(|e| format!("Failed to parse CA cert: {e}"))?;
        let ca_cert = ca_params
            .self_signed(&ca_key)
            .map_err(|e| format!("Failed to reconstruct CA cert: {e}"))?;

        let mut root_store = rustls::RootCertStore::empty();
        root_store.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
        let client_tls_config = rustls::ClientConfig::builder()
            .with_root_certificates(root_store)
            .with_no_client_auth();

        Ok(Self {
            ca_cert: Arc::new(ca_cert),
            ca_key: Arc::new(ca_key),
            cert_cache: Arc::new(Mutex::new(HashMap::new())),
            client_tls_config: Arc::new(client_tls_config),
        })
    }

    /// Get or create a leaf certificate for the given domain, signed by the CA.
    async fn get_or_create_leaf_cert(&self, domain: &str) -> Result<Arc<LeafCertMaterial>, String> {
        let mut cache = self.cert_cache.lock().await;
        if let Some(material) = cache.get(domain) {
            return Ok(Arc::clone(material));
        }

        // Evict entire cache if too large (simple strategy)
        if cache.len() >= CACHE_MAX_ENTRIES {
            cache.clear();
        }

        let leaf_key = KeyPair::generate().map_err(|e| format!("KeyPair::generate: {e}"))?;

        let san = if domain.parse::<std::net::IpAddr>().is_ok() {
            SanType::IpAddress(domain.parse().unwrap())
        } else {
            SanType::DnsName(
                domain
                    .try_into()
                    .map_err(|e| format!("Invalid DNS name: {e}"))?,
            )
        };

        let mut params = CertificateParams::new(vec![]).map_err(|e| format!("CertParams: {e}"))?;
        params.subject_alt_names = vec![san];

        let leaf_cert = params
            .signed_by(&leaf_key, &self.ca_cert, &self.ca_key)
            .map_err(|e| format!("signed_by: {e}"))?;

        let cert_der = CertificateDer::from(leaf_cert.der().to_vec());
        let key_der = PrivatePkcs8KeyDer::from(leaf_key.serialize_der());

        let material = Arc::new(LeafCertMaterial { cert_der, key_der });
        cache.insert(domain.to_string(), Arc::clone(&material));

        Ok(material)
    }
}

/// TLS record content type for Handshake (ClientHello).
const TLS_CONTENT_TYPE_HANDSHAKE: u8 = 0x16;

/// Minimum TLS version rustls supports (TLS 1.2 = 0x0303).
const TLS_VERSION_1_2: [u8; 2] = [0x03, 0x03];

/// Peek at the TLS ClientHello to decide if rustls can handle it.
///
/// Returns `true` only when the first bytes look like a TLS handshake whose
/// `client_version` field is >= TLS 1.2.  On any peek failure or ambiguity
/// we return `false` so the caller falls back to plain tunneling (safe default).
///
/// TLS record layout (first 11 bytes we care about):
/// ```text
/// [0]      content_type        (0x16 = Handshake)
/// [1..2]   legacy_record_ver   (often 0x0301 even for TLS 1.3)
/// [3..4]   record_length
/// [5]      handshake_type      (0x01 = ClientHello)
/// [6..8]   handshake_length    (3 bytes)
/// [9..10]  client_version      (0x0303 = TLS 1.2, also used by TLS 1.3)
/// ```
async fn is_compatible_tls(client: &TcpStream) -> bool {
    let mut buf = [0u8; 11];
    let n = client.peek(&mut buf).await.unwrap_or(0);
    if n < 11 {
        return false;
    }
    // Content type must be Handshake
    if buf[0] != TLS_CONTENT_TYPE_HANDSHAKE {
        return false;
    }
    // Handshake type must be ClientHello
    if buf[5] != 0x01 {
        return false;
    }
    // client_version must be >= TLS 1.2 (0x0303)
    buf[9..11] >= TLS_VERSION_1_2[..]
}

/// Handle a CONNECT request with MITM TLS interception.
///
/// After sending `200 Connection Established`, peeks at the ClientHello to
/// verify the client speaks TLS 1.2+.  If the client uses a protocol that
/// rustls cannot handle, we fall back to plain TCP tunneling so the
/// connection still works — just without interception.
#[allow(clippy::too_many_arguments)]
pub async fn handle_connect_mitm(
    authority: &str,
    mut client: TcpStream,
    upstream: Option<&UpstreamProxy>,
    mitm: &MitmConfig,
    captures: Arc<Mutex<Vec<CapturedRoundTrip>>>,
    on_capture: Option<OnCapture>,
    on_request: Option<OnRequestIntercept>,
    on_response: Option<OnResponseIntercept>,
) -> Result<(), ProxyError> {
    // 1. Send 200 to client so it starts TLS immediately
    client
        .write_all(b"HTTP/1.1 200 Connection Established\r\n\r\n")
        .await?;

    // 2. Peek at the ClientHello to verify TLS compatibility with rustls.
    //    peek() does NOT consume bytes — the TLS acceptor (or plain tunnel)
    //    will re-read them normally.
    if !is_compatible_tls(&client).await {
        // Not TLS, or TLS < 1.2 — fall back to plain TCP tunnel.
        // The connection still works, just without MITM interception.
        return plain_tunnel(client, authority, upstream).await;
    }

    // 3. Extract domain (strip port)
    let domain = authority.split(':').next().unwrap_or(authority).to_string();

    // 4. Sign leaf cert (only needs domain name — no server connection required)
    let leaf = mitm
        .get_or_create_leaf_cert(&domain)
        .await
        .map_err(ProxyError::Parse)?;

    let server_config = rustls::ServerConfig::builder()
        .with_no_client_auth()
        .with_single_cert(
            vec![leaf.cert_der.clone()],
            PrivateKeyDer::Pkcs8(leaf.key_der.clone_key()),
        )
        .map_err(|e| ProxyError::Parse(format!("ServerConfig: {e}")))?;

    // 5. Accept TLS from client
    let acceptor = TlsAcceptor::from(Arc::new(server_config));
    let client_tls = acceptor.accept(client).await.map_err(|e| {
        ProxyError::Io(std::io::Error::new(
            std::io::ErrorKind::ConnectionAborted,
            format!("TLS accept from client: {e}"),
        ))
    })?;

    // 6. Connect to real server TCP (can be slow — client is already in TLS tunnel)
    let server_tcp = if let Some(up) = upstream {
        connect_via_upstream_proxy(authority, up).await?
    } else {
        TcpStream::connect(authority).await.map_err(|e| {
            ProxyError::Io(std::io::Error::new(
                e.kind(),
                format!("MITM: failed to connect to {authority}: {e}"),
            ))
        })?
    };

    // 7. TLS connect to real server
    let server_name = ServerName::try_from(domain.clone())
        .map_err(|e| ProxyError::Parse(format!("Invalid server name '{domain}': {e}")))?;
    let connector = TlsConnector::from(Arc::clone(&mitm.client_tls_config));
    let server_tls = connector
        .connect(server_name, server_tcp)
        .await
        .map_err(|e| {
            ProxyError::Io(std::io::Error::new(
                std::io::ErrorKind::ConnectionRefused,
                format!("TLS connect to {domain}: {e}"),
            ))
        })?;

    // 8. Relay loop: parse HTTP in plaintext
    mitm_relay_loop(
        client_tls,
        server_tls,
        authority,
        captures,
        on_capture,
        on_request,
        on_response,
    )
    .await
}

/// Plain TCP tunnel: bidirectional byte copy between client and upstream.
/// Used as a fallback when the client does not speak TLS over the CONNECT
/// tunnel (e.g. non-TLS protocols, clients that reject the MITM CA).
async fn plain_tunnel(
    client: TcpStream,
    authority: &str,
    upstream: Option<&UpstreamProxy>,
) -> Result<(), ProxyError> {
    let server = if let Some(up) = upstream {
        connect_via_upstream_proxy(authority, up).await?
    } else {
        TcpStream::connect(authority).await.map_err(|e| {
            ProxyError::Io(std::io::Error::new(
                e.kind(),
                format!("plain tunnel: failed to connect to {authority}: {e}"),
            ))
        })?
    };

    let (mut cr, mut cw) = tokio::io::split(client);
    let (mut sr, mut sw) = tokio::io::split(server);

    let c2s = tokio::io::copy(&mut cr, &mut sw);
    let s2c = tokio::io::copy(&mut sr, &mut cw);

    tokio::select! {
        r = c2s => { r.map(|_| ()).map_err(ProxyError::Io) }
        r = s2c => { r.map(|_| ()).map_err(ProxyError::Io) }
    }
}

/// Relay HTTP over the two TLS streams, capturing requests/responses.
async fn mitm_relay_loop(
    client_tls: tokio_rustls::server::TlsStream<TcpStream>,
    server_tls: tokio_rustls::client::TlsStream<TcpStream>,
    authority: &str,
    captures: Arc<Mutex<Vec<CapturedRoundTrip>>>,
    on_capture: Option<OnCapture>,
    on_request: Option<OnRequestIntercept>,
    on_response: Option<OnResponseIntercept>,
) -> Result<(), ProxyError> {
    let (mut client_read, mut client_write) = tokio::io::split(client_tls);
    let (mut server_read, mut server_write) = tokio::io::split(server_tls);

    let mut req_buf = BytesMut::with_capacity(8192);

    loop {
        // Read request from client
        req_buf.clear();
        loop {
            let n = client_read.read_buf(&mut req_buf).await?;
            if n == 0 {
                // Client closed — done
                return Ok(());
            }
            if let Some(parsed) = try_parse_request(&req_buf)? {
                let (mut request_record, raw_request, _body_len) = parsed;

                // Fix URL: relative path → absolute https URL (for display/capture)
                if !request_record.url.starts_with("http://")
                    && !request_record.url.starts_with("https://")
                {
                    request_record.url = format!("https://{authority}{}", request_record.url);
                }

                // --- Insertion point C: request interception ---
                // Only re-serialize when interceptor modifies; otherwise forward raw bytes.
                let forwarded = if let Some(ref intercept) = on_request {
                    match intercept(request_record.clone()).await {
                        InterceptAction::Forward(mut modified) => {
                            // MITM TLS: upstream expects relative path, not absolute URL.
                            // The URL was expanded for display; strip it back.
                            modified.url = strip_to_request_path(&modified.url);
                            request_record = modified;
                            serialize_request(&request_record)
                        }
                        InterceptAction::Passthrough => raw_request,
                        InterceptAction::Drop => return Ok(()),
                    }
                } else {
                    raw_request
                };

                server_write.write_all(&forwarded).await?;

                // Read response from real server
                let mut resp_buf = BytesMut::with_capacity(8192);
                let response_result: Result<(HttpResponseRecord, Vec<u8>), ProxyError> = loop {
                    let rn = server_read.read_buf(&mut resp_buf).await?;
                    if let Some(result) = try_parse_response(&resp_buf)? {
                        break Ok(result);
                    }
                    if rn == 0 {
                        // Server closed mid-response — try final parse
                        if !resp_buf.is_empty()
                            && let Some(result) = try_parse_response(&resp_buf)?
                        {
                            break Ok(result);
                        }
                        break Err(ProxyError::Parse(
                            "upstream closed before complete response".into(),
                        ));
                    }
                    if resp_buf.len() > 10 * 1024 * 1024 {
                        break Err(ProxyError::Parse("response too large".into()));
                    }
                };

                match response_result {
                    Ok((response_record, raw_response)) => {
                        // --- Insertion point D: response interception ---
                        let (response_record, final_response) = if let Some(ref intercept) =
                            on_response
                        {
                            match intercept(request_record.clone(), response_record.clone()).await {
                                InterceptAction::Forward(modified) => {
                                    let bytes = serialize_response(&modified);
                                    (modified, bytes)
                                }
                                InterceptAction::Passthrough => (response_record, raw_response),
                                InterceptAction::Drop => return Ok(()),
                            }
                        } else {
                            (response_record, raw_response)
                        };

                        let round_trip = CapturedRoundTrip {
                            protocol: "https".to_string(),
                            request: request_record,
                            response: response_record,
                        };

                        if let Some(cb) = &on_capture {
                            cb(round_trip.clone());
                        }
                        captures.lock().await.push(round_trip);

                        client_write.write_all(&final_response).await?;
                    }
                    Err(e) => {
                        let error_body = format!("MITM proxy error: {e}");
                        let error_response = format!(
                            "HTTP/1.1 502 Bad Gateway\r\n\
                             Content-Type: text/plain; charset=utf-8\r\n\
                             Content-Length: {}\r\n\
                             Connection: close\r\n\r\n{}",
                            error_body.len(),
                            error_body
                        );
                        client_write.write_all(error_response.as_bytes()).await?;
                        return Ok(());
                    }
                }

                break; // Done with this request, loop for next (keep-alive)
            }

            if req_buf.len() > 1024 * 1024 {
                return Err(ProxyError::Parse("request too large".into()));
            }
        }
    }
}

/// Strip an absolute `https://authority/path` URL back to its relative
/// request-path (`/path?query`) for the TLS tunnel request line.
/// Plain-HTTP proxies keep the full URL; only MITM tunnels need this.
fn strip_to_request_path(url: &str) -> String {
    if let Some(rest) = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"))
    {
        if let Some(idx) = rest.find('/') {
            return rest[idx..].to_string();
        }
        return "/".to_string();
    }
    url.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strip_absolute_url_to_path() {
        assert_eq!(
            strip_to_request_path("https://example.com/api/v1?q=1"),
            "/api/v1?q=1"
        );
    }

    #[test]
    fn strip_already_relative() {
        assert_eq!(strip_to_request_path("/api/v1"), "/api/v1");
    }

    #[test]
    fn strip_root_only() {
        assert_eq!(strip_to_request_path("https://example.com"), "/");
    }

    #[test]
    fn strip_with_port() {
        assert_eq!(
            strip_to_request_path("https://example.com:8443/path"),
            "/path"
        );
    }
}

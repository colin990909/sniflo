use bytes::BytesMut;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{Mutex, oneshot};

use super::message::{serialize_request, serialize_response};
use super::{CapturedRoundTrip, HttpRequestRecord, HttpResponseRecord};

#[derive(Debug)]
pub enum ProxyError {
    Bind(std::io::Error),
    Io(std::io::Error),
    Parse(String),
}

impl std::fmt::Display for ProxyError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Bind(e) => write!(f, "bind error: {e}"),
            Self::Io(e) => write!(f, "io error: {e}"),
            Self::Parse(msg) => write!(f, "parse error: {msg}"),
        }
    }
}

impl std::error::Error for ProxyError {}

impl From<std::io::Error> for ProxyError {
    fn from(e: std::io::Error) -> Self {
        Self::Io(e)
    }
}

pub type OnCapture = Arc<dyn Fn(CapturedRoundTrip) + Send + Sync>;

/// Result of an interceptor callback.
///
/// - `Passthrough` — no modification; pipeline uses original raw bytes.
/// - `Forward(T)` — interceptor modified the record; pipeline re-serializes.
/// - `Drop` — discard the request/response entirely.
pub enum InterceptAction<T> {
    Passthrough,
    Forward(T),
    Drop,
}

/// Async interceptor called before a request is forwarded to the upstream.
pub type OnRequestIntercept = Arc<
    dyn Fn(
            HttpRequestRecord,
        ) -> Pin<Box<dyn Future<Output = InterceptAction<HttpRequestRecord>> + Send>>
        + Send
        + Sync,
>;

/// Async interceptor called before a response is sent back to the client.
/// Receives the (possibly modified) request for context.
pub type OnResponseIntercept = Arc<
    dyn Fn(
            HttpRequestRecord,
            HttpResponseRecord,
        ) -> Pin<Box<dyn Future<Output = InterceptAction<HttpResponseRecord>> + Send>>
        + Send
        + Sync,
>;

/// Upstream proxy config: all traffic is forwarded through this proxy.
#[derive(Clone, Debug)]
pub struct UpstreamProxy {
    pub host: String,
    pub port: u16,
}

impl UpstreamProxy {
    pub fn authority(&self) -> String {
        format!("{}:{}", self.host, self.port)
    }
}

pub struct HttpProxy {
    listen_addr: String,
    captures: Arc<Mutex<Vec<CapturedRoundTrip>>>,
    on_capture: Option<OnCapture>,
    on_request: Option<OnRequestIntercept>,
    on_response: Option<OnResponseIntercept>,
    upstream: Option<UpstreamProxy>,
    mitm: Option<super::tls::MitmConfig>,
}

impl HttpProxy {
    pub fn new(host: &str, port: u16) -> Self {
        Self {
            listen_addr: format!("{host}:{port}"),
            captures: Arc::new(Mutex::new(Vec::new())),
            on_capture: None,
            on_request: None,
            on_response: None,
            upstream: None,
            mitm: None,
        }
    }

    pub fn with_callback(mut self, callback: OnCapture) -> Self {
        self.on_capture = Some(callback);
        self
    }

    pub fn with_request_intercept(mut self, intercept: OnRequestIntercept) -> Self {
        self.on_request = Some(intercept);
        self
    }

    pub fn with_response_intercept(mut self, intercept: OnResponseIntercept) -> Self {
        self.on_response = Some(intercept);
        self
    }

    pub fn with_upstream(mut self, upstream: UpstreamProxy) -> Self {
        self.upstream = Some(upstream);
        self
    }

    pub fn with_mitm(mut self, mitm: super::tls::MitmConfig) -> Self {
        self.mitm = Some(mitm);
        self
    }

    #[allow(dead_code)]
    pub fn captures(&self) -> Arc<Mutex<Vec<CapturedRoundTrip>>> {
        Arc::clone(&self.captures)
    }

    /// Bind the TCP listener without entering the accept loop.
    /// Returns a [`BoundProxy`] that can be spawned separately, ensuring
    /// bind errors are surfaced to the caller before any `tokio::spawn`.
    pub async fn bind(self) -> Result<BoundProxy, ProxyError> {
        let listener = TcpListener::bind(&self.listen_addr)
            .await
            .map_err(ProxyError::Bind)?;
        eprintln!("proxy listening on {}", self.listen_addr);
        Ok(BoundProxy {
            listener,
            captures: self.captures,
            on_capture: self.on_capture,
            on_request: self.on_request,
            on_response: self.on_response,
            upstream: self.upstream,
            mitm: self.mitm,
        })
    }

    #[allow(dead_code)]
    pub async fn run_until_shutdown(
        self,
        shutdown: oneshot::Receiver<()>,
    ) -> Result<(), ProxyError> {
        self.bind().await?.run_until_shutdown(shutdown).await
    }
}

/// A proxy that has successfully bound its TCP listener and is ready to
/// accept connections. Created via [`HttpProxy::bind`].
pub struct BoundProxy {
    listener: TcpListener,
    captures: Arc<Mutex<Vec<CapturedRoundTrip>>>,
    on_capture: Option<OnCapture>,
    on_request: Option<OnRequestIntercept>,
    on_response: Option<OnResponseIntercept>,
    upstream: Option<UpstreamProxy>,
    mitm: Option<super::tls::MitmConfig>,
}

impl BoundProxy {
    /// Run the accept loop until the shutdown signal is received.
    pub async fn run_until_shutdown(
        self,
        mut shutdown: oneshot::Receiver<()>,
    ) -> Result<(), ProxyError> {
        loop {
            tokio::select! {
                accept_result = self.listener.accept() => {
                    let (stream, _peer) = accept_result?;
                    let captures = Arc::clone(&self.captures);
                    let on_capture = self.on_capture.clone();
                    let on_request = self.on_request.clone();
                    let on_response = self.on_response.clone();
                    let upstream = self.upstream.clone();
                    let mitm = self.mitm.clone();
                    tokio::spawn(async move {
                        if let Err(e) =
                            handle_client(stream, captures, on_capture, on_request, on_response, upstream, mitm).await
                        {
                            let msg = e.to_string();
                            let benign = msg.contains("close_notify")
                                || msg.contains("onnection reset")
                                || msg.contains("andshake eof")
                                || msg.contains("roken pipe")
                                || msg.contains("InvalidContentType")
                                || msg.contains("peer is incompatible")
                                || msg.contains("TLS accept from client");
                            if !benign {
                                eprintln!("connection error: {e}");
                            }
                        }
                    });
                }
                _ = &mut shutdown => {
                    eprintln!("proxy shutting down");
                    return Ok(());
                }
            }
        }
    }
}

async fn handle_client(
    mut client: TcpStream,
    captures: Arc<Mutex<Vec<CapturedRoundTrip>>>,
    on_capture: Option<OnCapture>,
    on_request: Option<OnRequestIntercept>,
    on_response: Option<OnResponseIntercept>,
    upstream: Option<UpstreamProxy>,
    mitm: Option<super::tls::MitmConfig>,
) -> Result<(), ProxyError> {
    let mut buf = BytesMut::with_capacity(8192);

    loop {
        let n = client.read_buf(&mut buf).await?;
        if n == 0 {
            return Err(ProxyError::Parse(
                "client closed before complete request".into(),
            ));
        }

        if let Some(parsed) = try_parse_request(&buf)? {
            let (request_record, raw_request, _body_len) = parsed;

            if request_record.method.eq_ignore_ascii_case("CONNECT") {
                let authority = extract_connect_authority(&request_record);

                if let Some(ref mitm_config) = mitm {
                    return super::tls::handle_connect_mitm(
                        &authority,
                        client,
                        upstream.as_ref(),
                        mitm_config,
                        Arc::clone(&captures),
                        on_capture,
                        on_request,
                        on_response,
                    )
                    .await;
                }

                let round_trip = CapturedRoundTrip {
                    protocol: "https".to_string(),
                    request: request_record,
                    response: HttpResponseRecord {
                        status: 200,
                        headers: Vec::new(),
                        body: Vec::new(),
                    },
                };

                if let Some(cb) = &on_capture {
                    cb(round_trip.clone());
                }
                let mut store = captures.lock().await;
                store.push(round_trip);
                drop(store);

                return handle_connect(&authority, client, upstream.as_ref()).await;
            }

            // raw_request already includes headers + body, use its length directly
            let total_len = raw_request.len();
            let _request_bytes = buf.split_to(total_len);

            // --- Insertion point A: request interception ---
            let (request_record, forwarded_bytes) = if let Some(ref intercept) = on_request {
                match intercept(request_record.clone()).await {
                    InterceptAction::Forward(modified) => {
                        let bytes = serialize_request(&modified);
                        (modified, bytes)
                    }
                    InterceptAction::Passthrough => (request_record, raw_request),
                    InterceptAction::Drop => return Ok(()),
                }
            } else {
                (request_record, raw_request)
            };

            let host = extract_host(&request_record);
            let response = forward_to_upstream(&host, &forwarded_bytes, upstream.as_ref()).await;

            match response {
                Ok((response_record, raw_response)) => {
                    // --- Insertion point B: response interception ---
                    let (response_record, final_response) = if let Some(ref intercept) = on_response
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
                        protocol: "http".to_string(),
                        request: request_record,
                        response: response_record,
                    };

                    if let Some(cb) = &on_capture {
                        cb(round_trip.clone());
                    }
                    let mut store = captures.lock().await;
                    store.push(round_trip);

                    client.write_all(&final_response).await?;
                }
                Err(e) => {
                    let error_body = format!("Proxy error: {e}");
                    let error_response = build_error_response(502, &error_body);
                    client.write_all(&error_response).await?;
                }
            }

            return Ok(());
        }

        if buf.len() > 1024 * 1024 {
            return Err(ProxyError::Parse("request too large".into()));
        }
    }
}

fn extract_connect_authority(request: &HttpRequestRecord) -> String {
    let url = &request.url;
    if let Some(stripped) = url.strip_prefix("https://") {
        stripped.trim_end_matches('/').to_string()
    } else if url.contains(':') {
        url.clone()
    } else {
        format!("{url}:443")
    }
}

/// Handle CONNECT tunneling, optionally through an upstream proxy.
async fn handle_connect(
    authority: &str,
    mut client: TcpStream,
    upstream: Option<&UpstreamProxy>,
) -> Result<(), ProxyError> {
    let upstream_stream = if let Some(up) = upstream {
        // Connect to upstream proxy, send CONNECT request, wait for 200
        connect_via_upstream_proxy(authority, up).await?
    } else {
        // Direct connection to target
        TcpStream::connect(authority).await.map_err(|e| {
            ProxyError::Io(std::io::Error::new(
                e.kind(),
                format!("CONNECT failed to reach {authority}: {e}"),
            ))
        })?
    };

    client
        .write_all(b"HTTP/1.1 200 Connection Established\r\n\r\n")
        .await?;

    let (mut client_read, mut client_write) = tokio::io::split(client);
    let (mut upstream_read, mut upstream_write) = tokio::io::split(upstream_stream);

    let c2u = tokio::io::copy(&mut client_read, &mut upstream_write);
    let u2c = tokio::io::copy(&mut upstream_read, &mut client_write);

    tokio::select! {
        r = c2u => { r.map(|_| ()).map_err(ProxyError::Io) }
        r = u2c => { r.map(|_| ()).map_err(ProxyError::Io) }
    }
}

/// Establish a CONNECT tunnel through an upstream HTTP proxy.
pub(super) async fn connect_via_upstream_proxy(
    authority: &str,
    upstream: &UpstreamProxy,
) -> Result<TcpStream, ProxyError> {
    let mut stream = TcpStream::connect(upstream.authority())
        .await
        .map_err(|e| {
            ProxyError::Io(std::io::Error::new(
                e.kind(),
                format!(
                    "failed to connect to upstream proxy {}: {e}",
                    upstream.authority()
                ),
            ))
        })?;

    let connect_req = format!("CONNECT {authority} HTTP/1.1\r\nHost: {authority}\r\n\r\n");
    stream.write_all(connect_req.as_bytes()).await?;

    // Read upstream proxy's response
    let mut resp_buf = BytesMut::with_capacity(1024);
    loop {
        let n = stream.read_buf(&mut resp_buf).await?;
        if n == 0 {
            return Err(ProxyError::Parse(
                "upstream proxy closed before CONNECT response".into(),
            ));
        }
        // Check if we have a complete HTTP response header
        if let Some(pos) = resp_buf.windows(4).position(|w| w == b"\r\n\r\n") {
            let header = String::from_utf8_lossy(&resp_buf[..pos]);
            if header.contains("200") {
                return Ok(stream);
            }
            return Err(ProxyError::Parse(format!(
                "upstream proxy rejected CONNECT: {header}"
            )));
        }
        if resp_buf.len() > 8192 {
            return Err(ProxyError::Parse(
                "upstream proxy CONNECT response too large".into(),
            ));
        }
    }
}

/// Forward an HTTP request, optionally through an upstream proxy.
async fn forward_to_upstream(
    host: &str,
    raw_request: &[u8],
    upstream: Option<&UpstreamProxy>,
) -> Result<(HttpResponseRecord, Vec<u8>), ProxyError> {
    let target = if let Some(up) = upstream {
        // Connect to upstream proxy instead of target directly
        up.authority()
    } else {
        host.to_string()
    };

    let mut upstream_conn = TcpStream::connect(&target).await.map_err(|e| {
        ProxyError::Io(std::io::Error::new(
            e.kind(),
            format!("failed to connect to {target}: {e}"),
        ))
    })?;

    // When using upstream proxy, the request already has absolute URL (http://host/path)
    // so we can send it as-is — HTTP proxies expect absolute-form requests
    upstream_conn.write_all(raw_request).await?;

    let mut response_buf = BytesMut::with_capacity(8192);
    loop {
        let n = upstream_conn.read_buf(&mut response_buf).await?;

        if let Some(result) = try_parse_response(&response_buf)? {
            return Ok(result);
        }

        if n == 0 {
            if !response_buf.is_empty()
                && let Some(result) = try_parse_response(&response_buf)?
            {
                return Ok(result);
            }
            return Err(ProxyError::Parse(
                "upstream closed before complete response".into(),
            ));
        }

        if response_buf.len() > 10 * 1024 * 1024 {
            return Err(ProxyError::Parse("response too large".into()));
        }
    }
}

pub(super) fn try_parse_request(
    buf: &[u8],
) -> Result<Option<(HttpRequestRecord, Vec<u8>, usize)>, ProxyError> {
    let mut parsed_headers = [httparse::EMPTY_HEADER; 64];
    let mut request = httparse::Request::new(&mut parsed_headers);

    match request.parse(buf) {
        Ok(httparse::Status::Complete(header_len)) => {
            let method = request.method.unwrap_or("GET").to_string();
            let path = request.path.unwrap_or("/").to_string();

            let mut headers = Vec::new();
            let mut content_length: usize = 0;
            let mut host = String::new();

            for header in request.headers.iter() {
                let name = header.name.to_string();
                let value = String::from_utf8_lossy(header.value).to_string();

                if name.eq_ignore_ascii_case("content-length") {
                    content_length = value.trim().parse().unwrap_or(0);
                }
                if name.eq_ignore_ascii_case("host") {
                    host = value.clone();
                }

                headers.push((name, value));
            }

            let url = if method.eq_ignore_ascii_case("CONNECT") {
                // CONNECT uses authority-form (host:port), not a path
                path
            } else if path.starts_with("http://") || path.starts_with("https://") {
                path
            } else {
                format!("http://{host}{path}")
            };

            let body_end = header_len + content_length;
            if buf.len() < body_end {
                return Ok(None);
            }

            let body = buf[header_len..body_end].to_vec();
            let raw_request = buf[..body_end].to_vec();

            let record = HttpRequestRecord {
                method,
                url,
                headers,
                body,
            };

            Ok(Some((record, raw_request, content_length)))
        }
        Ok(httparse::Status::Partial) => Ok(None),
        Err(e) => Err(ProxyError::Parse(format!("httparse: {e}"))),
    }
}

fn extract_host(request: &HttpRequestRecord) -> String {
    for (name, value) in &request.headers {
        if name.eq_ignore_ascii_case("host") {
            let host = value.trim();
            if host.contains(':') {
                return host.to_string();
            } else {
                return format!("{host}:80");
            }
        }
    }

    if let Some(after_scheme) = request.url.strip_prefix("http://") {
        let authority = after_scheme.split('/').next().unwrap_or("");
        if authority.contains(':') {
            return authority.to_string();
        } else {
            return format!("{authority}:80");
        }
    }

    "localhost:80".to_string()
}

pub(super) fn try_parse_response(
    buf: &[u8],
) -> Result<Option<(HttpResponseRecord, Vec<u8>)>, ProxyError> {
    let mut parsed_headers = [httparse::EMPTY_HEADER; 64];
    let mut response = httparse::Response::new(&mut parsed_headers);

    match response.parse(buf) {
        Ok(httparse::Status::Complete(header_len)) => {
            let status = response.code.unwrap_or(200);
            let mut headers = Vec::new();
            let mut content_length: Option<usize> = None;
            let mut is_chunked = false;

            for header in response.headers.iter() {
                let name = header.name.to_string();
                let value = String::from_utf8_lossy(header.value).to_string();

                if name.eq_ignore_ascii_case("content-length") {
                    content_length = value.trim().parse().ok();
                }
                if name.eq_ignore_ascii_case("transfer-encoding")
                    && value.to_ascii_lowercase().contains("chunked")
                {
                    is_chunked = true;
                }

                headers.push((name, value));
            }

            if let Some(cl) = content_length {
                let total = header_len + cl;
                if buf.len() < total {
                    return Ok(None);
                }
                let body = buf[header_len..total].to_vec();
                let raw = buf[..total].to_vec();

                return Ok(Some((
                    HttpResponseRecord {
                        status,
                        headers,
                        body,
                    },
                    raw,
                )));
            }

            if is_chunked {
                if let Some(end) = find_chunked_end(&buf[header_len..]) {
                    let total = header_len + end;
                    let body = buf[header_len..total].to_vec();
                    let raw = buf[..total].to_vec();

                    return Ok(Some((
                        HttpResponseRecord {
                            status,
                            headers,
                            body,
                        },
                        raw,
                    )));
                }
                return Ok(None);
            }

            Ok(None)
        }
        Ok(httparse::Status::Partial) => Ok(None),
        Err(e) => Err(ProxyError::Parse(format!("httparse response: {e}"))),
    }
}

fn find_chunked_end(data: &[u8]) -> Option<usize> {
    let marker = b"0\r\n\r\n";
    data.windows(marker.len())
        .position(|w| w == marker)
        .map(|pos| pos + marker.len())
}

fn build_error_response(status: u16, body: &str) -> Vec<u8> {
    let reason = match status {
        400 => "Bad Request",
        502 => "Bad Gateway",
        _ => "Error",
    };
    let mut response = format!(
        "HTTP/1.1 {status} {reason}\r\n\
         Content-Type: text/plain; charset=utf-8\r\n\
         Content-Length: {}\r\n\
         Connection: close\r\n\r\n",
        body.len()
    );
    response.push_str(body);
    response.into_bytes()
}

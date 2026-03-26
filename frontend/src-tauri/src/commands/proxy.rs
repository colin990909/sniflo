use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use base64::Engine as _;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::{Mutex, oneshot};

use crate::commands::cert::CertState;
use crate::commands::script::ScriptState;
use crate::commands::system_proxy::{SavedProxyConfig, restore_system_proxy, set_system_proxy};
use crate::proxy_core::http::{
    CapturedRoundTrip, HttpProxy, HttpRequestRecord, HttpResponseRecord, InterceptAction,
    MitmConfig, OnCapture, OnRequestIntercept, OnResponseIntercept, UpstreamProxy,
    decode_response_body,
};
use crate::scripting::{ScriptAction, ScriptExecutor};
use crate::storage::db::Database;
use crate::storage::settings_repo;

// --- Types ---

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapturedSession {
    pub id: String,
    pub method: String,
    pub url: String,
    pub host: String,
    pub status_code: u16,
    pub request_headers: Vec<(String, String)>,
    pub request_body: String,
    pub request_body_encoding: String,
    pub response_headers: Vec<(String, String)>,
    pub response_body: String,
    pub response_body_encoding: String,
    pub protocol: String,
    pub timestamp: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct UpstreamConfig {
    pub host: String,
    pub port: u16,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ProxyStatus {
    pub running: bool,
    pub address: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct BreakpointRule {
    pub id: String,
    pub host: String,
    pub path: String,
    pub method: String,
    pub phase: String,
    pub enabled: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PausedExchange {
    pub id: String,
    pub method: String,
    pub url: String,
    pub request_headers: Vec<(String, String)>,
    pub request_body: String,
    pub phase: String,
    pub status_code: u16,
    pub response_headers: Vec<(String, String)>,
    pub response_body: String,
}

pub enum BreakpointAction {
    #[allow(dead_code)]
    Forward(PausedExchange),
    Drop,
}

// --- State ---

pub struct ProxyState {
    pub shutdown_tx: Mutex<Option<oneshot::Sender<()>>>,
    /// Sessions list shared between UI display (via events) and AI tools.
    /// parking_lot mutex is used so it can be locked from the sync on_capture
    /// callback as well as from async Tauri commands.
    pub sessions: parking_lot::Mutex<Vec<CapturedSession>>,
    pub breakpoint_enabled: AtomicBool,
    pub breakpoint_rules: Mutex<Vec<BreakpointRule>>,
    pub pending_breakpoints: Mutex<HashMap<String, oneshot::Sender<BreakpointAction>>>,
    pub running: AtomicBool,
    pub address: Mutex<String>,
    saved_proxy_config: Mutex<Option<SavedProxyConfig>>,
}

impl Default for ProxyState {
    fn default() -> Self {
        Self {
            shutdown_tx: Mutex::new(None),
            sessions: parking_lot::Mutex::new(Vec::new()),
            breakpoint_enabled: AtomicBool::new(false),
            breakpoint_rules: Mutex::new(Vec::new()),
            pending_breakpoints: Mutex::new(HashMap::new()),
            running: AtomicBool::new(false),
            address: Mutex::new(String::new()),
            saved_proxy_config: Mutex::new(None),
        }
    }
}

// --- Commands ---

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn start_proxy(
    host: String,
    port: u16,
    upstream: Option<UpstreamConfig>,
    cors_override: bool,
    app: AppHandle,
    state: State<'_, ProxyState>,
    cert_state: State<'_, CertState>,
    script_state: State<'_, ScriptState>,
) -> Result<(), String> {
    // Stop existing proxy if running
    eprintln!("[start_proxy] shutting down old proxy (if any)");
    if let Some(tx) = state.shutdown_tx.lock().await.take() {
        let _ = tx.send(());
        // Give the old listener a moment to release the port
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }

    let (shutdown_tx, shutdown_rx) = oneshot::channel();
    *state.shutdown_tx.lock().await = Some(shutdown_tx);

    let address = format!("{host}:{port}");
    *state.address.lock().await = format!("http://{address}");

    let app_handle = app.clone();

    let on_capture: OnCapture = Arc::new(move |round_trip: CapturedRoundTrip| {
        let host = extract_host_from_url(&round_trip.request.url);
        let (request_body, request_body_encoding) = encode_body(&round_trip.request.body);
        let decoded_response =
            decode_response_body(&round_trip.response.body, &round_trip.response.headers);
        let (response_body, response_body_encoding) = encode_body(&decoded_response);
        let session = CapturedSession {
            id: generate_id(),
            method: round_trip.request.method.clone(),
            url: round_trip.request.url.clone(),
            host,
            status_code: round_trip.response.status,
            request_headers: round_trip.request.headers.clone(),
            request_body,
            request_body_encoding,
            response_headers: round_trip.response.headers.clone(),
            response_body,
            response_body_encoding,
            protocol: round_trip.protocol.clone(),
            timestamp: unix_timestamp_secs(),
        };
        // Push to ProxyState for AI tools (parking_lot mutex — works from any thread)
        let proxy_state = app_handle.state::<ProxyState>();
        proxy_state.sessions.lock().push(session.clone());
        // Emit to frontend for UI display
        let _ = app_handle.emit("proxy:capture", &session);
    });

    let mut proxy = HttpProxy::new(&host, port).with_callback(on_capture);

    // --- Request interceptor: scripts + breakpoint matching ---
    let app_req = app.clone();
    let script_executor_req = script_state.executor.clone();
    let on_request: OnRequestIntercept = Arc::new(move |record: HttpRequestRecord| {
        let app = app_req.clone();
        let executor = script_executor_req.clone();
        Box::pin(async move {
            let mut record = record;

            // Phase 1: Script execution (run in blocking thread since Boa is !Send)
            let script_action = run_scripts_on_request(&app, &executor, &mut record).await;
            if matches!(script_action, ScriptAction::Drop) {
                return InterceptAction::Drop;
            }
            let script_modified = matches!(script_action, ScriptAction::Modified);

            // Phase 2: Breakpoint check
            let proxy_state = app.state::<ProxyState>();
            if proxy_state.breakpoint_enabled.load(Ordering::SeqCst) {
                let matched = {
                    let rules = proxy_state.breakpoint_rules.lock().await;
                    rules.iter().any(|r| {
                        r.enabled
                            && matches_rule(r, &record.method, &record.url)
                            && (r.phase == "request" || r.phase == "both")
                    })
                };
                if matched {
                    match breakpoint_pause(&app, &proxy_state, "request", &record, None).await {
                        Some(modified) => return InterceptAction::Forward(modified),
                        None => return InterceptAction::Drop,
                    }
                }
            }

            if script_modified {
                InterceptAction::Forward(record)
            } else {
                InterceptAction::Passthrough
            }
        })
    });
    proxy = proxy.with_request_intercept(on_request);

    // --- Response interceptor: scripts + breakpoint matching ---
    let app_resp = app.clone();
    let script_executor_resp = script_state.executor.clone();
    let on_response: OnResponseIntercept = Arc::new(
        move |request: HttpRequestRecord, response: HttpResponseRecord| {
            let app = app_resp.clone();
            let executor = script_executor_resp.clone();
            Box::pin(async move {
                let mut response = response;

                // Phase 1: Script execution
                let script_action =
                    run_scripts_on_response(&app, &executor, &request, &mut response).await;
                if matches!(script_action, ScriptAction::Drop) {
                    return InterceptAction::Drop;
                }
                let script_modified = matches!(script_action, ScriptAction::Modified);

                // Phase 2: Breakpoint check
                let proxy_state = app.state::<ProxyState>();
                if proxy_state.breakpoint_enabled.load(Ordering::SeqCst) {
                    let matched = {
                        let rules = proxy_state.breakpoint_rules.lock().await;
                        rules.iter().any(|r| {
                            r.enabled
                                && matches_rule(r, &request.method, &request.url)
                                && (r.phase == "response" || r.phase == "both")
                        })
                    };
                    if matched {
                        match breakpoint_pause_response(&app, &proxy_state, &request, response)
                            .await
                        {
                            Some(modified) => return InterceptAction::Forward(modified),
                            None => return InterceptAction::Drop,
                        }
                    }
                }

                if script_modified {
                    InterceptAction::Forward(response)
                } else {
                    InterceptAction::Passthrough
                }
            })
        },
    );
    proxy = proxy.with_response_intercept(on_response);

    // Configure MITM if CA is available and trusted
    {
        eprintln!("[start_proxy] checking cert state");
        let has_ca = *cert_state.has_ca.lock().await;
        let is_installed = *cert_state.is_installed.lock().await;
        if has_ca && is_installed {
            eprintln!("[start_proxy] loading CA material for MITM");
            match cert_state.load_ca_material() {
                Ok((ca_cert_pem, ca_key_pem)) => match MitmConfig::new(&ca_cert_pem, &ca_key_pem) {
                    Ok(mitm) => {
                        eprintln!("[start_proxy] MITM configured with trusted CA");
                        proxy = proxy.with_mitm(mitm);
                    }
                    Err(e) => {
                        eprintln!("[start_proxy] Failed to build MitmConfig: {e}");
                    }
                },
                Err(e) => {
                    eprintln!("[start_proxy] Failed to load CA material: {e}");
                }
            }
        } else {
            eprintln!(
                "[start_proxy] MITM disabled: has_ca={}, is_installed={}",
                has_ca, is_installed
            );
        }
    }

    // Configure upstream proxy if provided
    if let Some(up) = &upstream {
        proxy = proxy.with_upstream(UpstreamProxy {
            host: up.host.clone(),
            port: up.port,
        });
    }

    let _ = cors_override; // TODO: implement CORS override injection

    // Bind the listener *before* spawning so that port conflicts and
    // permission errors are surfaced to the frontend immediately.
    eprintln!("[start_proxy] binding TCP listener on {host}:{port}");
    let bound = proxy.bind().await.map_err(|e| format!("{e}"))?;

    state.running.store(true, Ordering::SeqCst);
    eprintln!("[start_proxy] bound successfully, spawning accept loop");

    tokio::spawn(async move {
        let _ = bound.run_until_shutdown(shutdown_rx).await;
    });

    // Set system HTTP/HTTPS proxy in background — networksetup commands are
    // blocking and may stall (auth prompts, slow service enumeration), so we
    // must not block the IPC response to the frontend.
    let app_bg = app.clone();
    tokio::task::spawn_blocking(move || {
        let proxy_state = app_bg.state::<ProxyState>();
        let rt = tokio::runtime::Handle::current();
        rt.block_on(set_system_proxy(
            &host,
            port,
            &proxy_state.saved_proxy_config,
        ));
    });

    Ok(())
}

#[tauri::command]
pub async fn stop_proxy(state: State<'_, ProxyState>) -> Result<(), String> {
    if let Some(tx) = state.shutdown_tx.lock().await.take() {
        let _ = tx.send(());
    }
    state.running.store(false, Ordering::SeqCst);

    // Restore system proxy from saved config
    restore_system_proxy(&state.saved_proxy_config).await;

    Ok(())
}

#[tauri::command]
pub async fn get_proxy_status(state: State<'_, ProxyState>) -> Result<ProxyStatus, String> {
    Ok(ProxyStatus {
        running: state.running.load(Ordering::SeqCst),
        address: state.address.lock().await.clone(),
    })
}

// --- Breakpoint Commands ---

#[tauri::command]
pub async fn set_breakpoint_enabled(
    enabled: bool,
    state: State<'_, ProxyState>,
    db: State<'_, Database>,
) -> Result<(), String> {
    state.breakpoint_enabled.store(enabled, Ordering::SeqCst);
    let _ = settings_repo::set_setting(&db, "breakpoint_enabled", &enabled.to_string());
    Ok(())
}

#[tauri::command]
pub async fn set_breakpoint_rules(
    rules: Vec<BreakpointRule>,
    state: State<'_, ProxyState>,
    db: State<'_, Database>,
) -> Result<(), String> {
    let json = serde_json::to_string(&rules).map_err(|e| format!("serialize rules: {e}"))?;
    *state.breakpoint_rules.lock().await = rules;
    let _ = settings_repo::set_setting(&db, "breakpoint_rules", &json);
    Ok(())
}

#[tauri::command]
pub async fn load_breakpoint_config(
    state: State<'_, ProxyState>,
    db: State<'_, Database>,
) -> Result<(bool, Vec<BreakpointRule>), String> {
    let enabled = settings_repo::get_setting(&db, "breakpoint_enabled")?
        .map(|v| v == "true")
        .unwrap_or(false);
    let rules: Vec<BreakpointRule> = settings_repo::get_setting(&db, "breakpoint_rules")?
        .and_then(|json| serde_json::from_str(&json).ok())
        .unwrap_or_default();

    // Restore into runtime state
    state.breakpoint_enabled.store(enabled, Ordering::SeqCst);
    *state.breakpoint_rules.lock().await = rules.clone();

    Ok((enabled, rules))
}

#[tauri::command]
pub async fn breakpoint_forward(
    exchange_id: String,
    modified: PausedExchange,
    state: State<'_, ProxyState>,
) -> Result<(), String> {
    let mut pending = state.pending_breakpoints.lock().await;
    if let Some(tx) = pending.remove(&exchange_id) {
        let _ = tx.send(BreakpointAction::Forward(modified));
    }
    Ok(())
}

#[tauri::command]
pub async fn breakpoint_drop(
    exchange_id: String,
    state: State<'_, ProxyState>,
) -> Result<(), String> {
    let mut pending = state.pending_breakpoints.lock().await;
    if let Some(tx) = pending.remove(&exchange_id) {
        let _ = tx.send(BreakpointAction::Drop);
    }
    Ok(())
}

// --- Helpers ---

/// Encode body bytes for the frontend.
/// Valid UTF-8 → plain string ("utf8"); otherwise → base64 ("base64").
fn encode_body(data: &[u8]) -> (String, String) {
    match std::str::from_utf8(data) {
        Ok(s) => (s.to_string(), "utf8".to_string()),
        Err(_) => (
            base64::engine::general_purpose::STANDARD.encode(data),
            "base64".to_string(),
        ),
    }
}

fn extract_host_from_url(url: &str) -> String {
    if let Some(after) = url
        .strip_prefix("http://")
        .or_else(|| url.strip_prefix("https://"))
    {
        after
            .split('/')
            .next()
            .unwrap_or("")
            .split(':')
            .next()
            .unwrap_or("")
            .to_string()
    } else {
        url.split('/').next().unwrap_or("unknown").to_string()
    }
}

pub fn generate_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

fn unix_timestamp_secs() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    format!("{secs}")
}

// --- Breakpoint matching & pausing ---

/// Check if a breakpoint rule matches the given method and URL.
fn matches_rule(rule: &BreakpointRule, method: &str, url: &str) -> bool {
    // Method match (empty or "*" = match all)
    if !rule.method.is_empty() && rule.method != "*" && !rule.method.eq_ignore_ascii_case(method) {
        return false;
    }
    // Host match (empty or "*" = match all, otherwise substring)
    if !rule.host.is_empty() && rule.host != "*" && !url.contains(&rule.host) {
        return false;
    }
    // Path match (empty or "*" = match all, otherwise substring)
    if !rule.path.is_empty() && rule.path != "*" && !url.contains(&rule.path) {
        return false;
    }
    true
}

/// Pause on a matched request breakpoint: emit event, wait for user action.
async fn breakpoint_pause(
    app: &AppHandle,
    proxy_state: &ProxyState,
    phase: &str,
    request: &HttpRequestRecord,
    response: Option<&HttpResponseRecord>,
) -> Option<HttpRequestRecord> {
    let exchange_id = generate_id();
    let (body, _) = encode_body(&request.body);
    let paused = PausedExchange {
        id: exchange_id.clone(),
        method: request.method.clone(),
        url: request.url.clone(),
        request_headers: request.headers.clone(),
        request_body: body,
        phase: phase.to_string(),
        status_code: response.map_or(0, |r| r.status),
        response_headers: response.map_or_else(Vec::new, |r| r.headers.clone()),
        response_body: response.map_or_else(String::new, |r| {
            String::from_utf8_lossy(&r.body).to_string()
        }),
    };

    let (tx, rx) = oneshot::channel();
    {
        let mut pending = proxy_state.pending_breakpoints.lock().await;
        pending.insert(exchange_id.clone(), tx);
    }
    let _ = app.emit("breakpoint:paused", &paused);

    match rx.await {
        Ok(BreakpointAction::Forward(modified)) => Some(HttpRequestRecord {
            method: modified.method,
            url: modified.url,
            headers: modified.request_headers,
            body: modified.request_body.into_bytes(),
        }),
        Ok(BreakpointAction::Drop) | Err(_) => None,
    }
}

/// Pause on a matched response breakpoint: emit event, wait for user action.
async fn breakpoint_pause_response(
    app: &AppHandle,
    proxy_state: &ProxyState,
    request: &HttpRequestRecord,
    response: HttpResponseRecord,
) -> Option<HttpResponseRecord> {
    let exchange_id = generate_id();
    let (req_body, _) = encode_body(&request.body);

    // Decode compressed/chunked body so the frontend gets readable plaintext.
    let decoded_body = decode_response_body(&response.body, &response.headers);
    let (resp_body, _) = encode_body(&decoded_body);

    // Strip encoding headers — the body is now decoded plaintext.
    let clean_headers: Vec<(String, String)> = response
        .headers
        .iter()
        .filter(|(k, _)| {
            !k.eq_ignore_ascii_case("content-encoding")
                && !k.eq_ignore_ascii_case("transfer-encoding")
        })
        .cloned()
        .collect();

    let paused = PausedExchange {
        id: exchange_id.clone(),
        method: request.method.clone(),
        url: request.url.clone(),
        request_headers: request.headers.clone(),
        request_body: req_body,
        phase: "response".to_string(),
        status_code: response.status,
        response_headers: clean_headers,
        response_body: resp_body,
    };

    let (tx, rx) = oneshot::channel();
    {
        let mut pending = proxy_state.pending_breakpoints.lock().await;
        pending.insert(exchange_id.clone(), tx);
    }
    let _ = app.emit("breakpoint:paused", &paused);

    match rx.await {
        Ok(BreakpointAction::Forward(modified)) => Some(HttpResponseRecord {
            status: modified.status_code,
            headers: modified.response_headers,
            body: modified.response_body.into_bytes(),
        }),
        Ok(BreakpointAction::Drop) | Err(_) => None,
    }
}

// --- Script execution helpers ---

/// Run request-phase scripts in a blocking thread (Boa engine is CPU-bound).
async fn run_scripts_on_request(
    app: &AppHandle,
    executor: &Arc<ScriptExecutor>,
    request: &mut HttpRequestRecord,
) -> ScriptAction {
    let executor = executor.clone();
    let mut req_clone = request.clone();

    let result = tokio::task::spawn_blocking(move || {
        let (action, logs) = executor.execute_on_request(&mut req_clone);
        (action, logs, req_clone)
    })
    .await;

    match result {
        Ok((action, logs, modified_req)) => {
            if !logs.is_empty() {
                let _ = app.emit("script:execution_log", &logs);
            }
            if matches!(action, ScriptAction::Modified) {
                *request = modified_req;
            }
            action
        }
        Err(e) => {
            eprintln!("[script] Request script execution panicked: {e}");
            ScriptAction::Passthrough
        }
    }
}

/// Run response-phase scripts in a blocking thread.
async fn run_scripts_on_response(
    app: &AppHandle,
    executor: &Arc<ScriptExecutor>,
    request: &HttpRequestRecord,
    response: &mut HttpResponseRecord,
) -> ScriptAction {
    let executor = executor.clone();
    let req_clone = request.clone();
    let mut resp_clone = response.clone();

    let result = tokio::task::spawn_blocking(move || {
        let (action, logs) = executor.execute_on_response(&req_clone, &mut resp_clone);
        (action, logs, resp_clone)
    })
    .await;

    match result {
        Ok((action, logs, modified_resp)) => {
            if !logs.is_empty() {
                let _ = app.emit("script:execution_log", &logs);
            }
            if matches!(action, ScriptAction::Modified) {
                *response = modified_resp;
            }
            action
        }
        Err(e) => {
            eprintln!("[script] Response script execution panicked: {e}");
            ScriptAction::Passthrough
        }
    }
}

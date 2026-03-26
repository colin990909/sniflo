use serde::{Deserialize, Serialize};

use super::proxy::CapturedSession;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ExportResult {
    pub content: String,
    pub format: String,
}

#[tauri::command]
pub async fn get_sessions(
    state: tauri::State<'_, super::proxy::ProxyState>,
) -> Result<Vec<CapturedSession>, String> {
    let sessions = state.sessions.lock();
    Ok(sessions.clone())
}

#[tauri::command]
pub async fn clear_sessions(
    state: tauri::State<'_, super::proxy::ProxyState>,
) -> Result<(), String> {
    state.sessions.lock().clear();
    Ok(())
}

#[tauri::command]
pub async fn export_session(
    id: String,
    format: String,
    state: tauri::State<'_, super::proxy::ProxyState>,
) -> Result<ExportResult, String> {
    let sessions = state.sessions.lock();
    let session = sessions
        .iter()
        .find(|s| s.id == id)
        .ok_or("Session not found")?;

    let content = match format.as_str() {
        "curl" => export_curl(session),
        "json" => serde_json::to_string_pretty(session).unwrap_or_default(),
        "raw_http" => export_raw_http(session),
        _ => return Err(format!("Unknown export format: {format}")),
    };

    Ok(ExportResult { content, format })
}

fn export_curl(session: &CapturedSession) -> String {
    let mut cmd = format!("curl -X {} '{}'", session.method, session.url);
    for (key, value) in &session.request_headers {
        cmd.push_str(&format!(" \\\n  -H '{key}: {value}'"));
    }
    if !session.request_body.is_empty() {
        cmd.push_str(&format!(
            " \\\n  -d '{}'",
            session.request_body.replace('\'', "\\'")
        ));
    }
    cmd
}

fn export_raw_http(session: &CapturedSession) -> String {
    let mut raw = format!("{} {} HTTP/1.1\r\n", session.method, session.url);
    for (key, value) in &session.request_headers {
        raw.push_str(&format!("{key}: {value}\r\n"));
    }
    raw.push_str("\r\n");
    if !session.request_body.is_empty() {
        raw.push_str(&session.request_body);
    }
    raw.push_str("\r\n---\r\n");
    raw.push_str(&format!("HTTP/1.1 {}\r\n", session.status_code));
    for (key, value) in &session.response_headers {
        raw.push_str(&format!("{key}: {value}\r\n"));
    }
    raw.push_str("\r\n");
    raw.push_str(&session.response_body);
    raw
}

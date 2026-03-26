use async_trait::async_trait;
use serde_json::{Value, json};
use tauri::{AppHandle, Manager};

use crate::ai::tools::{Tool, ToolOutput};
use crate::ai::types::ToolDefinition;
use crate::commands::proxy::ProxyState;

/// Export a session in a specified format.
pub struct ExportSessionTool {
    app_handle: AppHandle,
}

impl ExportSessionTool {
    pub fn new(app_handle: AppHandle) -> Self {
        Self { app_handle }
    }
}

#[async_trait]
impl Tool for ExportSessionTool {
    fn definition(&self) -> ToolDefinition {
        ToolDefinition {
            name: "export_session".to_string(),
            description: "Export a captured session as cURL command, JSON, or raw HTTP format"
                .to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "session_id": { "type": "string", "description": "The session ID to export" },
                    "format": { "type": "string", "enum": ["curl", "json", "raw_http"], "description": "Export format", "default": "curl" }
                },
                "required": ["session_id"]
            }),
        }
    }

    async fn execute(&self, input: Value) -> ToolOutput {
        let session_id = input["session_id"].as_str().unwrap_or("");
        let format = input["format"].as_str().unwrap_or("curl");

        let state = self.app_handle.state::<ProxyState>();
        let sessions = state.sessions.lock();

        let Some(session) = sessions.iter().find(|s| s.id == session_id) else {
            return ToolOutput {
                content: format!("Session not found: {session_id}"),
                is_error: true,
            };
        };

        // Reuse the export logic from commands/session.rs
        let content = match format {
            "curl" => export_curl(session),
            "json" => serde_json::to_string_pretty(session).unwrap_or_default(),
            "raw_http" => export_raw_http(session),
            _ => {
                return ToolOutput {
                    content: format!("Unknown format: {format}"),
                    is_error: true,
                };
            }
        };

        ToolOutput {
            content,
            is_error: false,
        }
    }
}

fn export_curl(session: &crate::commands::proxy::CapturedSession) -> String {
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

fn export_raw_http(session: &crate::commands::proxy::CapturedSession) -> String {
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

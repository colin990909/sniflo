use async_trait::async_trait;
use serde_json::{Value, json};
use tauri::{AppHandle, Manager};

use crate::ai::tools::{Tool, ToolOutput};
use crate::ai::types::ToolDefinition;
use crate::commands::proxy::ProxyState;

/// Get proxy running status and configuration.
pub struct GetProxyStatusTool {
    app_handle: AppHandle,
}

impl GetProxyStatusTool {
    pub fn new(app_handle: AppHandle) -> Self {
        Self { app_handle }
    }
}

#[async_trait]
impl Tool for GetProxyStatusTool {
    fn definition(&self) -> ToolDefinition {
        ToolDefinition {
            name: "get_proxy_status".to_string(),
            description: "Get the current proxy running status and listening address".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {}
            }),
        }
    }

    async fn execute(&self, _input: Value) -> ToolOutput {
        let state = self.app_handle.state::<ProxyState>();
        let running = state.running.load(std::sync::atomic::Ordering::SeqCst);
        let address = state.address.lock().await.clone();
        let session_count = state.sessions.lock().len();

        let result = json!({
            "running": running,
            "address": address,
            "session_count": session_count,
        });

        ToolOutput {
            content: serde_json::to_string_pretty(&result).unwrap_or_default(),
            is_error: false,
        }
    }
}

use async_trait::async_trait;
use serde_json::{Value, json};
use tauri::{AppHandle, Manager};

use crate::ai::tools::{Tool, ToolOutput};
use crate::ai::types::ToolDefinition;
use crate::commands::cert::CertState;

/// Get CA certificate status.
pub struct GetCertStatusTool {
    app_handle: AppHandle,
}

impl GetCertStatusTool {
    pub fn new(app_handle: AppHandle) -> Self {
        Self { app_handle }
    }
}

#[async_trait]
impl Tool for GetCertStatusTool {
    fn definition(&self) -> ToolDefinition {
        ToolDefinition {
            name: "get_cert_status".to_string(),
            description: "Get the CA certificate status (generated, trusted by system)".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {}
            }),
        }
    }

    async fn execute(&self, _input: Value) -> ToolOutput {
        let state = self.app_handle.state::<CertState>();
        let has_ca = *state.has_ca.lock().await;
        let is_installed = *state.is_installed.lock().await;

        let result = json!({
            "has_ca": has_ca,
            "is_installed": is_installed,
            "mitm_ready": has_ca && is_installed,
        });

        ToolOutput {
            content: serde_json::to_string_pretty(&result).unwrap_or_default(),
            is_error: false,
        }
    }
}

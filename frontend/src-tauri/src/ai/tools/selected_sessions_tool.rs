use async_trait::async_trait;
use serde_json::{Value, json};
use tauri::{AppHandle, Manager};

use crate::ai::tools::{Tool, ToolOutput};
use crate::ai::types::ToolDefinition;
use crate::commands::ai::AIAgentState;

/// Get the currently selected session IDs from the UI.
pub struct GetSelectedSessionsTool {
    app_handle: AppHandle,
}

impl GetSelectedSessionsTool {
    pub fn new(app_handle: AppHandle) -> Self {
        Self { app_handle }
    }
}

#[async_trait]
impl Tool for GetSelectedSessionsTool {
    fn definition(&self) -> ToolDefinition {
        ToolDefinition {
            name: "get_selected_sessions".to_string(),
            description: "Get the session IDs currently selected by the user in the sessions panel. Use this to understand which traffic the user is focused on before analyzing or searching.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {}
            }),
        }
    }

    async fn execute(&self, _input: Value) -> ToolOutput {
        let ai_state = self.app_handle.state::<AIAgentState>();
        let selected: Vec<String> = ai_state
            .selected_session_ids
            .lock()
            .iter()
            .cloned()
            .collect();

        ToolOutput {
            content: serde_json::to_string_pretty(&json!({
                "count": selected.len(),
                "session_ids": selected,
            }))
            .unwrap_or_default(),
            is_error: false,
        }
    }
}

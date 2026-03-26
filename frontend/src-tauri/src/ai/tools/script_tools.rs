use async_trait::async_trait;
use serde_json::{Value, json};
use tauri::{AppHandle, Emitter, Manager};

use crate::ai::tools::{Tool, ToolOutput};
use crate::ai::types::ToolDefinition;
use crate::commands::script::ScriptState;
use crate::storage::db::Database;
use crate::storage::script_repo;

// ─── ListScriptsTool ─────────────────────────────────────

/// List all configured user scripts.
pub struct ListScriptsTool {
    app_handle: AppHandle,
}

impl ListScriptsTool {
    pub fn new(app_handle: AppHandle) -> Self {
        Self { app_handle }
    }
}

#[async_trait]
impl Tool for ListScriptsTool {
    fn definition(&self) -> ToolDefinition {
        ToolDefinition {
            name: "list_scripts".to_string(),
            description: "List all user scripts that automatically modify HTTP requests/responses"
                .to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {}
            }),
        }
    }

    async fn execute(&self, _input: Value) -> ToolOutput {
        let db = self.app_handle.state::<Database>();
        match script_repo::list_scripts(&db) {
            Ok(scripts) => {
                let result: Vec<Value> = scripts
                    .iter()
                    .map(|s| {
                        json!({
                            "id": s.id,
                            "name": s.name,
                            "urlPattern": s.url_pattern,
                            "phase": s.phase,
                            "priority": s.priority,
                            "enabled": s.enabled,
                            "codePreview": if s.code.len() > 200 {
                                format!("{}...", &s.code[..200])
                            } else {
                                s.code.clone()
                            },
                        })
                    })
                    .collect();

                ToolOutput {
                    content: serde_json::to_string_pretty(&json!({
                        "count": scripts.len(),
                        "scripts": result,
                    }))
                    .unwrap_or_default(),
                    is_error: false,
                }
            }
            Err(e) => ToolOutput {
                content: format!("Failed to list scripts: {e}"),
                is_error: true,
            },
        }
    }
}

// ─── AddScriptTool ───────────────────────────────────────

/// Create a new user script.
pub struct AddScriptTool {
    app_handle: AppHandle,
}

impl AddScriptTool {
    pub fn new(app_handle: AppHandle) -> Self {
        Self { app_handle }
    }
}

#[async_trait]
impl Tool for AddScriptTool {
    fn definition(&self) -> ToolDefinition {
        ToolDefinition {
            name: "add_script".to_string(),
            description:
                "Create a new JavaScript script to automatically modify matching HTTP traffic"
                    .to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "name": { "type": "string", "description": "Display name for the script" },
                    "code": { "type": "string", "description": "JavaScript code with onRequest(ctx) and/or onResponse(ctx) functions" },
                    "urlPattern": { "type": "string", "description": "URL substring to match (case-insensitive). Use * for all.", "default": "*" },
                    "phase": { "type": "string", "enum": ["request", "response", "both"], "description": "When to execute", "default": "both" }
                },
                "required": ["name", "code"]
            }),
        }
    }

    async fn execute(&self, input: Value) -> ToolOutput {
        let name = input["name"].as_str().unwrap_or("AI Script").to_string();
        let code = input["code"].as_str().unwrap_or("").to_string();
        let url_pattern = input["urlPattern"].as_str().unwrap_or("*").to_string();
        let phase = input["phase"].as_str().unwrap_or("both").to_string();

        let db = self.app_handle.state::<Database>();
        let script_state = self.app_handle.state::<ScriptState>();

        // Determine next priority
        let priority = match script_repo::list_scripts(&db) {
            Ok(scripts) => scripts.len() as i32,
            Err(_) => 0,
        };

        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        let script = crate::scripting::types::ScriptRule {
            id: uuid::Uuid::new_v4().to_string(),
            name: name.clone(),
            url_pattern: url_pattern.clone(),
            phase: phase.clone(),
            priority,
            enabled: true,
            code,
            source_path: None,
            created_at: format!("{now}"),
            updated_at: format!("{now}"),
        };

        if let Err(e) = script_repo::create_script(&db, &script) {
            return ToolOutput {
                content: format!("Failed to create script: {e}"),
                is_error: true,
            };
        }

        // Reload executor so the new script takes effect immediately
        if let Ok(scripts) = script_repo::list_scripts(&db) {
            script_state.executor.reload(scripts.clone());
            let _ = self.app_handle.emit("script:scripts_changed", &scripts);
        }

        ToolOutput {
            content: format!(
                "Script '{name}' created and enabled (pattern: {url_pattern}, phase: {phase})."
            ),
            is_error: false,
        }
    }
}

// ─── ToggleScriptTool ────────────────────────────────────

/// Enable or disable a user script by name or ID.
pub struct ToggleScriptTool {
    app_handle: AppHandle,
}

impl ToggleScriptTool {
    pub fn new(app_handle: AppHandle) -> Self {
        Self { app_handle }
    }
}

#[async_trait]
impl Tool for ToggleScriptTool {
    fn definition(&self) -> ToolDefinition {
        ToolDefinition {
            name: "toggle_script".to_string(),
            description: "Enable or disable an existing script by name or ID".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "nameOrId": { "type": "string", "description": "Script name or ID to toggle" },
                    "enabled": { "type": "boolean", "description": "true to enable, false to disable" }
                },
                "required": ["nameOrId", "enabled"]
            }),
        }
    }

    async fn execute(&self, input: Value) -> ToolOutput {
        let name_or_id = input["nameOrId"].as_str().unwrap_or("").to_string();
        let enabled = input["enabled"].as_bool().unwrap_or(true);

        let db = self.app_handle.state::<Database>();
        let script_state = self.app_handle.state::<ScriptState>();

        let scripts = match script_repo::list_scripts(&db) {
            Ok(s) => s,
            Err(e) => {
                return ToolOutput {
                    content: format!("Failed to list scripts: {e}"),
                    is_error: true,
                };
            }
        };

        // Find by ID first, then by name (case-insensitive)
        let target = scripts.iter().find(|s| s.id == name_or_id).or_else(|| {
            scripts
                .iter()
                .find(|s| s.name.eq_ignore_ascii_case(&name_or_id))
        });

        let Some(target) = target else {
            return ToolOutput {
                content: format!("Script '{name_or_id}' not found."),
                is_error: true,
            };
        };

        if let Err(e) = script_repo::toggle_script(&db, &target.id, enabled) {
            return ToolOutput {
                content: format!("Failed to toggle script: {e}"),
                is_error: true,
            };
        }

        if let Ok(scripts) = script_repo::list_scripts(&db) {
            script_state.executor.reload(scripts.clone());
            let _ = self.app_handle.emit("script:scripts_changed", &scripts);
        }

        let state_str = if enabled { "enabled" } else { "disabled" };
        ToolOutput {
            content: format!("Script '{}' {state_str}.", target.name),
            is_error: false,
        }
    }
}

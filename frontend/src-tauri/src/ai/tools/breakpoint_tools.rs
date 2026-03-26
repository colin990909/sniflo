use async_trait::async_trait;
use serde_json::{Value, json};
use tauri::{AppHandle, Emitter, Manager};

use crate::ai::tools::{Tool, ToolOutput};
use crate::ai::types::ToolDefinition;
use crate::commands::proxy::ProxyState;
use crate::storage::db::Database;
use crate::storage::settings_repo;

/// List active breakpoint rules.
pub struct ListBreakpointRulesTool {
    app_handle: AppHandle,
}

impl ListBreakpointRulesTool {
    pub fn new(app_handle: AppHandle) -> Self {
        Self { app_handle }
    }
}

#[async_trait]
impl Tool for ListBreakpointRulesTool {
    fn definition(&self) -> ToolDefinition {
        ToolDefinition {
            name: "list_breakpoint_rules".to_string(),
            description: "List all configured breakpoint rules for HTTP interception".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {}
            }),
        }
    }

    async fn execute(&self, _input: Value) -> ToolOutput {
        let state = self.app_handle.state::<ProxyState>();
        let enabled = state
            .breakpoint_enabled
            .load(std::sync::atomic::Ordering::SeqCst);
        let rules = state.breakpoint_rules.lock().await;

        let result = json!({
            "enabled": enabled,
            "rules": rules.iter().map(|r| json!({
                "id": r.id,
                "host": r.host,
                "path": r.path,
                "method": r.method,
                "phase": r.phase,
                "enabled": r.enabled,
            })).collect::<Vec<_>>(),
        });

        ToolOutput {
            content: serde_json::to_string_pretty(&result).unwrap_or_default(),
            is_error: false,
        }
    }
}

/// Add a new breakpoint rule.
pub struct AddBreakpointRuleTool {
    app_handle: AppHandle,
}

impl AddBreakpointRuleTool {
    pub fn new(app_handle: AppHandle) -> Self {
        Self { app_handle }
    }
}

#[async_trait]
impl Tool for AddBreakpointRuleTool {
    fn definition(&self) -> ToolDefinition {
        ToolDefinition {
            name: "add_breakpoint_rule".to_string(),
            description: "Add a new breakpoint rule to intercept matching HTTP requests"
                .to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "host": { "type": "string", "description": "Host pattern to match" },
                    "path": { "type": "string", "description": "Path pattern to match", "default": "*" },
                    "method": { "type": "string", "description": "HTTP method to match (or * for all)", "default": "*" },
                    "phase": { "type": "string", "enum": ["request", "response"], "description": "When to break", "default": "request" }
                },
                "required": ["host"]
            }),
        }
    }

    async fn execute(&self, input: Value) -> ToolOutput {
        let state = self.app_handle.state::<ProxyState>();
        let host = input["host"].as_str().unwrap_or("*").to_string();
        let path = input["path"].as_str().unwrap_or("*").to_string();
        let method = input["method"].as_str().unwrap_or("*").to_string();
        let phase = input["phase"].as_str().unwrap_or("request").to_string();

        let rule = crate::commands::proxy::BreakpointRule {
            id: crate::commands::proxy::generate_id(),
            host: host.clone(),
            path: path.clone(),
            method: method.clone(),
            phase: phase.clone(),
            enabled: true,
        };

        let mut rules = state.breakpoint_rules.lock().await;
        rules.push(rule);

        // Auto-enable breakpoints so the new rule takes effect immediately.
        state
            .breakpoint_enabled
            .store(true, std::sync::atomic::Ordering::SeqCst);

        // Persist to SQLite
        let db = self.app_handle.state::<Database>();
        let _ = settings_repo::set_setting(&db, "breakpoint_enabled", "true");
        if let Ok(json) = serde_json::to_string(&*rules) {
            let _ = settings_repo::set_setting(&db, "breakpoint_rules", &json);
        }

        // Notify frontend so the UI reflects the new rule.
        let rules_json: Vec<Value> = rules
            .iter()
            .map(|r| {
                json!({
                    "id": r.id,
                    "host": r.host,
                    "path": r.path,
                    "method": r.method,
                    "phase": r.phase,
                    "enabled": r.enabled,
                })
            })
            .collect();
        let _ = self.app_handle.emit(
            "breakpoint:rules_changed",
            json!({ "enabled": true, "rules": rules_json }),
        );

        ToolOutput {
            content: format!(
                "Breakpoint rule added: {method} {host}{path} (phase: {phase}). Breakpoints enabled."
            ),
            is_error: false,
        }
    }
}

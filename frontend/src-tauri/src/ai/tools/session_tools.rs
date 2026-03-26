use async_trait::async_trait;
use serde_json::{Value, json};
use tauri::{AppHandle, Manager};

use crate::ai::tools::{Tool, ToolOutput};
use crate::ai::types::ToolDefinition;
use crate::commands::proxy::{CapturedSession, ProxyState};

/// List captured sessions with optional filtering.
pub struct ListSessionsTool {
    app_handle: AppHandle,
}

impl ListSessionsTool {
    pub fn new(app_handle: AppHandle) -> Self {
        Self { app_handle }
    }
}

#[async_trait]
impl Tool for ListSessionsTool {
    fn definition(&self) -> ToolDefinition {
        ToolDefinition {
            name: "list_sessions".to_string(),
            description: "List captured HTTP sessions with optional filtering by host, method, or status code".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "host": { "type": "string", "description": "Filter by host (substring match)" },
                    "method": { "type": "string", "description": "Filter by HTTP method (GET, POST, etc.)" },
                    "status_code": { "type": "integer", "description": "Filter by exact status code" },
                    "limit": { "type": "integer", "description": "Max results to return (default 20)", "default": 20 }
                }
            }),
        }
    }

    async fn execute(&self, input: Value) -> ToolOutput {
        let state = self.app_handle.state::<ProxyState>();
        let sessions = state.sessions.lock();

        let host_filter = input["host"].as_str().unwrap_or("");
        let method_filter = input["method"].as_str().unwrap_or("");
        let status_filter = input["status_code"].as_u64();
        let limit = input["limit"].as_u64().unwrap_or(20) as usize;

        let filtered: Vec<&CapturedSession> = sessions
            .iter()
            .filter(|s| host_filter.is_empty() || s.host.contains(host_filter))
            .filter(|s| method_filter.is_empty() || s.method.eq_ignore_ascii_case(method_filter))
            .filter(|s| status_filter.is_none() || Some(s.status_code as u64) == status_filter)
            .take(limit)
            .collect();

        let result: Vec<Value> = filtered
            .iter()
            .map(|s| {
                json!({
                    "id": s.id,
                    "method": s.method,
                    "url": s.url,
                    "host": s.host,
                    "status_code": s.status_code,
                    "protocol": s.protocol,
                    "timestamp": s.timestamp,
                })
            })
            .collect();

        ToolOutput {
            content: serde_json::to_string_pretty(&json!({
                "total": sessions.len(),
                "filtered": result.len(),
                "sessions": result,
            }))
            .unwrap_or_default(),
            is_error: false,
        }
    }
}

/// Get full details of a single session.
pub struct GetSessionDetailTool {
    app_handle: AppHandle,
}

impl GetSessionDetailTool {
    pub fn new(app_handle: AppHandle) -> Self {
        Self { app_handle }
    }
}

#[async_trait]
impl Tool for GetSessionDetailTool {
    fn definition(&self) -> ToolDefinition {
        ToolDefinition {
            name: "get_session_detail".to_string(),
            description: "Get full details of a captured HTTP session including headers and body"
                .to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "session_id": { "type": "string", "description": "The session ID to retrieve" }
                },
                "required": ["session_id"]
            }),
        }
    }

    async fn execute(&self, input: Value) -> ToolOutput {
        let session_id = input["session_id"].as_str().unwrap_or("");

        // Check the per-turn cache first to avoid redundant fetches
        let ai_state = self.app_handle.state::<crate::commands::ai::AIAgentState>();

        let cached_content = {
            let cache = ai_state.session_detail_cache.lock();
            cache
                .get(session_id)
                .map(|s| serde_json::to_string_pretty(s).unwrap_or_default())
        };
        if let Some(content) = cached_content {
            return ToolOutput {
                content,
                is_error: false,
            };
        }

        // Not in cache — fetch from ProxyState and populate the cache
        let state = self.app_handle.state::<ProxyState>();
        let sessions = state.sessions.lock();

        match sessions.iter().find(|s| s.id == session_id) {
            Some(session) => {
                let content = serde_json::to_string_pretty(session).unwrap_or_default();
                // Cache a clone so subsequent calls in this turn skip the lookup
                ai_state
                    .session_detail_cache
                    .lock()
                    .insert(session_id.to_string(), session.clone());
                ToolOutput {
                    content,
                    is_error: false,
                }
            }
            None => ToolOutput {
                content: format!("Session not found: {session_id}"),
                is_error: true,
            },
        }
    }
}

/// Search sessions by keyword across URL, headers, and body.
pub struct SearchSessionsTool {
    app_handle: AppHandle,
}

impl SearchSessionsTool {
    pub fn new(app_handle: AppHandle) -> Self {
        Self { app_handle }
    }
}

#[async_trait]
impl Tool for SearchSessionsTool {
    fn definition(&self) -> ToolDefinition {
        ToolDefinition {
            name: "search_sessions".to_string(),
            description:
                "Search captured sessions by keyword across URL, headers, and body content"
                    .to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "Search keyword" },
                    "search_in": { "type": "string", "enum": ["url", "headers", "body", "all"], "description": "Where to search (default: all)", "default": "all" },
                    "limit": { "type": "integer", "description": "Max results (default 20)", "default": 20 }
                },
                "required": ["query"]
            }),
        }
    }

    async fn execute(&self, input: Value) -> ToolOutput {
        let query = input["query"].as_str().unwrap_or("").to_lowercase();
        let search_in = input["search_in"].as_str().unwrap_or("all");
        let limit = input["limit"].as_u64().unwrap_or(20) as usize;

        let state = self.app_handle.state::<ProxyState>();
        let sessions = state.sessions.lock();

        let matches: Vec<Value> = sessions
            .iter()
            .filter(|s| match search_in {
                "url" => s.url.to_lowercase().contains(&query),
                "headers" => {
                    headers_contain(&s.request_headers, &query)
                        || headers_contain(&s.response_headers, &query)
                }
                "body" => {
                    s.request_body.to_lowercase().contains(&query)
                        || s.response_body.to_lowercase().contains(&query)
                }
                _ => {
                    s.url.to_lowercase().contains(&query)
                        || headers_contain(&s.request_headers, &query)
                        || headers_contain(&s.response_headers, &query)
                        || s.request_body.to_lowercase().contains(&query)
                        || s.response_body.to_lowercase().contains(&query)
                }
            })
            .take(limit)
            .map(|s| {
                json!({
                    "id": s.id,
                    "method": s.method,
                    "url": s.url,
                    "host": s.host,
                    "status_code": s.status_code,
                })
            })
            .collect();

        ToolOutput {
            content: serde_json::to_string_pretty(&json!({
                "query": query,
                "matches": matches.len(),
                "sessions": matches,
            }))
            .unwrap_or_default(),
            is_error: false,
        }
    }
}

/// Compare two sessions side by side.
pub struct CompareSessionsTool {
    app_handle: AppHandle,
}

impl CompareSessionsTool {
    pub fn new(app_handle: AppHandle) -> Self {
        Self { app_handle }
    }
}

#[async_trait]
impl Tool for CompareSessionsTool {
    fn definition(&self) -> ToolDefinition {
        ToolDefinition {
            name: "compare_sessions".to_string(),
            description: "Compare two captured sessions and show differences in headers and body"
                .to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "session_id_a": { "type": "string", "description": "First session ID" },
                    "session_id_b": { "type": "string", "description": "Second session ID" }
                },
                "required": ["session_id_a", "session_id_b"]
            }),
        }
    }

    async fn execute(&self, input: Value) -> ToolOutput {
        let id_a = input["session_id_a"].as_str().unwrap_or("");
        let id_b = input["session_id_b"].as_str().unwrap_or("");

        let state = self.app_handle.state::<ProxyState>();
        let sessions = state.sessions.lock();

        let session_a = sessions.iter().find(|s| s.id == id_a);
        let session_b = sessions.iter().find(|s| s.id == id_b);

        match (session_a, session_b) {
            (Some(a), Some(b)) => {
                let result = json!({
                    "session_a": { "method": a.method, "url": a.url, "status": a.status_code },
                    "session_b": { "method": b.method, "url": b.url, "status": b.status_code },
                    "request_headers_diff": diff_headers(&a.request_headers, &b.request_headers),
                    "response_headers_diff": diff_headers(&a.response_headers, &b.response_headers),
                    "request_body_same": a.request_body == b.request_body,
                    "response_body_same": a.response_body == b.response_body,
                });
                ToolOutput {
                    content: serde_json::to_string_pretty(&result).unwrap_or_default(),
                    is_error: false,
                }
            }
            (None, _) => ToolOutput {
                content: format!("Session not found: {id_a}"),
                is_error: true,
            },
            (_, None) => ToolOutput {
                content: format!("Session not found: {id_b}"),
                is_error: true,
            },
        }
    }
}

// --- Helpers ---

fn headers_contain(headers: &[(String, String)], query: &str) -> bool {
    headers
        .iter()
        .any(|(k, v)| k.to_lowercase().contains(query) || v.to_lowercase().contains(query))
}

fn diff_headers(a: &[(String, String)], b: &[(String, String)]) -> Value {
    let mut only_a = Vec::new();
    let mut only_b = Vec::new();
    let mut changed = Vec::new();

    for (k, v) in a {
        match b.iter().find(|(bk, _)| bk == k) {
            Some((_, bv)) if bv != v => {
                changed.push(json!({"header": k, "a": v, "b": bv}));
            }
            None => only_a.push(json!({"header": k, "value": v})),
            _ => {}
        }
    }
    for (k, v) in b {
        if !a.iter().any(|(ak, _)| ak == k) {
            only_b.push(json!({"header": k, "value": v}));
        }
    }

    json!({
        "only_in_a": only_a,
        "only_in_b": only_b,
        "changed": changed,
    })
}

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptRule {
    pub id: String,
    pub name: String,
    pub url_pattern: String,
    /// "request" | "response" | "both"
    pub phase: String,
    /// Lower number runs first.
    pub priority: i32,
    pub enabled: bool,
    pub code: String,
    /// Original file path when imported from an external .js file (display only).
    pub source_path: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// Result of running scripts on a single request/response.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ScriptAction {
    /// No script matched or no modification was made.
    Passthrough,
    /// At least one script modified the record.
    Modified,
    /// A script explicitly returned "drop".
    Drop,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptExecutionLog {
    pub script_id: String,
    pub script_name: String,
    pub url: String,
    pub phase: String,
    pub success: bool,
    pub error_message: Option<String>,
    pub duration_ms: u64,
    pub logs: Vec<String>,
}

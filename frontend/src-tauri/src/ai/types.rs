use serde::{Deserialize, Serialize};

// --- Anthropic Protocol Core Types ---

/// A content block in a message, aligned with Anthropic's content block types.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ContentBlock {
    #[serde(rename = "text")]
    Text { text: String },

    #[serde(rename = "tool_use")]
    ToolUse {
        id: String,
        name: String,
        input: serde_json::Value,
    },

    #[serde(rename = "tool_result")]
    ToolResult {
        tool_use_id: String,
        content: String,
        #[serde(default)]
        is_error: bool,
    },
}

/// A message in the conversation, following Anthropic's Messages API format.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Message {
    pub role: String,
    pub content: Vec<ContentBlock>,
}

/// Tool definition following Anthropic's tool specification.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ToolDefinition {
    pub name: String,
    pub description: String,
    pub input_schema: serde_json::Value,
}

/// Why the model stopped generating.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum StopReason {
    EndTurn,
    ToolUse,
    MaxTokens,
}

/// The complete response from an AI model after streaming finishes.
#[derive(Clone, Debug)]
pub struct AssistantResponse {
    pub content: Vec<ContentBlock>,
    pub stop_reason: StopReason,
}

// --- Streaming Chunk Types ---

/// Individual chunks emitted during streaming from the AI client.
#[derive(Clone, Debug)]
#[allow(dead_code)]
pub enum StreamChunk {
    TextDelta(String),
    ThinkingDelta(String),
    ToolUseStart { id: String, name: String },
    ToolUseInputDelta(String),
    ToolUseEnd,
    Done,
}

// --- Tauri Event Types (Rust → Frontend) ---

/// Events emitted to the frontend during agent execution.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AgentEvent {
    StreamDelta {
        text: String,
    },
    ThinkingDelta {
        text: String,
    },
    ToolCall {
        id: String,
        name: String,
        input: serde_json::Value,
    },
    ToolResult {
        tool_use_id: String,
        content: String,
        #[serde(default)]
        is_error: bool,
    },
    Iteration {
        current: u32,
        max: u32,
    },
    AgentDone {
        final_text: String,
    },
    Error {
        message: String,
    },
}

// --- Frontend Request Types ---

/// Request sent from frontend to start an agent conversation.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct AgentRequest {
    pub conversation_id: String,
    pub runtime_id: String,
    pub user_message: String,
    pub attached_session_ids: Vec<String>,
    pub skill_name: Option<String>,
    #[serde(default)]
    pub model_override: Option<String>,
    pub max_iterations: u32,
    /// Previous conversation messages for multi-turn context.
    #[serde(default)]
    pub conversation_history: Vec<HistoryMessage>,
}

/// A message from the frontend conversation history, carrying structured content blocks
/// (text, tool_use, tool_result) so that multi-turn tool context is preserved.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct HistoryMessage {
    pub role: String,
    pub content: Vec<ContentBlock>,
}

// --- AI Client Error ---

#[derive(Debug)]
#[allow(dead_code)]
pub enum AIClientError {
    Network(String),
    Api(String),
    Parse(String),
    Cancelled,
}

impl std::fmt::Display for AIClientError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Network(msg) => write!(f, "Network error: {msg}"),
            Self::Api(msg) => write!(f, "API error: {msg}"),
            Self::Parse(msg) => write!(f, "Parse error: {msg}"),
            Self::Cancelled => write!(f, "Request cancelled"),
        }
    }
}

impl std::error::Error for AIClientError {}

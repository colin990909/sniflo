pub mod anthropic;
pub mod claude_code;
pub mod codex_cli;
pub mod openai;

use async_trait::async_trait;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::time::Duration;
use tokio::sync::mpsc;

use super::types::{AIClientError, AssistantResponse, Message, StreamChunk, ToolDefinition};

// ---------------------------------------------------------------------------
// Text-based tool-call protocol (used by local CLI runtimes)
// ---------------------------------------------------------------------------

/// A tool call parsed out of a local CLI text response.
pub struct ParsedToolCall {
    pub id: String,
    pub name: String,
    pub input: serde_json::Value,
}

/// Build the tool-call instruction block to inject into CLI prompts.
/// Returns an empty string when `tools` is empty.
pub fn build_tool_prompt_section(tools: &[ToolDefinition]) -> String {
    if tools.is_empty() {
        return String::new();
    }

    let mut section = String::from(
        "Available tools — call any by outputting a <tool_call> block:\n",
    );
    for tool in tools {
        section.push_str(&format!(
            "[{}] {}\n  Input schema: {}\n",
            tool.name,
            tool.description,
            tool.input_schema,
        ));
    }
    section.push_str(
        "\nTool call format (one per block, at the end of your reply):\n\
         <tool_call>{\"name\":\"TOOL_NAME\",\"id\":\"tc_1\",\"input\":{...}}</tool_call>\n\
         Rules:\n\
         - Output reasoning/explanation first, then all tool call(s) at the very end.\n\
         - Assign a unique \"id\" to each call (tc_1, tc_2, …).\n\
         - Do NOT fabricate tool results — results will be provided in the next message.\n\n",
    );
    section
}

/// Parse `<tool_call>…</tool_call>` blocks from a CLI text response.
/// Returns `(text_with_blocks_removed, parsed_calls)`.
/// Invalid JSON blocks are silently dropped (treated as plain text removal).
pub fn parse_tool_calls(text: &str) -> (String, Vec<ParsedToolCall>) {
    let mut parsed: Vec<ParsedToolCall> = Vec::new();
    let mut cleaned = String::new();
    let mut remaining = text;
    let mut counter: u32 = 0;

    while let Some(open) = remaining.find("<tool_call>") {
        cleaned.push_str(&remaining[..open]);
        remaining = &remaining[open + "<tool_call>".len()..];

        let close = match remaining.find("</tool_call>") {
            Some(pos) => pos,
            None => {
                // Malformed — keep the rest as text
                cleaned.push_str(remaining);
                remaining = "";
                break;
            }
        };

        let json_str = remaining[..close].trim();
        remaining = &remaining[close + "</tool_call>".len()..];

        if let Ok(value) = serde_json::from_str::<serde_json::Value>(json_str) {
            let name = value
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            if name.is_empty() {
                continue;
            }
            counter += 1;
            let id = value
                .get("id")
                .and_then(Value::as_str)
                .map(ToString::to_string)
                .unwrap_or_else(|| format!("tc_{counter}"));
            let input = value
                .get("input")
                .cloned()
                .unwrap_or(serde_json::Value::Object(Default::default()));
            parsed.push(ParsedToolCall { id, name, input });
        }
    }

    cleaned.push_str(remaining);
    (cleaned, parsed)
}

/// Trait abstracting remote AI runtimes. All implementations convert to/from
/// the Anthropic content block format internally.
#[async_trait]
pub trait AIClient: Send + Sync {
    async fn stream_chat(
        &self,
        messages: &[Message],
        tools: &[ToolDefinition],
        system_prompt: &str,
        event_tx: mpsc::UnboundedSender<StreamChunk>,
    ) -> Result<AssistantResponse, AIClientError>;
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeModelDescriptor {
    pub id: String,
    pub display_name: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeConnectionStatus {
    pub status: String,
    pub message: String,
}

#[derive(Clone, Debug)]
pub struct AnthropicModelsPage {
    pub models: Vec<RuntimeModelDescriptor>,
    pub has_more: bool,
    pub last_id: Option<String>,
}

/// Create an appropriate remote API client based on the protocol configuration.
pub fn create_remote_client(
    protocol: &str,
    base_url: String,
    api_key: String,
    model: String,
) -> Result<Box<dyn AIClient>, String> {
    match protocol {
        "anthropic" => Ok(Box::new(anthropic::AnthropicClient::new(
            base_url, api_key, model,
        ))),
        "openAI" | "openai" => Ok(Box::new(openai::OpenAIClient::new(
            base_url, api_key, model,
        ))),
        other => Err(format!("Unsupported remote API protocol: {other}")),
    }
}

/// Normalize a user-provided base URL: use the default when empty,
/// and strip trailing slashes.
pub fn normalize_base_url(user_url: &str, default_url: &str) -> String {
    if user_url.trim().is_empty() {
        default_url.to_string()
    } else {
        user_url.trim_end_matches('/').to_string()
    }
}

pub fn openai_models_url(user_url: &str) -> String {
    let base = normalize_base_url(user_url, "https://api.openai.com/v1");
    if base.ends_with("/models") {
        base
    } else if base.ends_with("/v1") {
        format!("{base}/models")
    } else {
        format!("{base}/v1/models")
    }
}

pub fn anthropic_models_url(user_url: &str) -> String {
    let base = normalize_base_url(user_url, "https://api.anthropic.com");
    if base.ends_with("/models") {
        base
    } else if base.ends_with("/v1") {
        format!("{base}/models")
    } else {
        format!("{base}/v1/models")
    }
}

pub fn openai_chat_completions_url(user_url: &str) -> String {
    let base = normalize_base_url(user_url, "https://api.openai.com/v1");
    if base.ends_with("/chat/completions") {
        base
    } else if base.ends_with("/v1") {
        format!("{base}/chat/completions")
    } else {
        format!("{base}/v1/chat/completions")
    }
}

pub fn anthropic_messages_url(user_url: &str) -> String {
    let base = normalize_base_url(user_url, "https://api.anthropic.com");
    if base.ends_with("/messages") {
        base
    } else if base.ends_with("/v1") {
        format!("{base}/messages")
    } else {
        format!("{base}/v1/messages")
    }
}

pub fn parse_openai_models_response(response: &Value) -> Result<Vec<String>, AIClientError> {
    let models = response
        .get("data")
        .and_then(Value::as_array)
        .ok_or_else(|| AIClientError::Parse("Missing OpenAI models data array".to_string()))?;

    Ok(models
        .iter()
        .filter_map(|entry| entry.get("id").and_then(Value::as_str))
        .map(ToString::to_string)
        .collect())
}

pub fn parse_anthropic_models_response(
    response: &Value,
) -> Result<AnthropicModelsPage, AIClientError> {
    let models = response
        .get("data")
        .and_then(Value::as_array)
        .ok_or_else(|| AIClientError::Parse("Missing Anthropic models data array".to_string()))?;

    Ok(AnthropicModelsPage {
        models: models
            .iter()
            .filter_map(|entry| {
                let id = entry.get("id").and_then(Value::as_str)?.to_string();
                let display_name = entry
                    .get("display_name")
                    .and_then(Value::as_str)
                    .map(ToString::to_string);
                Some(RuntimeModelDescriptor { id, display_name })
            })
            .collect(),
        has_more: response
            .get("has_more")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        last_id: response
            .get("last_id")
            .and_then(Value::as_str)
            .map(ToString::to_string),
    })
}

pub async fn list_remote_models(
    protocol: &str,
    base_url: &str,
    api_key: &str,
) -> Result<Vec<RuntimeModelDescriptor>, AIClientError> {
    let http = Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(45))
        .build()
        .unwrap_or_else(|_| Client::new());

    match protocol {
        "openAI" | "openai" => {
            let response = http
                .get(openai_models_url(base_url))
                .header("Authorization", format!("Bearer {api_key}"))
                .send()
                .await
                .map_err(|e| AIClientError::Network(e.to_string()))?;

            if !response.status().is_success() {
                let status = response.status();
                let body = response.text().await.unwrap_or_default();
                return Err(AIClientError::Api(format!("HTTP {status}: {body}")));
            }

            let json: Value = response
                .json()
                .await
                .map_err(|e| AIClientError::Parse(e.to_string()))?;

            Ok(parse_openai_models_response(&json)?
                .into_iter()
                .map(|id| RuntimeModelDescriptor {
                    display_name: None,
                    id,
                })
                .collect())
        }
        "anthropic" => {
            let mut models = Vec::new();
            let mut after_id: Option<String> = None;

            loop {
                let mut request = http
                    .get(anthropic_models_url(base_url))
                    .header("x-api-key", api_key)
                    .header("anthropic-version", "2023-06-01")
                    .query(&[("limit", "1000")]);

                if let Some(ref after) = after_id {
                    request = request.query(&[("after_id", after.as_str())]);
                }

                let response = request
                    .send()
                    .await
                    .map_err(|e| AIClientError::Network(e.to_string()))?;

                if !response.status().is_success() {
                    let status = response.status();
                    let body = response.text().await.unwrap_or_default();
                    return Err(AIClientError::Api(format!("HTTP {status}: {body}")));
                }

                let json: Value = response
                    .json()
                    .await
                    .map_err(|e| AIClientError::Parse(e.to_string()))?;
                let page = parse_anthropic_models_response(&json)?;
                models.extend(page.models);

                if !page.has_more {
                    break;
                }
                after_id = page.last_id;
                if after_id.is_none() {
                    break;
                }
            }

            Ok(models)
        }
        other => Err(AIClientError::Api(format!(
            "Unsupported remote API protocol: {other}"
        ))),
    }
}

pub async fn test_remote_connection(
    protocol: &str,
    base_url: &str,
    api_key: &str,
    model: &str,
) -> Result<RuntimeConnectionStatus, AIClientError> {
    let http = Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(45))
        .build()
        .unwrap_or_else(|_| Client::new());

    match protocol {
        "openAI" | "openai" => {
            let response = http
                .post(openai_chat_completions_url(base_url))
                .header("Authorization", format!("Bearer {api_key}"))
                .header("content-type", "application/json")
                .json(&json!({
                    "model": model,
                    "messages": [{ "role": "user", "content": "ping" }],
                    "max_tokens": 1,
                    "stream": false,
                }))
                .send()
                .await
                .map_err(|e| AIClientError::Network(e.to_string()))?;

            if !response.status().is_success() {
                let status = response.status();
                let body = response.text().await.unwrap_or_default();
                return Err(AIClientError::Api(format!("HTTP {status}: {body}")));
            }

            Ok(RuntimeConnectionStatus {
                status: "passed".to_string(),
                message: "Connected successfully.".to_string(),
            })
        }
        "anthropic" => {
            let response = http
                .post(anthropic_messages_url(base_url))
                .header("x-api-key", api_key)
                .header("anthropic-version", "2023-06-01")
                .header("content-type", "application/json")
                .json(&json!({
                    "model": model,
                    "max_tokens": 1,
                    "stream": false,
                    "messages": [{ "role": "user", "content": "ping" }],
                }))
                .send()
                .await
                .map_err(|e| AIClientError::Network(e.to_string()))?;

            if !response.status().is_success() {
                let status = response.status();
                let body = response.text().await.unwrap_or_default();
                return Err(AIClientError::Api(format!("HTTP {status}: {body}")));
            }

            Ok(RuntimeConnectionStatus {
                status: "passed".to_string(),
                message: "Connected successfully.".to_string(),
            })
        }
        other => Err(AIClientError::Api(format!(
            "Unsupported remote API protocol: {other}"
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_openai_models_url_appends_models_path() {
        assert_eq!(
            openai_models_url("https://api.openai.com"),
            "https://api.openai.com/v1/models"
        );
        assert_eq!(
            openai_models_url("https://api.openai.com/v1"),
            "https://api.openai.com/v1/models"
        );
        assert_eq!(
            openai_models_url("https://api.openai.com/v1/models"),
            "https://api.openai.com/v1/models"
        );
    }

    #[test]
    fn test_openai_chat_url_preserves_custom_endpoint_path() {
        assert_eq!(
            openai_chat_completions_url("https://proxy.example.com/openai/v1/chat/completions"),
            "https://proxy.example.com/openai/v1/chat/completions"
        );
        assert_eq!(
            openai_chat_completions_url("https://proxy.example.com/openai/v1"),
            "https://proxy.example.com/openai/v1/chat/completions"
        );
    }

    #[test]
    fn test_anthropic_messages_url_preserves_custom_endpoint_path() {
        assert_eq!(
            anthropic_messages_url("https://proxy.example.com/anthropic/v1/messages"),
            "https://proxy.example.com/anthropic/v1/messages"
        );
        assert_eq!(
            anthropic_messages_url("https://proxy.example.com/anthropic/v1"),
            "https://proxy.example.com/anthropic/v1/messages"
        );
    }

    #[test]
    fn test_parse_openai_models_response_extracts_ids() {
        let response = json!({
            "object": "list",
            "data": [
                { "id": "gpt-4o", "object": "model" },
                { "id": "gpt-5", "object": "model" }
            ]
        });

        let models = parse_openai_models_response(&response).unwrap();
        assert_eq!(models, vec!["gpt-4o".to_string(), "gpt-5".to_string()]);
    }

    #[test]
    fn test_parse_anthropic_models_response_extracts_ids_and_names() {
        let response = json!({
            "data": [
                {
                    "id": "claude-sonnet-4-20250514",
                    "display_name": "Claude Sonnet 4",
                    "type": "model"
                },
                {
                    "id": "claude-opus-4-20250514",
                    "display_name": "Claude Opus 4",
                    "type": "model"
                }
            ],
            "has_more": false,
            "first_id": "claude-sonnet-4-20250514",
            "last_id": "claude-opus-4-20250514"
        });

        let page = parse_anthropic_models_response(&response).unwrap();
        assert_eq!(page.models.len(), 2);
        assert_eq!(page.models[0].id, "claude-sonnet-4-20250514");
        assert_eq!(
            page.models[0].display_name.as_deref(),
            Some("Claude Sonnet 4")
        );
        assert!(!page.has_more);
    }

    #[test]
    fn parse_tool_calls_extracts_single_call() {
        let text = "Sure, let me list sessions.\n<tool_call>{\"name\":\"list_sessions\",\"id\":\"tc_1\",\"input\":{\"limit\":10}}</tool_call>";
        let (cleaned, calls) = parse_tool_calls(text);
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].name, "list_sessions");
        assert_eq!(calls[0].id, "tc_1");
        assert_eq!(calls[0].input["limit"], 10);
        assert!(cleaned.contains("Sure, let me list sessions."));
        assert!(!cleaned.contains("<tool_call>"));
    }

    #[test]
    fn parse_tool_calls_extracts_multiple_calls() {
        let text = "Calling two tools.\n\
                    <tool_call>{\"name\":\"list_sessions\",\"id\":\"tc_1\",\"input\":{}}</tool_call>\n\
                    <tool_call>{\"name\":\"get_proxy_status\",\"id\":\"tc_2\",\"input\":{}}</tool_call>";
        let (_, calls) = parse_tool_calls(text);
        assert_eq!(calls.len(), 2);
        assert_eq!(calls[0].name, "list_sessions");
        assert_eq!(calls[1].name, "get_proxy_status");
    }

    #[test]
    fn parse_tool_calls_generates_id_when_missing() {
        let text = "<tool_call>{\"name\":\"list_sessions\",\"input\":{}}</tool_call>";
        let (_, calls) = parse_tool_calls(text);
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].id, "tc_1");
    }

    #[test]
    fn parse_tool_calls_returns_empty_on_no_blocks() {
        let text = "Here is my analysis without any tool calls.";
        let (cleaned, calls) = parse_tool_calls(text);
        assert!(calls.is_empty());
        assert_eq!(cleaned, text);
    }

    #[test]
    fn parse_tool_calls_skips_invalid_json_blocks() {
        let text = "<tool_call>not json</tool_call>Some text.";
        let (cleaned, calls) = parse_tool_calls(text);
        assert!(calls.is_empty());
        assert!(cleaned.contains("Some text."));
    }

    #[test]
    fn build_tool_prompt_section_empty_when_no_tools() {
        let section = build_tool_prompt_section(&[]);
        assert!(section.is_empty());
    }

    #[test]
    fn build_tool_prompt_section_includes_tool_names() {
        let tools = vec![ToolDefinition {
            name: "list_sessions".to_string(),
            description: "List HTTP sessions".to_string(),
            input_schema: serde_json::json!({"type": "object"}),
        }];
        let section = build_tool_prompt_section(&tools);
        assert!(section.contains("list_sessions"));
        assert!(section.contains("List HTTP sessions"));
        assert!(section.contains("<tool_call>"));
    }
}

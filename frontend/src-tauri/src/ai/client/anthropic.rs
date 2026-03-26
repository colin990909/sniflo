use async_trait::async_trait;
use futures_util::StreamExt;
use reqwest::Client;
use serde_json::{Value, json};
use std::time::Duration;
use tokio::sync::mpsc;

use crate::ai::types::{
    AIClientError, AssistantResponse, ContentBlock, Message, StopReason, StreamChunk,
    ToolDefinition,
};

use super::{AIClient, anthropic_messages_url, normalize_base_url};

pub struct AnthropicClient {
    base_url: String,
    api_key: String,
    model: String,
    http: Client,
}

impl AnthropicClient {
    pub fn new(base_url: String, api_key: String, model: String) -> Self {
        let base_url = normalize_base_url(&base_url, "https://api.anthropic.com");
        Self {
            base_url,
            api_key,
            model,
            http: Client::builder()
                .connect_timeout(Duration::from_secs(30))
                .build()
                .unwrap_or_else(|_| Client::new()),
        }
    }

    /// Build the request body for Anthropic Messages API.
    fn build_request_body(
        &self,
        messages: &[Message],
        tools: &[ToolDefinition],
        system_prompt: &str,
    ) -> Value {
        let mut body = json!({
            "model": self.model,
            "max_tokens": 4096,
            "stream": true,
            "messages": messages,
        });

        if !system_prompt.is_empty() {
            body["system"] = json!(system_prompt);
        }

        if !tools.is_empty() {
            body["tools"] = json!(tools);
        }

        body
    }

    /// Resolve the full messages endpoint URL.
    fn messages_url(&self) -> String {
        anthropic_messages_url(&self.base_url)
    }
}

#[async_trait]
impl AIClient for AnthropicClient {
    async fn stream_chat(
        &self,
        messages: &[Message],
        tools: &[ToolDefinition],
        system_prompt: &str,
        event_tx: mpsc::UnboundedSender<StreamChunk>,
    ) -> Result<AssistantResponse, AIClientError> {
        let url = self.messages_url();
        let body = self.build_request_body(messages, tools, system_prompt);

        let response = self
            .http
            .post(&url)
            .header("x-api-key", &self.api_key)
            .header("anthropic-version", "2023-06-01")
            .header("content-type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| AIClientError::Network(e.to_string()))?;

        if !response.status().is_success() {
            let status = response.status();
            let body_text = response
                .text()
                .await
                .unwrap_or_else(|_| "Failed to read body".to_string());
            return Err(AIClientError::Api(format!("HTTP {status}: {body_text}")));
        }

        // Parse SSE stream
        let mut stream = response.bytes_stream();
        let mut buffer = String::new();
        let mut content_blocks: Vec<ContentBlock> = Vec::new();
        let mut stop_reason = StopReason::EndTurn;

        // Track in-progress tool_use blocks
        let mut current_tool_id = String::new();
        let mut current_tool_name = String::new();
        let mut current_tool_input_json = String::new();
        let mut full_text = String::new();

        // 90s per-chunk timeout — protects against network stalls mid-stream
        const STREAM_READ_TIMEOUT: Duration = Duration::from_secs(90);

        loop {
            let chunk_result = match tokio::time::timeout(STREAM_READ_TIMEOUT, stream.next()).await
            {
                Ok(Some(result)) => result,
                Ok(None) => break, // stream ended
                Err(_) => {
                    return Err(AIClientError::Network(
                        "SSE stream read timed out (90s without data)".to_string(),
                    ));
                }
            };

            let chunk = chunk_result.map_err(|e| AIClientError::Network(e.to_string()))?;
            let chunk_str = String::from_utf8_lossy(&chunk);
            buffer.push_str(&chunk_str);

            // Process complete SSE lines
            while let Some(line_end) = buffer.find('\n') {
                let line = buffer[..line_end].trim().to_string();
                buffer = buffer[line_end + 1..].to_string();

                if line.is_empty() || line.starts_with(':') {
                    continue;
                }

                if let Some(data) = line.strip_prefix("data: ") {
                    if data == "[DONE]" {
                        continue;
                    }

                    let event: Value = serde_json::from_str(data)
                        .map_err(|e| AIClientError::Parse(format!("Invalid JSON: {e}: {data}")))?;

                    let event_type = event["type"].as_str().unwrap_or("");
                    match event_type {
                        "content_block_start" => {
                            let block = &event["content_block"];
                            let block_type = block["type"].as_str().unwrap_or("");
                            if block_type == "tool_use" {
                                current_tool_id = block["id"].as_str().unwrap_or("").to_string();
                                current_tool_name =
                                    block["name"].as_str().unwrap_or("").to_string();
                                current_tool_input_json.clear();
                                let _ = event_tx.send(StreamChunk::ToolUseStart {
                                    id: current_tool_id.clone(),
                                    name: current_tool_name.clone(),
                                });
                            } else if block_type == "thinking" {
                                // Thinking block — deltas handled in content_block_delta
                            }
                        }
                        "content_block_delta" => {
                            let delta = &event["delta"];
                            let delta_type = delta["type"].as_str().unwrap_or("");
                            match delta_type {
                                "text_delta" => {
                                    let text = delta["text"].as_str().unwrap_or("");
                                    if !text.is_empty() {
                                        full_text.push_str(text);
                                        let _ =
                                            event_tx.send(StreamChunk::TextDelta(text.to_string()));
                                    }
                                }
                                "thinking_delta" => {
                                    let thinking = delta["thinking"].as_str().unwrap_or("");
                                    if !thinking.is_empty() {
                                        let _ = event_tx
                                            .send(StreamChunk::ThinkingDelta(thinking.to_string()));
                                    }
                                }
                                "input_json_delta" => {
                                    let partial = delta["partial_json"].as_str().unwrap_or("");
                                    current_tool_input_json.push_str(partial);
                                    let _ = event_tx
                                        .send(StreamChunk::ToolUseInputDelta(partial.to_string()));
                                }
                                _ => {}
                            }
                        }
                        "content_block_stop" => {
                            if !current_tool_name.is_empty() {
                                let input: Value = serde_json::from_str(&current_tool_input_json)
                                    .unwrap_or(json!({}));
                                content_blocks.push(ContentBlock::ToolUse {
                                    id: current_tool_id.clone(),
                                    name: current_tool_name.clone(),
                                    input,
                                });
                                current_tool_name.clear();
                                current_tool_id.clear();
                                current_tool_input_json.clear();
                                let _ = event_tx.send(StreamChunk::ToolUseEnd);
                            }
                        }
                        "message_delta" => {
                            if let Some(sr) = event["delta"]["stop_reason"].as_str() {
                                stop_reason = match sr {
                                    "tool_use" => StopReason::ToolUse,
                                    "max_tokens" => StopReason::MaxTokens,
                                    _ => StopReason::EndTurn,
                                };
                            }
                        }
                        "message_stop" => {
                            let _ = event_tx.send(StreamChunk::Done);
                        }
                        "error" => {
                            let err_msg = event["error"]["message"]
                                .as_str()
                                .unwrap_or("Unknown API error");
                            return Err(AIClientError::Api(err_msg.to_string()));
                        }
                        _ => {}
                    }
                }
            }
        }

        // Add accumulated text as a content block if present
        if !full_text.is_empty() {
            content_blocks.insert(0, ContentBlock::Text { text: full_text });
        }

        Ok(AssistantResponse {
            content: content_blocks,
            stop_reason,
        })
    }
}

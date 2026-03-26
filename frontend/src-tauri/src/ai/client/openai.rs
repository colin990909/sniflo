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

use super::{AIClient, normalize_base_url, openai_chat_completions_url};

pub struct OpenAIClient {
    base_url: String,
    api_key: String,
    model: String,
    http: Client,
}

impl OpenAIClient {
    pub fn new(base_url: String, api_key: String, model: String) -> Self {
        let base_url = normalize_base_url(&base_url, "https://api.openai.com/v1");
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

    /// Resolve the full chat completions endpoint URL.
    fn completions_url(&self) -> String {
        openai_chat_completions_url(&self.base_url)
    }

    /// Convert Anthropic-format messages to OpenAI format.
    fn convert_messages(messages: &[Message], system_prompt: &str) -> Vec<Value> {
        let mut oai_messages = Vec::new();

        if !system_prompt.is_empty() {
            oai_messages.push(json!({
                "role": "system",
                "content": system_prompt,
            }));
        }

        for msg in messages {
            match msg.role.as_str() {
                "assistant" => {
                    let mut oai_msg = json!({"role": "assistant"});
                    let mut text_parts = Vec::new();
                    let mut tool_calls = Vec::new();

                    for block in &msg.content {
                        match block {
                            ContentBlock::Text { text } => text_parts.push(text.clone()),
                            ContentBlock::ToolUse { id, name, input } => {
                                tool_calls.push(json!({
                                    "id": id,
                                    "type": "function",
                                    "function": {
                                        "name": name,
                                        "arguments": input.to_string(),
                                    }
                                }));
                            }
                            ContentBlock::ToolResult { .. } => {}
                        }
                    }

                    if !text_parts.is_empty() {
                        oai_msg["content"] = json!(text_parts.join(""));
                    }
                    if !tool_calls.is_empty() {
                        oai_msg["tool_calls"] = json!(tool_calls);
                    }
                    oai_messages.push(oai_msg);
                }
                "user" => {
                    // Check if this user message contains tool_results
                    let mut has_tool_results = false;
                    for block in &msg.content {
                        if let ContentBlock::ToolResult {
                            tool_use_id,
                            content,
                            ..
                        } = block
                        {
                            has_tool_results = true;
                            oai_messages.push(json!({
                                "role": "tool",
                                "tool_call_id": tool_use_id,
                                "content": content,
                            }));
                        }
                    }

                    if !has_tool_results {
                        let text: String = msg
                            .content
                            .iter()
                            .filter_map(|b| match b {
                                ContentBlock::Text { text } => Some(text.as_str()),
                                _ => None,
                            })
                            .collect::<Vec<_>>()
                            .join("");
                        if !text.is_empty() {
                            oai_messages.push(json!({
                                "role": "user",
                                "content": text,
                            }));
                        }
                    }
                }
                _ => {}
            }
        }

        oai_messages
    }

    /// Convert Anthropic tool definitions to OpenAI function format.
    fn convert_tools(tools: &[ToolDefinition]) -> Vec<Value> {
        tools
            .iter()
            .map(|t| {
                json!({
                    "type": "function",
                    "function": {
                        "name": t.name,
                        "description": t.description,
                        "parameters": t.input_schema,
                    }
                })
            })
            .collect()
    }
}

fn sse_data_payload(line: &str) -> Option<&str> {
    line.strip_prefix("data:").map(str::trim_start)
}

#[async_trait]
impl AIClient for OpenAIClient {
    async fn stream_chat(
        &self,
        messages: &[Message],
        tools: &[ToolDefinition],
        system_prompt: &str,
        event_tx: mpsc::UnboundedSender<StreamChunk>,
    ) -> Result<AssistantResponse, AIClientError> {
        let url = self.completions_url();
        let oai_messages = Self::convert_messages(messages, system_prompt);
        let oai_tools = Self::convert_tools(tools);

        let mut body = json!({
            "model": self.model,
            "messages": oai_messages,
            "stream": true,
        });

        if !oai_tools.is_empty() {
            body["tools"] = json!(oai_tools);
        }

        let response = self
            .http
            .post(&url)
            .header("Authorization", format!("Bearer {}", self.api_key))
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

        let mut stream = response.bytes_stream();
        let mut buffer = String::new();
        let mut full_text = String::new();
        let mut stop_reason = StopReason::EndTurn;
        let mut stream_done = false;

        // Track tool calls by index
        let mut tool_calls: Vec<ToolCallAccumulator> = Vec::new();

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

            while let Some(line_end) = buffer.find('\n') {
                let line = buffer[..line_end].trim().to_string();
                buffer = buffer[line_end + 1..].to_string();

                if line.is_empty() {
                    continue;
                }

                let Some(data) = sse_data_payload(&line) else {
                    continue;
                };

                if data == "[DONE]" {
                    let _ = event_tx.send(StreamChunk::Done);
                    stream_done = true;
                    break;
                }

                let event: Value = match serde_json::from_str(data) {
                    Ok(v) => v,
                    Err(_) => continue,
                };

                let choices = &event["choices"];
                let Some(choice) = choices.get(0) else {
                    continue;
                };

                // Check finish_reason
                if let Some(fr) = choice["finish_reason"].as_str() {
                    stop_reason = match fr {
                        "tool_calls" => StopReason::ToolUse,
                        "length" => StopReason::MaxTokens,
                        _ => StopReason::EndTurn,
                    };
                }

                let delta = &choice["delta"];

                // Text content
                if let Some(text) = delta["content"].as_str()
                    && !text.is_empty()
                {
                    full_text.push_str(text);
                    let _ = event_tx.send(StreamChunk::TextDelta(text.to_string()));
                }

                // Reasoning/thinking content (DeepSeek, Qwen, etc.)
                if let Some(thinking) = delta["reasoning_content"]
                    .as_str()
                    .or_else(|| delta["reasoning"].as_str())
                    && !thinking.is_empty()
                {
                    let _ = event_tx.send(StreamChunk::ThinkingDelta(thinking.to_string()));
                }

                // Tool calls
                if let Some(tc_array) = delta["tool_calls"].as_array() {
                    for tc in tc_array {
                        let idx = tc["index"].as_u64().unwrap_or(0) as usize;

                        // Ensure accumulator exists
                        while tool_calls.len() <= idx {
                            tool_calls.push(ToolCallAccumulator::default());
                        }

                        let acc = &mut tool_calls[idx];

                        if let Some(id) = tc["id"].as_str() {
                            acc.id = id.to_string();
                        }
                        if let Some(name) = tc["function"]["name"].as_str() {
                            acc.name = name.to_string();
                            let _ = event_tx.send(StreamChunk::ToolUseStart {
                                id: acc.id.clone(),
                                name: acc.name.clone(),
                            });
                        }
                        if let Some(args) = tc["function"]["arguments"].as_str() {
                            acc.arguments.push_str(args);
                            let _ = event_tx.send(StreamChunk::ToolUseInputDelta(args.to_string()));
                        }
                    }
                }
            }

            if stream_done {
                break;
            }
        }

        // Build content blocks
        let mut content_blocks = Vec::new();
        if !full_text.is_empty() {
            content_blocks.push(ContentBlock::Text { text: full_text });
        }
        for tc in &tool_calls {
            if !tc.name.is_empty() {
                let input: Value = serde_json::from_str(&tc.arguments).unwrap_or(json!({}));
                content_blocks.push(ContentBlock::ToolUse {
                    id: tc.id.clone(),
                    name: tc.name.clone(),
                    input,
                });
                let _ = event_tx.send(StreamChunk::ToolUseEnd);
            }
        }

        Ok(AssistantResponse {
            content: content_blocks,
            stop_reason,
        })
    }
}

#[derive(Default)]
struct ToolCallAccumulator {
    id: String,
    name: String,
    arguments: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sse_data_payload_accepts_data_lines_with_or_without_space() {
        assert_eq!(sse_data_payload("data: [DONE]"), Some("[DONE]"));
        assert_eq!(sse_data_payload("data:[DONE]"), Some("[DONE]"));
        assert_eq!(sse_data_payload("data: {\"x\":1}"), Some("{\"x\":1}"));
        assert_eq!(sse_data_payload("data:{\"x\":1}"), Some("{\"x\":1}"));
        assert_eq!(sse_data_payload("event: message"), None);
    }
}

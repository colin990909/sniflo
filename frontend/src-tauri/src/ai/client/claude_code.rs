use async_trait::async_trait;
use serde::Deserialize;
use serde_json::Value;
use std::path::PathBuf;
use std::process::Stdio;
use tokio::io::AsyncBufReadExt;
use tokio::io::AsyncReadExt;
use tokio::process::Command;
use tokio::sync::mpsc;

use crate::ai::types::{
    AIClientError, AssistantResponse, ContentBlock, Message, StopReason, StreamChunk,
    ToolDefinition,
};

use super::AIClient;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeCodeRuntimeConfig {
    pub cli_path: Option<String>,
    pub model: Option<String>,
    pub working_directory: Option<String>,
    #[serde(default)]
    pub max_context_tokens: u32,
}

pub struct ClaudeCodeCliClient {
    cli_path: String,
    model: String,
    working_directory: Option<PathBuf>,
}

impl ClaudeCodeCliClient {
    pub fn available_models(current_model: Option<&str>) -> Vec<super::RuntimeModelDescriptor> {
        let mut models = vec![
            super::RuntimeModelDescriptor {
                id: "sonnet".to_string(),
                display_name: Some("Sonnet".to_string()),
            },
            super::RuntimeModelDescriptor {
                id: "opus".to_string(),
                display_name: Some("Opus".to_string()),
            },
            super::RuntimeModelDescriptor {
                id: "haiku".to_string(),
                display_name: Some("Haiku".to_string()),
            },
            super::RuntimeModelDescriptor {
                id: "default".to_string(),
                display_name: Some("Default".to_string()),
            },
            super::RuntimeModelDescriptor {
                id: "sonnet[1m]".to_string(),
                display_name: Some("Sonnet 1M".to_string()),
            },
            super::RuntimeModelDescriptor {
                id: "opusplan".to_string(),
                display_name: Some("Opus Plan".to_string()),
            },
            super::RuntimeModelDescriptor {
                id: "claude-sonnet-4-5".to_string(),
                display_name: Some("Claude Sonnet 4.5".to_string()),
            },
            super::RuntimeModelDescriptor {
                id: "claude-opus-4-1".to_string(),
                display_name: Some("Claude Opus 4.1".to_string()),
            },
        ];

        if let Some(current) = current_model
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .filter(|current| !models.iter().any(|model| model.id == *current))
        {
            models.insert(
                0,
                super::RuntimeModelDescriptor {
                    id: current.to_string(),
                    display_name: Some(current.to_string()),
                },
            );
        }

        models
    }

    pub fn from_config(config: ClaudeCodeRuntimeConfig) -> Self {
        Self {
            cli_path: config
                .cli_path
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| "claude".to_string()),
            model: config
                .model
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| "sonnet".to_string()),
            working_directory: config
                .working_directory
                .filter(|value| !value.trim().is_empty())
                .map(PathBuf::from),
        }
    }

    fn build_prompt(messages: &[Message], tools: &[ToolDefinition]) -> String {
        let mut prompt = String::new();

        let tool_section = super::build_tool_prompt_section(tools);
        if !tool_section.is_empty() {
            prompt.push_str(&tool_section);
        }

        prompt.push_str("Conversation:\n");

        for message in messages {
            prompt.push_str(&format!(
                "{}:\n{}\n\n",
                message.role,
                render_message(message)
            ));
        }

        prompt.push_str("Respond to the latest user message.");
        prompt
    }

    fn command_args(&self, system_prompt: &str, prompt: &str) -> Vec<String> {
        let mut args = vec![
            "--model".to_string(),
            self.model.clone(),
            "--print".to_string(),
            "--output-format".to_string(),
            "stream-json".to_string(),
            "--verbose".to_string(),
            "--dangerously-skip-permissions".to_string(),
        ];

        if !system_prompt.trim().is_empty() {
            args.push("--append-system-prompt".to_string());
            args.push(system_prompt.trim().to_string());
        }

        args.push(prompt.to_string());
        args
    }
}

fn render_message(message: &Message) -> String {
    let mut rendered = Vec::new();

    for block in &message.content {
        match block {
            ContentBlock::Text { text } => rendered.push(text.clone()),
            ContentBlock::ToolUse { name, input, .. } => {
                rendered.push(format!("Tool call `{name}` with input {}", input))
            }
            ContentBlock::ToolResult {
                tool_use_id,
                content,
                is_error,
            } => {
                let prefix = if *is_error {
                    "Tool error"
                } else {
                    "Tool result"
                };
                rendered.push(format!("{prefix} `{tool_use_id}`: {content}"));
            }
        }
    }

    rendered.join("\n")
}

fn extract_result_text(stdout: &str) -> Result<String, AIClientError> {
    let value: Value = serde_json::from_str(stdout.trim()).map_err(|e| {
        AIClientError::Parse(format!("Failed to parse Claude Code JSON output: {e}"))
    })?;

    if let Some(error) = value.get("error").and_then(Value::as_str) {
        return Err(AIClientError::Api(error.to_string()));
    }

    if value.get("subtype").and_then(Value::as_str) == Some("error") {
        let message = value
            .get("result")
            .and_then(Value::as_str)
            .or_else(|| value.get("message").and_then(Value::as_str))
            .unwrap_or("Claude Code returned an error");
        return Err(AIClientError::Api(message.to_string()));
    }

    let result = value
        .get("result")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .ok_or_else(|| AIClientError::Parse("Claude Code returned no result text".to_string()))?;

    Ok(result.to_string())
}

/// Resolves a CLI binary name to its full path via the user's login shell.
/// GUI apps on macOS do not inherit shell PATH (e.g. NVM, Homebrew paths).
async fn resolve_cli_path(cli_path: &str) -> String {
    if cli_path.starts_with('/') {
        return cli_path.to_string();
    }

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let which_cmd = format!("which {cli_path}");

    if let Ok(output) = Command::new(&shell)
        .args(["-l", "-c", &which_cmd])
        .output()
        .await
    {
        if output.status.success() {
            let resolved = String::from_utf8_lossy(&output.stdout)
                .trim()
                .to_string();
            if !resolved.is_empty() {
                return resolved;
            }
        }
    }

    cli_path.to_string()
}

#[async_trait]
impl AIClient for ClaudeCodeCliClient {
    async fn stream_chat(
        &self,
        messages: &[Message],
        tools: &[ToolDefinition],
        system_prompt: &str,
        event_tx: mpsc::UnboundedSender<StreamChunk>,
    ) -> Result<AssistantResponse, AIClientError> {
        let prompt = Self::build_prompt(messages, tools);
        let resolved_cli_path = resolve_cli_path(&self.cli_path).await;

        let mut command = Command::new(&resolved_cli_path);
        command
            .args(self.command_args(system_prompt, &prompt))
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .env("CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC", "1");

        if let Some(ref working_directory) = self.working_directory {
            command.current_dir(working_directory);
        }

        let mut child = command.spawn().map_err(|e| {
            AIClientError::Network(format!(
                "Failed to start Claude Code CLI at '{}': {e}",
                resolved_cli_path
            ))
        })?;

        let stdout = child.stdout.take().ok_or_else(|| {
            AIClientError::Network("Failed to capture Claude Code CLI stdout".to_string())
        })?;
        let stderr = child.stderr.take().ok_or_else(|| {
            AIClientError::Network("Failed to capture Claude Code CLI stderr".to_string())
        })?;

        // Read stdout line by line: emit thinking deltas in real-time,
        // capture the final `result` event for the authoritative response text.
        let stdout_task = {
            let event_tx = event_tx.clone();
            tokio::spawn(async move {
                let mut reader = tokio::io::BufReader::new(stdout).lines();
                let mut final_result: Result<String, String> =
                    Err(String::new());

                while let Some(line) = reader.next_line().await? {
                    let Ok(value) = serde_json::from_str::<Value>(&line) else {
                        continue;
                    };

                    let event_type =
                        value.get("type").and_then(Value::as_str).unwrap_or("");

                    match event_type {
                        "assistant" => {
                            // Emit thinking content blocks immediately as they arrive.
                            if let Some(blocks) = value
                                .pointer("/message/content")
                                .and_then(Value::as_array)
                            {
                                for block in blocks {
                                    if block.get("type").and_then(Value::as_str)
                                        == Some("thinking")
                                    {
                                        if let Some(thinking) =
                                            block.get("thinking").and_then(Value::as_str)
                                        {
                                            let _ = event_tx.send(
                                                StreamChunk::ThinkingDelta(thinking.to_string()),
                                            );
                                        }
                                    }
                                }
                            }
                        }
                        "result" => {
                            final_result =
                                extract_result_text(&line).map_err(|e| e.to_string());
                        }
                        _ => {}
                    }
                }

                Ok::<Result<String, String>, std::io::Error>(final_result)
            })
        };

        let stderr_task = tokio::spawn(async move {
            let mut reader = tokio::io::BufReader::new(stderr);
            let mut collected = String::new();
            reader.read_to_string(&mut collected).await?;
            Ok::<String, std::io::Error>(collected)
        });

        let status = child.wait().await.map_err(|e| {
            AIClientError::Network(format!("Failed waiting for Claude Code CLI: {e}"))
        })?;

        let inner_result = stdout_task
            .await
            .map_err(|e| {
                AIClientError::Network(format!(
                    "Failed joining Claude Code stdout task: {e}"
                ))
            })?
            .map_err(|e| {
                AIClientError::Network(format!("Failed reading Claude Code CLI stdout: {e}"))
            })?;

        let stderr_text = stderr_task
            .await
            .map_err(|e| {
                AIClientError::Network(format!(
                    "Failed joining Claude Code stderr task: {e}"
                ))
            })?
            .map_err(|e| {
                AIClientError::Network(format!("Failed reading Claude Code CLI stderr: {e}"))
            })?;

        if !status.success() {
            let error_msg = match &inner_result {
                Err(msg) if !msg.is_empty() => msg.clone(),
                _ => {
                    let s = stderr_text.trim().to_string();
                    if s.is_empty() {
                        "Claude Code exited without a readable error message".to_string()
                    } else {
                        s
                    }
                }
            };
            return Err(AIClientError::Api(error_msg));
        }

        let final_text = inner_result.map_err(AIClientError::Api)?;
        let (text_content, tool_calls) = super::parse_tool_calls(&final_text);

        if tool_calls.is_empty() {
            let _ = event_tx.send(StreamChunk::TextDelta(final_text.clone()));
            let _ = event_tx.send(StreamChunk::Done);
            return Ok(AssistantResponse {
                content: vec![ContentBlock::Text { text: final_text }],
                stop_reason: StopReason::EndTurn,
            });
        }

        let mut content: Vec<ContentBlock> = Vec::new();
        let trimmed_text = text_content.trim().to_string();
        if !trimmed_text.is_empty() {
            let _ = event_tx.send(StreamChunk::TextDelta(trimmed_text.clone()));
            content.push(ContentBlock::Text { text: trimmed_text });
        }
        for call in tool_calls {
            content.push(ContentBlock::ToolUse {
                id: call.id,
                name: call.name,
                input: call.input,
            });
        }
        let _ = event_tx.send(StreamChunk::Done);
        Ok(AssistantResponse {
            content,
            stop_reason: StopReason::ToolUse,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::types::Message;

    #[test]
    fn claude_command_arguments_use_stream_json_format() {
        let client = ClaudeCodeCliClient::from_config(ClaudeCodeRuntimeConfig {
            cli_path: Some("/usr/local/bin/claude".to_string()),
            model: Some("sonnet".to_string()),
            working_directory: Some("/tmp".to_string()),
            max_context_tokens: 0,
        });

        let args = client.command_args("System prompt", "Inspect this request");

        assert!(args.contains(&"--print".to_string()));
        assert!(args.contains(&"--output-format".to_string()));
        assert!(args.contains(&"stream-json".to_string()));
        assert!(args.contains(&"--verbose".to_string()));
        assert!(args.contains(&"--append-system-prompt".to_string()));
        assert_eq!(
            args.last().map(String::as_str),
            Some("Inspect this request")
        );
    }

    #[test]
    fn prompt_includes_conversation_text() {
        let prompt = ClaudeCodeCliClient::build_prompt(
            &[Message {
                role: "user".to_string(),
                content: vec![ContentBlock::Text {
                    text: "Check this request".to_string(),
                }],
            }],
            &[],
        );

        assert!(prompt.contains("Conversation:"));
        assert!(prompt.contains("Check this request"));
    }

    #[test]
    fn available_models_returns_curated_claude_options() {
        let models = ClaudeCodeCliClient::available_models(None);

        assert!(!models.is_empty());
        assert!(models.iter().any(|model| model.id == "sonnet"));
        assert!(models.iter().any(|model| model.id == "claude-sonnet-4-5"));
    }

    #[test]
    fn available_models_preserves_current_unknown_model() {
        let models = ClaudeCodeCliClient::available_models(Some("custom-claude-preview"));

        assert_eq!(
            models.first().map(|model| model.id.as_str()),
            Some("custom-claude-preview")
        );
    }

    #[test]
    fn extract_result_text_reads_json_result_field() {
        let text = extract_result_text(
            r#"{"type":"result","subtype":"success","result":"All checks passed"}"#,
        )
        .unwrap();

        assert_eq!(text, "All checks passed");
    }
}

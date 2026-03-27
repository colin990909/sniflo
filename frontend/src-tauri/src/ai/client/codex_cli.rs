use async_trait::async_trait;
use serde::Deserialize;
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::io::AsyncBufReadExt;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;
use tokio::sync::mpsc;

use crate::ai::types::{
    AIClientError, AssistantResponse, ContentBlock, Message, StopReason, StreamChunk,
    ToolDefinition,
};

use super::AIClient;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexCliRuntimeConfig {
    pub cli_path: Option<String>,
    pub model: Option<String>,
    pub working_directory: Option<String>,
    pub approval_policy: Option<String>,
    pub sandbox_mode: Option<String>,
    #[serde(default)]
    pub max_context_tokens: u32,
}

pub struct CodexCliClient {
    cli_path: String,
    model: String,
    working_directory: Option<PathBuf>,
    approval_policy: String,
    sandbox_mode: String,
}

impl CodexCliClient {
    pub fn available_models(current_model: Option<&str>) -> Vec<super::RuntimeModelDescriptor> {
        let mut models = vec![
            super::RuntimeModelDescriptor {
                id: "gpt-5.3-codex".to_string(),
                display_name: Some("GPT-5.3 Codex".to_string()),
            },
            super::RuntimeModelDescriptor {
                id: "gpt-5.2-codex".to_string(),
                display_name: Some("GPT-5.2 Codex".to_string()),
            },
            super::RuntimeModelDescriptor {
                id: "gpt-5.1-codex-max".to_string(),
                display_name: Some("GPT-5.1 Codex Max".to_string()),
            },
            super::RuntimeModelDescriptor {
                id: "gpt-5.1-codex".to_string(),
                display_name: Some("GPT-5.1 Codex".to_string()),
            },
            super::RuntimeModelDescriptor {
                id: "gpt-5.1-codex-mini".to_string(),
                display_name: Some("GPT-5.1 Codex Mini".to_string()),
            },
            super::RuntimeModelDescriptor {
                id: "gpt-5-codex".to_string(),
                display_name: Some("GPT-5 Codex".to_string()),
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

    pub fn from_config(config: CodexCliRuntimeConfig) -> Self {
        Self {
            cli_path: config
                .cli_path
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| "codex".to_string()),
            model: config
                .model
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| "gpt-5-codex".to_string()),
            working_directory: config
                .working_directory
                .filter(|value| !value.trim().is_empty())
                .map(PathBuf::from),
            approval_policy: config
                .approval_policy
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| "on-request".to_string()),
            sandbox_mode: config
                .sandbox_mode
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| "workspace-write".to_string()),
        }
    }

    fn build_prompt(
        messages: &[Message],
        system_prompt: &str,
        tools: &[ToolDefinition],
    ) -> String {
        let mut prompt = String::new();

        if !system_prompt.trim().is_empty() {
            prompt.push_str("System instructions:\n");
            prompt.push_str(system_prompt.trim());
            prompt.push_str("\n\n");
        }

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

    fn command_args(&self, output_path: &Path) -> Vec<String> {
        vec![
            "-m".to_string(),
            self.model.clone(),
            "-s".to_string(),
            self.sandbox_mode.clone(),
            "-a".to_string(),
            self.approval_policy.clone(),
            "exec".to_string(),
            "--json".to_string(),
            "--color".to_string(),
            "never".to_string(),
            "--skip-git-repo-check".to_string(),
            "-o".to_string(),
            output_path.display().to_string(),
            "-".to_string(),
        ]
    }

    fn temporary_output_path() -> PathBuf {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        std::env::temp_dir().join(format!(
            "sniflo-codex-last-message-{}-{timestamp}.txt",
            std::process::id()
        ))
    }

    fn extract_error_message(stdout: &str, stderr: &str) -> String {
        let mut structured_message: Option<String> = None;

        for line in stdout.lines() {
            let Ok(value) = serde_json::from_str::<Value>(line) else {
                continue;
            };

            let event_type = value
                .get("type")
                .and_then(Value::as_str)
                .unwrap_or_default();
            if event_type.contains("error") || event_type.ends_with("failed") {
                if let Some(message) = value.get("message").and_then(Value::as_str) {
                    structured_message = Some(message.to_string());
                } else if let Some(message) =
                    value.pointer("/error/message").and_then(Value::as_str)
                {
                    structured_message = Some(message.to_string());
                }
            }
        }

        structured_message
            .or_else(|| {
                let stderr = stderr.trim();
                if stderr.is_empty() {
                    None
                } else {
                    Some(stderr.to_string())
                }
            })
            .or_else(|| {
                let stdout = stdout.trim();
                if stdout.is_empty() {
                    None
                } else {
                    Some(stdout.to_string())
                }
            })
            .unwrap_or_else(|| "Codex CLI exited without a readable error message".to_string())
    }

    fn extract_thinking_delta(line: &str) -> Option<String> {
        let value = serde_json::from_str::<Value>(line).ok()?;

        let event_type = value
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or_default();

        let is_reasoning_event = event_type.contains("reasoning")
            || event_type.contains("thinking")
            || matches!(
                value.pointer("/item/type").and_then(Value::as_str),
                Some("reasoning") | Some("thinking")
            );

        if !is_reasoning_event {
            return None;
        }

        extract_reasoning_text(&value)
    }
}

fn extract_reasoning_text(value: &Value) -> Option<String> {
    const PRIORITY_KEYS: &[&str] = &["delta", "output_text", "text", "summary", "content"];

    match value {
        Value::String(text) => {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        }
        Value::Array(items) => items.iter().find_map(extract_reasoning_text),
        Value::Object(map) => {
            for key in PRIORITY_KEYS {
                if let Some(found) = map.get(*key).and_then(extract_reasoning_text) {
                    return Some(found);
                }
            }

            for (key, nested) in map {
                if key == "type" {
                    continue;
                }
                if let Some(found) = extract_reasoning_text(nested) {
                    return Some(found);
                }
            }

            None
        }
        _ => None,
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

/// Resolves a CLI binary name to its full path via the user's login shell.
/// This is necessary on macOS/Linux GUI apps that don't inherit the shell PATH
/// (e.g. NVM-managed node binaries).
async fn resolve_cli_path(cli_path: &str) -> String {
    // If already an absolute path, use it directly.
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
impl AIClient for CodexCliClient {
    async fn stream_chat(
        &self,
        messages: &[Message],
        tools: &[ToolDefinition],
        system_prompt: &str,
        event_tx: mpsc::UnboundedSender<StreamChunk>,
    ) -> Result<AssistantResponse, AIClientError> {
        let prompt = Self::build_prompt(messages, system_prompt, tools);
        let output_path = Self::temporary_output_path();

        let resolved_cli_path = resolve_cli_path(&self.cli_path).await;

        let mut command = Command::new(&resolved_cli_path);
        command
            .args(self.command_args(&output_path))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .env("OTEL_SDK_DISABLED", "true");

        if let Some(ref working_directory) = self.working_directory {
            command.current_dir(working_directory);
        }

        let mut child = command.spawn().map_err(|e| {
            AIClientError::Network(format!(
                "Failed to start Codex CLI at '{}': {e}",
                resolved_cli_path
            ))
        })?;

        let stdout = child.stdout.take().ok_or_else(|| {
            AIClientError::Network("Failed to capture Codex CLI stdout".to_string())
        })?;
        let stderr = child.stderr.take().ok_or_else(|| {
            AIClientError::Network("Failed to capture Codex CLI stderr".to_string())
        })?;

        if let Some(mut stdin) = child.stdin.take() {
            stdin.write_all(prompt.as_bytes()).await.map_err(|e| {
                AIClientError::Network(format!("Failed to write prompt to Codex CLI: {e}"))
            })?;
            stdin.shutdown().await.map_err(|e| {
                AIClientError::Network(format!("Failed to close Codex CLI stdin: {e}"))
            })?;
        }

        let stdout_task = {
            let event_tx = event_tx.clone();
            tokio::spawn(async move {
                let mut reader = tokio::io::BufReader::new(stdout).lines();
                let mut collected = String::new();

                while let Some(line) = reader.next_line().await? {
                    if let Some(thinking) = Self::extract_thinking_delta(&line) {
                        let _ = event_tx.send(StreamChunk::ThinkingDelta(thinking));
                    }

                    collected.push_str(&line);
                    collected.push('\n');
                }

                Ok::<String, std::io::Error>(collected)
            })
        };

        let stderr_task = tokio::spawn(async move {
            let mut reader = tokio::io::BufReader::new(stderr);
            let mut collected = String::new();
            tokio::io::AsyncReadExt::read_to_string(&mut reader, &mut collected).await?;
            Ok::<String, std::io::Error>(collected)
        });

        let status = child
            .wait()
            .await
            .map_err(|e| AIClientError::Network(format!("Failed waiting for Codex CLI: {e}")))?;

        let stdout = stdout_task
            .await
            .map_err(|e| AIClientError::Network(format!("Failed joining Codex stdout task: {e}")))?
            .map_err(|e| AIClientError::Network(format!("Failed reading Codex CLI stdout: {e}")))?;
        let stderr = stderr_task
            .await
            .map_err(|e| AIClientError::Network(format!("Failed joining Codex stderr task: {e}")))?
            .map_err(|e| AIClientError::Network(format!("Failed reading Codex CLI stderr: {e}")))?;

        if !status.success() {
            let _ = tokio::fs::remove_file(&output_path).await;
            return Err(AIClientError::Api(Self::extract_error_message(
                &stdout, &stderr,
            )));
        }

        let final_text = tokio::fs::read_to_string(&output_path)
            .await
            .unwrap_or_default()
            .trim()
            .to_string();
        let _ = tokio::fs::remove_file(&output_path).await;

        if final_text.is_empty() {
            return Err(AIClientError::Parse(Self::extract_error_message(
                &stdout, &stderr,
            )));
        }

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
    fn codex_command_arguments_put_global_flags_before_exec() {
        let client = CodexCliClient::from_config(CodexCliRuntimeConfig {
            cli_path: Some("/usr/local/bin/codex".to_string()),
            model: Some("gpt-5-codex".to_string()),
            working_directory: Some("/tmp".to_string()),
            approval_policy: Some("on-request".to_string()),
            sandbox_mode: Some("workspace-write".to_string()),
            max_context_tokens: 0,
        });

        let args = client.command_args(Path::new("/tmp/out.txt"));

        assert_eq!(args[0], "-m");
        assert_eq!(args[2], "-s");
        assert_eq!(args[4], "-a");
        assert_eq!(args[6], "exec");
        assert!(args.contains(&"--json".to_string()));
        assert_eq!(args.last().map(String::as_str), Some("-"));
    }

    #[test]
    fn prompt_includes_system_and_conversation_text() {
        let prompt = CodexCliClient::build_prompt(
            &[Message {
                role: "user".to_string(),
                content: vec![ContentBlock::Text {
                    text: "Check this request".to_string(),
                }],
            }],
            "You are inside Sniflo.",
            &[],
        );

        assert!(prompt.contains("System instructions:"));
        assert!(prompt.contains("Conversation:"));
        assert!(prompt.contains("Check this request"));
    }

    #[test]
    fn available_models_returns_curated_codex_options() {
        let models = CodexCliClient::available_models(None);

        assert!(!models.is_empty());
        assert!(models.iter().any(|model| model.id == "gpt-5-codex"));
    }

    #[test]
    fn available_models_preserves_current_unknown_model() {
        let models = CodexCliClient::available_models(Some("custom-codex-preview"));

        assert_eq!(
            models.first().map(|model| model.id.as_str()),
            Some("custom-codex-preview")
        );
    }

    #[test]
    fn extract_thinking_delta_reads_reasoning_summary_delta_events() {
        let delta = CodexCliClient::extract_thinking_delta(
            r#"{"type":"response.reasoning_summary_text.delta","delta":"Inspecting request headers..."}"#,
        );

        assert_eq!(delta.as_deref(), Some("Inspecting request headers..."));
    }

    #[test]
    fn extract_thinking_delta_ignores_non_reasoning_events() {
        let delta = CodexCliClient::extract_thinking_delta(
            r#"{"type":"response.output_text.delta","delta":"Final answer"}"#,
        );

        assert!(delta.is_none());
    }

    #[test]
    fn extract_thinking_delta_reads_reasoning_summary_part_done_events() {
        let delta = CodexCliClient::extract_thinking_delta(
            r#"{"type":"response.reasoning_summary_part.done","part":{"type":"summary_text","text":"Tracing the redirect chain..."}}"#,
        );

        assert_eq!(delta.as_deref(), Some("Tracing the redirect chain..."));
    }

    #[test]
    fn extract_thinking_delta_reads_nested_reasoning_delta_fields() {
        let delta = CodexCliClient::extract_thinking_delta(
            r#"{"type":"response.reasoning_summary_text.delta","part":{"delta":"Checking auth cookie flow..."}}"#,
        );

        assert_eq!(delta.as_deref(), Some("Checking auth cookie flow..."));
    }
}

use std::sync::Arc;

use serde::Deserialize;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{mpsc, watch};

use crate::ai::client::{self, AIClient};
use crate::ai::context;
use crate::ai::skill::ResolvedSkillTool;
use crate::ai::tools::ToolRegistry;
use crate::ai::tools::breakpoint_tools::*;
use crate::ai::tools::cert_tools::*;
use crate::ai::tools::export_tools::*;
use crate::ai::tools::proxy_tools::*;
use crate::ai::tools::script_tools::*;
use crate::ai::tools::selected_sessions_tool::*;
use crate::ai::tools::session_tools::*;
use crate::ai::types::*;
use crate::commands::ai::AIAgentState;
use crate::storage::db::Database;
use crate::storage::runtime_repo::{self, AIRuntimeEntry};

const DEFAULT_SYSTEM_PROMPT: &str = r#"You are an AI assistant integrated into an HTTP proxy debugger. You can analyze captured HTTP sessions, manage breakpoint rules, manage user scripts that automatically modify HTTP traffic, check proxy and certificate status, and export sessions.

When the user asks you to analyze traffic, search sessions, or debug HTTP issues, use the available tools to access the proxy's captured data. You can also create scripts to automatically modify requests and responses — for example, adding headers, rewriting URLs, or mocking responses. Always provide clear, actionable insights based on the actual data."#;

/// Build a ToolRegistry with all builtin tools.
pub fn build_builtin_registry(app_handle: &AppHandle) -> ToolRegistry {
    let mut registry = ToolRegistry::new();

    registry.register(Box::new(ListSessionsTool::new(app_handle.clone())));
    registry.register(Box::new(GetSessionDetailTool::new(app_handle.clone())));
    registry.register(Box::new(SearchSessionsTool::new(app_handle.clone())));
    registry.register(Box::new(CompareSessionsTool::new(app_handle.clone())));
    registry.register(Box::new(ListBreakpointRulesTool::new(app_handle.clone())));
    registry.register(Box::new(AddBreakpointRuleTool::new(app_handle.clone())));
    registry.register(Box::new(GetProxyStatusTool::new(app_handle.clone())));
    registry.register(Box::new(GetCertStatusTool::new(app_handle.clone())));
    registry.register(Box::new(ExportSessionTool::new(app_handle.clone())));
    registry.register(Box::new(GetSelectedSessionsTool::new(app_handle.clone())));
    registry.register(Box::new(ListScriptsTool::new(app_handle.clone())));
    registry.register(Box::new(AddScriptTool::new(app_handle.clone())));
    registry.register(Box::new(ToggleScriptTool::new(app_handle.clone())));

    registry
}

/// Build the system prompt, optionally including skill prompt and attached session context.
/// Attached sessions are fetched inline so the AI can analyze them immediately
/// without needing to call get_session_detail (eliminates redundant tool calls).
/// Session data is size-limited to prevent blowing up the context window.
fn build_system_prompt(
    skill_prompt: Option<&str>,
    attached_session_ids: &[String],
    app_handle: &AppHandle,
) -> String {
    let mut prompt = DEFAULT_SYSTEM_PROMPT.to_string();

    if let Some(skill) = skill_prompt {
        prompt.push_str("\n\n--- Skill Instructions ---\n");
        prompt.push_str(skill);
    }

    if !attached_session_ids.is_empty() {
        let proxy_state = app_handle.state::<crate::commands::proxy::ProxyState>();
        let sessions = proxy_state.sessions.lock();
        let ai_state = app_handle.state::<AIAgentState>();

        let mut session_section = format!(
            "\n\n--- Attached Sessions ({}) ---\n\
             The following session data is provided inline. \
             Do NOT call get_session_detail for these sessions — the data is already here.\n",
            attached_session_ids.len(),
        );

        for id in attached_session_ids {
            if let Some(session) = sessions.iter().find(|s| s.id == *id) {
                // Pre-populate the per-turn cache so redundant tool calls are instant
                ai_state
                    .session_detail_cache
                    .lock()
                    .insert(id.clone(), session.clone());

                if let Ok(json) = serde_json::to_string_pretty(session) {
                    session_section.push_str(&format!("\n[Session {}]\n{}\n", id, json));
                }
            } else {
                session_section.push_str(&format!("\n[Session {} — not found]\n", id));
            }
        }

        // Limit session data size to prevent context window overflow
        prompt.push_str(&context::limit_session_data(&session_section));
    }

    let state = app_handle.state::<crate::commands::proxy::ProxyState>();
    let running = state.running.load(std::sync::atomic::Ordering::SeqCst);
    prompt.push_str(&format!(
        "\n\nProxy status: {}",
        if running { "running" } else { "stopped" }
    ));

    prompt
}

fn extract_text(content: &[ContentBlock]) -> String {
    content
        .iter()
        .filter_map(|b| match b {
            ContentBlock::Text { text } => Some(text.as_str()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("")
}

async fn execute_tool_call(
    tool_registry: &ToolRegistry,
    resolved_skill_tool: Option<ResolvedSkillTool>,
    name: &str,
    input: serde_json::Value,
) -> crate::ai::tools::ToolOutput {
    if let Some(output) = tool_registry.execute(name, input.clone()).await {
        return output;
    }

    if let Some(skill_tool) = resolved_skill_tool {
        return crate::ai::skill::execute_resolved_tool(&skill_tool, input).await;
    }

    crate::ai::tools::ToolOutput {
        content: format!("Unknown tool: {name}"),
        is_error: true,
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RemoteApiRuntimeConfig {
    protocol: String,
    base_url: String,
    api_key: String,
    model: String,
    #[serde(default)]
    max_context_tokens: u32,
}

fn resolve_runtime_execution(
    runtime: &AIRuntimeEntry,
    model_override: Option<&str>,
) -> Result<(u32, Arc<dyn AIClient>), String> {
    let model_override = model_override
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string);

    match runtime.runtime_type.as_str() {
        "remote_api" => {
            let mut config =
                serde_json::from_value::<RemoteApiRuntimeConfig>(runtime.config.clone())
                    .map_err(|error| format!("Invalid remote runtime config: {error}"))?;

            if let Some(ref model) = model_override {
                config.model = model.clone();
            }

            let context_budget = context::resolve_context_budget(
                config.max_context_tokens,
                &format!("remote_api:{}", config.protocol),
            );

            let client = client::create_remote_client(
                &config.protocol,
                config.base_url,
                config.api_key,
                config.model,
            )
            .map(Arc::from)
            .map_err(|error| format!("Failed to create remote runtime client: {error}"))?;

            Ok((context_budget, client))
        }
        "codex_local" => {
            let mut config = serde_json::from_value::<
                crate::ai::client::codex_cli::CodexCliRuntimeConfig,
            >(runtime.config.clone())
            .map_err(|error| format!("Invalid Codex runtime config: {error}"))?;

            if let Some(ref model) = model_override {
                config.model = Some(model.clone());
            }

            let context_budget =
                context::resolve_context_budget(config.max_context_tokens, "codex_local");
            let client: Arc<dyn AIClient> = Arc::new(
                crate::ai::client::codex_cli::CodexCliClient::from_config(config),
            );

            Ok((context_budget, client))
        }
        "claude_code_local" => {
            let mut config = serde_json::from_value::<
                crate::ai::client::claude_code::ClaudeCodeRuntimeConfig,
            >(runtime.config.clone())
            .map_err(|error| format!("Invalid Claude Code runtime config: {error}"))?;

            if let Some(ref model) = model_override {
                config.model = Some(model.clone());
            }

            let context_budget =
                context::resolve_context_budget(config.max_context_tokens, "claude_code_local");
            let client: Arc<dyn AIClient> =
                Arc::new(crate::ai::client::claude_code::ClaudeCodeCliClient::from_config(config));

            Ok((context_budget, client))
        }
        runtime_type => Err(format!(
            "Runtime type `{runtime_type}` is not wired into the execution engine yet"
        )),
    }
}

/// Check if an API error is a context window overflow error.
fn is_context_window_error(error: &AIClientError) -> bool {
    let msg = error.to_string().to_lowercase();
    msg.contains("context window")
        || msg.contains("context_length_exceeded")
        || msg.contains("maximum context length")
        || msg.contains("token limit")
        || (msg.contains("too long") && msg.contains("token"))
}

/// Run the agent ReAct loop.
pub async fn run_agent(
    request: AgentRequest,
    app_handle: AppHandle,
    cancel_rx: watch::Receiver<bool>,
) {
    let emit = |event: AgentEvent| {
        let _ = app_handle.emit("ai:agent_event", &event);
    };

    // Load runtime config from database
    let db = app_handle.state::<Database>();
    let runtime = match runtime_repo::get_runtime_by_id(&db, &request.runtime_id) {
        Ok(Some(p)) => p,
        Ok(None) => {
            emit(AgentEvent::Error {
                message: format!("Runtime not found: {}", request.runtime_id),
            });
            return;
        }
        Err(e) => {
            emit(AgentEvent::Error {
                message: format!("Failed to load runtime: {e}"),
            });
            return;
        }
    };

    let (context_budget, ai_client): (u32, Arc<dyn AIClient>) =
        match resolve_runtime_execution(&runtime, request.model_override.as_deref()) {
            Ok(result) => result,
            Err(message) => {
                emit(AgentEvent::Error { message });
                return;
            }
        };

    // Build tool registry with builtin tools
    let mut tool_registry = build_builtin_registry(&app_handle);

    // Load skill if specified
    let skill_prompt = if let Some(ref skill_name) = request.skill_name {
        let ai_state = app_handle.state::<AIAgentState>();
        let manager = ai_state.skill_manager.lock().await;

        let skill_tool_defs = manager.get_tool_definitions(skill_name);
        for tool_def in &skill_tool_defs {
            if !tool_registry.has_tool(&tool_def.name) {
                tool_registry.register_definition_only(tool_def.clone());
            }
        }

        manager.get_system_prompt(skill_name)
    } else {
        None
    };

    // Build system prompt (session data is auto-limited)
    let system_prompt = build_system_prompt(
        skill_prompt.as_deref(),
        &request.attached_session_ids,
        &app_handle,
    );

    // Build initial message history from conversation context.
    let mut history: Vec<Message> = request
        .conversation_history
        .iter()
        .filter(|h| !h.content.is_empty())
        .map(|h| Message {
            role: h.role.clone(),
            content: h.content.clone(),
        })
        .collect();

    // Append the current user message
    history.push(Message {
        role: "user".to_string(),
        content: vec![ContentBlock::Text {
            text: request.user_message.clone(),
        }],
    });

    let tool_defs = tool_registry.list_definitions();
    let max_iter = request.max_iterations.min(20);

    for iteration in 1..=max_iter {
        if *cancel_rx.borrow() {
            emit(AgentEvent::Error {
                message: "Agent cancelled by user".to_string(),
            });
            return;
        }

        emit(AgentEvent::Iteration {
            current: iteration,
            max: max_iter,
        });

        // Truncate history to fit context budget before sending
        let (truncated_history, was_truncated) = context::truncate_messages_to_budget(
            &history,
            &system_prompt,
            &tool_defs,
            context_budget,
        );
        if was_truncated && iteration == 1 {
            eprintln!(
                "[ai] Context truncated: {} → {} messages (budget: {} tokens)",
                history.len(),
                truncated_history.len(),
                context_budget,
            );
        }

        let response = stream_api_call(
            &ai_client,
            &truncated_history,
            &tool_defs,
            &system_prompt,
            &emit,
        )
        .await;

        let response = match response {
            Ok(resp) => resp,
            Err(e) => {
                // On context window error, retry once with halved budget
                if is_context_window_error(&e) {
                    let reduced_budget = context_budget / 2;
                    eprintln!(
                        "[ai] Context window error, retrying with reduced budget: {} tokens",
                        reduced_budget,
                    );
                    let (retry_history, _) = context::truncate_messages_to_budget(
                        &history,
                        &system_prompt,
                        &tool_defs,
                        reduced_budget,
                    );
                    match stream_api_call(
                        &ai_client,
                        &retry_history,
                        &tool_defs,
                        &system_prompt,
                        &emit,
                    )
                    .await
                    {
                        Ok(resp) => resp,
                        Err(retry_err) => {
                            emit(AgentEvent::Error {
                                message: format!(
                                    "AI API error (context too large even after truncation, \
                                     try setting a larger Max Context Tokens in runtime settings \
                                     or clear the chat): {retry_err}"
                                ),
                            });
                            return;
                        }
                    }
                } else {
                    emit(AgentEvent::Error {
                        message: format!("AI API error: {e}"),
                    });
                    return;
                }
            }
        };

        match response.stop_reason {
            StopReason::EndTurn => {
                let final_text = extract_text(&response.content);
                emit(AgentEvent::AgentDone { final_text });
                return;
            }
            StopReason::MaxTokens => {
                emit(AgentEvent::Error {
                    message: "Response truncated: max tokens reached".to_string(),
                });
                return;
            }
            StopReason::ToolUse => {
                let mut tool_results: Vec<ContentBlock> = Vec::new();

                for block in &response.content {
                    if let ContentBlock::ToolUse { id, name, input } = block {
                        emit(AgentEvent::ToolCall {
                            id: id.clone(),
                            name: name.clone(),
                            input: input.clone(),
                        });

                        let resolved_skill_tool = if let Some(ref skill_name) = request.skill_name {
                            let ai_state = app_handle.state::<AIAgentState>();
                            let manager = ai_state.skill_manager.lock().await;
                            manager.resolve_tool_execution(skill_name, name)
                        } else {
                            None
                        };

                        let result = execute_tool_call(
                            &tool_registry,
                            resolved_skill_tool,
                            name,
                            input.clone(),
                        )
                        .await;

                        emit(AgentEvent::ToolResult {
                            tool_use_id: id.clone(),
                            content: result.content.clone(),
                            is_error: result.is_error,
                        });

                        tool_results.push(ContentBlock::ToolResult {
                            tool_use_id: id.clone(),
                            content: result.content,
                            is_error: result.is_error,
                        });
                    }
                }

                history.push(Message {
                    role: "assistant".to_string(),
                    content: response.content.clone(),
                });
                history.push(Message {
                    role: "user".to_string(),
                    content: tool_results,
                });
            }
        }
    }

    emit(AgentEvent::Error {
        message: format!("Agent reached maximum iterations ({max_iter})"),
    });
}

/// Execute a single API call with streaming, returning the assembled response.
async fn stream_api_call(
    ai_client: &Arc<dyn AIClient>,
    messages: &[Message],
    tools: &[ToolDefinition],
    system_prompt: &str,
    emit: &impl Fn(AgentEvent),
) -> Result<AssistantResponse, AIClientError> {
    let (event_tx, mut event_rx) = mpsc::unbounded_channel::<StreamChunk>();
    let messages_clone = messages.to_vec();
    let tools_clone = tools.to_vec();
    let system_clone = system_prompt.to_string();

    let api_task = {
        let client = Arc::clone(ai_client);
        tokio::spawn(async move {
            client
                .stream_chat(&messages_clone, &tools_clone, &system_clone, event_tx)
                .await
        })
    };

    while let Some(chunk) = event_rx.recv().await {
        match &chunk {
            StreamChunk::TextDelta(text) => {
                emit(AgentEvent::StreamDelta { text: text.clone() });
            }
            StreamChunk::ThinkingDelta(text) => {
                emit(AgentEvent::ThinkingDelta { text: text.clone() });
            }
            StreamChunk::Done => {}
            _ => {}
        }
    }

    match api_task.await {
        Ok(result) => result,
        Err(e) => Err(AIClientError::Network(format!("Task join error: {e}"))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    use crate::ai::skill::SkillManager;
    use crate::ai::tools::{Tool, ToolOutput};
    use crate::storage::runtime_repo::AIRuntimeEntry;
    use async_trait::async_trait;
    use serde_json::json;

    fn runtime_entry(runtime_type: &str, config: serde_json::Value) -> AIRuntimeEntry {
        AIRuntimeEntry {
            id: "rt-1".to_string(),
            name: "Runtime".to_string(),
            runtime_type: runtime_type.to_string(),
            config,
            is_default: true,
            created_at: "2026-03-24T00:00:00Z".to_string(),
            updated_at: "2026-03-24T00:00:00Z".to_string(),
            last_healthcheck: None,
        }
    }

    #[test]
    fn codex_local_runtime_is_supported_by_agent_execution() {
        let runtime = runtime_entry(
            "codex_local",
            json!({
                "cliPath": "/usr/local/bin/codex",
                "model": "gpt-5-codex",
                "sandboxMode": "workspace-write",
                "approvalPolicy": "on-request",
                "maxContextTokens": 0
            }),
        );

        let result = resolve_runtime_execution(&runtime, None);

        assert!(
            result.is_ok(),
            "expected codex_local runtime to be supported"
        );
    }

    #[test]
    fn claude_code_local_runtime_is_supported_by_agent_execution() {
        let runtime = runtime_entry(
            "claude_code_local",
            json!({
                "cliPath": "/usr/local/bin/claude",
                "model": "claude-sonnet-4-5",
                "workingDirectory": "/tmp",
                "maxContextTokens": 0
            }),
        );

        let result = resolve_runtime_execution(&runtime, None);

        assert!(
            result.is_ok(),
            "expected claude_code_local runtime to be supported"
        );
    }

    struct DummyTool;

    #[async_trait]
    impl Tool for DummyTool {
        fn definition(&self) -> ToolDefinition {
            ToolDefinition {
                name: "builtin_echo".to_string(),
                description: "Echo via builtin".to_string(),
                input_schema: json!({
                    "type": "object"
                }),
            }
        }

        async fn execute(&self, input: serde_json::Value) -> ToolOutput {
            ToolOutput {
                content: input.to_string(),
                is_error: false,
            }
        }
    }

    fn write_skill_package(dir: &std::path::Path, body: &str) {
        fs::create_dir_all(dir).unwrap();
        fs::write(dir.join("SKILL.md"), body).unwrap();
    }

    fn write_echo_skill(skills_root: &std::path::Path) {
        let skill_dir = skills_root.join("echo-skill");
        write_skill_package(
            &skill_dir,
            r#"---
name: echo-skill
description: Echo skill tool
version: 1.0.0
tools:
  - name: echo_payload
    description: Echo structured payload
    input_schema:
      type: object
    handler: tools/echo.sh
---
# Echo Skill
"#,
        );

        let tools_dir = skill_dir.join("tools");
        fs::create_dir_all(&tools_dir).unwrap();
        let script_path = tools_dir.join("echo.sh");
        fs::write(&script_path, "#!/bin/sh\ncat\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = fs::metadata(&script_path).unwrap().permissions();
            perms.set_mode(0o755);
            fs::set_permissions(&script_path, perms).unwrap();
        }
    }

    #[tokio::test]
    async fn builtin_tool_execution_still_uses_registry() {
        let mut registry = ToolRegistry::new();
        registry.register(Box::new(DummyTool));

        let skills_root = tempfile::tempdir().unwrap();
        let manager = SkillManager::new(skills_root.path().to_path_buf());
        let resolved_skill_tool = manager.resolve_tool_execution("echo-skill", "builtin_echo");

        let result = execute_tool_call(
            &registry,
            resolved_skill_tool,
            "builtin_echo",
            json!({ "value": "from-registry" }),
        )
        .await;

        assert!(!result.is_error);
        assert_eq!(result.content, r#"{"value":"from-registry"}"#);
    }

    #[tokio::test]
    async fn active_skill_tools_execute_when_not_registered_as_builtin() {
        let registry = ToolRegistry::new();
        let skills_root = tempfile::tempdir().unwrap();
        write_echo_skill(skills_root.path());

        let mut manager = SkillManager::new(skills_root.path().to_path_buf());
        manager.load_all().unwrap();
        let resolved_skill_tool = manager.resolve_tool_execution("echo-skill", "echo_payload");

        let result = execute_tool_call(
            &registry,
            resolved_skill_tool,
            "echo_payload",
            json!({ "value": "from-skill" }),
        )
        .await;

        assert!(
            !result.is_error,
            "unexpected tool error: {}",
            result.content
        );
        assert_eq!(result.content.trim(), r#"{"value":"from-skill"}"#);
    }
}

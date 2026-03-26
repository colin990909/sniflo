use std::collections::{HashMap, HashSet};

use serde::Deserialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::process::Command;
use tokio::sync::{Mutex, watch};

use crate::ai::agent;
use crate::ai::client::{self, RuntimeConnectionStatus, RuntimeModelDescriptor};
use crate::ai::skill::{SkillManager, SkillSummary};
use crate::ai::types::{AgentEvent, AgentRequest};
use crate::commands::proxy::CapturedSession;
use crate::storage::conversation_repo::{self, ConversationMessage, ConversationSummary};
use crate::storage::db::Database;
use crate::storage::runtime_repo;

/// Tauri-managed state for the AI agent system.
pub struct AIAgentState {
    /// Active agent cancel signals, keyed by conversation_id.
    pub active_agents: Mutex<HashMap<String, watch::Sender<bool>>>,
    /// Skill package manager.
    pub skill_manager: Mutex<SkillManager>,
    /// Currently selected session IDs in the frontend.
    pub selected_session_ids: parking_lot::Mutex<HashSet<String>>,
    /// Per-turn cache of session details to avoid redundant fetches.
    pub session_detail_cache: parking_lot::Mutex<HashMap<String, CapturedSession>>,
}

impl AIAgentState {
    pub fn new(skills_dir: std::path::PathBuf) -> Self {
        let mut skill_manager = SkillManager::new(skills_dir);
        if let Err(e) = skill_manager.load_all() {
            eprintln!("[ai] Failed to load skills: {e}");
        }
        Self {
            active_agents: Mutex::new(HashMap::new()),
            skill_manager: Mutex::new(skill_manager),
            selected_session_ids: parking_lot::Mutex::new(HashSet::new()),
            session_detail_cache: parking_lot::Mutex::new(HashMap::new()),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RemoteApiRuntimeConfig {
    protocol: String,
    base_url: String,
    api_key: String,
    model: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocalCliRuntimeConfig {
    cli_path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CodexRuntimeModelConfig {
    model: Option<String>,
}

fn default_cli_for_runtime(runtime_type: &str) -> Option<&'static str> {
    match runtime_type {
        "claude_code_local" => Some("claude"),
        "codex_local" => Some("codex"),
        _ => None,
    }
}

async fn test_local_cli_runtime(
    runtime_type: &str,
    config_value: serde_json::Value,
) -> Result<RuntimeConnectionStatus, String> {
    let config: LocalCliRuntimeConfig =
        serde_json::from_value(config_value).map_err(|e| format!("Invalid runtime config: {e}"))?;

    let command = config
        .cli_path
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| default_cli_for_runtime(runtime_type))
        .ok_or_else(|| format!("Unsupported local runtime type: {runtime_type}"))?;

    let output = Command::new(command)
        .arg("--version")
        .output()
        .await
        .map_err(|e| format!("Failed to run {command}: {e}"))?;

    if output.status.success() {
        let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Ok(RuntimeConnectionStatus {
            status: "passed".to_string(),
            message: if version.is_empty() {
                format!("{command} is available")
            } else {
                format!("{command} is available: {version}")
            },
        })
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(if stderr.is_empty() {
            format!("{command} exited with status {}", output.status)
        } else {
            stderr
        })
    }
}

#[tauri::command]
pub async fn ai_runtime_test(
    runtime_id: String,
    db: State<'_, Database>,
) -> Result<RuntimeConnectionStatus, String> {
    let runtime = runtime_repo::get_runtime_by_id(&db, &runtime_id)?
        .ok_or_else(|| format!("Runtime not found: {runtime_id}"))?;

    match runtime.runtime_type.as_str() {
        "remote_api" => {
            let config: RemoteApiRuntimeConfig = serde_json::from_value(runtime.config)
                .map_err(|e| format!("Invalid remote runtime config: {e}"))?;
            client::test_remote_connection(
                &config.protocol,
                &config.base_url,
                &config.api_key,
                &config.model,
            )
            .await
            .map_err(|e| e.to_string())
        }
        "claude_code_local" | "codex_local" => {
            test_local_cli_runtime(&runtime.runtime_type, runtime.config).await
        }
        other => Err(format!("Unsupported runtime type: {other}")),
    }
}

#[tauri::command]
pub async fn ai_runtime_list_models(
    runtime_id: String,
    db: State<'_, Database>,
) -> Result<Vec<RuntimeModelDescriptor>, String> {
    let runtime = runtime_repo::get_runtime_by_id(&db, &runtime_id)?
        .ok_or_else(|| format!("Runtime not found: {runtime_id}"))?;

    if runtime.runtime_type == "codex_local" {
        let config: CodexRuntimeModelConfig = serde_json::from_value(runtime.config)
            .map_err(|e| format!("Invalid Codex runtime config: {e}"))?;
        return Ok(client::codex_cli::CodexCliClient::available_models(
            config.model.as_deref(),
        ));
    }

    if runtime.runtime_type == "claude_code_local" {
        let config: CodexRuntimeModelConfig = serde_json::from_value(runtime.config)
            .map_err(|e| format!("Invalid Claude runtime config: {e}"))?;
        return Ok(client::claude_code::ClaudeCodeCliClient::available_models(
            config.model.as_deref(),
        ));
    }

    if runtime.runtime_type != "remote_api" {
        return Ok(Vec::new());
    }

    let config: RemoteApiRuntimeConfig = serde_json::from_value(runtime.config)
        .map_err(|e| format!("Invalid remote runtime config: {e}"))?;

    client::list_remote_models(&config.protocol, &config.base_url, &config.api_key)
        .await
        .map_err(|e| e.to_string())
}

/// Start an agent conversation. Returns immediately; results stream via events.
#[tauri::command]
pub async fn ai_send_message(
    request: AgentRequest,
    app: AppHandle,
    ai_state: State<'_, AIAgentState>,
) -> Result<(), String> {
    let conversation_id = request.conversation_id.clone();

    // Cancel any existing agent for this conversation
    {
        let mut agents = ai_state.active_agents.lock().await;
        if let Some(tx) = agents.remove(&conversation_id) {
            let _ = tx.send(true);
        }
    }

    // Clear session detail cache for the new turn
    ai_state.session_detail_cache.lock().clear();

    // Create cancel channel
    let (cancel_tx, cancel_rx) = watch::channel(false);

    // Register the cancel sender
    {
        let mut agents = ai_state.active_agents.lock().await;
        agents.insert(conversation_id.clone(), cancel_tx);
    }

    // Spawn the agent loop with panic protection
    let app_handle = app.clone();
    let conv_id = conversation_id.clone();
    tokio::spawn(async move {
        let app_for_panic = app_handle.clone();
        let result =
            tokio::task::spawn(agent::run_agent(request, app_handle.clone(), cancel_rx)).await;

        if let Err(join_err) = result {
            // Agent task panicked — emit an error so the frontend can recover
            let msg = if join_err.is_panic() {
                let panic_val = join_err.into_panic();
                if let Some(s) = panic_val.downcast_ref::<String>() {
                    format!("Agent panicked: {s}")
                } else if let Some(s) = panic_val.downcast_ref::<&str>() {
                    format!("Agent panicked: {s}")
                } else {
                    "Agent panicked (unknown cause)".to_string()
                }
            } else {
                format!("Agent task failed: {join_err}")
            };
            let _ = app_for_panic.emit("ai:agent_event", &AgentEvent::Error { message: msg });
        }

        // Clean up: remove from active agents
        let ai_state = app_handle.state::<AIAgentState>();
        let mut agents = ai_state.active_agents.lock().await;
        agents.remove(&conv_id);
    });

    Ok(())
}

/// Cancel a running agent by conversation ID.
#[tauri::command]
pub async fn ai_cancel(
    conversation_id: String,
    ai_state: State<'_, AIAgentState>,
) -> Result<(), String> {
    let mut agents = ai_state.active_agents.lock().await;
    if let Some(tx) = agents.remove(&conversation_id) {
        let _ = tx.send(true);
        Ok(())
    } else {
        Err(format!(
            "No active agent for conversation: {conversation_id}"
        ))
    }
}

/// List all installed skills.
#[tauri::command]
pub async fn ai_list_skills(
    ai_state: State<'_, AIAgentState>,
) -> Result<Vec<SkillSummary>, String> {
    let manager = ai_state.skill_manager.lock().await;
    Ok(manager.list_summaries())
}

/// Install a skill from a local directory path.
#[tauri::command]
pub async fn ai_install_skill(
    source_path: String,
    ai_state: State<'_, AIAgentState>,
    _db: State<'_, Database>,
) -> Result<SkillSummary, String> {
    let path = std::path::Path::new(&source_path);
    if !path.exists() || !path.is_dir() {
        return Err(format!("Invalid skill directory: {source_path}"));
    }

    let mut manager = ai_state.skill_manager.lock().await;
    manager.install(path, &_db)
}

/// Uninstall a skill by name.
#[tauri::command]
pub async fn ai_uninstall_skill(
    skill_name: String,
    ai_state: State<'_, AIAgentState>,
    _db: State<'_, Database>,
) -> Result<(), String> {
    let mut manager = ai_state.skill_manager.lock().await;
    manager.uninstall(&skill_name, &_db)
}

/// Update the selected session IDs from the frontend.
#[tauri::command]
pub fn ai_set_selected_sessions(ids: Vec<String>, ai_state: State<'_, AIAgentState>) {
    let mut selected = ai_state.selected_session_ids.lock();
    selected.clear();
    selected.extend(ids);
}

/// Get the currently selected session IDs.
#[tauri::command]
pub fn ai_get_selected_sessions(ai_state: State<'_, AIAgentState>) -> Vec<String> {
    ai_state
        .selected_session_ids
        .lock()
        .iter()
        .cloned()
        .collect()
}

// ── Conversation persistence commands ───────────────────────────

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn conversation_create(
    id: String,
    title: String,
    runtime_id: Option<String>,
    skill_name: Option<String>,
    model_override: Option<String>,
    primary_host: Option<String>,
    created_at: String,
    db: State<'_, Database>,
) -> Result<(), String> {
    conversation_repo::create_conversation(
        &db,
        &id,
        &title,
        runtime_id.as_deref(),
        skill_name.as_deref(),
        model_override.as_deref(),
        primary_host.as_deref(),
        &created_at,
    )
}

#[tauri::command]
pub fn conversation_update_model_override(
    conversation_id: String,
    model_override: Option<String>,
    db: State<'_, Database>,
) -> Result<(), String> {
    conversation_repo::update_conversation_model_override(
        &db,
        &conversation_id,
        model_override.as_deref(),
    )
}

#[tauri::command]
pub fn conversation_update_primary_host(
    conversation_id: String,
    primary_host: String,
    db: State<'_, Database>,
) -> Result<(), String> {
    conversation_repo::update_conversation_primary_host(&db, &conversation_id, &primary_host)
}

#[tauri::command]
pub fn conversation_update_title(
    conversation_id: String,
    title: String,
    db: State<'_, Database>,
) -> Result<(), String> {
    conversation_repo::update_conversation_title(&db, &conversation_id, &title)
}

#[tauri::command]
pub fn write_text_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn conversation_list(db: State<'_, Database>) -> Result<Vec<ConversationSummary>, String> {
    conversation_repo::list_conversations(&db)
}

#[tauri::command]
pub fn conversation_load_messages(
    conversation_id: String,
    db: State<'_, Database>,
) -> Result<Vec<ConversationMessage>, String> {
    conversation_repo::load_conversation_messages(&db, &conversation_id)
}

#[tauri::command]
pub fn conversation_save_messages(
    messages: Vec<ConversationMessage>,
    db: State<'_, Database>,
) -> Result<(), String> {
    conversation_repo::save_messages_batch(&db, &messages)
}

#[tauri::command]
pub fn conversation_delete(conversation_id: String, db: State<'_, Database>) -> Result<(), String> {
    conversation_repo::delete_conversation(&db, &conversation_id)
}

use std::sync::Arc;

use tauri::State;

use crate::scripting::executor::ScriptExecutor;
use crate::scripting::types::ScriptRule;
use crate::storage::db::Database;
use crate::storage::script_repo;
use crate::storage::settings_repo;

/// Managed state holding the script executor.
pub struct ScriptState {
    pub executor: Arc<ScriptExecutor>,
}

impl ScriptState {
    pub fn new() -> Self {
        Self {
            executor: Arc::new(ScriptExecutor::new()),
        }
    }

    /// Reload scripts from DB into the executor's in-memory list.
    fn sync_from_db(&self, db: &Database) -> Result<(), String> {
        let scripts = script_repo::list_scripts(db)?;
        self.executor.reload(scripts);
        Ok(())
    }

    fn load_enabled_from_db(&self, db: &Database) -> Result<bool, String> {
        let enabled = load_script_enabled_setting(db)?;
        self.executor.set_enabled(enabled);
        Ok(enabled)
    }
}

fn load_script_enabled_setting(db: &Database) -> Result<bool, String> {
    Ok(settings_repo::get_setting(db, "script_enabled")?
        .map(|v| v == "true")
        .unwrap_or(false))
}

fn save_script_enabled_setting(db: &Database, enabled: bool) -> Result<(), String> {
    settings_repo::set_setting(db, "script_enabled", &enabled.to_string())
}

#[tauri::command]
pub fn list_scripts(db: State<'_, Database>) -> Result<Vec<ScriptRule>, String> {
    script_repo::list_scripts(&db)
}

#[tauri::command]
pub fn set_script_enabled(
    enabled: bool,
    db: State<'_, Database>,
    state: State<'_, ScriptState>,
) -> Result<(), String> {
    save_script_enabled_setting(&db, enabled)?;
    state.executor.set_enabled(enabled);
    Ok(())
}

#[tauri::command]
pub fn load_script_config(
    db: State<'_, Database>,
    state: State<'_, ScriptState>,
) -> Result<(bool, Vec<ScriptRule>), String> {
    let enabled = state.load_enabled_from_db(&db)?;
    let scripts = script_repo::list_scripts(&db)?;
    state.executor.reload(scripts.clone());
    Ok((enabled, scripts))
}

#[tauri::command]
pub fn create_script(
    script: ScriptRule,
    db: State<'_, Database>,
    state: State<'_, ScriptState>,
) -> Result<(), String> {
    script_repo::create_script(&db, &script)?;
    state.sync_from_db(&db)
}

#[tauri::command]
pub fn update_script(
    script: ScriptRule,
    db: State<'_, Database>,
    state: State<'_, ScriptState>,
) -> Result<(), String> {
    script_repo::update_script(&db, &script)?;
    state.sync_from_db(&db)
}

#[tauri::command]
pub fn delete_script(
    id: String,
    db: State<'_, Database>,
    state: State<'_, ScriptState>,
) -> Result<(), String> {
    script_repo::delete_script(&db, &id)?;
    state.sync_from_db(&db)
}

#[tauri::command]
pub fn toggle_script(
    id: String,
    enabled: bool,
    db: State<'_, Database>,
    state: State<'_, ScriptState>,
) -> Result<(), String> {
    script_repo::toggle_script(&db, &id, enabled)?;
    state.sync_from_db(&db)
}

#[tauri::command]
pub fn reorder_scripts(
    ids: Vec<String>,
    db: State<'_, Database>,
    state: State<'_, ScriptState>,
) -> Result<(), String> {
    script_repo::reorder_scripts(&db, &ids)?;
    state.sync_from_db(&db)
}

#[tauri::command]
pub fn import_script_file(
    path: String,
    db: State<'_, Database>,
    state: State<'_, ScriptState>,
) -> Result<ScriptRule, String> {
    let file_path = std::path::Path::new(&path);
    let code =
        std::fs::read_to_string(file_path).map_err(|e| format!("Failed to read file: {e}"))?;

    let name = file_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Imported Script")
        .to_string();

    let script = ScriptRule {
        id: uuid::Uuid::new_v4().to_string(),
        name,
        url_pattern: "*".to_string(),
        phase: "both".to_string(),
        priority: next_priority(&db)?,
        enabled: false,
        code,
        source_path: Some(path),
        created_at: now_iso(),
        updated_at: now_iso(),
    };

    script_repo::create_script(&db, &script)?;
    state.sync_from_db(&db)?;
    Ok(script)
}

#[tauri::command]
pub fn test_script(
    code: String,
    phase: String,
    request_json: String,
    response_json: Option<String>,
) -> Result<String, String> {
    use crate::proxy_core::http::{HttpRequestRecord, HttpResponseRecord};
    use crate::scripting::engine;

    let mut request: HttpRequestRecord =
        serde_json::from_str(&request_json).map_err(|e| format!("Invalid request JSON: {e}"))?;

    if phase == "response" {
        let resp_str = response_json.unwrap_or_else(|| {
            r#"{"status":200,"headers":[["Content-Type","text/plain"]],"body":""}"#.to_string()
        });
        let mut response: HttpResponseRecord =
            serde_json::from_str(&resp_str).map_err(|e| format!("Invalid response JSON: {e}"))?;

        let result = engine::execute_response_script(&code, &request, &mut response);
        let output = serde_json::json!({
            "modified": result.modified,
            "dropped": result.dropped,
            "logs": result.logs,
            "error": result.error,
            "response": response,
        });
        serde_json::to_string_pretty(&output).map_err(|e| e.to_string())
    } else {
        let result = engine::execute_request_script(&code, &mut request);
        let output = serde_json::json!({
            "modified": result.modified,
            "dropped": result.dropped,
            "logs": result.logs,
            "error": result.error,
            "request": request,
        });
        serde_json::to_string_pretty(&output).map_err(|e| e.to_string())
    }
}

fn next_priority(db: &Database) -> Result<i32, String> {
    db.with_conn(|conn| {
        let max: Option<i32> =
            conn.query_row("SELECT MAX(priority) FROM scripts", [], |row| row.get(0))?;
        Ok(max.unwrap_or(-1) + 1)
    })
}

fn now_iso() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    format!("{now}")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_db() -> Database {
        let dir = tempfile::tempdir().unwrap();
        Database::open(dir.path()).unwrap()
    }

    #[test]
    fn script_enabled_defaults_to_false_when_missing() {
        let db = test_db();

        let enabled = load_script_enabled_setting(&db).unwrap();

        assert!(!enabled);
    }

    #[test]
    fn script_enabled_round_trips_through_settings() {
        let db = test_db();

        save_script_enabled_setting(&db, true).unwrap();
        assert!(load_script_enabled_setting(&db).unwrap());

        save_script_enabled_setting(&db, false).unwrap();
        assert!(!load_script_enabled_setting(&db).unwrap());
    }
}

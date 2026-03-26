use crate::storage::db::Database;
use crate::storage::runtime_repo::{self, AIRuntimeEntry};
use crate::storage::settings_repo::{self, AppSettings};

#[tauri::command]
pub fn save_runtimes(
    runtimes: Vec<AIRuntimeEntry>,
    state: tauri::State<'_, Database>,
) -> Result<(), String> {
    runtime_repo::save_runtimes(&state, &runtimes)
}

#[tauri::command]
pub fn load_runtimes(state: tauri::State<'_, Database>) -> Result<Vec<AIRuntimeEntry>, String> {
    runtime_repo::list_runtimes(&state)
}

#[tauri::command]
pub fn save_settings(
    settings: AppSettings,
    state: tauri::State<'_, Database>,
) -> Result<(), String> {
    settings_repo::save_settings(&state, &settings)
}

#[tauri::command]
pub fn load_settings(state: tauri::State<'_, Database>) -> Result<AppSettings, String> {
    settings_repo::load_settings(&state)
}

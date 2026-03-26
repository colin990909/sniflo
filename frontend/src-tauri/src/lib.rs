mod ai;
mod commands;
mod proxy_core;
mod scripting;
mod storage;

use tauri::Manager;

use commands::ai::AIAgentState;
use commands::cert::CertState;
use commands::proxy::ProxyState;
use commands::script::ScriptState;
use storage::db::Database;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // rustls 0.23+ requires an explicit CryptoProvider.  Install the ring
    // provider once at startup so all downstream rustls usage (MITM TLS,
    // client connections) has a provider available.
    rustls::crypto::ring::default_provider()
        .install_default()
        .expect("Failed to install rustls CryptoProvider");

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("Failed to get app data dir");

            app.manage(ProxyState::default());
            app.manage(CertState::new(app_data_dir.clone()));

            let db = Database::open(&app_data_dir).expect("Failed to open database");

            // Initialize script system: load scripts from DB into executor
            let script_state = ScriptState::new();
            if let Ok(scripts) = storage::script_repo::list_scripts(&db) {
                script_state.executor.reload(scripts);
            }
            if let Ok(Some(enabled)) = storage::settings_repo::get_setting(&db, "script_enabled") {
                script_state.executor.set_enabled(enabled == "true");
            }
            app.manage(script_state);

            app.manage(db);

            let skills_dir = app_data_dir.join("skills");
            app.manage(AIAgentState::new(skills_dir));

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Proxy
            commands::proxy::start_proxy,
            commands::proxy::stop_proxy,
            commands::proxy::get_proxy_status,
            // Breakpoints
            commands::proxy::set_breakpoint_enabled,
            commands::proxy::set_breakpoint_rules,
            commands::proxy::load_breakpoint_config,
            commands::proxy::breakpoint_forward,
            commands::proxy::breakpoint_drop,
            // Certificate
            commands::cert::generate_ca,
            commands::cert::install_ca,
            commands::cert::get_cert_status,
            commands::cert::show_cert_in_finder,
            // Storage
            commands::storage::save_runtimes,
            commands::storage::load_runtimes,
            commands::storage::save_settings,
            commands::storage::load_settings,
            // Session
            commands::session::get_sessions,
            commands::session::clear_sessions,
            commands::session::export_session,
            // AI Agent
            commands::ai::ai_send_message,
            commands::ai::ai_cancel,
            commands::ai::ai_runtime_test,
            commands::ai::ai_runtime_list_models,
            commands::ai::ai_list_skills,
            commands::ai::ai_install_skill,
            commands::ai::ai_uninstall_skill,
            commands::ai::ai_set_selected_sessions,
            commands::ai::ai_get_selected_sessions,
            // Conversation persistence
            commands::ai::conversation_create,
            commands::ai::conversation_update_model_override,
            commands::ai::conversation_update_primary_host,
            commands::ai::conversation_update_title,
            commands::ai::conversation_list,
            commands::ai::conversation_load_messages,
            commands::ai::conversation_save_messages,
            commands::ai::conversation_delete,
            commands::ai::write_text_file,
            // Scripts
            commands::script::list_scripts,
            commands::script::set_script_enabled,
            commands::script::load_script_config,
            commands::script::create_script,
            commands::script::update_script,
            commands::script::delete_script,
            commands::script::toggle_script,
            commands::script::reorder_scripts,
            commands::script::import_script_file,
            commands::script::test_script,
            // Update checker
            commands::update::check_for_update,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

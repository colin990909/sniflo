use std::path::Path;
use std::sync::Mutex;

use rusqlite::Connection;

pub struct Database {
    conn: Mutex<Connection>,
}

impl Database {
    /// Open (or create) the SQLite database at `app_data_dir/app.db` and run migrations.
    pub fn open(app_data_dir: &Path) -> Result<Self, String> {
        let _ = std::fs::create_dir_all(app_data_dir);
        let db_path = app_data_dir.join("app.db");
        let conn = Connection::open(&db_path)
            .map_err(|e| format!("Failed to open database at {}: {e}", db_path.display()))?;

        // Enable WAL mode for better concurrent read performance
        conn.execute_batch("PRAGMA journal_mode=WAL;")
            .map_err(|e| format!("Failed to set WAL mode: {e}"))?;

        let db = Self {
            conn: Mutex::new(conn),
        };
        db.migrate()?;
        db.migrate_json_providers(app_data_dir)?;
        db.migrate_json_settings(app_data_dir)?;
        Ok(db)
    }

    /// Run all schema migrations.
    fn migrate(&self) -> Result<(), String> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| format!("DB lock poisoned: {e}"))?;
        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS providers (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                provider_type TEXT NOT NULL,
                api_key TEXT NOT NULL DEFAULT '',
                base_url TEXT NOT NULL DEFAULT '',
                model TEXT NOT NULL DEFAULT '',
                custom_protocol TEXT,
                cli_path TEXT,
                is_default INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS ai_runtimes (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                runtime_type TEXT NOT NULL,
                config_json TEXT NOT NULL,
                is_default INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                last_healthcheck_json TEXT
            );

            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS installed_skills (
                name TEXT PRIMARY KEY,
                version TEXT NOT NULL,
                description TEXT NOT NULL,
                path TEXT NOT NULL,
                tool_count INTEGER NOT NULL DEFAULT 0,
                installed_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS conversations (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL DEFAULT '',
                skill_name TEXT,
                primary_host TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS conversation_messages (
                id TEXT PRIMARY KEY,
                conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                sort_order INTEGER NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_conv_messages_conv_id
                ON conversation_messages(conversation_id, sort_order);

            CREATE TABLE IF NOT EXISTS scripts (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                url_pattern TEXT NOT NULL DEFAULT '*',
                phase TEXT NOT NULL DEFAULT 'both',
                priority INTEGER NOT NULL DEFAULT 0,
                enabled INTEGER NOT NULL DEFAULT 1,
                code TEXT NOT NULL DEFAULT '',
                source_path TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            ",
        )
        .map_err(|e| format!("Migration failed: {e}"))?;

        // Incremental column migrations — each ALTER is idempotent (ignore "duplicate column").
        let alter_statements = [
            "ALTER TABLE providers ADD COLUMN max_context_tokens INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE conversations ADD COLUMN runtime_id TEXT",
            "ALTER TABLE conversations ADD COLUMN model_override TEXT",
            "ALTER TABLE conversations ADD COLUMN primary_host TEXT",
            "ALTER TABLE conversations ADD COLUMN runtime_session_id TEXT",
            "ALTER TABLE conversations ADD COLUMN runtime_session_meta TEXT",
            "ALTER TABLE conversation_messages ADD COLUMN tool_call_name TEXT",
            "ALTER TABLE conversation_messages ADD COLUMN tool_call_id TEXT",
            "ALTER TABLE conversation_messages ADD COLUMN tool_input TEXT",
        ];
        for sql in alter_statements {
            let _ = conn.execute(sql, []);
        }

        Ok(())
    }

    /// Migrate providers from legacy providers.json into SQLite (one-time).
    fn migrate_json_providers(&self, app_data_dir: &Path) -> Result<(), String> {
        let json_path = app_data_dir.join("providers.json");
        if !json_path.exists() {
            return Ok(());
        }

        // Only migrate if the providers table is empty
        let count: i64 = self.with_conn(|conn| {
            conn.query_row("SELECT COUNT(*) FROM providers", [], |row| row.get(0))
        })?;
        if count > 0 {
            // Already have providers in SQLite, just remove the old file
            let _ = std::fs::remove_file(&json_path);
            return Ok(());
        }

        eprintln!("[db] Migrating providers from providers.json to SQLite");
        let json_str = std::fs::read_to_string(&json_path)
            .map_err(|e| format!("Failed to read providers.json: {e}"))?;

        // Parse with flexible field names (try both camelCase and snake_case)
        let raw: Vec<serde_json::Value> = serde_json::from_str(&json_str)
            .map_err(|e| format!("Failed to parse providers.json: {e}"))?;

        for entry in &raw {
            let id = json_str_field(entry, &["id"]);
            let name = json_str_field(entry, &["name"]);
            let provider_type = json_str_field(entry, &["providerType", "provider_type"]);
            let api_key = json_str_field(entry, &["apiKey", "api_key"]);
            let base_url = json_str_field(entry, &["baseURL", "baseUrl", "base_url"]);
            let model = json_str_field(entry, &["model"]);
            let custom_protocol = json_opt_field(entry, &["customProtocol", "custom_protocol"]);
            let cli_path = json_opt_field(entry, &["cliPath", "cli_path"]);
            let is_default = entry
                .get("isDefault")
                .or_else(|| entry.get("is_default"))
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let created_at = json_str_field(entry, &["createdAt", "created_at"]);

            if id.is_empty() {
                continue;
            }

            let _ = self.with_conn(|conn| {
                conn.execute(
                    "INSERT OR IGNORE INTO providers (id, name, provider_type, api_key, base_url, model, custom_protocol, cli_path, is_default, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                    rusqlite::params![id, name, provider_type, api_key, base_url, model, custom_protocol, cli_path, is_default as i32, created_at],
                )?;
                Ok(())
            });
        }

        // Remove old file after successful migration
        let _ = std::fs::rename(&json_path, app_data_dir.join("providers.json.migrated"));
        eprintln!("[db] Migrated {} providers from JSON to SQLite", raw.len());
        Ok(())
    }

    /// Migrate settings from legacy settings.json into SQLite (one-time).
    fn migrate_json_settings(&self, app_data_dir: &Path) -> Result<(), String> {
        let json_path = app_data_dir.join("settings.json");
        if !json_path.exists() {
            return Ok(());
        }

        let count: i64 = self.with_conn(|conn| {
            conn.query_row("SELECT COUNT(*) FROM settings", [], |row| row.get(0))
        })?;
        if count > 0 {
            let _ = std::fs::remove_file(&json_path);
            return Ok(());
        }

        eprintln!("[db] Migrating settings from settings.json to SQLite");
        let json_str = std::fs::read_to_string(&json_path)
            .map_err(|e| format!("Failed to read settings.json: {e}"))?;
        let raw: serde_json::Value = serde_json::from_str(&json_str)
            .map_err(|e| format!("Failed to parse settings.json: {e}"))?;

        if let Some(lang) = raw.get("language").and_then(|v| v.as_str()) {
            let _ = self.with_conn(|conn| {
                conn.execute(
                    "INSERT OR IGNORE INTO settings (key, value) VALUES ('language', ?1)",
                    rusqlite::params![lang],
                )?;
                Ok(())
            });
        }
        if let Some(cors) = raw
            .get("cors_override")
            .or_else(|| raw.get("corsOverride"))
            .and_then(|v| v.as_bool())
        {
            let _ = self.with_conn(|conn| {
                conn.execute(
                    "INSERT OR IGNORE INTO settings (key, value) VALUES ('cors_override', ?1)",
                    rusqlite::params![cors.to_string()],
                )?;
                Ok(())
            });
        }

        let _ = std::fs::rename(&json_path, app_data_dir.join("settings.json.migrated"));
        Ok(())
    }

    /// Acquire the connection lock and execute a closure.
    pub fn with_conn<F, T>(&self, f: F) -> Result<T, String>
    where
        F: FnOnce(&Connection) -> Result<T, rusqlite::Error>,
    {
        let conn = self
            .conn
            .lock()
            .map_err(|e| format!("DB lock poisoned: {e}"))?;
        f(&conn).map_err(|e| format!("Database error: {e}"))
    }
}

/// Extract a string field from a JSON value, trying multiple key names.
fn json_str_field(value: &serde_json::Value, keys: &[&str]) -> String {
    for key in keys {
        if let Some(v) = value.get(*key).and_then(|v| v.as_str()) {
            return v.to_string();
        }
    }
    String::new()
}

/// Extract an optional string field from a JSON value, trying multiple key names.
fn json_opt_field(value: &serde_json::Value, keys: &[&str]) -> Option<String> {
    for key in keys {
        if let Some(v) = value.get(*key).and_then(|v| v.as_str()) {
            return Some(v.to_string());
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_open_in_memory() {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::open(dir.path()).unwrap();
        db.with_conn(|conn| {
            let count: i64 = conn.query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('providers','settings','installed_skills','conversations','conversation_messages','scripts','ai_runtimes')",
                [],
                |row| row.get(0),
            )?;
            assert_eq!(count, 7);
            Ok(())
        }).unwrap();
    }

    #[test]
    fn test_migrate_idempotent() {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::open(dir.path()).unwrap();
        db.migrate().unwrap();
    }

    #[test]
    fn test_migrate_json_providers() {
        let dir = tempfile::tempdir().unwrap();
        let json_path = dir.path().join("providers.json");
        std::fs::write(&json_path, r#"[{"id":"p1","name":"Test","providerType":"anthropic","apiKey":"sk-xxx","baseURL":"https://api.anthropic.com","model":"claude","isDefault":true,"createdAt":"2025-01-01"}]"#).unwrap();

        let db = Database::open(dir.path()).unwrap();

        // Verify migration happened
        let count: i64 = db
            .with_conn(|conn| {
                conn.query_row("SELECT COUNT(*) FROM providers", [], |row| row.get(0))
            })
            .unwrap();
        assert_eq!(count, 1);

        // Verify JSON file was renamed
        assert!(!json_path.exists());
        assert!(dir.path().join("providers.json.migrated").exists());
    }
}

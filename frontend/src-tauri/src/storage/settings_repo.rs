use rusqlite::params;
use serde::{Deserialize, Serialize};

use super::db::Database;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub language: String,
    pub theme: String,
    pub cors_override: bool,
    pub listen_host: String,
    pub listen_port: u16,
    pub upstream_enabled: bool,
    pub upstream_host: String,
    pub upstream_port: u16,
    pub auto_start_proxy: bool,
    pub max_sessions: u32,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            language: "system".to_string(),
            theme: "light".to_string(),
            cors_override: false,
            listen_host: "127.0.0.1".to_string(),
            listen_port: 9090,
            upstream_enabled: false,
            upstream_host: "127.0.0.1".to_string(),
            upstream_port: 7890,
            auto_start_proxy: false,
            max_sessions: 0,
        }
    }
}

pub fn get_setting(db: &Database, key: &str) -> Result<Option<String>, String> {
    db.with_conn(|conn| {
        let mut stmt = conn.prepare("SELECT value FROM settings WHERE key = ?1")?;
        let mut rows = stmt.query_map(params![key], |row| row.get::<_, String>(0))?;
        match rows.next() {
            Some(val) => Ok(Some(val?)),
            None => Ok(None),
        }
    })
}

pub fn set_setting(db: &Database, key: &str, value: &str) -> Result<(), String> {
    db.with_conn(|conn| {
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
            params![key, value],
        )?;
        Ok(())
    })
}

fn parse_u16(val: Option<String>, default: u16) -> u16 {
    val.and_then(|v| v.parse().ok()).unwrap_or(default)
}

fn parse_u32(val: Option<String>, default: u32) -> u32 {
    val.and_then(|v| v.parse().ok()).unwrap_or(default)
}

fn parse_bool(val: Option<String>, default: bool) -> bool {
    val.map(|v| v == "true").unwrap_or(default)
}

fn normalize_theme(theme: String) -> String {
    match theme.as_str() {
        "dark" => "dark".to_string(),
        _ => "light".to_string(),
    }
}

pub fn load_settings(db: &Database) -> Result<AppSettings, String> {
    let defaults = AppSettings::default();
    Ok(AppSettings {
        language: get_setting(db, "language")?.unwrap_or(defaults.language),
        theme: normalize_theme(get_setting(db, "theme")?.unwrap_or(defaults.theme)),
        cors_override: parse_bool(get_setting(db, "cors_override")?, defaults.cors_override),
        listen_host: get_setting(db, "listen_host")?.unwrap_or(defaults.listen_host),
        listen_port: parse_u16(get_setting(db, "listen_port")?, defaults.listen_port),
        upstream_enabled: parse_bool(
            get_setting(db, "upstream_enabled")?,
            defaults.upstream_enabled,
        ),
        upstream_host: get_setting(db, "upstream_host")?.unwrap_or(defaults.upstream_host),
        upstream_port: parse_u16(get_setting(db, "upstream_port")?, defaults.upstream_port),
        auto_start_proxy: parse_bool(
            get_setting(db, "auto_start_proxy")?,
            defaults.auto_start_proxy,
        ),
        max_sessions: parse_u32(get_setting(db, "max_sessions")?, defaults.max_sessions),
    })
}

pub fn save_settings(db: &Database, settings: &AppSettings) -> Result<(), String> {
    set_setting(db, "language", &settings.language)?;
    set_setting(db, "theme", &settings.theme)?;
    set_setting(db, "cors_override", &settings.cors_override.to_string())?;
    set_setting(db, "listen_host", &settings.listen_host)?;
    set_setting(db, "listen_port", &settings.listen_port.to_string())?;
    set_setting(
        db,
        "upstream_enabled",
        &settings.upstream_enabled.to_string(),
    )?;
    set_setting(db, "upstream_host", &settings.upstream_host)?;
    set_setting(db, "upstream_port", &settings.upstream_port.to_string())?;
    set_setting(
        db,
        "auto_start_proxy",
        &settings.auto_start_proxy.to_string(),
    )?;
    set_setting(db, "max_sessions", &settings.max_sessions.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_db() -> Database {
        let dir = tempfile::tempdir().unwrap();
        Database::open(dir.path()).unwrap()
    }

    #[test]
    fn test_default_settings() {
        let db = test_db();
        let settings = load_settings(&db).unwrap();
        let defaults = AppSettings::default();
        assert_eq!(settings.language, defaults.language);
        assert_eq!(settings.theme, defaults.theme);
        assert!(!settings.cors_override);
        assert_eq!(settings.listen_host, "127.0.0.1");
        assert_eq!(settings.listen_port, 9090);
        assert!(!settings.upstream_enabled);
        assert_eq!(settings.upstream_host, "127.0.0.1");
        assert_eq!(settings.upstream_port, 7890);
        assert!(!settings.auto_start_proxy);
        assert_eq!(settings.max_sessions, 0);
    }

    #[test]
    fn test_save_and_load_settings() {
        let db = test_db();
        let settings = AppSettings {
            language: "zh-Hans".to_string(),
            theme: "dark".to_string(),
            cors_override: true,
            listen_host: "0.0.0.0".to_string(),
            listen_port: 8080,
            upstream_enabled: true,
            upstream_host: "192.168.1.1".to_string(),
            upstream_port: 1080,
            auto_start_proxy: true,
            max_sessions: 500,
        };
        save_settings(&db, &settings).unwrap();
        let loaded = load_settings(&db).unwrap();
        assert_eq!(loaded.language, "zh-Hans");
        assert_eq!(loaded.theme, "dark");
        assert!(loaded.cors_override);
        assert_eq!(loaded.listen_host, "0.0.0.0");
        assert_eq!(loaded.listen_port, 8080);
        assert!(loaded.upstream_enabled);
        assert_eq!(loaded.upstream_host, "192.168.1.1");
        assert_eq!(loaded.upstream_port, 1080);
        assert!(loaded.auto_start_proxy);
        assert_eq!(loaded.max_sessions, 500);
    }

    #[test]
    fn test_set_and_get_setting() {
        let db = test_db();
        set_setting(&db, "custom_key", "custom_value").unwrap();
        let val = get_setting(&db, "custom_key").unwrap();
        assert_eq!(val, Some("custom_value".to_string()));

        // Overwrite
        set_setting(&db, "custom_key", "new_value").unwrap();
        let val = get_setting(&db, "custom_key").unwrap();
        assert_eq!(val, Some("new_value".to_string()));
    }

    #[test]
    fn test_invalid_port_falls_back_to_default() {
        let db = test_db();
        set_setting(&db, "listen_port", "not_a_number").unwrap();
        let settings = load_settings(&db).unwrap();
        assert_eq!(settings.listen_port, 9090);
    }

    #[test]
    fn test_legacy_system_theme_loads_as_light() {
        let db = test_db();
        set_setting(&db, "theme", "system").unwrap();

        let settings = load_settings(&db).unwrap();

        assert_eq!(settings.theme, "light");
    }
}

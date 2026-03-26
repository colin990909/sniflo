use super::db::Database;
use rusqlite::params;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AIRuntimeEntry {
    pub id: String,
    pub name: String,
    pub runtime_type: String,
    pub config: serde_json::Value,
    pub is_default: bool,
    pub created_at: String,
    pub updated_at: String,
    pub last_healthcheck: Option<serde_json::Value>,
}

pub fn list_runtimes(db: &Database) -> Result<Vec<AIRuntimeEntry>, String> {
    db.with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id, name, runtime_type, config_json, is_default, created_at, updated_at, last_healthcheck_json
             FROM ai_runtimes
             ORDER BY created_at",
        )?;
        let rows = stmt.query_map([], |row| {
            let config_json: String = row.get(3)?;
            let last_healthcheck_json: Option<String> = row.get(7)?;
            Ok(AIRuntimeEntry {
                id: row.get(0)?,
                name: row.get(1)?,
                runtime_type: row.get(2)?,
                config: serde_json::from_str(&config_json).unwrap_or(serde_json::Value::Null),
                is_default: row.get::<_, i32>(4)? != 0,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
                last_healthcheck: last_healthcheck_json
                    .and_then(|value| serde_json::from_str(&value).ok()),
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>()
    })
}

pub fn save_runtimes(db: &Database, runtimes: &[AIRuntimeEntry]) -> Result<(), String> {
    db.with_conn(|conn| {
        let tx = conn.unchecked_transaction()?;
        tx.execute("DELETE FROM ai_runtimes", [])?;

        let mut stmt = tx.prepare(
            "INSERT INTO ai_runtimes
             (id, name, runtime_type, config_json, is_default, created_at, updated_at, last_healthcheck_json)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        )?;

        for runtime in runtimes {
            stmt.execute(params![
                runtime.id,
                runtime.name,
                runtime.runtime_type,
                runtime.config.to_string(),
                runtime.is_default as i32,
                runtime.created_at,
                runtime.updated_at,
                runtime.last_healthcheck.as_ref().map(|value| value.to_string()),
            ])?;
        }

        drop(stmt);
        tx.commit()?;
        Ok(())
    })
}

pub fn get_runtime_by_id(db: &Database, id: &str) -> Result<Option<AIRuntimeEntry>, String> {
    db.with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id, name, runtime_type, config_json, is_default, created_at, updated_at, last_healthcheck_json
             FROM ai_runtimes
             WHERE id = ?1",
        )?;
        let mut rows = stmt.query_map(params![id], |row| {
            let config_json: String = row.get(3)?;
            let last_healthcheck_json: Option<String> = row.get(7)?;
            Ok(AIRuntimeEntry {
                id: row.get(0)?,
                name: row.get(1)?,
                runtime_type: row.get(2)?,
                config: serde_json::from_str(&config_json).unwrap_or(serde_json::Value::Null),
                is_default: row.get::<_, i32>(4)? != 0,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
                last_healthcheck: last_healthcheck_json
                    .and_then(|value| serde_json::from_str(&value).ok()),
            })
        })?;

        match rows.next() {
            Some(row) => Ok(Some(row?)),
            None => Ok(None),
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_db() -> Database {
        let dir = tempfile::tempdir().unwrap();
        Database::open(dir.path()).unwrap()
    }

    fn make_runtime(id: &str, name: &str) -> AIRuntimeEntry {
        AIRuntimeEntry {
            id: id.to_string(),
            name: name.to_string(),
            runtime_type: "remote_api".to_string(),
            config: serde_json::json!({
                "protocol": "openai",
                "endpointMode": "official",
                "baseUrl": "https://api.openai.com/v1",
                "apiKey": "sk-test",
                "model": "gpt-4o"
            }),
            is_default: false,
            created_at: "2026-03-24T00:00:00Z".to_string(),
            updated_at: "2026-03-24T00:00:00Z".to_string(),
            last_healthcheck: None,
        }
    }

    #[test]
    fn test_save_and_list_runtimes() {
        let db = test_db();
        let runtimes = vec![
            make_runtime("rt-1", "Claude Code"),
            make_runtime("rt-2", "Remote API"),
        ];
        save_runtimes(&db, &runtimes).unwrap();

        let loaded = list_runtimes(&db).unwrap();
        assert_eq!(loaded.len(), 2);
        assert_eq!(loaded[0].name, "Claude Code");
        assert_eq!(loaded[1].name, "Remote API");
    }

    #[test]
    fn test_get_runtime_by_id() {
        let db = test_db();
        save_runtimes(&db, &[make_runtime("rt-1", "Codex")]).unwrap();

        let found = get_runtime_by_id(&db, "rt-1").unwrap();
        assert!(found.is_some());
        assert_eq!(found.unwrap().name, "Codex");
    }

    #[test]
    fn test_default_runtime_roundtrip() {
        let db = test_db();
        let mut runtime = make_runtime("rt-default", "Claude Code");
        runtime.is_default = true;
        runtime.last_healthcheck = Some(serde_json::json!({
            "status": "passed",
            "message": "ok"
        }));
        save_runtimes(&db, &[runtime]).unwrap();

        let loaded = list_runtimes(&db).unwrap();
        assert_eq!(loaded.len(), 1);
        assert!(loaded[0].is_default);
        assert_eq!(
            loaded[0].last_healthcheck.as_ref().unwrap()["status"],
            "passed"
        );
    }
}

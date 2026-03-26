use rusqlite::params;

use super::db::Database;
use crate::scripting::types::ScriptRule;

pub fn list_scripts(db: &Database) -> Result<Vec<ScriptRule>, String> {
    db.with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id, name, url_pattern, phase, priority, enabled, code, source_path, created_at, updated_at
             FROM scripts ORDER BY priority ASC, created_at ASC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(ScriptRule {
                id: row.get(0)?,
                name: row.get(1)?,
                url_pattern: row.get(2)?,
                phase: row.get(3)?,
                priority: row.get(4)?,
                enabled: row.get::<_, i32>(5)? != 0,
                code: row.get(6)?,
                source_path: row.get(7)?,
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>()
    })
}

pub fn create_script(db: &Database, script: &ScriptRule) -> Result<(), String> {
    db.with_conn(|conn| {
        conn.execute(
            "INSERT INTO scripts (id, name, url_pattern, phase, priority, enabled, code, source_path, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                script.id,
                script.name,
                script.url_pattern,
                script.phase,
                script.priority,
                script.enabled as i32,
                script.code,
                script.source_path,
                script.created_at,
                script.updated_at,
            ],
        )?;
        Ok(())
    })
}

pub fn update_script(db: &Database, script: &ScriptRule) -> Result<(), String> {
    db.with_conn(|conn| {
        conn.execute(
            "UPDATE scripts SET name=?2, url_pattern=?3, phase=?4, priority=?5, enabled=?6, code=?7, source_path=?8, updated_at=?9
             WHERE id=?1",
            params![
                script.id,
                script.name,
                script.url_pattern,
                script.phase,
                script.priority,
                script.enabled as i32,
                script.code,
                script.source_path,
                script.updated_at,
            ],
        )?;
        Ok(())
    })
}

pub fn delete_script(db: &Database, id: &str) -> Result<(), String> {
    db.with_conn(|conn| {
        conn.execute("DELETE FROM scripts WHERE id=?1", params![id])?;
        Ok(())
    })
}

pub fn toggle_script(db: &Database, id: &str, enabled: bool) -> Result<(), String> {
    db.with_conn(|conn| {
        conn.execute(
            "UPDATE scripts SET enabled=?2 WHERE id=?1",
            params![id, enabled as i32],
        )?;
        Ok(())
    })
}

pub fn reorder_scripts(db: &Database, ids: &[String]) -> Result<(), String> {
    db.with_conn(|conn| {
        for (idx, id) in ids.iter().enumerate() {
            conn.execute(
                "UPDATE scripts SET priority=?2 WHERE id=?1",
                params![id, idx as i32],
            )?;
        }
        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_db() -> Database {
        let dir = tempfile::tempdir().unwrap();
        Database::open(dir.path()).unwrap()
    }

    fn make_script(id: &str, name: &str) -> ScriptRule {
        ScriptRule {
            id: id.to_string(),
            name: name.to_string(),
            url_pattern: "*".to_string(),
            phase: "both".to_string(),
            priority: 0,
            enabled: true,
            code: "function onRequest(ctx) {}".to_string(),
            source_path: None,
            created_at: "2026-01-01".to_string(),
            updated_at: "2026-01-01".to_string(),
        }
    }

    #[test]
    fn test_create_and_list() {
        let db = test_db();
        create_script(&db, &make_script("s1", "Script 1")).unwrap();
        create_script(&db, &make_script("s2", "Script 2")).unwrap();
        let scripts = list_scripts(&db).unwrap();
        assert_eq!(scripts.len(), 2);
        assert_eq!(scripts[0].name, "Script 1");
    }

    #[test]
    fn test_update() {
        let db = test_db();
        create_script(&db, &make_script("s1", "Original")).unwrap();
        let mut script = make_script("s1", "Updated");
        script.url_pattern = "*.example.com*".to_string();
        update_script(&db, &script).unwrap();
        let scripts = list_scripts(&db).unwrap();
        assert_eq!(scripts[0].name, "Updated");
        assert_eq!(scripts[0].url_pattern, "*.example.com*");
    }

    #[test]
    fn test_delete() {
        let db = test_db();
        create_script(&db, &make_script("s1", "To Delete")).unwrap();
        delete_script(&db, "s1").unwrap();
        let scripts = list_scripts(&db).unwrap();
        assert!(scripts.is_empty());
    }

    #[test]
    fn test_toggle() {
        let db = test_db();
        create_script(&db, &make_script("s1", "Script")).unwrap();
        toggle_script(&db, "s1", false).unwrap();
        let scripts = list_scripts(&db).unwrap();
        assert!(!scripts[0].enabled);
        toggle_script(&db, "s1", true).unwrap();
        let scripts = list_scripts(&db).unwrap();
        assert!(scripts[0].enabled);
    }

    #[test]
    fn test_reorder() {
        let db = test_db();
        let mut s1 = make_script("s1", "First");
        s1.priority = 0;
        let mut s2 = make_script("s2", "Second");
        s2.priority = 1;
        create_script(&db, &s1).unwrap();
        create_script(&db, &s2).unwrap();

        // Reverse order
        reorder_scripts(&db, &["s2".to_string(), "s1".to_string()]).unwrap();
        let scripts = list_scripts(&db).unwrap();
        assert_eq!(scripts[0].id, "s2");
        assert_eq!(scripts[1].id, "s1");
    }
}

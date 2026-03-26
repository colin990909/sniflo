use rusqlite::params;
use serde::{Deserialize, Serialize};

use super::db::Database;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledSkillRecord {
    pub name: String,
    pub version: String,
    pub description: String,
    pub path: String,
    pub tool_count: i32,
    pub installed_at: String,
}

pub fn list_skills(db: &Database) -> Result<Vec<InstalledSkillRecord>, String> {
    db.with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT name, version, description, path, tool_count, installed_at FROM installed_skills ORDER BY installed_at"
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(InstalledSkillRecord {
                name: row.get(0)?,
                version: row.get(1)?,
                description: row.get(2)?,
                path: row.get(3)?,
                tool_count: row.get(4)?,
                installed_at: row.get(5)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>()
    })
}

pub fn save_skill(db: &Database, record: &InstalledSkillRecord) -> Result<(), String> {
    db.with_conn(|conn| {
        conn.execute(
            "INSERT OR REPLACE INTO installed_skills (name, version, description, path, tool_count, installed_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                record.name,
                record.version,
                record.description,
                record.path,
                record.tool_count,
                record.installed_at,
            ],
        )?;
        Ok(())
    })
}

pub fn delete_skill(db: &Database, name: &str) -> Result<(), String> {
    db.with_conn(|conn| {
        conn.execute(
            "DELETE FROM installed_skills WHERE name = ?1",
            params![name],
        )?;
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

    #[test]
    fn test_skill_crud() {
        let db = test_db();
        let skill = InstalledSkillRecord {
            name: "security-audit".to_string(),
            version: "1.0.0".to_string(),
            description: "Security audit skill".to_string(),
            path: "/path/to/skill".to_string(),
            tool_count: 3,
            installed_at: "2025-01-01".to_string(),
        };
        save_skill(&db, &skill).unwrap();

        let skills = list_skills(&db).unwrap();
        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].name, "security-audit");
        assert_eq!(skills[0].tool_count, 3);

        delete_skill(&db, "security-audit").unwrap();
        let skills = list_skills(&db).unwrap();
        assert!(skills.is_empty());
    }
}

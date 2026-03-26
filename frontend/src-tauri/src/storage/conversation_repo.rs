use rusqlite::params;
use serde::{Deserialize, Serialize};

use super::db::Database;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationSummary {
    pub id: String,
    pub title: String,
    pub runtime_id: Option<String>,
    pub skill_name: Option<String>,
    pub model_override: Option<String>,
    pub primary_host: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationMessage {
    pub id: String,
    pub conversation_id: String,
    pub role: String,
    pub content: String,
    pub sort_order: i32,
    pub created_at: String,
    pub tool_call_name: Option<String>,
    pub tool_call_id: Option<String>,
    pub tool_input: Option<String>,
}

#[allow(clippy::too_many_arguments)]
pub fn create_conversation(
    db: &Database,
    id: &str,
    title: &str,
    runtime_id: Option<&str>,
    skill_name: Option<&str>,
    model_override: Option<&str>,
    primary_host: Option<&str>,
    created_at: &str,
) -> Result<(), String> {
    db.with_conn(|conn| {
        conn.execute(
            "INSERT INTO conversations (id, title, runtime_id, skill_name, model_override, primary_host, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
            params![
                id,
                title,
                runtime_id,
                skill_name,
                model_override,
                primary_host,
                created_at
            ],
        )?;
        Ok(())
    })
}

#[allow(dead_code)] // used in tests
pub fn save_message(db: &Database, msg: &ConversationMessage) -> Result<(), String> {
    db.with_conn(|conn| {
        conn.execute(
            "INSERT OR REPLACE INTO conversation_messages \
             (id, conversation_id, role, content, sort_order, created_at, \
              tool_call_name, tool_call_id, tool_input) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                msg.id,
                msg.conversation_id,
                msg.role,
                msg.content,
                msg.sort_order,
                msg.created_at,
                msg.tool_call_name,
                msg.tool_call_id,
                msg.tool_input,
            ],
        )?;
        conn.execute(
            "UPDATE conversations SET updated_at = ?1 WHERE id = ?2",
            params![msg.created_at, msg.conversation_id],
        )?;
        Ok(())
    })
}

pub fn save_messages_batch(db: &Database, msgs: &[ConversationMessage]) -> Result<(), String> {
    db.with_conn(|conn| {
        for msg in msgs {
            conn.execute(
                "INSERT OR REPLACE INTO conversation_messages \
                 (id, conversation_id, role, content, sort_order, created_at, \
                  tool_call_name, tool_call_id, tool_input) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    msg.id,
                    msg.conversation_id,
                    msg.role,
                    msg.content,
                    msg.sort_order,
                    msg.created_at,
                    msg.tool_call_name,
                    msg.tool_call_id,
                    msg.tool_input,
                ],
            )?;
        }
        if let Some(last) = msgs.last() {
            conn.execute(
                "UPDATE conversations SET updated_at = ?1 WHERE id = ?2",
                params![last.created_at, last.conversation_id],
            )?;
        }
        Ok(())
    })
}

pub fn load_conversation_messages(
    db: &Database,
    conversation_id: &str,
) -> Result<Vec<ConversationMessage>, String> {
    db.with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id, conversation_id, role, content, sort_order, created_at, \
                    tool_call_name, tool_call_id, tool_input \
             FROM conversation_messages WHERE conversation_id = ?1 ORDER BY sort_order",
        )?;
        let rows = stmt.query_map(params![conversation_id], |row| {
            Ok(ConversationMessage {
                id: row.get(0)?,
                conversation_id: row.get(1)?,
                role: row.get(2)?,
                content: row.get(3)?,
                sort_order: row.get(4)?,
                created_at: row.get(5)?,
                tool_call_name: row.get(6)?,
                tool_call_id: row.get(7)?,
                tool_input: row.get(8)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>()
    })
}

pub fn list_conversations(db: &Database) -> Result<Vec<ConversationSummary>, String> {
    db.with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id, title, runtime_id, skill_name, model_override, primary_host, created_at, updated_at \
             FROM conversations ORDER BY updated_at DESC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(ConversationSummary {
                id: row.get(0)?,
                title: row.get(1)?,
                runtime_id: row.get(2)?,
                skill_name: row.get(3)?,
                model_override: row.get(4)?,
                primary_host: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>()
    })
}

#[allow(dead_code)] // available for future use
pub fn update_conversation_title(
    db: &Database,
    conversation_id: &str,
    title: &str,
) -> Result<(), String> {
    db.with_conn(|conn| {
        conn.execute(
            "UPDATE conversations SET title = ?1 WHERE id = ?2",
            params![title, conversation_id],
        )?;
        Ok(())
    })
}

pub fn update_conversation_model_override(
    db: &Database,
    conversation_id: &str,
    model_override: Option<&str>,
) -> Result<(), String> {
    db.with_conn(|conn| {
        conn.execute(
            "UPDATE conversations SET model_override = ?1 WHERE id = ?2",
            params![model_override, conversation_id],
        )?;
        Ok(())
    })
}

pub fn update_conversation_primary_host(
    db: &Database,
    conversation_id: &str,
    primary_host: &str,
) -> Result<(), String> {
    db.with_conn(|conn| {
        conn.execute(
            "UPDATE conversations
             SET primary_host = CASE
                 WHEN primary_host IS NULL OR primary_host = '' THEN ?1
                 ELSE primary_host
             END
             WHERE id = ?2",
            params![primary_host, conversation_id],
        )?;
        Ok(())
    })
}

pub fn delete_conversation(db: &Database, conversation_id: &str) -> Result<(), String> {
    db.with_conn(|conn| {
        conn.execute(
            "DELETE FROM conversation_messages WHERE conversation_id = ?1",
            params![conversation_id],
        )?;
        conn.execute(
            "DELETE FROM conversations WHERE id = ?1",
            params![conversation_id],
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
    fn test_conversation_lifecycle() {
        let db = test_db();
        create_conversation(
            &db,
            "conv1",
            "Test Chat",
            Some("rt-1"),
            Some("security"),
            Some("gpt-5.3-codex"),
            Some("auth.example.com"),
            "2025-01-01T00:00:00.000Z",
        )
        .unwrap();

        let convs = list_conversations(&db).unwrap();
        assert_eq!(convs.len(), 1);
        assert_eq!(convs[0].title, "Test Chat");
        assert_eq!(convs[0].runtime_id.as_deref(), Some("rt-1"));
        assert_eq!(convs[0].skill_name.as_deref(), Some("security"));
        assert_eq!(convs[0].model_override.as_deref(), Some("gpt-5.3-codex"));
        assert_eq!(convs[0].primary_host.as_deref(), Some("auth.example.com"));
        assert_eq!(convs[0].created_at, "2025-01-01T00:00:00.000Z");
        assert_eq!(convs[0].updated_at, "2025-01-01T00:00:00.000Z");

        let msg = ConversationMessage {
            id: "msg1".to_string(),
            conversation_id: "conv1".to_string(),
            role: "user".to_string(),
            content: "Hello".to_string(),
            sort_order: 0,
            created_at: "2025-01-01".to_string(),
            tool_call_name: None,
            tool_call_id: None,
            tool_input: None,
        };
        save_message(&db, &msg).unwrap();

        let messages = load_conversation_messages(&db, "conv1").unwrap();
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].content, "Hello");

        delete_conversation(&db, "conv1").unwrap();
        let convs = list_conversations(&db).unwrap();
        assert!(convs.is_empty());
        let messages = load_conversation_messages(&db, "conv1").unwrap();
        assert!(messages.is_empty());
    }

    #[test]
    fn test_save_messages_batch() {
        let db = test_db();
        create_conversation(
            &db,
            "conv2",
            "Batch Test",
            Some("rt-2"),
            None,
            None,
            None,
            "2025-01-01T00:00:00.000Z",
        )
        .unwrap();

        let msgs = vec![
            ConversationMessage {
                id: "m1".to_string(),
                conversation_id: "conv2".to_string(),
                role: "user".to_string(),
                content: "Hello".to_string(),
                sort_order: 0,
                created_at: "2025-01-01".to_string(),
                tool_call_name: None,
                tool_call_id: None,
                tool_input: None,
            },
            ConversationMessage {
                id: "m2".to_string(),
                conversation_id: "conv2".to_string(),
                role: "assistant".to_string(),
                content: "Hi there".to_string(),
                sort_order: 1,
                created_at: "2025-01-01".to_string(),
                tool_call_name: None,
                tool_call_id: None,
                tool_input: None,
            },
            ConversationMessage {
                id: "m3".to_string(),
                conversation_id: "conv2".to_string(),
                role: "toolCall".to_string(),
                content: "list_sessions".to_string(),
                sort_order: 2,
                created_at: "2025-01-01".to_string(),
                tool_call_name: Some("list_sessions".to_string()),
                tool_call_id: Some("tc_001".to_string()),
                tool_input: Some(r#"{"limit":10}"#.to_string()),
            },
        ];
        save_messages_batch(&db, &msgs).unwrap();

        let loaded = load_conversation_messages(&db, "conv2").unwrap();
        assert_eq!(loaded.len(), 3);
        assert_eq!(loaded[2].tool_call_name.as_deref(), Some("list_sessions"));
        assert_eq!(loaded[2].tool_call_id.as_deref(), Some("tc_001"));
        assert_eq!(loaded[2].tool_input.as_deref(), Some(r#"{"limit":10}"#));
    }

    #[test]
    fn test_update_conversation_title() {
        let db = test_db();
        create_conversation(
            &db,
            "conv3",
            "Old Title",
            Some("rt-3"),
            None,
            None,
            None,
            "2025-01-01T00:00:00.000Z",
        )
        .unwrap();

        update_conversation_title(&db, "conv3", "New Title").unwrap();

        let convs = list_conversations(&db).unwrap();
        assert_eq!(convs[0].title, "New Title");
    }

    #[test]
    fn test_update_conversation_model_override() {
        let db = test_db();
        create_conversation(
            &db,
            "conv4",
            "Model Override",
            Some("rt-4"),
            None,
            None,
            None,
            "2025-01-01T00:00:00.000Z",
        )
        .unwrap();

        update_conversation_model_override(&db, "conv4", Some("claude-sonnet-4-5")).unwrap();

        let convs = list_conversations(&db).unwrap();
        assert_eq!(
            convs[0].model_override.as_deref(),
            Some("claude-sonnet-4-5")
        );
    }

    #[test]
    fn test_update_conversation_primary_host_only_backfills_empty_values() {
        let db = test_db();
        create_conversation(
            &db,
            "conv5",
            "Primary Host",
            Some("rt-5"),
            None,
            None,
            None,
            "2025-01-01T00:00:00.000Z",
        )
        .unwrap();

        update_conversation_primary_host(&db, "conv5", "auth.example.com").unwrap();
        update_conversation_primary_host(&db, "conv5", "profile.example.com").unwrap();

        let convs = list_conversations(&db).unwrap();
        assert_eq!(convs[0].primary_host.as_deref(), Some("auth.example.com"));
    }
}

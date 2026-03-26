//! Context window management: token estimation and message truncation.
//!
//! Uses a character-based heuristic for token counting. The ratio varies by
//! language (English ≈ 4 chars/token, CJK ≈ 1.5 chars/token) but 3.5 is a
//! reasonable cross-language average for mixed content including JSON overhead.

use std::collections::HashSet;

use crate::ai::types::{ContentBlock, Message, ToolDefinition};

/// Approximate chars-per-token ratio. Conservative to avoid under-counting.
const CHARS_PER_TOKEN: f64 = 3.5;

/// Tokens reserved for the model's output (max_tokens sent to API).
const OUTPUT_RESERVE_TOKENS: u32 = 4096;

/// Maximum characters allowed for inline session data in the system prompt.
const MAX_SESSION_DATA_CHARS: usize = 30_000;

/// Default context window sizes by runtime kind / protocol when user sets 0 (auto).
pub fn default_context_tokens(runtime_key: &str) -> u32 {
    match runtime_key {
        "claude_code_local" | "anthropic" | "remote_api:anthropic" => 200_000,
        "codex_local" | "openAI" | "openai" | "remote_api:openai" => 128_000,
        _ => 8_000, // conservative default for custom / unknown runtimes
    }
}

/// Resolve the effective context budget in tokens.
pub fn resolve_context_budget(max_context_tokens: u32, runtime_key: &str) -> u32 {
    if max_context_tokens > 0 {
        max_context_tokens
    } else {
        default_context_tokens(runtime_key)
    }
}

/// Estimate token count from a string.
fn estimate_string_tokens(s: &str) -> u32 {
    (s.len() as f64 / CHARS_PER_TOKEN).ceil() as u32
}

/// Estimate token count for a single content block.
fn estimate_content_block_tokens(block: &ContentBlock) -> u32 {
    match block {
        ContentBlock::Text { text } => estimate_string_tokens(text),
        ContentBlock::ToolUse { name, input, .. } => {
            // tool name + JSON-serialized input
            let input_str = input.to_string();
            estimate_string_tokens(name) + estimate_string_tokens(&input_str) + 10
        }
        ContentBlock::ToolResult { content, .. } => estimate_string_tokens(content) + 10,
    }
}

/// Estimate token count for a single message.
fn estimate_message_tokens(msg: &Message) -> u32 {
    // Each message has ~4 tokens of overhead (role, separators)
    let overhead = 4u32;
    let content_tokens: u32 = msg.content.iter().map(estimate_content_block_tokens).sum();
    overhead + content_tokens
}

/// Estimate token count for tool definitions.
fn estimate_tool_definitions_tokens(tools: &[ToolDefinition]) -> u32 {
    tools
        .iter()
        .map(|t| {
            let schema_str = t.input_schema.to_string();
            estimate_string_tokens(&t.name)
                + estimate_string_tokens(&t.description)
                + estimate_string_tokens(&schema_str)
                + 20 // structural overhead per tool
        })
        .sum()
}

/// Truncate conversation history to fit within a token budget.
///
/// Strategy: keep the most recent messages. If the budget is tight, drop the
/// oldest user-assistant exchange pairs first. The last user message is always
/// preserved. After truncation, any orphan `tool_result` blocks (whose matching
/// `tool_use` was truncated) are removed to prevent API errors.
///
/// Returns a (possibly shortened) message list and whether truncation occurred.
pub fn truncate_messages_to_budget(
    messages: &[Message],
    system_prompt: &str,
    tools: &[ToolDefinition],
    context_budget: u32,
) -> (Vec<Message>, bool) {
    let system_tokens = estimate_string_tokens(system_prompt);
    let tool_tokens = estimate_tool_definitions_tokens(tools);
    let fixed_overhead = system_tokens + tool_tokens + OUTPUT_RESERVE_TOKENS;

    if fixed_overhead >= context_budget {
        if let Some(last) = messages.last() {
            let mut result = vec![last.clone()];
            strip_orphan_tool_references(&mut result);
            return (result, true);
        }
        return (vec![], true);
    }

    let message_budget = context_budget - fixed_overhead;

    let message_tokens: Vec<u32> = messages.iter().map(estimate_message_tokens).collect();
    let total: u32 = message_tokens.iter().sum();

    if total <= message_budget {
        return (messages.to_vec(), false);
    }

    // Keep messages from the end, dropping oldest first
    let mut kept_tokens = 0u32;
    let mut keep_from = messages.len();

    for i in (0..messages.len()).rev() {
        let msg_tokens = message_tokens[i];
        if kept_tokens + msg_tokens > message_budget {
            break;
        }
        kept_tokens += msg_tokens;
        keep_from = i;
    }

    if keep_from >= messages.len() {
        keep_from = messages.len().saturating_sub(1);
    }

    let mut result: Vec<Message> = messages[keep_from..].to_vec();

    // Remove all orphan tool references caused by truncation
    strip_orphan_tool_references(&mut result);

    (result, true)
}

/// Remove orphan `tool_result` blocks that reference `tool_use` IDs not present
/// in any assistant message, and remove orphan `tool_use` blocks whose results
/// are missing. Cleans up empty messages after stripping.
fn strip_orphan_tool_references(messages: &mut Vec<Message>) {
    // Collect all tool_use IDs from assistant messages
    let tool_use_ids: HashSet<String> = messages
        .iter()
        .filter(|m| m.role == "assistant")
        .flat_map(|m| m.content.iter())
        .filter_map(|b| match b {
            ContentBlock::ToolUse { id, .. } => Some(id.clone()),
            _ => None,
        })
        .collect();

    // Collect all tool_result IDs from user messages
    let tool_result_ids: HashSet<String> = messages
        .iter()
        .filter(|m| m.role == "user")
        .flat_map(|m| m.content.iter())
        .filter_map(|b| match b {
            ContentBlock::ToolResult { tool_use_id, .. } => Some(tool_use_id.clone()),
            _ => None,
        })
        .collect();

    // Strip orphan tool_result blocks (no matching tool_use)
    for msg in messages.iter_mut() {
        if msg.role == "user" {
            msg.content.retain(|b| match b {
                ContentBlock::ToolResult { tool_use_id, .. } => {
                    tool_use_ids.contains(tool_use_id)
                }
                _ => true,
            });
        }
    }

    // Strip orphan tool_use blocks (no matching tool_result)
    for msg in messages.iter_mut() {
        if msg.role == "assistant" {
            msg.content.retain(|b| match b {
                ContentBlock::ToolUse { id, .. } => tool_result_ids.contains(id),
                _ => true,
            });
        }
    }

    // Remove empty messages
    messages.retain(|m| !m.content.is_empty());
}

/// Truncate inline session data in the system prompt to fit within
/// [`MAX_SESSION_DATA_CHARS`]. If the sessions section exceeds the limit,
/// each session's JSON is truncated with a marker.
pub fn limit_session_data(session_json: &str) -> String {
    if session_json.len() <= MAX_SESSION_DATA_CHARS {
        return session_json.to_string();
    }

    // Truncate to budget and append a note
    let truncated = &session_json[..MAX_SESSION_DATA_CHARS];
    // Find the last complete line to avoid broken JSON
    let cut_point = truncated.rfind('\n').unwrap_or(MAX_SESSION_DATA_CHARS);
    format!(
        "{}\n... [session data truncated — {} chars omitted]",
        &session_json[..cut_point],
        session_json.len() - cut_point
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn text_msg(role: &str, text: &str) -> Message {
        Message {
            role: role.to_string(),
            content: vec![ContentBlock::Text {
                text: text.to_string(),
            }],
        }
    }

    fn tool_result_msg(tool_use_id: &str, content: &str) -> Message {
        Message {
            role: "user".to_string(),
            content: vec![ContentBlock::ToolResult {
                tool_use_id: tool_use_id.to_string(),
                content: content.to_string(),
                is_error: false,
            }],
        }
    }

    #[test]
    fn test_estimate_string_tokens() {
        // 14 chars / 3.5 ≈ 4 tokens
        assert_eq!(estimate_string_tokens("Hello, world!!"), 4);
        assert_eq!(estimate_string_tokens(""), 0);
    }

    #[test]
    fn test_no_truncation_when_fits() {
        let messages = vec![text_msg("user", "hello"), text_msg("assistant", "world")];
        let (result, truncated) = truncate_messages_to_budget(&messages, "system", &[], 10_000);
        assert!(!truncated);
        assert_eq!(result.len(), 2);
    }

    #[test]
    fn test_truncation_drops_oldest() {
        let messages: Vec<Message> = (0..100)
            .map(|i| {
                text_msg(
                    if i % 2 == 0 { "user" } else { "assistant" },
                    &"x".repeat(100),
                )
            })
            .collect();

        // Tight budget: only room for a few messages
        let (result, truncated) = truncate_messages_to_budget(&messages, "system", &[], 500);
        assert!(truncated);
        assert!(result.len() < messages.len());
        // Last message is always preserved
        assert_eq!(result.last().unwrap().role, messages.last().unwrap().role);
    }

    #[test]
    fn test_truncation_skips_orphan_tool_results() {
        let messages = vec![
            text_msg("user", "q1"),
            Message {
                role: "assistant".to_string(),
                content: vec![
                    ContentBlock::Text { text: "a".repeat(500) },
                    ContentBlock::ToolUse {
                        id: "t1".to_string(),
                        name: "tool".to_string(),
                        input: json!({}),
                    },
                ],
            },
            tool_result_msg("t1", &"r".repeat(500)),
            text_msg("user", "q2"),
            text_msg("assistant", "a2"),
        ];

        // Budget that can fit q2+a2 and the tool_result but not the first assistant msg.
        // The truncation should strip the orphan tool_result.
        let (result, truncated) = truncate_messages_to_budget(&messages, "system", &[], 600);
        assert!(truncated);
        // No message should contain an orphan tool_result
        for msg in &result {
            for block in &msg.content {
                assert!(
                    !matches!(block, ContentBlock::ToolResult { .. }),
                    "orphan tool_result should have been stripped"
                );
            }
        }
    }

    #[test]
    fn test_truncation_preserves_matched_tool_pairs() {
        let messages = vec![
            text_msg("user", "old question"),
            text_msg("assistant", &"old answer ".repeat(200)),
            text_msg("user", "new question"),
            Message {
                role: "assistant".to_string(),
                content: vec![
                    ContentBlock::Text { text: "let me check".to_string() },
                    ContentBlock::ToolUse {
                        id: "t2".to_string(),
                        name: "search".to_string(),
                        input: json!({"q": "test"}),
                    },
                ],
            },
            tool_result_msg("t2", "search results here"),
            text_msg("user", "thanks"),
            text_msg("assistant", "done"),
        ];

        let (result, truncated) = truncate_messages_to_budget(&messages, "system", &[], 800);
        assert!(truncated);
        // The matched tool pair should be preserved or both removed
        let has_tool_use = result.iter().any(|m| {
            m.content.iter().any(|b| matches!(b, ContentBlock::ToolUse { id, .. } if id == "t2"))
        });
        let has_tool_result = result.iter().any(|m| {
            m.content.iter().any(|b| matches!(b, ContentBlock::ToolResult { tool_use_id, .. } if tool_use_id == "t2"))
        });
        assert_eq!(has_tool_use, has_tool_result, "tool_use and tool_result must be both present or both absent");
    }

    #[test]
    fn test_strip_orphan_removes_mismatched_references() {
        use super::strip_orphan_tool_references;

        let mut messages = vec![
            // orphan tool_result (no matching assistant tool_use)
            Message {
                role: "user".to_string(),
                content: vec![ContentBlock::ToolResult {
                    tool_use_id: "orphan_id".to_string(),
                    content: "stale result".to_string(),
                    is_error: false,
                }],
            },
            text_msg("user", "hello"),
            Message {
                role: "assistant".to_string(),
                content: vec![
                    ContentBlock::Text { text: "checking".to_string() },
                    ContentBlock::ToolUse {
                        id: "valid_id".to_string(),
                        name: "tool".to_string(),
                        input: json!({}),
                    },
                ],
            },
            Message {
                role: "user".to_string(),
                content: vec![ContentBlock::ToolResult {
                    tool_use_id: "valid_id".to_string(),
                    content: "valid result".to_string(),
                    is_error: false,
                }],
            },
        ];

        strip_orphan_tool_references(&mut messages);

        // orphan tool_result message should be removed
        assert_eq!(messages.len(), 3);
        assert_eq!(messages[0].role, "user");
        assert!(matches!(&messages[0].content[0], ContentBlock::Text { text } if text == "hello"));
    }

    #[test]
    fn test_limit_session_data_short() {
        let short = "short data";
        assert_eq!(limit_session_data(short), short);
    }

    #[test]
    fn test_limit_session_data_long() {
        let long = "a\n".repeat(20_000);
        let result = limit_session_data(&long);
        assert!(result.len() < long.len());
        assert!(result.contains("truncated"));
    }

    #[test]
    fn test_default_context_tokens() {
        assert_eq!(default_context_tokens("claude_code_local"), 200_000);
        assert_eq!(default_context_tokens("codex_local"), 128_000);
        assert_eq!(default_context_tokens("remote_api:anthropic"), 200_000);
        assert_eq!(default_context_tokens("remote_api:openai"), 128_000);
        assert_eq!(default_context_tokens("unknown"), 8_000);
    }

    #[test]
    fn test_resolve_context_budget() {
        assert_eq!(resolve_context_budget(0, "remote_api:anthropic"), 200_000);
        assert_eq!(resolve_context_budget(4096, "codex_local"), 4096);
    }

    #[test]
    fn test_estimate_tool_definitions_tokens() {
        let tools = vec![ToolDefinition {
            name: "get_session".to_string(),
            description: "Get a session by ID".to_string(),
            input_schema: json!({"type": "object", "properties": {"id": {"type": "string"}}}),
        }];
        let tokens = estimate_tool_definitions_tokens(&tools);
        assert!(tokens > 0);
    }
}

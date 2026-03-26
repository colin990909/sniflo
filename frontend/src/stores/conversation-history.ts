import type { ChatMessage } from "./ai-store";

/** A content block matching the Rust ContentBlock enum (serde tagged by "type"). */
interface ContentBlock {
  type: "text" | "tool_use" | "tool_result";
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: string;
  is_error?: boolean;
}

/** A history message with structured content blocks, matching Rust HistoryMessage. */
export interface HistoryMessage {
  role: string;
  content: ContentBlock[];
}

function collectToolUseBlocks(messages: ChatMessage[], startIndex: number): [ContentBlock[], number] {
  const blocks: ContentBlock[] = [];
  let i = startIndex;

  while (i < messages.length && messages[i].role === "toolCall") {
    const toolCall = messages[i];
    if (toolCall.toolCallId && toolCall.toolCallName && toolCall.toolInput) {
      try {
        blocks.push({
          type: "tool_use",
          id: toolCall.toolCallId,
          name: toolCall.toolCallName,
          input: JSON.parse(toolCall.toolInput),
        });
      } catch {
        // Skip malformed tool input
      }
    }
    i++;
  }

  return [blocks, i];
}

/**
 * Convert the flat ChatMessage list into structured HistoryMessage array
 * that preserves tool_use / tool_result blocks across conversation turns.
 *
 * Grouping rules (following Anthropic Messages API format):
 *   user text          → { role: "user",      content: [Text] }
 *   assistant text     → { role: "assistant",  content: [Text, ...ToolUse] }
 *     + following toolCalls are merged into the same assistant message
 *   toolResult(s)      → { role: "user",       content: [...ToolResult] }
 */
export function buildConversationHistory(messages: ChatMessage[]): HistoryMessage[] {
  const relevant = messages.filter((m) => {
    if (m.role === "system" || m.role === "thought" || m.role === "observation") return false;
    if (m.role === "toolCall" && !m.toolInput) return false;
    return true;
  });

  const history: HistoryMessage[] = [];
  let i = 0;

  while (i < relevant.length) {
    const msg = relevant[i];

    if (msg.role === "user") {
      if (msg.content.trim()) {
        history.push({
          role: "user",
          content: [{ type: "text", text: msg.content }],
        });
      }
      i++;
    } else if (msg.role === "assistant") {
      const blocks: ContentBlock[] = [];

      if (msg.content.trim()) {
        blocks.push({ type: "text", text: msg.content });
      }

      const [toolUseBlocks, nextIndex] = collectToolUseBlocks(relevant, i + 1);
      blocks.push(...toolUseBlocks);
      i = nextIndex;

      if (blocks.length > 0) {
        history.push({ role: "assistant", content: blocks });
      }
    } else if (msg.role === "toolCall") {
      const [blocks, nextIndex] = collectToolUseBlocks(relevant, i);
      if (blocks.length > 0) {
        history.push({ role: "assistant", content: blocks });
      }
      i = nextIndex;
    } else if (msg.role === "toolResult") {
      const blocks: ContentBlock[] = [];

      while (i < relevant.length && relevant[i].role === "toolResult") {
        const tr = relevant[i];
        if (tr.toolCallId) {
          blocks.push({
            type: "tool_result",
            tool_use_id: tr.toolCallId,
            content: tr.content,
            is_error: tr.isError ?? false,
          });
        }
        i++;
      }

      if (blocks.length > 0) {
        history.push({ role: "user", content: blocks });
      }
    } else {
      i++;
    }
  }

  return history;
}

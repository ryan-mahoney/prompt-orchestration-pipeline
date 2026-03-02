import type { ChatMessage } from "./types";

const MENTION_PATTERN = /@\[[^\]]*]\(([^)]+)\)/g;

export function parseMentions(messages: ChatMessage[]): string[] {
  const seen = new Set<string>();

  for (const message of messages) {
    for (const match of message.content.matchAll(MENTION_PATTERN)) {
      const id = match[1];
      if (id) seen.add(id);
    }
  }

  return [...seen];
}

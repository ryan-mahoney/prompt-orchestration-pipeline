/**
 * Parse @[display](id) mentions from chat messages.
 * Used to extract referenced artifact files for schema enrichment.
 */

const MENTION_REGEX = /@\[([^\]]+)\]\(([^)]+)\)/g;

/**
 * Extract unique filenames from @mentions in messages.
 * @param {Array<{ role: string, content: string }>} messages
 * @returns {string[]} Array of unique filenames
 */
export function parseMentions(messages) {
  const filenames = new Set();

  for (const msg of messages) {
    if (!msg.content) continue;
    for (const match of msg.content.matchAll(MENTION_REGEX)) {
      filenames.add(match[2]);
    }
  }

  return [...filenames];
}

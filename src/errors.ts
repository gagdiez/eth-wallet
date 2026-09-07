/** Providers may reject with plain JSON objects rather than Error instances. */
export function errorMessage(error: unknown): string {
  const messages: string[] = [];
  const seen = new Set<object>();
  function visit(value: unknown, depth = 0) {
    if (depth > 8 || value == null) return;
    if (typeof value === 'string') {
      if (value.trim() && !messages.includes(value)) messages.push(value);
      return;
    }
    if (typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    const item = value as Record<string, unknown>;
    if (typeof item.message === 'string') visit(item.message, depth + 1);
    for (const key of ['data', 'originalError', 'error', 'cause']) visit(item[key], depth + 1);
  }
  visit(error);
  if (messages.length) return messages.join(': ');
  try { return JSON.stringify(error) ?? String(error); }
  catch { return 'Unknown wallet error'; }
}

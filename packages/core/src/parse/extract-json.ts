/**
 * Pulls the first complete JSON object out of a model response. Models wrap
 * JSON in fences or narrate around it often enough that failing on that alone
 * would measure formatting compliance rather than prediction quality — but the
 * recovery is deliberately narrow, and anything beyond it is a contract
 * violation rather than a guess.
 */
export const extractJsonObject = (raw: string): string | null => {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;

  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const candidate = fenced?.[1]?.trim() ?? trimmed;

  const start = candidate.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < candidate.length; index += 1) {
    const char = candidate[index];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      if (inString) escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return candidate.slice(start, index + 1);
    }
  }

  return null;
};

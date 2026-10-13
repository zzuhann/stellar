// Strips leading @ and surrounding whitespace from each comma-separated IG/Threads handle.
// ponytail: anything else (URLs, other separators) is stored as-is rather than guessed at.
export const normalizeSocialHandles = (value: string): string =>
  value
    .split(',')
    .map(handle => handle.trim().replace(/^@+\s*/, ''))
    .filter(Boolean)
    .join(', ');

// IG/Threads handles never contain "@" or whitespace; keep comma-separated multi-handle structure.
export const normalizeSocialHandles = (value: string): string =>
  value
    .split(',')
    .map(part => part.replace(/[@\s]/g, ''))
    .filter(Boolean)
    .join(', ');

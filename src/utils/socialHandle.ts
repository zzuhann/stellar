const PROFILE_URL =
  /(?:https?:\/\/)?(?:www\.)?(?:instagram|threads)\.(?:com|net)\/@?([A-Za-z0-9._]+)(?:[/?#][^\s,、]*)?/gi;

// IG/Threads handles never contain "@", whitespace, ",", "、" or "/"; those are all treated as separators.
export const normalizeSocialHandles = (value: string): string =>
  value
    .replace(PROFILE_URL, '$1')
    .split(/[,、/\s]+/)
    .map(part => part.replace(/@/g, ''))
    .filter(Boolean)
    .join(', ');

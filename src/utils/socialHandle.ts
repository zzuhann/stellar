const PROFILE_URL =
  /(?:https?:\/\/)?(?:www\.)?(instagram|threads)\.(?:com|net)\/@?([A-Za-z0-9._]+)(?:\/([A-Za-z0-9._]+))?(?:[/?#][^\s,、]*)?/gi;
const IG_RESERVED = new Set(['p', 'reel', 'reels', 'tv', 'explore', 'stories', 'accounts']);

// Returns null when a URL can't be resolved to a handle (e.g. IG post links); callers must keep the original.
// Handles never contain "@", whitespace, ",", "、" or "/"; those are all separators.
export const parseSocialHandles = (value: string): string | null => {
  let unresolvable = false;
  const unwrapped = value.replace(
    PROFILE_URL,
    (_m, platform: string, first: string, second?: string) => {
      if (platform.toLowerCase() !== 'instagram' || !IG_RESERVED.has(first.toLowerCase())) {
        return first;
      }
      if (first.toLowerCase() === 'stories' && second) return second;
      unresolvable = true;
      return '';
    }
  );
  if (unresolvable) return null;
  return unwrapped
    .split(/[,、/\s]+/)
    .map(part => part.replace(/@/g, ''))
    .filter(Boolean)
    .join(', ');
};

export const normalizeSocialHandles = (value: string): string =>
  parseSocialHandles(value) ?? value.trim();

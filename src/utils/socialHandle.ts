const IG_RESERVED = new Set(['p', 'reel', 'reels', 'tv', 'explore', 'stories', 'accounts']);
const IG_HOSTS = new Set(['instagram.com', 'www.instagram.com']);
const THREADS_HOSTS = new Set(['threads.com', 'www.threads.com', 'threads.net', 'www.threads.net']);
const USERNAME = /^[A-Za-z0-9._]+$/;
const LOOKS_LIKE_URL = /:\/\/|^[\w.-]+\.[a-z]{2,}\//i;

// Returns the handle from a whitelisted IG/Threads profile URL, or null if it can't be resolved.
const handleFromUrl = (token: string): string | null => {
  let url: URL;
  try {
    url = new URL(token.includes('://') ? token : `https://${token}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const segs = url.pathname.split('/').slice(1);
  if (segs[segs.length - 1] === '') segs.pop();

  let user: string | undefined;
  if (IG_HOSTS.has(host)) {
    if (segs[0]?.toLowerCase() === 'stories' && segs.length >= 2) user = segs[1];
    else if (segs.length === 1 && !IG_RESERVED.has(segs[0].toLowerCase())) user = segs[0];
  } else if (THREADS_HOSTS.has(host)) {
    if (segs[0]?.startsWith('@')) user = segs[0].slice(1);
  }
  return user && USERNAME.test(user) ? user : null;
};

// Returns null when any token can't be resolved (e.g. IG post links, foreign URLs); callers keep the original.
// Plain handles are not charset-checked: stylised Unicode handles exist in the data.
export const parseSocialHandles = (value: string): string | null => {
  const handles: string[] = [];
  for (const token of value.split(/[,、\s]+/).filter(Boolean)) {
    if (LOOKS_LIKE_URL.test(token)) {
      const handle = handleFromUrl(token);
      if (handle === null) return null;
      handles.push(handle);
    } else {
      for (const part of token.split('/')) {
        const cleaned = part.replace(/@/g, '');
        if (cleaned) handles.push(cleaned);
      }
    }
  }
  return handles.join(', ');
};

export const normalizeSocialHandles = (value: string): string =>
  parseSocialHandles(value) ?? value.trim();

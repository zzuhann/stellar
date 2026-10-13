const IG_RESERVED = new Set(['p', 'reel', 'reels', 'tv', 'explore', 'stories', 'accounts']);
const IG_HOSTS = new Set(['instagram.com', 'www.instagram.com']);
const THREADS_HOSTS = new Set(['threads.com', 'www.threads.com', 'threads.net', 'www.threads.net']);
const USERNAME = /^[A-Za-z0-9._]+$/;
const FINAL_HANDLE = /^[A-Za-z0-9._]{1,30}$/;
const LOOKS_LIKE_URL = /:\/\/|^\/\/|^[\w.-]+\.[a-z]{2,}(:\d+)?\//i;

// Returns the handle from a whitelisted IG/Threads profile URL, or null if it can't be resolved.
const handleFromUrl = (token: string): string | null => {
  let url: URL;
  try {
    let href = `https://${token}`;
    if (token.startsWith('//')) href = `https:${token}`;
    else if (token.includes('://')) href = token;
    url = new URL(href);
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
// Input is NFKC-normalised so stylised/full-width characters become ASCII.
export const parseSocialHandles = (value: string): string | null => {
  const handles: string[] = [];
  // Split on whitespace only first: URLs never contain spaces, so commas in a query stay in the chunk.
  for (const chunk of value.normalize('NFKC').split(/\s+/).filter(Boolean)) {
    if (LOOKS_LIKE_URL.test(chunk)) {
      // 、 inside a URL chunk can't be told apart from a list separator
      if (chunk.includes('、')) return null;
      const handle = handleFromUrl(chunk.replace(/^,+|,+$/g, ''));
      if (handle === null) return null;
      handles.push(handle);
    } else {
      for (const piece of chunk.split(/[,、]+/)) {
        if (LOOKS_LIKE_URL.test(piece.replace(/^@+/, ''))) return null;
        for (const part of piece.split('/')) {
          const cleaned = part.replace(/@/g, '');
          if (cleaned) handles.push(cleaned);
        }
      }
    }
  }
  if (!handles.every(h => FINAL_HANDLE.test(h))) return null;
  return handles.join(', ');
};

export const normalizeSocialHandles = (value: string): string =>
  parseSocialHandles(value) ?? value.trim();

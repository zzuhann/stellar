import { oauthConfig } from '../config/oauth';

interface OAuthState {
  eventId: string;
  userId: string;
  redirectUrl: string;
  timestamp: number;
}

export function encodeState(data: Omit<OAuthState, 'timestamp'>): string {
  return Buffer.from(
    JSON.stringify({
      ...data,
      timestamp: Date.now(),
    })
  ).toString('base64url');
}

export function decodeState(state: string): OAuthState {
  const decoded = JSON.parse(Buffer.from(state, 'base64url').toString()) as OAuthState;

  // 驗證 10 分鐘內有效
  if (Date.now() - decoded.timestamp > 10 * 60 * 1000) {
    throw new Error('State expired');
  }

  return decoded;
}

interface TokenResponse {
  access_token: string;
  user_id: string;
}

export async function exchangeCodeForToken(code: string): Promise<string> {
  const response = await fetch(oauthConfig.threads.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: oauthConfig.threads.clientId,
      client_secret: oauthConfig.threads.clientSecret,
      grant_type: 'authorization_code',
      redirect_uri: oauthConfig.threads.redirectUri,
      code,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Token exchange failed:', errorText);
    throw new Error('Failed to exchange code for token');
  }

  const data = (await response.json()) as TokenResponse;
  return data.access_token;
}

interface ThreadsUserInfo {
  id: string;
  username: string;
}

export async function getThreadsUsername(accessToken: string): Promise<string> {
  const url = `${oauthConfig.threads.userInfoUrl}?fields=id,username&access_token=${accessToken}`;
  const response = await fetch(url);

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Get user info failed:', errorText);
    throw new Error('Failed to get Threads user info');
  }

  const data = (await response.json()) as ThreadsUserInfo;
  return data.username;
}

export function matchUsername(
  oauthUsername: string,
  socialMedia: { instagram?: string; threads?: string }
): boolean {
  const normalized = oauthUsername.toLowerCase();

  const allUsernames = [
    ...(socialMedia.threads?.split(',').map(s => s.trim().toLowerCase()) || []),
    ...(socialMedia.instagram?.split(',').map(s => s.trim().toLowerCase()) || []),
  ];

  return allUsernames.includes(normalized);
}

export function buildThreadsOAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: oauthConfig.threads.clientId,
    redirect_uri: oauthConfig.threads.redirectUri,
    scope: oauthConfig.threads.scope,
    response_type: 'code',
    state,
  });

  const url = `${oauthConfig.threads.authorizationUrl}?${params.toString()}`;
  return url;
}

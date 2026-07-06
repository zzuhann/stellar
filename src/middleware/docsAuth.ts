import { Request, Response, NextFunction } from 'express';

// /api/docs 的存取關卡：HTTP Basic Auth
// （原本疊加 IP 白名單，但公網 IP 是動態的，IP 一換帳密就形同虛設，
// 改為 Basic Auth 單一關卡。ipWhitelist.ts 邏輯保留但未套用在此路由）
const DOCS_REALM = 'STELLAR API Docs';

const sendUnauthorized = (res: Response): void => {
  res.setHeader('WWW-Authenticate', `Basic realm="${DOCS_REALM}"`);
  res.status(401).json({ error: 'Unauthorized' });
};

export const requireDocsAuth = (req: Request, res: Response, next: NextFunction): void => {
  // 本地開發不設限，跟 restrictToWhitelistedIp 的 dev bypass 一致
  if (process.env.NODE_ENV !== 'production') {
    next();
    return;
  }

  const { DOCS_USER, DOCS_PASSWORD } = process.env;

  // fail-closed：帳密任一沒設定時一律拒絕，不能因為沒設定就直接放行
  if (!DOCS_USER || !DOCS_PASSWORD) {
    console.warn('/api/docs blocked: DOCS_USER or DOCS_PASSWORD not configured');
    sendUnauthorized(res);
    return;
  }

  const authHeader = req.headers.authorization || '';
  const [scheme, encoded] = authHeader.split(' ');

  if (scheme !== 'Basic' || !encoded) {
    sendUnauthorized(res);
    return;
  }

  let decoded: string;
  try {
    decoded = Buffer.from(encoded, 'base64').toString('utf8');
  } catch {
    sendUnauthorized(res);
    return;
  }

  const separatorIndex = decoded.indexOf(':');
  if (separatorIndex === -1) {
    sendUnauthorized(res);
    return;
  }

  const user = decoded.slice(0, separatorIndex);
  const password = decoded.slice(separatorIndex + 1);

  if (user === DOCS_USER && password === DOCS_PASSWORD) {
    next();
    return;
  }

  console.warn('/api/docs blocked: invalid Basic Auth credentials');
  sendUnauthorized(res);
};

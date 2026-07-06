import { Request, Response, NextFunction } from 'express';

// 白名單：只有這些 IP 可以存取（用逗號分隔），比照 EMAIL_WHITELIST 的寫法
const docsIpWhitelist = new Set(
  (process.env.DOCS_IP_WHITELIST || '')
    .split(',')
    .map(ip => ip.trim())
    .filter(Boolean)
);

// IPv4-mapped IPv6（如 ::ffff:1.2.3.4）正規化成純 IPv4，避免跟白名單的 1.2.3.4 字串比對不相等
const normalizeIp = (ip: string): string => ip.replace(/^::ffff:/i, '');

// 白名單外一律回 404，避免讓人知道這條路由其實存在
export const restrictToWhitelistedIp = (req: Request, res: Response, next: NextFunction): void => {
  // 本地開發不設限，方便工程師自己看文件
  if (process.env.NODE_ENV !== 'production') {
    next();
    return;
  }

  const normalizedIp = normalizeIp(req.ip || '');

  if (docsIpWhitelist.has(normalizedIp)) {
    next();
    return;
  }

  console.warn(`/api/docs blocked: req.ip=${req.ip || ''}, normalized=${normalizedIp}`);
  res.status(404).json({ error: 'Route not found' });
};

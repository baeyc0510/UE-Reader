// Local-only API: loopback Host, same-origin requests, defensive headers.
export function localOnly(req, res, next) {
  const host = req.headers.host || '';
  if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return res.status(403).json({ error: '로컬 연결만 허용합니다.' });
  if (req.headers.origin && ![`http://${host}`, `https://${host}`].includes(req.headers.origin)) return res.status(403).json({ error: '외부 페이지 요청은 허용하지 않습니다.' });
  if (req.headers['sec-fetch-site'] === 'cross-site') return res.status(403).json({ error: '외부 요청은 허용하지 않습니다.' });
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  if (req.path.startsWith('/api')) res.setHeader('Cache-Control', 'no-store');
  next();
}

export const asyncRoute = handler => (req, res, next) => Promise.resolve(handler(req, res)).catch(next);
export const errorHandler = (err, req, res, next) => res.status(err.status || 500).json({ error: err.message || '작업을 완료하지 못했습니다.' });

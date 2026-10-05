// Fallback proxy for chess.com's public API (spec 5): used only when the browser's direct fetch fails (network / CORS).
// Only /pub/player/ paths are allowed, a proper User-Agent is added, 429s are retried, and responses are cached for 60 s.
import type { VercelRequest, VercelResponse } from '@vercel/node';

const ALLOWED = /^\/pub\/player\/[A-Za-z0-9_-]{2,50}(\/games\/archives|\/games\/\d{4}\/\d{1,2}(\/pgn)?)?\/?$/;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'GET only' });
    return;
  }
  const raw = Array.isArray(req.query.path) ? req.query.path[0] : req.query.path;
  const path = typeof raw === 'string' ? raw : '';
  if (!path.startsWith('/pub/player/') || path.includes('..') || !ALLOWED.test(path)) {
    res.status(400).json({ error: 'Only /pub/player/ paths are allowed.' });
    return;
  }
  const contact = process.env.CHESSCOM_CONTACT_EMAIL ?? 'unknown';
  const headers = { 'User-Agent': `BlunderCheck/1.0 (contact: ${contact})`, Accept: 'application/json' };
  try {
    let upstream = await fetch(`https://api.chess.com${path}`, { headers });
    for (let i = 0; i < 2 && upstream.status === 429; i++) {
      await sleep(2000);
      upstream = await fetch(`https://api.chess.com${path}`, { headers });
    }
    const body = await upstream.text();
    res.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'application/json');
    if (upstream.ok) res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    res.status(upstream.status).send(body);
  } catch {
    res.status(502).json({ error: 'Could not reach chess.com.' });
  }
}

// "Ask Coach why" (spec 10). Verifies the Supabase JWT, rate-limits to 30/day per user, then streams a short plain-English
// explanation from the Anthropic Messages API. The API key never leaves the server. If the key is missing the route 404s.
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { clip, requireUser, serviceClient } from './_lib.js';

export const DAILY_LIMIT = 30;
const MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5-5';

export function buildPrompt(b: Record<string, unknown>): string {
  const side = b.color === 'b' ? 'Black' : 'White';
  const facts = [
    `Position before the move (FEN): ${clip(b.fen, 120)}`,
    `The student plays ${side}. They played ${clip(b.played, 12)}.`,
    `Engine's best move instead: ${clip(b.best, 12) || 'unknown'}.`,
    `Opponent's best reply after ${clip(b.played, 12)}: ${clip(b.reply, 12) || 'unknown'}. Engine line after the move: ${clip(b.line, 80) || 'n/a'}.`,
    `Category: ${clip(b.category, 30)}. Summary: ${clip(b.summary, 300)}`,
    `Win chance dropped by about ${Math.round(Number(b.drop) || 0)} percentage points.`,
  ].join('\n');
  return (
    'You are a warm, direct chess coach for a complete beginner who keeps losing to friends.\n' +
    `Facts from a chess engine (trust them; do not invent other tactics or piece locations beyond what the FEN shows):\n${facts}\n\n` +
    `In 3 or 4 short sentences of plain English: say what went wrong with ${clip(b.played, 12)}, why ${clip(b.best, 12) || 'the better move'} is better, ` +
    'and one habit that would have caught it. Use square names only when they help. No headings, no lists, no em dashes.'
  );
}

function parseBody(req: VercelRequest): Record<string, unknown> | null {
  try {
    const b = typeof req.body === 'string' ? (JSON.parse(req.body) as unknown) : req.body;
    return b && typeof b === 'object' ? (b as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(404).json({ error: 'Coach chat is not enabled.' });
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' });
    return;
  }
  const sb = serviceClient();
  if (!sb) {
    res.status(500).json({ error: 'Server is not configured.' });
    return;
  }
  const user = await requireUser(req, res, sb);
  if (!user) return;

  // Validate first so malformed requests never cost the user a daily question.
  const body = parseBody(req);
  if (!body || typeof body.fen !== 'string' || typeof body.played !== 'string') {
    res.status(400).json({ error: 'Missing fen or played move.' });
    return;
  }

  // Count just before calling upstream, so retries cannot bypass the limit.
  const { data: used, error } = await sb.rpc('bump_coach_usage', { p_user: user.id });
  if (error) {
    res.status(500).json({ error: 'Could not check your daily limit.' });
    return;
  }
  if (typeof used === 'number' && used > DAILY_LIMIT) {
    res.status(429).json({ error: "You've used today's coach questions." });
    return;
  }

  let upstream: Response;
  try {
    upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: MODEL, max_tokens: 200, stream: true, messages: [{ role: 'user', content: buildPrompt(body) }] }),
    });
  } catch {
    res.status(502).json({ error: 'The coach is busy. Try again in a minute.' });
    return;
  }
  if (!upstream.ok || !upstream.body) {
    res.status(502).json({ error: 'The coach is busy. Try again in a minute.' });
    return;
  }

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  const reader = upstream.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i = buf.indexOf('\n');
      while (i >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        i = buf.indexOf('\n');
        if (!line.startsWith('data:')) continue;
        try {
          const evt = JSON.parse(line.slice(5)) as { type?: string; delta?: { type?: string; text?: string } };
          if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta' && evt.delta.text) res.write(evt.delta.text);
        } catch {
          /* ignore non-JSON keepalives */
        }
      }
    }
  } catch {
    /* upstream dropped mid-stream: end the response with what we have */
  } finally {
    res.end();
  }
}

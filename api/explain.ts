// "Ask Coach why" (spec 10). Verifies the Supabase JWT, rate-limits per user (see dailyLimit in _anthropic.ts), then streams a short plain-English
// explanation from the Anthropic Messages API. The API key never leaves the server. If the key is missing the route 404s.
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { callAnthropic, claimQuota, parseJsonBody, pipeText } from './_anthropic.js';
import { clip, requireUser, serviceClient } from './_lib.js';

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
  const body = parseJsonBody(req);
  if (!body || typeof body.fen !== 'string' || typeof body.played !== 'string') {
    res.status(400).json({ error: 'Missing fen or played move.' });
    return;
  }
  if (!(await claimQuota(sb, user.id, res))) return;

  try {
    const upstream = await callAnthropic(apiKey, { system: '', messages: [{ role: 'user', content: buildPrompt(body) }], maxTokens: 700, stream: true });
    if (!upstream.ok || !upstream.body) {
      res.status(502).json({ error: 'The coach is busy. Try again in a minute.' });
      return;
    }
    await pipeText(upstream, res);
  } catch {
    if (!res.headersSent) res.status(502).json({ error: 'The coach is busy. Try again in a minute.' });
    else res.end();
  }
}

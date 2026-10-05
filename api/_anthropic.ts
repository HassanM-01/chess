// Shared plumbing for the AI endpoints: daily quota, the Anthropic call, and streaming text back to the browser.
// The Anthropic key only ever lives here, on the server.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { VercelRequest, VercelResponse } from '@vercel/node';

export const MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5-5';

/** One shared allowance for every AI feature (explanations, reports, debriefs, chat). Override with COACH_DAILY_LIMIT. */
export function dailyLimit(): number {
  const n = Number(process.env.COACH_DAILY_LIMIT);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 50;
}

export function parseJsonBody(req: VercelRequest): Record<string, unknown> | null {
  try {
    const b = typeof req.body === 'string' ? (JSON.parse(req.body) as unknown) : req.body;
    return b && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Counts one use for today. Returns false (and answers 429) when the user is over their allowance. */
export async function claimQuota(sb: SupabaseClient, userId: string, res: VercelResponse): Promise<boolean> {
  const { data: used, error } = await sb.rpc('bump_coach_usage', { p_user: userId });
  if (error) {
    res.status(500).json({ error: 'Could not check your daily limit.' });
    return false;
  }
  if (typeof used === 'number' && used > dailyLimit()) {
    res.status(429).json({ error: "You've used today's coach questions. They reset tomorrow." });
    return false;
  }
  return true;
}

export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AnthropicCall {
  system: string;
  messages: AnthropicMessage[];
  maxTokens: number;
  stream: boolean;
  signal?: AbortSignal;
}

export async function callAnthropic(apiKey: string, c: AnthropicCall): Promise<Response> {
  return fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    // `thinking: between_tools` = no hidden reasoning before the answer. On this model hidden thinking is counted against
    // max_tokens, so a long structured prompt could use the whole budget and return nothing (found by the live tests).
    body: JSON.stringify({ model: MODEL, max_tokens: c.maxTokens, stream: c.stream, thinking: { type: 'between_tools' }, ...(c.system ? { system: c.system } : {}), messages: c.messages }),
    signal: c.signal,
  });
}

/** Pull the text out of a non-streaming Messages API response. */
export async function readText(upstream: Response): Promise<string> {
  const j = (await upstream.json()) as { content?: { type?: string; text?: string }[] };
  return (j.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
}

/** Stream the model's text deltas to the browser as plain text. Always ends the response. */
export async function pipeText(upstream: Response, res: VercelResponse): Promise<void> {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (!upstream.body) {
    res.end();
    return;
  }
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
    /* upstream dropped mid-stream: end with what we have */
  } finally {
    res.end();
  }
}

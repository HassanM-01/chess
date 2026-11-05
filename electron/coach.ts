// The optional AI coach: the user's own Anthropic API key, kept encrypted on this computer (Windows DPAPI via Electron's safeStorage),
// and one call to the Messages API. The key never reaches the page; the page only sends text and gets text back.
import { app, net, safeStorage } from 'electron';
import { existsSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5-5';
const keyFile = (): string => join(app.getPath('userData'), 'coach-key.bin');

export interface CoachMessage {
  role: 'user' | 'assistant';
  content: string;
}
export interface CoachRequest {
  system: string;
  messages: CoachMessage[];
}

export const hasKey = (): boolean => existsSync(keyFile());

export async function setKey(raw: unknown): Promise<void> {
  const key = typeof raw === 'string' ? raw.trim() : '';
  if (!/^sk-ant-[A-Za-z0-9_-]{20,300}$/.test(key)) throw new Error('That does not look like an Anthropic API key (it starts with sk-ant-).');
  if (!safeStorage.isEncryptionAvailable()) throw new Error('This computer cannot encrypt the key, so it was not saved.');
  await writeFile(keyFile(), safeStorage.encryptString(key));
}

export async function clearKey(): Promise<void> {
  await rm(keyFile(), { force: true });
}

async function readKey(): Promise<string | null> {
  try {
    return safeStorage.decryptString(await readFile(keyFile()));
  } catch {
    return null;
  }
}

/** The request is checked before anything leaves the computer: sizes, roles, and strict alternation starting with the user. */
export function validate(req: unknown): CoachRequest {
  const r = req as Partial<CoachRequest> | null;
  if (!r || typeof r.system !== 'string' || !Array.isArray(r.messages)) throw new Error('Bad coach request');
  if (r.system.length > 6000) throw new Error('Coach request too long');
  const msgs = r.messages.slice(-12);
  if (!msgs.length || msgs.length > 12) throw new Error('Bad coach request');
  let expect: 'user' | 'assistant' = msgs[0].role === 'assistant' ? 'assistant' : 'user';
  const out: CoachMessage[] = [];
  for (const m of msgs) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string' || !m.content.trim()) throw new Error('Bad coach request');
    if (m.role !== expect) throw new Error('Bad coach request');
    expect = expect === 'user' ? 'assistant' : 'user';
    out.push({ role: m.role, content: m.content.slice(0, 9000) });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  if (!out.length || out[out.length - 1].role !== 'user') throw new Error('Bad coach request');
  return { system: r.system, messages: out };
}

export async function ask(req: unknown): Promise<string> {
  const { system, messages } = validate(req);
  const key = await readKey();
  if (!key) throw new Error('No API key saved. Add one in Settings.');
  let res: Response;
  try {
    res = await net.fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      // no hidden reasoning before the answer: it would be counted against max_tokens and could leave an empty reply
      body: JSON.stringify({ model: MODEL, max_tokens: 900, thinking: { type: 'between_tools' }, system, messages }),
    });
  } catch {
    throw new Error('Could not reach the coach. Check your internet connection.');
  }
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) throw new Error('Anthropic rejected the API key. Check it in Settings.');
    if (res.status === 429) throw new Error('Too many questions at once, or the account is out of credit. Try again in a minute.');
    let detail = '';
    try {
      detail = ((await res.json()) as { error?: { message?: string } }).error?.message ?? '';
    } catch {
      /* keep it generic */
    }
    throw new Error(`The coach could not answer (${res.status}). ${detail.slice(0, 160)}`.trim());
  }
  const j = (await res.json()) as { content?: { type?: string; text?: string }[] };
  const text = (j.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('').trim();
  if (!text) throw new Error('The coach sent an empty answer. Try again.');
  return text;
}

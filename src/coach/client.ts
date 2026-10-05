// Calls /api/coach with the signed-in user's token. The Anthropic key never reaches the browser.
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';
import type { ChatMessage, CoachReport } from './types';

/** The coach needs accounts (for the token and the daily limit) and a build with the coach switched on. */
// VITE_COACH_MOCK is for the automated browser tests only: it lets the coach UI run in local mode against a mocked endpoint.
export const coachEnabled = import.meta.env.VITE_COACH_ENABLED === '1' && (isSupabaseConfigured || import.meta.env.VITE_COACH_MOCK === '1');

export class CoachError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

async function post(body: Record<string, unknown>, signal?: AbortSignal): Promise<Response> {
  const token = isSupabaseConfigured ? ((await getSupabase().auth.getSession()).data.session?.access_token ?? '') : '';
  const res = await fetch('/api/coach', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    let msg = 'The coach is not available right now. Try again in a minute.';
    try {
      const j = (await res.json()) as { error?: string };
      if (j.error) msg = j.error;
    } catch {
      /* keep the default */
    }
    throw new CoachError(msg, res.status);
  }
  return res;
}

export async function requestReport(factsText: string): Promise<CoachReport> {
  const res = await post({ mode: 'report', facts: factsText });
  const j = (await res.json()) as { report?: CoachReport };
  if (!j.report) throw new CoachError('The coach could not write your plan just now. Try again in a minute.');
  return j.report;
}

/** Reads a streamed plain-text answer, calling onText with everything received so far. */
async function readStream(res: Response, onText: (full: string) => void): Promise<string> {
  if (!res.body) throw new CoachError('The coach is not available right now.');
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let acc = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    acc += dec.decode(value, { stream: true });
    onText(acc);
  }
  return acc;
}

export async function streamDebrief(factsText: string, sessionText: string, onText: (full: string) => void, signal?: AbortSignal): Promise<string> {
  return readStream(await post({ mode: 'debrief', facts: factsText, session: sessionText }, signal), onText);
}

export async function streamChat(factsText: string, messages: ChatMessage[], onText: (full: string) => void, signal?: AbortSignal): Promise<string> {
  return readStream(await post({ mode: 'chat', facts: factsText, messages }, signal), onText);
}

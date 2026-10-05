// The personal coach: report, session debrief and chat. The browser sends FACTS (computed by the engine and the app);
// this function checks sign-in and the daily allowance, asks Claude to write, and sends back only what the app can use.
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { callAnthropic, claimQuota, parseJsonBody, pipeText, readText } from './_anthropic.js';
import { chatMessages, chatSystemPrompt, debriefMessages, debriefSystemPrompt, extractJson, reportMessages, reportSystemPrompt, sanitizeReport } from './_coach.js';
import { clip, requireUser, serviceClient } from './_lib.js';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(404).json({ error: 'The coach is not enabled.' });
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

  // Validate before spending any of the user's allowance.
  const body = parseJsonBody(req);
  const mode = body?.mode;
  const facts = typeof body?.facts === 'string' ? clip(body.facts, 12000) : '';
  if (!body || (mode !== 'report' && mode !== 'debrief' && mode !== 'chat') || !facts.startsWith('{')) {
    res.status(400).json({ error: 'Bad request.' });
    return;
  }
  let system = '';
  let messages;
  let maxTokens = 1200;
  if (mode === 'report') {
    system = reportSystemPrompt();
    messages = reportMessages(facts);
    maxTokens = 3000;
  } else if (mode === 'debrief') {
    const session = typeof body.session === 'string' ? body.session : '';
    if (!session) {
      res.status(400).json({ error: 'Missing session.' });
      return;
    }
    system = debriefSystemPrompt();
    messages = debriefMessages(facts, session);
    maxTokens = 700;
  } else {
    messages = chatMessages(facts, body.messages);
    if (!messages) {
      res.status(400).json({ error: 'Send a message first.' });
      return;
    }
    system = chatSystemPrompt();
    maxTokens = 1200;
  }

  if (!(await claimQuota(sb, user.id, res))) return;

  try {
    if (mode === 'report') {
      // The report is JSON the app renders, so it is not streamed. One retry if the model's reply cannot be used.
      for (let attempt = 0; attempt < 2; attempt++) {
        const upstream = await callAnthropic(apiKey, { system, messages, maxTokens, stream: false });
        if (!upstream.ok) break;
        const report = sanitizeReport(extractJson(await readText(upstream)));
        if (report) {
          res.setHeader('Cache-Control', 'no-store');
          res.status(200).json({ report });
          return;
        }
      }
      res.status(502).json({ error: 'The coach could not write your plan just now. Try again in a minute.' });
      return;
    }
    const upstream = await callAnthropic(apiKey, { system, messages, maxTokens, stream: true });
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

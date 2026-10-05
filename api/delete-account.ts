// Deletes the signed-in user's account. Every table references auth.users with ON DELETE CASCADE, so all data goes too.
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireUser, serviceClient } from './_lib.js';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
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
  const { error } = await sb.auth.admin.deleteUser(user.id);
  if (error) {
    res.status(500).json({ error: 'Could not delete the account.' });
    return;
  }
  res.status(200).json({ ok: true });
}

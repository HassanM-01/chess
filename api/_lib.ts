// Shared helpers for the Vercel serverless functions (underscore prefix: not exposed as a route).
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import type { VercelRequest, VercelResponse } from '@vercel/node';

export function serviceClient(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Verify the Supabase JWT from the Authorization header and return the user. */
export async function requireUser(req: VercelRequest, res: VercelResponse, sb: SupabaseClient): Promise<User | null> {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) {
    res.status(401).json({ error: 'Sign in first.' });
    return null;
  }
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data.user) {
    res.status(401).json({ error: 'Your session expired. Sign in again.' });
    return null;
  }
  return data.user;
}

export const clip = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');

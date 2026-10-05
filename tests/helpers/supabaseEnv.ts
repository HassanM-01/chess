// Real-Supabase tests only run when these are set (CI without secrets and local runs without a project skip them).
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const SB_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '';
export const SB_ANON = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? '';
export const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
export const hasSupabase = Boolean(SB_URL && SB_ANON && SB_SERVICE);

export const admin = (): SupabaseClient => createClient(SB_URL, SB_SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
export const anon = (): SupabaseClient => createClient(SB_URL, SB_ANON, { auth: { persistSession: false, autoRefreshToken: false } });

export interface TestUser {
  id: string;
  email: string;
  client: SupabaseClient;
}

/** Create a confirmed throwaway user (service role) and sign them in with a password. */
export async function createTestUser(label: string): Promise<TestUser> {
  const a = admin();
  const email = `bc-test-${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  const password = `Pw-${Math.random().toString(36).slice(2)}-Aa1!`;
  const { data, error } = await a.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
  const client = anon();
  const { error: e2 } = await client.auth.signInWithPassword({ email, password });
  if (e2) throw new Error(`sign in failed: ${e2.message}`);
  return { id: data.user.id, email, client };
}

export async function deleteTestUser(u: TestUser): Promise<void> {
  await admin().auth.admin.deleteUser(u.id);
}

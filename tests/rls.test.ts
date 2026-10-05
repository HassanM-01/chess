// Row Level Security checks against a real Supabase project (spec phase 1: "a second user can't see the first user's profile").
// Skipped unless SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are set. Run after applying the migrations.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fetchPublicGame } from '@/db/supabaseRepo';
import { anon, admin, createTestUser, deleteTestUser, hasSupabase, type TestUser } from './helpers/supabaseEnv';

describe.skipIf(!hasSupabase)('Row Level Security', () => {
  let a: TestUser;
  let b: TestUser;
  let gameA: string;
  let gameA2: string;

  const newGame = (userId: string, ext: string, isPublic = false): Record<string, unknown> => ({
    user_id: userId,
    source: 'pgn',
    external_id: ext,
    pgn: '1. e4 e5',
    moves_uci: ['e2e4', 'e7e5'],
    moves_san: ['e4', 'e5'],
    user_color: 'w',
    analysis_status: 'done',
    is_public: isPublic,
  });

  beforeAll(async () => {
    a = await createTestUser('a');
    b = await createTestUser('b');
    const g1 = await a.client.from('games').insert(newGame(a.id, 'rls-1')).select('id').single();
    const g2 = await a.client.from('games').insert(newGame(a.id, 'rls-2')).select('id').single();
    expect(g1.error).toBeNull();
    gameA = g1.data?.id as string;
    gameA2 = g2.data?.id as string;
    await a.client.from('game_analysis').insert({ game_id: gameA, user_id: a.id, engine: 't', depth: 1, evals: [[0, null, null]], summary: {} });
    await a.client.from('game_analysis').insert({ game_id: gameA2, user_id: a.id, engine: 't', depth: 1, evals: [[0, null, null]], summary: {} });
  });

  afterAll(async () => {
    if (a) await deleteTestUser(a);
    if (b) await deleteTestUser(b);
  });

  it('the signup trigger creates a profile and progress row for each new user', async () => {
    const p = await a.client.from('profiles').select('id').eq('id', a.id);
    expect(p.data).toHaveLength(1);
    const pr = await a.client.from('progress').select('user_id').eq('user_id', a.id);
    expect(pr.data).toHaveLength(1);
  });

  it("user B cannot read user A's profile, games, analysis, progress or attempts", async () => {
    expect((await b.client.from('profiles').select('*').eq('id', a.id)).data).toEqual([]);
    expect((await b.client.from('games').select('id').eq('id', gameA)).data).toEqual([]);
    expect((await b.client.from('game_analysis').select('game_id').eq('game_id', gameA)).data).toEqual([]);
    expect((await b.client.from('progress').select('user_id').eq('user_id', a.id)).data).toEqual([]);
    // and a blanket select only returns B's own rows
    const mine = await b.client.from('profiles').select('id');
    expect((mine.data ?? []).map((r) => r.id)).toEqual([b.id]);
  });

  it("user B cannot modify or delete user A's rows", async () => {
    const upd = await b.client.from('profiles').update({ display_name: 'hacked' }).eq('id', a.id).select('id');
    expect(upd.data ?? []).toEqual([]);
    const updG = await b.client.from('games').update({ is_public: true }).eq('id', gameA).select('id');
    expect(updG.data ?? []).toEqual([]);
    const del = await b.client.from('games').delete().eq('id', gameA).select('id');
    expect(del.data ?? []).toEqual([]);
    const still = await a.client.from('games').select('id,is_public').eq('id', gameA).single();
    expect(still.data?.is_public).toBe(false);
  });

  it('user B cannot insert rows that belong to user A', async () => {
    const r = await b.client.from('games').insert(newGame(a.id, 'rls-evil')).select('id');
    expect(r.error).not.toBeNull();
    const t = await b.client.from('attempts').insert({ user_id: a.id, correct: true }).select('id');
    expect(t.error).not.toBeNull();
  });

  it('a chess.com username can be linked to only one account', async () => {
    const name = `rls${Date.now()}`;
    expect((await a.client.from('profiles').update({ chesscom_username: name }).eq('id', a.id).select('id')).error).toBeNull();
    const clash = await b.client.from('profiles').update({ chesscom_username: name.toUpperCase() }).eq('id', b.id).select('id');
    expect(clash.error?.code).toBe('23505');
  });

  it('public sharing: only games flagged is_public are readable signed out, read-only', async () => {
    const pub = anon();
    expect((await pub.from('games').select('id').eq('id', gameA2)).data).toEqual([]); // not shared
    expect(await fetchPublicGame(pub, gameA2)).toBeNull();

    const flip = await a.client.from('games').update({ is_public: true }).eq('id', gameA).select('id');
    expect(flip.error).toBeNull();
    const shared = await fetchPublicGame(pub, gameA);
    expect(shared?.game.id).toBe(gameA);
    expect(shared?.analysis.gameId).toBe(gameA);
    expect(await fetchPublicGame(pub, gameA2)).toBeNull();

    // signed-out visitors cannot write
    const w = await pub.from('games').update({ is_public: false }).eq('id', gameA).select('id');
    expect(w.data ?? []).toEqual([]);
    const ins = await pub.from('games').insert(newGame(a.id, 'rls-anon'));
    expect(ins.error).not.toBeNull();
    // and unsharing hides it again
    await a.client.from('games').update({ is_public: false }).eq('id', gameA);
    expect(await fetchPublicGame(pub, gameA)).toBeNull();
  });

  it('puzzles are readable by signed-in users only and never writable from clients', async () => {
    await admin().from('puzzles').upsert({ id: 'rls_test_puzzle', fen: '8/8/8/8/8/8/8/K6k w - - 0 1', moves: ['a1a2'], themes: ['free'], rating: 600, source: 'test' });
    expect((await a.client.from('puzzles').select('id').eq('id', 'rls_test_puzzle')).data).toHaveLength(1);
    expect((await anon().from('puzzles').select('id').eq('id', 'rls_test_puzzle')).data ?? []).toEqual([]);
    const w = await a.client.from('puzzles').insert({ id: 'rls_evil', fen: 'x', moves: [], themes: [], rating: 1, source: 'evil' });
    expect(w.error).not.toBeNull();
    await admin().from('puzzles').delete().eq('id', 'rls_test_puzzle');
  });

  it('coach_usage has no client access at all', async () => {
    const r = await a.client.from('coach_usage').select('*');
    expect(r.error !== null || (r.data ?? []).length === 0).toBe(true);
    const w = await a.client.from('coach_usage').insert({ user_id: a.id, count: 0 });
    expect(w.error).not.toBeNull();
    const rpc = await a.client.rpc('bump_coach_usage', { p_user: a.id });
    expect(rpc.error).not.toBeNull(); // service role only
  });

  it('deleting the user cascades every row', async () => {
    const tmp = await createTestUser('tmp');
    await tmp.client.from('games').insert(newGame(tmp.id, 'rls-tmp'));
    await deleteTestUser(tmp);
    const left = await admin().from('games').select('id').eq('user_id', tmp.id);
    expect(left.data).toEqual([]);
    expect((await admin().from('profiles').select('id').eq('id', tmp.id)).data).toEqual([]);
  });
});

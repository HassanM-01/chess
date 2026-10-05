import { describe, expect, it } from 'vitest';
import { categorize } from '@/analysis/categorize';
import { Chess, uciMove } from '@/chess/compat';
import { attackers, forkTargets, hangingInfo, hangingPieces, parseFen, phaseOf } from '@/chess/tactics';
import { gameFens, moveNumberLabel, pvSan } from '@/chess/helpers';
import { buildPrompt } from '../api/explain';
import { generateTrainingItems } from '@/skill/trainingItems';
import { buildTrainerSession, trainerCounts } from '@/skill/sessionBuilder';
import type { TrainingItem } from '@/db/types';
import { PGN_TEXT } from './helpers/fixtures';
import { parsePgnText } from '@/chesscom/parsePgn';

describe('tactics helpers', () => {
  it('finds attackers, loose pieces and forks', () => {
    // White knight on e5 forks nothing; black queen on d4 is attacked by a pawn
    const b = parseFen('rnb1kbnr/pppp1ppp/8/4p3/3q4/2P5/PP1PPPPP/RNBQKBNR w KQkq - 0 1');
    expect(attackers(b, 'd4', 'w')).toContain('c3');
    expect(hangingInfo(b, 'd4')).toMatchObject({ reason: 'cheaper' });
    expect(hangingPieces(b, 'b').map((h) => h.square)).toEqual(['d4']);
    // classic knight fork on f7: king e8 and rook h8 vs knight g5? build: Nf7+ forks Kd8? use simple
    const f = parseFen('3k3r/5N2/8/8/8/8/8/4K3 b - - 0 1');
    expect(forkTargets(f, 'f7').sort()).toEqual(['d8', 'h8']);
  });

  it('phase: opening to ply 20, endgame with few pieces', () => {
    expect(phaseOf(parseFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'), 20)).toBe('opening');
    expect(phaseOf(parseFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'), 21)).toBe('middlegame');
    expect(phaseOf(parseFen('8/5k2/8/8/8/3K4/3R4/8 w - - 0 40'), 40)).toBe('endgame');
  });

  it('move numbers honour a custom start position', () => {
    expect(moveNumberLabel('8/8/8/8/8/8/8/K6k b - - 0 12', 0)).toBe('12...');
    expect(moveNumberLabel('8/8/8/8/8/8/8/K6k b - - 0 12', 1)).toBe('13.');
    expect(moveNumberLabel('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 2)).toBe('2.');
  });
});

describe('categorize (synthetic engine evals)', () => {
  const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const play = (moves: string[]): { fens: string[] } => {
    const c = new Chess();
    const fens = [c.fen()];
    for (const u of moves) {
      uciMove(c, u);
      fens.push(c.fen());
    }
    return { fens };
  };

  it('missed mate in one', () => {
    const { fens } = play(['f2f3', 'e7e5', 'g2g4', 'd8h4']); // Black mated; check white's earlier moves
    expect(fens.length).toBe(5);
    const r = categorize(
      '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1',
      '6k1/5ppp/8/8/8/8/R7/6K1 b - - 0 1',
      'a1a2',
      { cpWhite: 10000, mateWhite: 1, best: 'a1a8' },
      { cpWhite: 0, mateWhite: null, best: null },
      'w',
    );
    expect(r?.cat).toBe('missed_mate');
    expect(r?.text).toContain('Ra8#');
  });

  it('hung piece: a knight moved to a square where it is simply taken', () => {
    // White knight goes to e5 where the black pawn on d6... use a clean position: Nf3-g5? black h6 pawn takes it.
    const f0 = '4k3/8/7p/8/8/5N2/8/4K3 w - - 0 1';
    const c = new Chess(f0);
    uciMove(c, 'f3g5');
    const r = categorize(f0, c.fen(), 'f3g5', { cpWhite: 0, mateWhite: null, best: 'e1e2' }, { cpWhite: -300, mateWhite: null, best: 'h6g5' }, 'w');
    expect(r?.cat).toBe('hung');
    expect(r?.sq).toBe('g5');
    expect(r?.text).toContain('knight');
  });

  it('even trades are not hung pieces: a knight that can be recaptured', () => {
    // Nxd5 wins a pawn but ...Qxd5 is met by Rxd5: the capture of a knight (value 3) on d5 is an even swap, not "hung"
    const f0 = '4k3/8/8/3p4/8/2N5/8/3RK3 w - - 0 1';
    const c = new Chess(f0);
    uciMove(c, 'c3d5');
    const r = categorize(f0, c.fen(), 'c3d5', { cpWhite: 0, mateWhite: null, best: 'c3d5' }, { cpWhite: 100, mateWhite: null, best: 'e8d7' }, 'w');
    expect(r?.cat).not.toBe('hung');
    // and the same capture with the defender removed IS a hung knight
    const g0 = '3qk3/8/8/3p4/8/2N5/8/4K3 w - - 0 1';
    const c2 = new Chess(g0);
    uciMove(c2, 'c3d5');
    const h = categorize(g0, c2.fen(), 'c3d5', { cpWhite: 0, mateWhite: null, best: 'e1e2' }, { cpWhite: -600, mateWhite: null, best: 'd8d5' }, 'w');
    expect(h?.cat).toBe('hung');
  });

  it('START position is parseable', () => {
    expect(Object.keys(parseFen(START))).toHaveLength(32);
    expect(pvSan(START, ['e2e4', 'e7e5', 'g1f3'])).toEqual(['e4', 'e5', 'Nf3']);
    expect(gameFens(START, ['e2e4']).length).toBe(2);
  });
});

describe('training items and session building', () => {
  const { games } = parsePgnText(PGN_TEXT, 'huhsaaan');
  const g = games.find((x) => x.black === 'whole_cooked_chicken')!;
  // flat evals so only structure is tested
  const evals = Array.from({ length: g.movesUci.length + 1 }, (): [number, null, null] => [0, null, null]);

  it('generates draft items with unique (kind, game, ply) keys and balanced calm/safe pools', () => {
    const items = generateTrainingItems(g, evals, [], { gameId: 'g1', opponent: 'x' });
    const keys = items.map((i) => `${i.kind}|${i.ply}`);
    expect(new Set(keys).size).toBe(keys.length);
    const calm = items.filter((i) => i.payload.pool === 'calm').length;
    const threat = items.filter((i) => i.payload.pool === 'threat').length;
    expect(calm).toBeLessThanOrEqual(Math.max(1, Math.ceil(threat / 4)));
    expect(items.every((i) => i.payload.me === g.userColor)).toBe(true);
  });

  const mk = (id: string, pool: TrainingItem['payload']['pool'], due = true): TrainingItem =>
    ({
      id,
      userId: 'u',
      kind: pool === 'own' ? 'own_mistake' : pool === 'punish' ? 'punish' : pool === 'blunder' || pool === 'safe' ? 'judge' : 'threat',
      mistakeId: null,
      gameId: 'g',
      ply: 1,
      payload: { pool } as never,
      box: 0,
      dueAt: new Date(Date.now() + (due ? -1000 : 86_400_000)).toISOString(),
      attempts: 0,
      correct: 0,
      lastResult: null,
      createdAt: new Date().toISOString(),
    }) as TrainingItem;

  it('the daily mix is 15 positions drawn per the spec and tops up from other pools', () => {
    const pools: TrainingItem['payload']['pool'][] = ['threat', 'calm', 'blunder', 'safe', 'punish', 'own'];
    const all = pools.flatMap((p) => Array.from({ length: 6 }, (_, i) => mk(`${p}${i}`, p)));
    const mix = buildTrainerSession(all, 'mix');
    expect(mix).toHaveLength(15); // 3+1+2+2+2+3 = 13, topped up to 15
    const poor = [...Array.from({ length: 30 }, (_, i) => mk(`t${i}`, 'threat'))];
    expect(buildTrainerSession(poor, 'mix')).toHaveLength(15);
    expect(trainerCounts(all)).toMatchObject({ threat: 12, judge: 12, punish: 6, fix: 6, fixDue: 6 });
  });

  it('not-yet-due items are only used when nothing else is available', () => {
    const items = [mk('due', 'threat'), mk('later', 'threat', false)];
    const s = buildTrainerSession(items, 'threat');
    expect(s.map((i) => i.id)).toContain('due');
    expect(s[0].id === 'due' || s[1].id === 'due').toBe(true);
  });
});

describe('/api/explain prompt', () => {
  it('contains engine facts, the student colour and the style rules, and clips untrusted input', () => {
    const p = buildPrompt({ fen: 'x'.repeat(500), color: 'b', played: 'Qh5', best: 'Nf3', reply: 'Nxh5', category: 'hung', summary: 'You hung it', drop: 41.6, line: 'Nxh5 g6' });
    expect(p).toContain('The student plays Black. They played Qh5.');
    expect(p).toContain('Win chance dropped by about 42');
    expect(p).toContain('No headings, no lists, no em dashes');
    expect(p.length).toBeLessThan(1500);
  });
});

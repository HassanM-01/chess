import { describe, expect, it } from 'vitest';
import { Chess } from '@/chess/compat';
import { analyzeMate } from '@/mate/anatomy';
import { PATTERNS } from '@/mate/patterns';

describe('mating patterns', () => {
  for (const p of PATTERNS) {
    it(`${p.title}: every move is legal, the student's side delivers the mate, and the last move is checkmate`, () => {
      const c = new Chess(p.startFen);
      let lastMover = c.turn();
      p.moves.forEach(([san], i) => {
        lastMover = c.turn();
        expect(() => c.move(san), `${p.id} move ${i + 1}: ${san}`).not.toThrow();
      });
      expect(c.isCheckmate(), p.id).toBe(true);
      expect(lastMover, `${p.id}: the mating side`).toBe(p.side);
      // every move that ends in # in the script is the last one, and the others are not mate
      const sans = p.moves.map((m) => m[0]);
      expect(sans.slice(0, -1).some((s) => s.endsWith('#'))).toBe(false);
      expect(sans[sans.length - 1].endsWith('#')).toBe(true);
      // the student moves on their turns
      const first = new Chess(p.startFen).turn();
      expect((first === p.side) === (p.moves.length % 2 === 1)).toBe(true);
    });
  }

  it('ids are unique and every move has an explanation', () => {
    expect(new Set(PATTERNS.map((p) => p.id)).size).toBe(PATTERNS.length);
    for (const p of PATTERNS) for (const [, why] of p.moves) expect(why.length).toBeGreaterThan(15);
  });
});

describe('analyzeMate: why is it mate?', () => {
  const finalFen = (id: string): string => {
    const p = PATTERNS.find((x) => x.id === id)!;
    const c = new Chess(p.startFen);
    for (const [san] of p.moves) c.move(san);
    return c.fen();
  };

  it('is null for anything that is not checkmate', () => {
    expect(analyzeMate(new Chess().fen())).toBeNull();
    expect(analyzeMate('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1')).toBeNull(); // stalemate
    expect(analyzeMate('not a fen')).toBeNull();
  });

  it('back-rank: the rook covers f8 and h8, and the king\'s own pawns block f7, g7, h7', () => {
    const a = analyzeMate(finalFen('back-rank'))!;
    expect(a.kingSquare).toBe('g8');
    expect(a.checkers).toEqual([{ square: 'a8', piece: 'r' }]);
    const covered = a.escapes.filter((e) => e.why === 'covered').map((e) => e.square).sort();
    const blocked = a.escapes.filter((e) => e.why === 'own-piece').map((e) => e.square).sort();
    expect(covered).toEqual(['f8', 'h8']);
    expect(blocked).toEqual(['f7', 'g7', 'h7']);
    expect(a.summary).toContain('The king on g8 is in check from the rook on a8.');
    expect(a.summary).toContain('f8 is covered by the rook on a8');
    expect(a.summary).toContain('blocked by its own pieces');
    expect(a.summary).toContain('That is checkmate.');
    expect(a.marks.f8).toBe('bad');
    expect(a.marks.f7).toBe('sel');
    expect(a.marks.g8).toBe('bad');
  });

  it('smothered mate: a knight check cannot be blocked, and the king is hemmed in by its own pieces', () => {
    const a = analyzeMate(finalFen('smothered'))!;
    expect(a.checkers[0]).toEqual({ square: 'f7', piece: 'n' });
    expect(a.escapes.every((e) => e.why === 'own-piece')).toBe(true);
    expect(a.noAnswer).toContain('knight check cannot be blocked');
  });

  it('arabian mate: the protected rook cannot be taken, and the 7th row is covered', () => {
    const a = analyzeMate(finalFen('arabian'))!;
    expect(a.kingSquare).toBe('h8');
    expect(a.checkers[0]).toEqual({ square: 'h7', piece: 'r' });
    expect(a.escapes.map((e) => e.square).sort()).toEqual(['g7', 'g8', 'h7']);
    expect(a.escapes.find((e) => e.square === 'h7')!.by).toEqual(['f6']); // the knight protects the rook
    expect(a.escapes.find((e) => e.square === 'g8')!.by).toEqual(['f6']);
    expect(a.escapes.find((e) => e.square === 'g7')!.by).toEqual(['h7']);
  });

  it('a rook\'s ray also covers the square behind the king (the king cannot step back along the check)', () => {
    const a = analyzeMate(finalFen('anastasia'))!;
    expect(a.kingSquare).toBe('h7');
    const h8 = a.escapes.find((e) => e.square === 'h8')!;
    expect(h8.by).toEqual(['h1']);
    expect(a.escapes.find((e) => e.square === 'g7')!.why).toBe('own-piece');
  });

  it('scholar\'s mate: the bishop protects the queen, so the king cannot take her', () => {
    const a = analyzeMate(finalFen('scholars'))!;
    expect(a.kingSquare).toBe('e8');
    expect(a.checkers[0].square).toBe('f7');
    expect(a.escapes.find((e) => e.square === 'f7')!.by).toContain('c4');
  });

  it('fool\'s mate and queen-kiss produce readable, complete explanations', () => {
    for (const id of ['fools', 'queen-kiss', 'ladder']) {
      const a = analyzeMate(finalFen(id))!;
      expect(a.summary.startsWith('The king on')).toBe(true);
      expect(a.summary.endsWith('That is checkmate.')).toBe(true);
      expect(a.arrows.length).toBeGreaterThan(0);
    }
  });
});

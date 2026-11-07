// The engine's request queue, with a fake engine that behaves like Stockfish: short searches end by themselves,
// "infinite" ones (depth 99) only end when told to stop.
import { describe, expect, it } from 'vitest';
import { Engine, type EngineTransport } from '@/engine/engine';

class Fake implements EngineTransport {
  sent: string[] = [];
  private searching = false;
  private cb: (l: string) => void = () => undefined;
  send(cmd: string): void {
    this.sent.push(cmd);
    if (cmd === 'uci') setTimeout(() => { this.cb('id name Fake'); this.cb('uciok'); }, 0);
    else if (cmd.startsWith('go')) {
      this.searching = true;
      if (!/depth 99/.test(cmd)) setTimeout(() => this.finish(), 5);
    } else if (cmd === 'stop' && this.searching) setTimeout(() => this.finish(), 1);
  }
  private finish(): void {
    if (!this.searching) return;
    this.searching = false;
    this.cb('info depth 1 multipv 1 score cp 10 pv e2e4');
    this.cb('bestmove e2e4');
  }
  onLine(cb: (l: string) => void): void { this.cb = cb; }
  onError(): void { /* nothing */ }
  terminate(): void { /* nothing */ }
}

const make = (): { engine: Engine; fake: Fake } => {
  const fake = new Fake();
  return { fake, engine: new Engine(() => fake, [{ file: 'fake', kind: 'strong', bootTimeoutMs: 2000 }]) };
};
const FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const FEN2 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
const waitFor = async (cond: () => boolean): Promise<void> => {
  for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 10));
  expect(cond()).toBe(true);
};
const live = (engine: Engine, signal: AbortSignal): Promise<unknown> => engine.run(FEN, { depth: 99, movetimeMs: 1_800_000, priority: 'interactive', interruptible: true, signal });

describe('engine queue', () => {
  it('lets a quick request interrupt an endless live search, which then carries on', async () => {
    const { engine, fake } = make();
    const ac = new AbortController();
    const l = live(engine, ac.signal);
    await waitFor(() => fake.sent.some((c) => c.startsWith('go depth 99')));
    const quick = await engine.run(FEN2, { depth: 10, priority: 'interactive' });
    expect(quick.best).toBe('e2e4');
    // the live search was put back and starts again after the quick one
    await waitFor(() => fake.sent.filter((c) => c.startsWith('go depth 99')).length === 2);
    ac.abort();
    await l.catch(() => undefined);
  });

  it('does not bring back a live search that its owner already cancelled (it used to block the engine for 30 minutes)', async () => {
    const { engine, fake } = make();
    const ac = new AbortController();
    const l = live(engine, ac.signal);
    l.catch(() => undefined);
    await waitFor(() => fake.sent.some((c) => c.startsWith('go depth 99')));
    // a new request interrupts the live search, and at the same moment its owner cancels it (the board moved on)
    const first = engine.run(FEN, { depth: 10, priority: 'interactive' });
    ac.abort();
    await first;
    // right after, another request arrives: it has to run, not wait behind a zombie search
    const second = await Promise.race([engine.run(FEN2, { depth: 10, priority: 'interactive' }), new Promise<'hung'>((r) => setTimeout(() => r('hung'), 3000))]);
    expect(second).not.toBe('hung');
    await expect(l).rejects.toThrow('aborted');
    expect(fake.sent.filter((c) => c.startsWith('go depth 99'))).toHaveLength(1); // it never ran a second time
  });
});

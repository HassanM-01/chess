// UCI wrapper with a two-level priority queue (spec 6.1).
// Interactive requests always run before background analysis, and they even interrupt a background search
// that is already running (the interrupted job is re-queued at the front of the background queue).
import type { EngineLine, EnginePriority, EngineStatus, PosEval, RunOptions } from './types';

export interface EngineTransport {
  send(cmd: string): void;
  onLine(cb: (line: string) => void): void;
  onError(cb: (err: unknown) => void): void;
  terminate(): void;
}

export type TransportFactory = (file: string) => EngineTransport;

export interface EngineFile {
  file: string;
  kind: 'fast' | 'compat';
  bootTimeoutMs: number;
}

export const DEFAULT_ENGINE_FILES: EngineFile[] = [
  { file: 'stockfish-18-lite-single.js', kind: 'fast', bootTimeoutMs: 25_000 },
  { file: 'stockfish-18-asm.js', kind: 'compat', bootTimeoutMs: 60_000 },
];

interface Job {
  fen: string;
  depth: number;
  skill: number;
  multipv: number;
  priority: EnginePriority;
  newGame: boolean;
  res: (e: PosEval) => void;
  rej: (err: unknown) => void;
  aborted?: boolean;
}

const ABORTED = Symbol('aborted');
const JOB_TIMEOUT_MS = 45_000;

export class Engine {
  status: EngineStatus = 'idle';
  kind: '' | 'fast' | 'compat' = '';
  private transport: EngineTransport | null = null;
  private ready: Promise<void> | null = null;
  private opts: Record<string, number> = {};
  private handler: ((line: string) => void) | null = null;
  private hi: Job[] = [];
  private lo: Job[] = [];
  private running: Job | null = null;
  private listeners = new Set<() => void>();

  constructor(
    private factory: TransportFactory,
    private files: EngineFile[] = DEFAULT_ENGINE_FILES,
  ) {}

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  private setStatus(s: EngineStatus): void {
    this.status = s;
    this.listeners.forEach((l) => l());
  }

  /** Jobs waiting (not counting the one running). */
  get queued(): { interactive: number; background: number } {
    return { interactive: this.hi.length, background: this.lo.length };
  }

  boot(): Promise<void> {
    if (this.ready) return this.ready;
    this.setStatus('loading');
    this.ready = (async () => {
      for (const f of this.files) {
        try {
          await this.start(f);
          this.kind = f.kind;
          this.setStatus('ready');
          return;
        } catch (e) {
          console.warn('engine failed to start', f.file, e);
        }
      }
      this.setStatus('failed');
      this.ready = null; // allow a later retry
      throw new Error('Engine could not start');
    })();
    return this.ready;
  }

  private start(f: EngineFile): Promise<void> {
    return new Promise<void>((res, rej) => {
      let t: ReturnType<typeof setTimeout> | undefined;
      let w: EngineTransport;
      try {
        w = this.factory(f.file);
      } catch (e) {
        rej(e);
        return;
      }
      const fail = (e: unknown): void => {
        if (t) clearTimeout(t);
        try {
          w.terminate();
        } catch {
          /* ignore */
        }
        rej(e);
      };
      t = setTimeout(() => fail(new Error('engine boot timeout')), f.bootTimeoutMs);
      w.onError(fail);
      w.onLine((line) => {
        if (line.startsWith('uciok')) {
          if (t) clearTimeout(t);
          this.transport = w;
          this.opts = {};
          w.onError((e) => console.warn('engine error', e));
          w.onLine((l) => this.handler?.(l));
          res();
        }
      });
      w.send('uci');
    });
  }

  /** Stop the worker and fail whatever is running; the next run() re-boots. */
  private reset(): void {
    try {
      this.transport?.terminate();
    } catch {
      /* ignore */
    }
    this.transport = null;
    this.ready = null;
    this.handler = null;
    this.setStatus('idle');
  }

  run(fen: string, o: RunOptions = {}): Promise<PosEval> {
    const priority = o.priority ?? 'interactive';
    return new Promise<PosEval>((res, rej) => {
      const job: Job = { fen, depth: o.depth ?? 10, skill: o.skill ?? 20, multipv: o.multipv ?? 1, priority, newGame: !!o.newGame, res, rej };
      if (priority === 'interactive') {
        this.hi.push(job);
        // Interrupt a running background search so the tap feels instant.
        if (this.running && this.running.priority === 'background' && !this.running.aborted) {
          this.running.aborted = true;
          this.transport?.send('stop');
        }
      } else {
        this.lo.push(job);
      }
      void this.pump();
    });
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    const job = this.hi.shift() ?? this.lo.shift();
    if (!job) return;
    this.running = job;
    try {
      await this.boot();
      const r = await this.exec(job);
      if (r === ABORTED) {
        job.aborted = false;
        this.lo.unshift(job); // retry later, ahead of the other background work
      } else {
        job.res(r);
      }
    } catch (e) {
      job.rej(e);
    }
    this.running = null;
    void this.pump();
  }

  private setopt(k: string, v: number): void {
    if (this.opts[k] !== v) {
      this.transport?.send(`setoption name ${k} value ${v}`);
      this.opts[k] = v;
    }
  }

  private exec(job: Job): Promise<PosEval | typeof ABORTED> {
    return new Promise((resolve, reject) => {
      const tr = this.transport;
      if (!tr) {
        reject(new Error('engine not running'));
        return;
      }
      if (job.aborted) {
        resolve(ABORTED); // an interactive request arrived while the engine was still booting
        return;
      }
      this.setopt('Skill Level', job.skill);
      this.setopt('MultiPV', job.multipv);
      const turn = job.fen.split(' ')[1];
      const lines: Record<number, EngineLine> = {};
      const watchdog = setTimeout(() => {
        this.handler = null;
        this.reset();
        reject(new Error('engine timeout'));
      }, JOB_TIMEOUT_MS);
      this.handler = (l: string) => {
        if (l.startsWith('info') && l.includes(' pv ') && l.includes(' score ')) {
          const mp = +(l.match(/ multipv (\d+)/)?.[1] ?? 1);
          const m = l.match(/ score (cp|mate) (-?\d+)/);
          if (!m) return;
          let cp: number | null = null;
          let mate: number | null = null;
          if (m[1] === 'cp') cp = +m[2];
          else mate = +m[2];
          // UCI scores are from the side to move; convert to White's point of view.
          if (turn === 'b') {
            if (cp != null) cp = -cp;
            if (mate != null) mate = -mate;
          }
          const pv = l.split(' pv ')[1].trim().split(' ');
          lines[mp] = { cpWhite: cp == null ? ((mate ?? 0) > 0 ? 10000 : -10000) : cp, mateWhite: mate, pv };
        } else if (l.startsWith('bestmove')) {
          clearTimeout(watchdog);
          this.handler = null;
          if (job.aborted) {
            resolve(ABORTED);
            return;
          }
          const bm = l.split(' ')[1];
          const top = lines[1] ?? { cpWhite: 0, mateWhite: null, pv: [] };
          resolve({
            cpWhite: top.cpWhite,
            mateWhite: top.mateWhite,
            best: bm && bm !== '(none)' ? bm : null,
            pv: top.pv,
            lines: Object.keys(lines)
              .map(Number)
              .sort((a, b) => a - b)
              .map((k) => lines[k]),
          });
        }
      };
      if (job.newGame) tr.send('ucinewgame');
      tr.send(`position fen ${job.fen}`);
      tr.send(`go depth ${job.depth}`);
    });
  }
}

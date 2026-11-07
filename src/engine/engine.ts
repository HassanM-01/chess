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

/** `wasm` overrides where the worker script loads its .wasm from (used for the big build hosted off-site). */
export type TransportFactory = (file: string, wasm?: string) => EngineTransport;

export type EngineKind = 'fast' | 'compat' | 'strong';

export interface EngineFile {
  file: string;
  kind: EngineKind;
  bootTimeoutMs: number;
  wasm?: string;
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
  movetimeMs?: number;
  timeoutMs?: number;
  interruptible: boolean;
  onInfo?: (lines: EngineLine[], depth: number) => void;
  res: (e: PosEval) => void;
  rej: (err: unknown) => void;
  aborted?: boolean;
  /** stopped by the caller (AbortSignal): finish with whatever was found */
  stopped?: boolean;
}

const ABORTED = Symbol('aborted');
const JOB_TIMEOUT_MS = 45_000;

export class Engine {
  status: EngineStatus = 'idle';
  kind: '' | EngineKind = '';
  /** "Stockfish 19" once the engine has introduced itself */
  name = '';
  private restartWanted = false;
  private transport: EngineTransport | null = null;
  private ready: Promise<void> | null = null;
  private opts: Record<string, number> = {};
  private handler: ((line: string) => void) | null = null;
  private hi: Job[] = [];
  private lo: Job[] = [];
  private running: Job | null = null;
  private listeners = new Set<() => void>();

  /**
   * `files` is tried in order. It may be a function so the list can depend on the device (the strong build is only
   * offered where it is downloaded and cached). `onFileFailed` lets the caller remember a build that did not start.
   */
  constructor(
    private factory: TransportFactory,
    private files: EngineFile[] | (() => Promise<EngineFile[]>) = DEFAULT_ENGINE_FILES,
    private onFileFailed?: (f: EngineFile, e: unknown) => void,
    /** UCI commands sent once after the handshake (Threads, Hash, UCI_ShowWDL ...), before the first search */
    private initCommands?: () => string[] | Promise<string[]>,
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
      const files = typeof this.files === 'function' ? await this.files().catch(() => DEFAULT_ENGINE_FILES) : this.files;
      for (const f of files) {
        try {
          await this.start(f);
          this.kind = f.kind;
          this.setStatus('ready');
          return;
        } catch (e) {
          console.warn('engine failed to start', f.file, e);
          this.onFileFailed?.(f, e);
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
        w = this.factory(f.file, f.wasm);
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
        if (line.startsWith('id name ')) this.name = line.slice(8).trim();
        if (line.startsWith('uciok')) {
          this.transport = w;
          this.opts = {};
          w.onError((e) => console.warn('engine error', e));
          w.onLine((l) => this.handler?.(l));
          const done = (): void => {
            if (t) clearTimeout(t);
            this.handler = null;
            res();
          };
          if (!this.initCommands) return done();
          // Apply the options, then wait until the engine has allocated its memory before the first search starts.
          void Promise.resolve(this.initCommands()).then(
            (cmds) => {
              this.handler = (l) => {
                if (l.startsWith('readyok')) done();
              };
              for (const c of cmds) w.send(c);
              w.send('isready');
            },
            fail,
          );
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

  /** Re-read the init commands (thread count, hash size ...): the engine is restarted as soon as nothing is running. */
  requestRestart(): void {
    this.restartWanted = true;
    if (!this.running) this.applyRestart();
  }
  private applyRestart(): void {
    if (!this.restartWanted) return;
    this.restartWanted = false;
    this.reset();
  }

  run(fen: string, o: RunOptions = {}): Promise<PosEval> {
    const priority = o.priority ?? 'interactive';
    return new Promise<PosEval>((res, rej) => {
      const job: Job = {
        fen,
        depth: o.depth ?? 10,
        skill: o.skill ?? 20,
        multipv: o.multipv ?? 1,
        priority,
        newGame: !!o.newGame,
        movetimeMs: o.movetimeMs,
        timeoutMs: o.timeoutMs,
        interruptible: o.interruptible ?? priority === 'background',
        onInfo: o.onInfo,
        res,
        rej,
      };
      const sig = o.signal;
      if (sig) {
        const onAbort = (): void => {
          const queued = this.hi.indexOf(job) >= 0 ? this.hi : this.lo.indexOf(job) >= 0 ? this.lo : null;
          if (queued) {
            queued.splice(queued.indexOf(job), 1);
            rej(new Error('aborted'));
          } else if (this.running === job && !job.stopped) {
            job.stopped = true;
            this.transport?.send('stop');
          }
        };
        if (sig.aborted) {
          rej(new Error('aborted'));
          return;
        }
        sig.addEventListener('abort', onAbort, { once: true });
      }
      if (priority === 'interactive') {
        this.hi.push(job);
        // Interrupt a running background search so the tap feels instant.
        if (this.running && this.running.interruptible && !this.running.aborted && !this.running.stopped) {
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
        if (job.stopped) {
          // The caller gave up on this search (AbortSignal) while a newer request was also interrupting it. Running it
          // again would be pointless, and because it is already marked stopped it could never be interrupted again:
          // an endless live analysis would block every request after it.
          job.rej(new Error('aborted'));
        } else {
          this.lo.unshift(job); // retry later, ahead of the other background work
        }
      } else {
        job.res(r);
      }
    } catch (e) {
      job.rej(e);
    }
    this.running = null;
    if (this.restartWanted && !this.hi.length && !this.lo.length) this.applyRestart();
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
      let depthReached = 0;
      const limit = job.timeoutMs ?? (job.movetimeMs ? job.movetimeMs + 30_000 : JOB_TIMEOUT_MS);
      const watchdog = setTimeout(() => {
        this.handler = null;
        this.reset();
        reject(new Error('engine timeout'));
      }, limit);
      this.handler = (l: string) => {
        if (l.startsWith('info') && l.includes(' pv ') && l.includes(' score ')) {
          // Bound scores come from an iteration that was cut short; they are not real evaluations.
          if (/ score (cp|mate) -?\d+ (lower|upper)bound/.test(l)) return;
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
          const depth = +(l.match(/ depth (\d+)/)?.[1] ?? 0);
          const w = l.match(/ wdl (\d+) (\d+) (\d+)/);
          // WDL is reported for the side to move; store it from White's point of view like the scores.
          const wdl: [number, number, number] | undefined = w ? (turn === 'b' ? [+w[3], +w[2], +w[1]] : [+w[1], +w[2], +w[3]]) : undefined;
          lines[mp] = { cpWhite: cp == null ? ((mate ?? 0) > 0 ? 10000 : -10000) : cp, mateWhite: mate, pv, depth, wdl };
          if (mp === 1) depthReached = depth;
          if (job.onInfo) job.onInfo(Object.keys(lines).map(Number).sort((a, b) => a - b).map((k) => lines[k]), depthReached);
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
            depth: depthReached || undefined,
            wdl: top.wdl,
            lines: Object.keys(lines)
              .map(Number)
              .sort((a, b) => a - b)
              .map((k) => lines[k]),
          });
        }
      };
      if (job.newGame) tr.send('ucinewgame');
      tr.send(`position fen ${job.fen}`);
      tr.send(`go depth ${job.depth}${job.movetimeMs ? ` movetime ${Math.round(job.movetimeMs)}` : ''}`);
    });
  }
}

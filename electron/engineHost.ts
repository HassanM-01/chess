// Runs the native Stockfish binary and pipes UCI text to and from the app.
// Deliberately free of Electron imports so it can be tested with plain Node.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';

export interface EngineHostEvents {
  /** a batch of complete lines the engine printed */
  lines(lines: string[]): void;
  /** the process ended (crash, kill or `quit`) */
  exit(info: { code: number | null; signal: string | null; expected: boolean }): void;
  error(message: string): void;
}

export class EngineHost {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private buf = '';
  private pending: string[] = [];
  private timer: NodeJS.Timeout | null = null;
  private killing = false;

  constructor(
    private resolvePath: () => string | null,
    private events: EngineHostEvents,
  ) {}

  get running(): boolean {
    return this.proc !== null;
  }

  /** Spawn the engine if it is not running. Returns false (and reports an error) when there is no binary. */
  start(): boolean {
    if (this.proc) return true;
    const exe = this.resolvePath();
    if (!exe || !existsSync(exe)) {
      this.events.error('Stockfish was not found. Set its location in Settings.');
      return false;
    }
    const p = spawn(exe, [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    this.proc = p;
    this.killing = false;
    this.buf = '';
    try {
      // Let the UI stay smooth while the engine uses every core.
      if (p.pid) os.setPriority(p.pid, os.constants.priority.PRIORITY_BELOW_NORMAL);
    } catch {
      /* not allowed on this system: harmless */
    }
    p.stdout.on('data', (d: Buffer) => this.onData(d));
    p.stderr.on('data', () => undefined);
    p.stdin.on('error', () => undefined);
    p.on('error', (e) => {
      this.events.error(`Could not start Stockfish: ${e.message}`);
      this.proc = null;
    });
    p.on('exit', (code, signal) => {
      this.flush();
      const expected = this.killing;
      if (this.proc === p) this.proc = null;
      this.events.exit({ code, signal, expected });
    });
    return true;
  }

  send(cmd: string): void {
    if (!this.proc && !this.start()) return;
    this.proc?.stdin.write(cmd.replace(/[\r\n]+/g, ' ').trim() + '\n');
  }

  /** Stop the engine process. The next send() starts a fresh one. */
  kill(): void {
    const p = this.proc;
    if (!p) return;
    this.killing = true;
    this.proc = null;
    try {
      p.stdin.write('quit\n');
    } catch {
      /* ignore */
    }
    const t = setTimeout(() => p.kill(), 400);
    p.once('exit', () => clearTimeout(t));
  }

  private onData(d: Buffer): void {
    this.buf += d.toString('utf8');
    let i = this.buf.indexOf('\n');
    while (i >= 0) {
      const line = this.buf.slice(0, i).trim();
      this.buf = this.buf.slice(i + 1);
      if (line) this.pending.push(line);
      i = this.buf.indexOf('\n');
    }
    // Deep searches print many info lines per second: hand them over in small batches.
    if (this.pending.length && !this.timer) this.timer = setTimeout(() => this.flush(), 25);
  }

  private flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.pending.length) return;
    const out = this.pending;
    this.pending = [];
    this.events.lines(out);
  }
}

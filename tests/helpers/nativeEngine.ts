// The real native Stockfish (engine/stockfish.exe) as an Engine in Node, for the review tests. Tests skip when it is absent.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Engine, type EngineTransport } from '@/engine/engine';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const NATIVE_EXE = join(root, 'engine', process.platform === 'win32' ? 'stockfish.exe' : 'stockfish');
export const hasNativeEngine = existsSync(NATIVE_EXE);

export function nativeTransport(): EngineTransport {
  const p = spawn(NATIVE_EXE, [], { stdio: ['pipe', 'pipe', 'ignore'] });
  let buf = '';
  let lineCb: (l: string) => void = () => undefined;
  let errCb: (e: unknown) => void = () => undefined;
  p.stdout.on('data', (d: Buffer) => {
    buf += d.toString();
    let i = buf.indexOf('\n');
    while (i >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) lineCb(line);
      i = buf.indexOf('\n');
    }
  });
  p.on('error', (e) => errCb(e));
  p.stdin.on('error', () => undefined);
  return {
    send: (cmd) => void p.stdin.write(cmd + '\n'),
    onLine: (cb) => {
      lineCb = cb;
    },
    onError: (cb) => {
      errCb = cb;
    },
    terminate: () => {
      try {
        p.stdin.write('quit\n');
      } catch {
        /* ignore */
      }
      setTimeout(() => p.kill(), 300);
    },
  };
}

export function makeNativeEngine(threads = Math.max(1, Math.min(8, os.availableParallelism() - 2)), hashMb = 512): Engine {
  return new Engine(
    () => nativeTransport(),
    [{ file: 'native', kind: 'strong', bootTimeoutMs: 30_000 }],
    undefined,
    () => [`setoption name Threads value ${threads}`, `setoption name Hash value ${hashMb}`, 'setoption name UCI_ShowWDL value true'],
  );
}

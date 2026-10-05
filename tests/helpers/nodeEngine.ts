// Runs the real Stockfish 18 build in Node (child process, UCI over stdin/stdout) for tests and scripts.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Engine, type EngineFile, type EngineTransport } from '@/engine/engine';
import { makeEvaluator, type Evaluator } from '@/engine/evalPos';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN = join(root, 'node_modules', 'stockfish', 'bin');

export function nodeTransport(file: string): EngineTransport {
  const p = spawn(process.execPath, [join(BIN, file)], { stdio: ['pipe', 'pipe', 'ignore'] });
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
    send: (cmd) => {
      p.stdin.write(cmd + '\n');
    },
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
      p.kill();
    },
  };
}

const FILES: EngineFile[] = [{ file: 'stockfish-18-lite-single.js', kind: 'fast', bootTimeoutMs: 30_000 }];

export function createNodeEngine(): Engine {
  return new Engine(nodeTransport, FILES);
}

export function createNodeEvaluator(engine = createNodeEngine()): { engine: Engine; evalPos: Evaluator } {
  return { engine, evalPos: makeEvaluator(engine) };
}

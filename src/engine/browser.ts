// Browser wiring: the Stockfish build files in /public/engine are classic Web Worker scripts.
import { Engine, type EngineTransport } from './engine';

function workerTransport(file: string): EngineTransport {
  const url = `${import.meta.env.BASE_URL}engine/${file}`;
  const w = new Worker(url);
  return {
    send: (cmd) => w.postMessage(cmd),
    onLine: (cb) => {
      w.onmessage = (e: MessageEvent) => cb(String(e.data));
    },
    onError: (cb) => {
      w.onerror = (e) => cb(e);
    },
    terminate: () => w.terminate(),
  };
}

let instance: Engine | null = null;

/** The one shared engine (a single Web Worker). */
export function getEngine(): Engine {
  if (!instance) instance = new Engine(workerTransport);
  return instance;
}

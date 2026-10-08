// Browser wiring: the Stockfish build files in /public/engine are classic Web Worker scripts.
import { DEFAULT_ENGINE_FILES, Engine, type EngineFile, type EngineTransport } from './engine';
import { STRONG_FILE, getStrongPref, isStrongCached, markStrongFailed, readDevice, strongFailedBefore, strongSource, strongStore, strongWanted, strongWasmUrl } from './strong';

function workerTransport(file: string, wasm?: string): EngineTransport {
  // The Stockfish.js worker reads the location of its .wasm from the URL fragment, which lets the small script live
  // on this site while the big file comes from a CDN.
  const hash = wasm && new URL(wasm).origin !== location.origin ? `#${encodeURIComponent(wasm)}` : '';
  const url = `${import.meta.env.BASE_URL}engine/${file}${hash}`;
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

/**
 * Which builds to try. The strong one goes first only when it is wanted on this device AND already in the cache;
 * if it is wanted but not cached yet, start the download in the background and use the lite build for this session.
 */
async function engineFiles(): Promise<EngineFile[]> {
  const src = strongSource();
  if (!strongWanted(getStrongPref(), readDevice(), src, strongFailedBefore())) {
    void strongStore.refresh();
    return DEFAULT_ENGINE_FILES;
  }
  if (await isStrongCached()) {
    void strongStore.refresh();
    return [{ file: STRONG_FILE, kind: 'strong', bootTimeoutMs: 90_000, wasm: strongWasmUrl() ?? undefined }, ...DEFAULT_ENGINE_FILES];
  }
  void strongStore.refresh().then(() => strongStore.download());
  return DEFAULT_ENGINE_FILES;
}

let instance: Engine | null = null;

/** The one shared engine (a single Web Worker). */
export function getEngine(): Engine {
  if (!instance) {
    instance = new Engine(workerTransport, engineFiles, (f) => {
      // A strong build that cannot start (memory, corrupt cache) must not be retried on every launch.
      if (f.kind === 'strong') {
        markStrongFailed();
        void strongStore.refresh();
      }
    });
  }
  return instance;
}

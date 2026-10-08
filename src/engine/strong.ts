// The optional "strong" engine: the full Stockfish 18 build (~108 MB wasm, single thread) for computers.
// Phones and small devices keep the 7 MB lite build. The big file is downloaded once into the service worker's cache
// (see vite.config.ts) and is used from the next launch, so nothing ever waits on the download.
//
// Build-time switch, VITE_STRONG_ENGINE_WASM:
//   unset / ''   feature off (default)
//   'local'      the wasm is served from this site at /engine/stockfish-18-single.wasm (scripts/copy-engine.mjs copies it;
//                needs a host that accepts a >100 MB static file, e.g. Vercel Pro)
//   'https://…'  absolute URL of stockfish-18-single.wasm on a CDN that sends CORS headers (keep the file name)

export type StrongPref = 'auto' | 'on' | 'off';

export const STRONG_FILE = 'stockfish-18-single.js';
export const STRONG_WASM_NAME = 'stockfish-18-single.wasm';

const PREF_KEY = 'bc-strong-engine';
const FAILED_KEY = 'bc-strong-engine-failed';

export type StrongSource = { kind: 'off' } | { kind: 'local' } | { kind: 'url'; url: string };

export function parseSource(raw: string | undefined): StrongSource {
  const v = (raw ?? '').trim();
  if (!v) return { kind: 'off' };
  if (v === 'local') return { kind: 'local' };
  // https only (a CDN), plus plain http for a server on this machine while developing
  return /^(https:\/\/|http:\/\/(localhost|127\.0\.0\.1)[:/])/.test(v) ? { kind: 'url', url: v } : { kind: 'off' };
}

export const strongSource = (): StrongSource => parseSource(import.meta.env.VITE_STRONG_ENGINE_WASM as string | undefined);

/** Absolute URL of the big wasm, or null when the feature is off. */
export function strongWasmUrl(src: StrongSource = strongSource()): string | null {
  if (src.kind === 'off') return null;
  if (src.kind === 'url') return src.url;
  return new URL(`${import.meta.env.BASE_URL}engine/${STRONG_WASM_NAME}`, location.href).href;
}

export interface DeviceInfo {
  coarsePointer: boolean;
  ios: boolean;
  saveData: boolean;
  cores: number;
  /** Chromium only; undefined elsewhere */
  memoryGb: number | undefined;
}

export function readDevice(): DeviceInfo {
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  const ios = /iPad|iPhone|iPod/.test(nav.userAgent) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);
  return {
    coarsePointer: typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches,
    ios,
    saveData: !!nav.connection?.saveData,
    cores: nav.hardwareConcurrency || 1,
    memoryGb: nav.deviceMemory,
  };
}

/** "Auto" turns the strong engine on only for computers: no touch-first input, no iOS, a few cores, and no data saver. */
export function deviceCanRunStrong(d: DeviceInfo): boolean {
  return !d.coarsePointer && !d.ios && !d.saveData && d.cores >= 4 && (d.memoryGb === undefined || d.memoryGb >= 4);
}

export function strongWanted(pref: StrongPref, d: DeviceInfo, src: StrongSource, failedBefore: boolean): boolean {
  if (src.kind === 'off' || pref === 'off' || failedBefore) return false; // choosing "On" again clears the failed flag
  return pref === 'on' || deviceCanRunStrong(d);
}

// ---- per-device preference -----------------------------------------------------------------------------------

const read = (k: string): string | null => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string | null): void => {
  try {
    if (v == null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* private mode etc.: the preference just does not persist */
  }
};

export const getStrongPref = (): StrongPref => {
  const v = read(PREF_KEY);
  return v === 'on' || v === 'off' ? v : 'auto';
};
export const strongFailedBefore = (): boolean => read(FAILED_KEY) === '1';
export const markStrongFailed = (): void => write(FAILED_KEY, '1');

// ---- download + cache state ----------------------------------------------------------------------------------

export type StrongState =
  | { phase: 'unavailable' } // this build has no strong engine configured
  | { phase: 'off' } // switched off, or "auto" decided this device should not use it
  | { phase: 'needs-download' }
  | { phase: 'downloading'; fraction: number }
  | { phase: 'ready' } // cached; used from the next launch (or already in use)
  | { phase: 'error'; message: string };

const hasController = (): boolean => typeof navigator !== 'undefined' && !!navigator.serviceWorker?.controller;
const hasCaches = (): boolean => typeof caches !== 'undefined';

/** The service worker (CacheFirst for the wasm) is what stores it, so it must be controlling this page. */
export async function isStrongCached(url: string | null = strongWasmUrl()): Promise<boolean> {
  if (!url || !hasCaches()) return false;
  try {
    return !!(await caches.match(url));
  } catch {
    return false;
  }
}

class StrongStore {
  private state: StrongState = { phase: 'unavailable' };
  private listeners = new Set<() => void>();
  private job: Promise<void> | null = null;

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };
  getState = (): StrongState => this.state;
  private set(s: StrongState): void {
    this.state = s;
    this.listeners.forEach((l) => l());
  }

  /** Recompute the state from the preference, the device and the cache. */
  async refresh(): Promise<StrongState> {
    if (this.job) return this.state; // a download is in flight; it reports its own progress
    const src = strongSource();
    if (src.kind === 'off') {
      this.set({ phase: 'unavailable' });
    } else if (!strongWanted(getStrongPref(), readDevice(), src, strongFailedBefore())) {
      this.set({ phase: 'off' });
    } else {
      this.set((await isStrongCached()) ? { phase: 'ready' } : { phase: 'needs-download' });
    }
    return this.state;
  }

  setPref(p: StrongPref): Promise<StrongState> {
    write(PREF_KEY, p === 'auto' ? null : p);
    write(FAILED_KEY, null); // choosing explicitly gives it another chance
    return this.refresh();
  }

  /** Fetch the big wasm through the service worker so it lands in the cache. Resolves when finished; never throws. */
  download(): Promise<void> {
    if (this.job) return this.job;
    const url = strongWasmUrl();
    if (!url) return Promise.resolve();
    if (!hasController()) {
      this.set({ phase: 'error', message: 'Reload the page once so the offline cache can take over, then try again.' });
      return Promise.resolve();
    }
    this.set({ phase: 'downloading', fraction: 0 });
    this.job = (async () => {
      try {
        const res = await fetch(url, { mode: 'cors' });
        if (!res.ok || !res.body) throw new Error(`download failed (${res.status})`);
        const total = Number(res.headers.get('content-length')) || 0;
        const reader = res.body.getReader();
        let got = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          got += value.byteLength;
          if (total) this.set({ phase: 'downloading', fraction: Math.min(1, got / total) });
        }
        this.job = null;
        await this.refresh();
        // The service worker stores the response as it streams past; if it did not, say so rather than looping.
        if (this.state.phase === 'needs-download') this.set({ phase: 'error', message: 'The browser did not keep the download. Try again from the installed app, or leave this off.' });
      } catch (e) {
        this.job = null;
        this.set({ phase: 'error', message: e instanceof Error ? e.message : 'download failed' });
      }
    })();
    return this.job;
  }
}

export const strongStore = new StrongStore();

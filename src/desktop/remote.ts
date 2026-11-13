// When the UI is opened from a phone (Safari over Tailscale or Wi-Fi), there is no Electron preload. This builds the same
// `window.desktop` API on top of the small HTTP server in the desktop app (electron/remoteServer.ts), so every page works
// unchanged and Stockfish keeps running natively on the computer.
import type { DesktopApi, OpenedFile } from './api';

type Listener<T> = (v: T) => void;
type ServerEvent =
  | { t: 'lines'; v: string[] }
  | { t: 'exit'; v: { code: number | null; expected: boolean } }
  | { t: 'puzzles'; v: { phase: string; fraction: number; count: number } }
  | { t: 'hello'; v: { fresh: boolean } };

/** Fired when the computer dropped this page's engine (it was away too long); the engine wrapper re-boots on it. */
export const ENGINE_LOST_EVENT = 'bc-engine-lost';

// Not crypto.randomUUID: pages served over plain http to another device are not a "secure context" and lack it.
const clientId = Array.from({ length: 24 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('');

function notPaired(): never {
  // the server answers the page itself with the "pair this phone" instructions
  location.reload();
  throw new Error('This phone is not paired with the computer');
}

async function rpc<T>(m: string, ...a: unknown[]): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/rpc?c=${clientId}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ m, a }) });
  } catch {
    throw new Error('Could not reach your computer. Is Blunder Check running there?');
  }
  if (res.status === 401) notPaired();
  const j = (await res.json()) as { ok: boolean; v?: T; error?: string };
  if (!j.ok) throw new Error(j.error || `Request failed (${res.status})`);
  return j.v as T;
}

function pickTextFiles(opts: { extensions: string[]; multi?: boolean }): Promise<OpenedFile[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = !!opts.multi;
    input.accept = opts.extensions.map((x) => `.${x}`).join(',');
    input.style.display = 'none';
    let settled = false;
    const done = (v: OpenedFile[]): void => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(v);
    };
    input.addEventListener('cancel', () => done([]));
    input.addEventListener('change', () => {
      const files = Array.from(input.files ?? []).slice(0, 50);
      void Promise.all(files.map(async (f) => ({ name: f.name, text: await f.text() }))).then(done, () => done([]));
    });
    document.body.appendChild(input);
    input.click();
  });
}

export function createRemoteApi(): DesktopApi {
  const lineLs = new Set<Listener<string[]>>();
  const exitLs = new Set<Listener<{ code: number | null; expected: boolean }>>();
  const puzzleLs = new Set<Listener<{ phase: string; fraction: number; count: number }>>();
  const on = <T>(set: Set<Listener<T>>, cb: Listener<T>): (() => void) => {
    set.add(cb);
    return () => {
      set.delete(cb);
    };
  };

  let greeted = false;
  const es = new EventSource(`/api/events?c=${clientId}`);
  es.onmessage = (m) => {
    let ev: ServerEvent;
    try {
      ev = JSON.parse(m.data as string) as ServerEvent;
    } catch {
      return;
    }
    if (ev.t === 'lines') lineLs.forEach((l) => l(ev.v));
    else if (ev.t === 'exit') exitLs.forEach((l) => l(ev.v));
    else if (ev.t === 'puzzles') puzzleLs.forEach((l) => l(ev.v));
    else if (ev.t === 'hello') {
      // Reconnected after a long time away: the computer had already stopped this page's Stockfish.
      if (greeted && ev.v.fresh) window.dispatchEvent(new Event(ENGINE_LOST_EVENT));
      greeted = true;
    }
  };

  // Engine commands must arrive in order: batch what is sent in one tick and post the batches one after another.
  let batch: string[] = [];
  let chain: Promise<unknown> = Promise.resolve();
  const flush = (): void => {
    const cmds = batch;
    batch = [];
    chain = chain
      .then(() => fetch(`/api/engine?c=${clientId}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cmds }) }))
      .then((r) => {
        if (r.status === 401) notPaired();
      })
      .catch(() => lineLs.forEach((l) => l(['info string desktop-error Lost the connection to your computer'])));
  };

  // Saves of the same key must not overtake each other on the network.
  const writes = new Map<string, Promise<unknown>>();
  const serial = <T>(key: string, job: () => Promise<T>): Promise<T> => {
    const p = (writes.get(key) ?? Promise.resolve()).catch(() => undefined).then(job);
    writes.set(key, p);
    void p
      .finally(() => {
        if (writes.get(key) === p) writes.delete(key);
      })
      .catch(() => undefined);
    return p;
  };

  return {
    isRemote: true,
    engine: {
      info: () => rpc('engine.info'),
      send: (cmd) => {
        if (!batch.length) queueMicrotask(flush);
        batch.push(cmd);
      },
      onLines: (cb) => on(lineLs, cb),
      onExit: (cb) => on(exitLs, cb),
      kill: async () => {
        await chain; // let commands already sent reach the engine first
        await rpc('engine.kill');
      },
      pick: async () => null, // the engine lives on the computer: choose it there
    },
    store: {
      read: <T>(key: string) => serial(key, () => rpc<T | null>('store.read', key)),
      write: (key, value) => serial(key, () => rpc<void>('store.write', key, value)),
      remove: (key) => serial(key, () => rpc<void>('store.remove', key)),
      list: (prefix) => rpc('store.list', prefix),
    },
    system: { info: () => rpc('system.info') },
    http: { get: (url) => rpc('http.get', url) },
    files: { openText: (opts) => pickTextFiles(opts) },
    puzzles: {
      importLichess: (opts) => rpc('puzzles.importLichess', opts),
      onProgress: (cb) => on(puzzleLs, cb),
      cancel: () => void rpc('puzzles.cancel').catch(() => undefined),
    },
    coach: {
      hasKey: () => rpc('coach.hasKey'),
      setKey: (key) => rpc('coach.setKey', key),
      clearKey: () => rpc('coach.clearKey'),
      ask: (req) => rpc('coach.ask', req),
    },
    openExternal: (url) => {
      if (/^https:\/\//.test(url)) window.open(url, '_blank', 'noopener');
    },
  };
}

/** Install the network bridge when this page was served by the desktop app's phone server. */
export async function installRemoteBridge(): Promise<boolean> {
  if (window.desktop || !/^https?:$/.test(location.protocol)) return false;
  try {
    const r = await fetch('/api/hello', { cache: 'no-store' });
    if (!r.ok) return false;
    const j = (await r.json()) as { app?: string };
    if (j.app !== 'blunder-check') return false;
  } catch {
    return false;
  }
  window.desktop = createRemoteApi();
  document.documentElement.classList.add('is-phone');
  return true;
}

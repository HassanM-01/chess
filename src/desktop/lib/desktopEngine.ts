// The one shared engine of the desktop app: native Stockfish in the main process, reached over IPC.
import { useSyncExternalStore } from 'react';
import { Engine, type EngineTransport } from '@/engine/engine';
import type { EngineStatus } from '@/engine/types';
import { resolveEngineOptions, useSettings } from '../state/settings';

function ipcTransport(): EngineTransport {
  const d = window.desktop!.engine;
  let lineCb: (l: string) => void = () => undefined;
  let errCb: (e: unknown) => void = () => undefined;
  const offLines = d.onLines((lines) => {
    for (const l of lines) {
      if (l.startsWith('info string desktop-error ')) errCb(new Error(l.slice('info string desktop-error '.length)));
      else lineCb(l);
    }
  });
  const offExit = d.onExit((i) => {
    if (!i.expected) errCb(new Error('The engine stopped unexpectedly'));
  });
  return {
    send: (cmd) => d.send(cmd),
    onLine: (cb) => {
      lineCb = cb;
    },
    onError: (cb) => {
      errCb = cb;
    },
    terminate: () => {
      offLines();
      offExit();
      void d.kill();
    },
  };
}

let instance: Engine | null = null;
let lastError = '';
const errListeners = new Set<() => void>();

export function getEngine(): Engine {
  if (!instance) {
    instance = new Engine(
      () => ipcTransport(),
      [{ file: 'native', kind: 'strong', bootTimeoutMs: 90_000 }],
      (_f, e) => {
        lastError = e instanceof Error ? e.message : String(e);
        errListeners.forEach((l) => l());
      },
      async () => {
        const o = await resolveEngineOptions();
        return [
          `setoption name Threads value ${o.threads}`,
          `setoption name Hash value ${o.hashMb}`,
          'setoption name UCI_ShowWDL value true',
          'setoption name Move Overhead value 0',
        ];
      },
    );
  }
  return instance;
}

/** Apply new thread / hash settings as soon as the engine is idle. */
export function applyEngineSettings(): void {
  instance?.requestRestart();
}

export function useEngineStatus(): { status: EngineStatus; name: string; error: string } {
  const e = getEngine();
  const status = useSyncExternalStore(
    (cb) => {
      errListeners.add(cb);
      const off = e.subscribe(cb);
      return () => {
        errListeners.delete(cb);
        off();
      };
    },
    () => e.status,
  );
  return { status, name: e.name, error: lastError };
}

// Re-start the engine when the user changes threads or hash.
let prev = '';
useSettings.subscribe((s) => {
  const key = `${s.threads}|${s.hashMb}`;
  if (prev && key !== prev) applyEngineSettings();
  prev = key;
});

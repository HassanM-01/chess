import { create } from 'zustand';
import { DEFAULT_PRESET, PRESETS, type PresetKey } from '@/review/presets';
import type { SystemInfo } from '../api';

export interface DesktopSettings {
  loaded: boolean;
  preset: PresetKey | 'custom';
  depth: number;
  movetimeMs: number;
  multipv: number;
  /** null = use what the app recommends for this computer */
  threads: number | null;
  hashMb: number | null;
  chesscomUsername: string;
  boardTheme: 'green' | 'brown' | 'blue';
}

const DEFAULTS: DesktopSettings = {
  loaded: false,
  preset: DEFAULT_PRESET,
  depth: PRESETS[DEFAULT_PRESET].depth,
  movetimeMs: PRESETS[DEFAULT_PRESET].movetimeMs,
  multipv: PRESETS[DEFAULT_PRESET].multipv,
  threads: null,
  hashMb: null,
  chesscomUsername: '',
  boardTheme: 'green',
};

/** Extra keys in settings.json (the engine path is written by the main process) must survive our saves. */
let extra: Record<string, unknown> = {};

interface Store extends DesktopSettings {
  load(): Promise<void>;
  set(patch: Partial<DesktopSettings>): void;
}

export const useSettings = create<Store>((set, get) => ({
  ...DEFAULTS,
  async load() {
    const raw = (await window.desktop?.store.read<Record<string, unknown>>('settings')) ?? {};
    const { loaded: _l, ...saved } = raw as Partial<DesktopSettings>;
    extra = Object.fromEntries(Object.entries(raw).filter(([k]) => !(k in DEFAULTS)));
    set({ ...DEFAULTS, ...saved, loaded: true });
  },
  set(patch) {
    set(patch);
    const { load: _a, set: _b, loaded: _c, ...data } = get();
    void window.desktop?.store.write('settings', { ...extra, ...data });
  },
}));

let sys: Promise<SystemInfo> | null = null;
export const getSystem = (): Promise<SystemInfo> => (sys ??= window.desktop!.system.info());

/** The thread / hash values that will actually be sent to Stockfish. */
export async function resolveEngineOptions(): Promise<{ threads: number; hashMb: number }> {
  const s = useSettings.getState();
  const info = await getSystem();
  return { threads: s.threads ?? info.recommended.threads, hashMb: s.hashMb ?? info.recommended.hashMb };
}

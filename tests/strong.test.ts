// The optional strong engine: who gets it, how the engine falls back, and how analyses are labelled.
import { describe, expect, it, vi } from 'vitest';
import { engineTag } from '@/analysis/analyzeGame';
import { Engine, type EngineFile, type EngineTransport } from '@/engine/engine';
import { deviceCanRunStrong, parseSource, strongWanted, type DeviceInfo } from '@/engine/strong';

const desktop: DeviceInfo = { coarsePointer: false, ios: false, saveData: false, cores: 8, memoryGb: 8 };
const local = { kind: 'local' } as const;

describe('strong engine configuration', () => {
  it('is off unless the build sets a local copy or an https URL', () => {
    expect(parseSource(undefined)).toEqual({ kind: 'off' });
    expect(parseSource('  ')).toEqual({ kind: 'off' });
    expect(parseSource('local')).toEqual({ kind: 'local' });
    expect(parseSource('https://cdn.example/x/stockfish-18-single.wasm')).toEqual({ kind: 'url', url: 'https://cdn.example/x/stockfish-18-single.wasm' });
    expect(parseSource('http://insecure.example/x.wasm')).toEqual({ kind: 'off' });
    expect(parseSource('http://localhost:8080/stockfish-18-single.wasm')).toEqual({ kind: 'url', url: 'http://localhost:8080/stockfish-18-single.wasm' });
    expect(parseSource('garbage')).toEqual({ kind: 'off' });
  });
});

describe('who gets the strong engine', () => {
  it('auto: computers yes; phones, tablets, data saver and weak machines no', () => {
    expect(deviceCanRunStrong(desktop)).toBe(true);
    expect(deviceCanRunStrong({ ...desktop, memoryGb: undefined })).toBe(true); // Firefox/Safari do not report memory
    expect(deviceCanRunStrong({ ...desktop, coarsePointer: true })).toBe(false);
    expect(deviceCanRunStrong({ ...desktop, ios: true })).toBe(false);
    expect(deviceCanRunStrong({ ...desktop, saveData: true })).toBe(false);
    expect(deviceCanRunStrong({ ...desktop, cores: 2 })).toBe(false);
    expect(deviceCanRunStrong({ ...desktop, memoryGb: 2 })).toBe(false);
  });

  it('the preference and a previous failure decide the rest', () => {
    const phone = { ...desktop, coarsePointer: true, ios: true };
    expect(strongWanted('auto', desktop, local, false)).toBe(true);
    expect(strongWanted('auto', phone, local, false)).toBe(false);
    expect(strongWanted('on', phone, local, false)).toBe(true); // an explicit choice overrides the device check
    expect(strongWanted('off', desktop, local, false)).toBe(false);
    expect(strongWanted('auto', desktop, { kind: 'off' }, false)).toBe(false); // build without the feature
    expect(strongWanted('on', desktop, { kind: 'off' }, false)).toBe(false);
    expect(strongWanted('on', desktop, local, true)).toBe(false); // failed before: not retried until chosen again
  });
});

describe('Engine file fallback', () => {
  /** a fake worker that answers `uci` with `uciok`, or stays silent to simulate a build that never starts */
  const fake = (silent: Set<string>) => (file: string): EngineTransport => {
    let line: (l: string) => void = () => undefined;
    return {
      send: (cmd) => {
        if (cmd === 'uci' && !silent.has(file)) queueMicrotask(() => line('uciok'));
      },
      onLine: (cb) => {
        line = cb;
      },
      onError: () => undefined,
      terminate: () => undefined,
    };
  };
  const strong: EngineFile = { file: 'stockfish-18-single.js', kind: 'strong', bootTimeoutMs: 20, wasm: 'https://cdn.example/stockfish-18-single.wasm' };
  const lite: EngineFile = { file: 'stockfish-18-lite-single.js', kind: 'fast', bootTimeoutMs: 20 };

  it('uses the strong build when it starts', async () => {
    const e = new Engine(fake(new Set()), async () => [strong, lite]);
    await e.boot();
    expect(e.kind).toBe('strong');
  });

  it('falls back to the lite build and reports the strong one as failed', async () => {
    const failed = vi.fn();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const e = new Engine(fake(new Set([strong.file])), async () => [strong, lite], failed);
    await e.boot();
    warn.mockRestore();
    expect(e.kind).toBe('fast');
    expect(failed).toHaveBeenCalledTimes(1);
    expect(failed.mock.calls[0][0]).toMatchObject({ kind: 'strong' });
  });

  it('passes the wasm location to the worker factory', async () => {
    const seen: (string | undefined)[] = [];
    const factory = (file: string, wasm?: string): EngineTransport => {
      seen.push(wasm);
      return fake(new Set())(file);
    };
    await new Engine(factory, async () => [strong, lite]).boot();
    expect(seen).toEqual(['https://cdn.example/stockfish-18-single.wasm']);
  });
});

describe('analysis labels', () => {
  it('names the engine build and depth', () => {
    expect(engineTag('fast')).toBe('sf18-lite-d15');
    expect(engineTag('compat')).toBe('sf18-lite-d15');
    expect(engineTag('strong')).toBe('sf18-full-d15');
  });
});

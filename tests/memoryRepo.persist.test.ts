import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryRepo } from '@/db/memoryRepo';

function fakeStorage() {
  const data = new Map<string, string>();
  return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
}

describe('local-mode persistence', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('saves within a quarter of a second even while writes keep arriving (it is a throttle, not a debounce)', async () => {
    const storage = fakeStorage();
    const repo = createMemoryRepo({ storage, storageKey: 'k' });
    await repo.updateProfile({ settings: { theme: 'dark' } });
    // steady background activity: a new write every 100 ms for a full second
    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(100);
      await repo.updateProgress({ daily: { puzzles: i } });
    }
    const saved = JSON.parse(storage.data.get('k') ?? '{}') as { profile?: { settings?: { theme?: string } } };
    expect(saved.profile?.settings?.theme).toBe('dark');
  });

  it('flush() writes immediately, so leaving the page cannot lose the last change', async () => {
    const storage = fakeStorage();
    const repo = createMemoryRepo({ storage, storageKey: 'k' });
    await repo.updateProfile({ settings: { theme: 'dark' } });
    expect(storage.data.has('k')).toBe(false); // still waiting on the timer
    repo.flush();
    expect(JSON.parse(storage.data.get('k') as string).profile.settings.theme).toBe('dark');
    // and a second repo reading the same storage sees it (what a reload does)
    const again = createMemoryRepo({ storage, storageKey: 'k' });
    expect((await again.getProfile()).settings.theme).toBe('dark');
  });
});

// Tiny JSON file store for the desktop app (games, reviews, puzzles, settings). One file per key.
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

const KEY = /^[A-Za-z0-9_-]+(\/[A-Za-z0-9_.-]+)*$/;

export class JsonStore {
  private root: string;
  constructor(root: string) {
    this.root = resolve(root);
  }

  private file(key: string): string {
    if (!KEY.test(key) || key.includes('..')) throw new Error(`bad store key: ${key}`);
    const f = resolve(this.root, key + '.json');
    if (!f.startsWith(this.root + sep)) throw new Error(`bad store key: ${key}`);
    return f;
  }

  async read<T = unknown>(key: string): Promise<T | null> {
    try {
      return JSON.parse(await readFile(this.file(key), 'utf8')) as T;
    } catch {
      return null;
    }
  }

  /** Write atomically so a crash mid-write never leaves a half-written file. */
  async write(key: string, value: unknown): Promise<void> {
    const f = this.file(key);
    await mkdir(dirname(f), { recursive: true });
    const tmp = `${f}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(value), 'utf8');
    await rename(tmp, f);
  }

  async remove(key: string): Promise<void> {
    await rm(this.file(key), { force: true });
  }

  /** Keys under a prefix like "reviews" (no trailing slash), without the .json extension. */
  async list(prefix: string): Promise<string[]> {
    if (!/^[A-Za-z0-9_-]+$/.test(prefix)) throw new Error(`bad prefix: ${prefix}`);
    try {
      const names = await readdir(join(this.root, prefix));
      return names.filter((n) => n.endsWith('.json')).map((n) => `${prefix}/${n.slice(0, -5)}`);
    } catch {
      return [];
    }
  }
}

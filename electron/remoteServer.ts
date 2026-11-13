// Phone access: serves the same UI the desktop window uses over plain HTTP, plus a small JSON API that mirrors window.desktop.
// Meant to be reached over Tailscale (or the home Wi-Fi). Every phone or browser tab gets its own Stockfish process on this
// computer, so the strong native engine does the work and the phone only draws the board.
// Deliberately free of Electron imports (everything Electron-specific is passed in) so it can be tested with plain Node.
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import os from 'node:os';
import { extname, normalize, resolve, sep } from 'node:path';
import { gzipSync } from 'node:zlib';
import { EngineHost } from './engineHost';

export interface RemoteDeps {
  /** folder with the built UI (dist-desktop) */
  uiRoot: string;
  store: {
    read(key: string): Promise<unknown>;
    write(key: string, value: unknown): Promise<void>;
    remove(key: string): Promise<void>;
    list(prefix: string): Promise<string[]>;
  };
  resolveEnginePath(): string | null;
  engineInfo(): { path: string; found: boolean };
  systemInfo(): unknown;
  httpGet(url: string): Promise<{ status: number; body: string }>;
  coach: {
    hasKey(): boolean;
    setKey(key: unknown): Promise<void>;
    clearKey(): Promise<void>;
    ask(req: unknown): Promise<string>;
  };
  importLichess(limit: number, onProgress: (p: { phase: string; fraction: number; count: number }) => void, signal: { aborted: boolean }): Promise<{ count: number }>;
  log?(msg: string): void;
}

export interface RemoteLink {
  label: string;
  url: string;
}

const COOKIE = 'bc_phone';
const MAX_BODY = 64 * 1024 * 1024;
const MAX_CLIENTS = 4;
/** a phone that went away (screen locked, tab closed) keeps its engine this long in case it comes back */
const REAP_AFTER_MS = 15 * 60 * 1000;
const MAX_BUFFERED_LINES = 20_000;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
};
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://images.chesscomfiles.com https://*.chesscomfiles.com",
  "font-src 'self' data:",
  "connect-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ');

type Event = { t: 'lines'; v: string[] } | { t: 'exit'; v: { code: number | null; expected: boolean } } | { t: 'puzzles'; v: unknown } | { t: 'hello'; v: { fresh: boolean } };

interface Client {
  id: string;
  host: EngineHost;
  res: ServerResponse | null;
  /** events waiting for the phone to reconnect */
  backlog: Event[];
  backlogLines: number;
  reap: NodeJS.Timeout | null;
  lastSeen: number;
  puzzleCancel: { aborted: boolean };
}

export const newPairingCode = (): string => randomBytes(18).toString('base64url');

/** Addresses a phone can use to reach this computer. Tailscale addresses (100.64.0.0/10) come first. */
export function phoneLinks(port: number, code: string): RemoteLink[] {
  const out: RemoteLink[] = [];
  const pair = (h: string): string => `http://${h}:${port}/pair?code=${encodeURIComponent(code)}`;
  const tail: string[] = [];
  const lan: string[] = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      const [p, q] = a.address.split('.').map(Number);
      if (p === 100 && q >= 64 && q <= 127) tail.push(a.address);
      else if (!/vEthernet|VirtualBox|VMware|WSL|Hyper-V/i.test(name)) lan.push(a.address);
    }
  }
  if (tail.length) {
    out.push({ label: 'Tailscale (works anywhere)', url: pair(os.hostname().toLowerCase()) });
    for (const a of tail) out.push({ label: 'Tailscale IP', url: pair(a) });
  }
  for (const a of lan) out.push({ label: 'Same Wi-Fi only', url: pair(a) });
  return out;
}

export class RemoteServer {
  private server: Server | null = null;
  private clients = new Map<string, Client>();
  private gzCache = new Map<string, { mtime: number; gz: Buffer; raw: Buffer }>();
  private heartbeat: NodeJS.Timeout | null = null;

  constructor(
    private deps: RemoteDeps,
    private code: string,
  ) {}

  get running(): boolean {
    return !!this.server?.listening;
  }

  setCode(code: string): void {
    this.code = code;
  }

  start(port: number, hostname = '0.0.0.0'): Promise<void> {
    if (this.server) return Promise.resolve();
    return new Promise((res, rej) => {
      const s = createServer((req, resp) => {
        this.handle(req, resp).catch((e: unknown) => {
          if (!resp.headersSent) this.json(resp, 500, { ok: false, error: e instanceof Error ? e.message : String(e) });
          else resp.end();
        });
      });
      s.keepAliveTimeout = 65_000;
      s.once('error', (e) => {
        this.server = null;
        rej(e);
      });
      s.listen(port, hostname, () => {
        this.server = s;
        this.heartbeat = setInterval(() => {
          for (const c of this.clients.values()) c.res?.write(': ping\n\n');
        }, 20_000);
        res();
      });
    });
  }

  async stop(): Promise<void> {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    for (const c of [...this.clients.values()]) this.dropClient(c);
    const s = this.server;
    this.server = null;
    if (!s) return;
    s.closeAllConnections();
    await new Promise<void>((r) => s.close(() => r()));
  }

  // ---- auth ---------------------------------------------------------------------------------------------------
  private sameCode(given: string | undefined): boolean {
    if (!given) return false;
    const a = Buffer.from(given);
    const b = Buffer.from(this.code);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private cookieCode(req: IncomingMessage): string | undefined {
    const raw = req.headers.cookie ?? '';
    for (const part of raw.split(';')) {
      const [k, ...v] = part.trim().split('=');
      if (k === COOKIE) {
        try {
          return decodeURIComponent(v.join('='));
        } catch {
          return undefined;
        }
      }
    }
    return undefined;
  }

  /** POSTs must come from a page this server served (blocks other sites from driving the API through the cookie). */
  private sameOrigin(req: IncomingMessage): boolean {
    const origin = req.headers.origin;
    if (!origin) return true; // the cookie is SameSite=Strict, so cross-site requests carry no cookie anyway
    try {
      return new URL(origin).host === req.headers.host;
    } catch {
      return false;
    }
  }

  // ---- routing --------------------------------------------------------------------------------------------------
  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://local');
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'no-referrer');

    if (url.pathname === '/pair') {
      if (!this.sameCode(url.searchParams.get('code') ?? undefined)) return this.page(res, 403, 'That pairing link is not valid', 'Open Settings → Phone access in Blunder Check on your computer and use the link shown there.');
      res.writeHead(302, {
        'set-cookie': `${COOKIE}=${encodeURIComponent(this.code)}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Strict`,
        location: '/',
        'cache-control': 'no-store',
      });
      res.end();
      return;
    }

    if (!this.sameCode(this.cookieCode(req))) {
      if (url.pathname.startsWith('/api/')) return this.json(res, 401, { ok: false, error: 'not paired' });
      return this.page(res, 401, 'This phone is not paired yet', 'Open Settings → Phone access in Blunder Check on your computer and open the pairing link on this phone once.');
    }

    if (url.pathname === '/api/hello') return this.json(res, 200, { ok: true, app: 'blunder-check', computer: os.hostname() });
    if (url.pathname === '/api/events' && req.method === 'GET') return this.events(url, req, res);
    if (url.pathname.startsWith('/api/')) {
      if (req.method !== 'POST') return this.json(res, 405, { ok: false, error: 'POST only' });
      if (!this.sameOrigin(req)) return this.json(res, 403, { ok: false, error: 'bad origin' });
      const body = await this.body(req);
      const client = this.client(url.searchParams.get('c'));
      if (url.pathname === '/api/engine') return this.engine(client, body, res);
      if (url.pathname === '/api/rpc') return this.rpc(client, body, req, res);
      return this.json(res, 404, { ok: false, error: 'unknown endpoint' });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return this.json(res, 405, { ok: false, error: 'GET only' });
    return this.file(url.pathname, req, res);
  }

  // ---- clients and their engines ----------------------------------------------------------------------------------
  private client(id: string | null): Client {
    if (!id || !/^[A-Za-z0-9_-]{8,64}$/.test(id)) throw new Error('missing client id');
    const known = this.clients.get(id);
    if (known) return known;
    if (this.clients.size >= MAX_CLIENTS) {
      // make room: drop the client that has been away the longest (or, if all are connected, the oldest)
      const victim = [...this.clients.values()].sort((a, b) => (a.res ? 1 : 0) - (b.res ? 1 : 0) || a.lastSeen - b.lastSeen)[0];
      if (victim) this.dropClient(victim);
    }
    const client: Client = {
      id,
      res: null,
      backlog: [],
      backlogLines: 0,
      reap: null,
      lastSeen: Date.now(),
      puzzleCancel: { aborted: false },
      host: new EngineHost(this.deps.resolveEnginePath, {
        lines: (lines) => this.emit(client, { t: 'lines', v: lines }),
        exit: (i) => this.emit(client, { t: 'exit', v: { code: i.code, expected: i.expected } }),
        error: (m) => this.emit(client, { t: 'lines', v: [`info string desktop-error ${m}`] }),
      }),
    };
    this.clients.set(id, client);
    this.deps.log?.(`phone connected (${this.clients.size} active)`);
    return client;
  }

  private dropClient(c: Client): void {
    if (c.reap) clearTimeout(c.reap);
    c.reap = null;
    c.host.kill();
    c.puzzleCancel.aborted = true;
    const r = c.res;
    c.res = null;
    try {
      r?.end();
    } catch {
      /* gone */
    }
    this.clients.delete(c.id);
  }

  private emit(c: Client, ev: Event): void {
    if (c.res && !c.res.writableEnded) {
      c.res.write(`data: ${JSON.stringify(ev)}\n\n`);
      return;
    }
    // Phone is away (locked screen, Safari in the background): keep the output so a search in progress still finishes.
    c.backlog.push(ev);
    if (ev.t === 'lines') c.backlogLines += ev.v.length;
    if (c.backlogLines > MAX_BUFFERED_LINES) {
      // keep everything that is not a progress line (bestmove, readyok, ...) and the most recent progress
      const keep: Event[] = [];
      let n = 0;
      for (let i = c.backlog.length - 1; i >= 0; i--) {
        const e = c.backlog[i];
        if (e.t !== 'lines') {
          keep.push(e);
          continue;
        }
        const v = n < 2000 ? e.v : e.v.filter((l) => !l.startsWith('info '));
        n += v.length;
        if (v.length) keep.push({ t: 'lines', v });
      }
      c.backlog = keep.reverse();
      c.backlogLines = n;
    }
  }

  private events(url: URL, req: IncomingMessage, res: ServerResponse): void {
    const id = url.searchParams.get('c');
    const fresh = !!id && !this.clients.has(id);
    const c = this.client(id);
    if (c.reap) clearTimeout(c.reap);
    c.reap = null;
    const old = c.res;
    c.res = null;
    try {
      old?.end(); // an older stream from the same page
    } catch {
      /* gone */
    }
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.write('retry: 2000\n\n');
    res.write(`data: ${JSON.stringify({ t: 'hello', v: { fresh } })}\n\n`);
    c.res = res;
    c.lastSeen = Date.now();
    const backlog = c.backlog;
    c.backlog = [];
    c.backlogLines = 0;
    for (const ev of backlog) res.write(`data: ${JSON.stringify(ev)}\n\n`);
    req.on('close', () => {
      if (c.res !== res) return;
      c.res = null;
      c.lastSeen = Date.now();
      if (this.clients.get(c.id) === c) c.reap = setTimeout(() => this.dropClient(c), REAP_AFTER_MS);
    });
  }

  private engine(c: Client, body: unknown, res: ServerResponse): void {
    const cmds = (body as { cmds?: unknown } | null)?.cmds;
    if (!Array.isArray(cmds) || cmds.length > 200) return this.json(res, 400, { ok: false, error: 'bad commands' });
    c.lastSeen = Date.now();
    for (const cmd of cmds) if (typeof cmd === 'string' && cmd.length <= 20_000) c.host.send(cmd);
    this.json(res, 200, { ok: true });
  }

  private async rpc(c: Client, body: unknown, req: IncomingMessage, res: ServerResponse): Promise<void> {
    const { m, a } = (body ?? {}) as { m?: unknown; a?: unknown };
    const args = Array.isArray(a) ? a : [];
    const str = (i: number): string => {
      const v = args[i];
      if (typeof v !== 'string') throw new Error('bad argument');
      return v;
    };
    const d = this.deps;
    let v: unknown;
    try {
      switch (m) {
        case 'store.read':
          v = await d.store.read(str(0));
          break;
        case 'store.write':
          await d.store.write(str(0), args[1]);
          break;
        case 'store.remove':
          await d.store.remove(str(0));
          break;
        case 'store.list':
          v = await d.store.list(str(0));
          break;
        case 'engine.info':
          v = d.engineInfo();
          break;
        case 'engine.kill':
          c.host.kill();
          break;
        case 'system.info':
          v = d.systemInfo();
          break;
        case 'http.get':
          v = await d.httpGet(str(0));
          break;
        case 'coach.hasKey':
          v = d.coach.hasKey();
          break;
        case 'coach.setKey':
          await d.coach.setKey(args[0]);
          break;
        case 'coach.clearKey':
          await d.coach.clearKey();
          break;
        case 'coach.ask':
          v = await d.coach.ask(args[0]);
          break;
        case 'puzzles.importLichess': {
          c.puzzleCancel = { aborted: false };
          const limit = Number((args[0] as { limit?: unknown } | undefined)?.limit);
          v = await d.importLichess(Math.max(1000, Math.min(200_000, Math.floor(limit) || 40_000)), (p) => this.emit(c, { t: 'puzzles', v: p }), c.puzzleCancel);
          break;
        }
        case 'puzzles.cancel':
          c.puzzleCancel.aborted = true;
          break;
        default:
          return this.json(res, 404, { ok: false, error: `unknown method ${String(m)}` });
      }
    } catch (e) {
      return this.json(res, 200, { ok: false, error: e instanceof Error ? e.message : String(e) }, req);
    }
    this.json(res, 200, { ok: true, v: v ?? null }, req);
  }

  // ---- plumbing -----------------------------------------------------------------------------------------------------
  private body(req: IncomingMessage): Promise<unknown> {
    return new Promise((res, rej) => {
      const chunks: Buffer[] = [];
      let size = 0;
      req.on('data', (b: Buffer) => {
        size += b.length;
        if (size > MAX_BODY) {
          rej(new Error('request too large'));
          req.destroy();
          return;
        }
        chunks.push(b);
      });
      req.on('end', () => {
        if (!size) return res(null);
        try {
          res(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch {
          rej(new Error('bad JSON'));
        }
      });
      req.on('error', rej);
    });
  }

  private json(res: ServerResponse, status: number, data: unknown, req?: IncomingMessage): void {
    let body: Buffer = Buffer.from(JSON.stringify(data));
    const headers: Record<string, string> = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
    if (req && body.length > 32 * 1024 && /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''))) {
      body = gzipSync(body, { level: 4 });
      headers['content-encoding'] = 'gzip';
    }
    res.writeHead(status, headers);
    res.end(body);
  }

  private page(res: ServerResponse, status: number, title: string, text: string): void {
    const esc = (s: string): string => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch] ?? ch);
    res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': CSP });
    res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Blunder Check</title>
<style>body{font:17px/1.5 system-ui,-apple-system,sans-serif;background:#262522;color:#f1f1ec;margin:0;padding:48px 24px;max-width:520px}h1{font-size:22px}</style></head>
<body><h1>♞ ${esc(title)}</h1><p>${esc(text)}</p></body></html>`);
  }

  private async file(pathname: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
    const root = resolve(this.deps.uiRoot);
    let rel: string;
    try {
      rel = decodeURIComponent(pathname);
    } catch {
      return this.json(res, 400, { ok: false, error: 'bad path' });
    }
    if (rel === '/' || rel === '') rel = '/index.html';
    const file = resolve(root, '.' + normalize(rel));
    if (!file.startsWith(root + sep)) return this.json(res, 403, { ok: false, error: 'forbidden' });
    let st;
    try {
      st = await stat(file);
      if (!st.isFile()) throw new Error('not a file');
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('Not found');
      return;
    }
    const type = MIME[extname(file)] ?? 'application/octet-stream';
    const headers: Record<string, string> = {
      'content-type': type,
      'content-security-policy': CSP,
      // file names under assets/ carry a content hash, so they never change; the page itself must always be fresh
      'cache-control': rel.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
    };
    let cached = this.gzCache.get(file);
    if (!cached || cached.mtime !== st.mtimeMs) {
      const raw = await readFile(file);
      const zippable = /^(text\/|application\/(json|manifest)|image\/svg)/.test(type) && raw.length > 1024;
      cached = { mtime: st.mtimeMs, raw, gz: zippable ? gzipSync(raw, { level: 6 }) : raw };
      this.gzCache.set(file, cached);
    }
    let body = cached.raw;
    if (cached.gz !== cached.raw && /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''))) {
      body = cached.gz;
      headers['content-encoding'] = 'gzip';
    }
    headers['content-length'] = String(body.length);
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : body);
  }
}

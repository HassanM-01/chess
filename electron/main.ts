// Electron main process: window, native Stockfish, local file storage, a few safe helpers.
import { app, BrowserWindow, dialog, ipcMain, net, protocol, shell, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import { existsSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { extname, join, normalize, resolve, sep } from 'node:path';
import * as coach from './coach';
import { EngineHost } from './engineHost';
import { downloadLichessPuzzles } from './lichessPuzzles';
import { newPairingCode, phoneLinks, RemoteServer, type RemoteLink } from './remoteServer';
import { JsonStore } from './store';

const DEV_URL = process.env.DESKTOP_DEV_URL; // set by `npm run desktop:dev`
const APP_ORIGIN = 'app://local';
const isDev = !!DEV_URL;
/** `--headless`: no window, just phone access (started by `npm run phone`). */
const headless = process.argv.includes('--headless');

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);

let win: BrowserWindow | null = null;
let store: JsonStore;
let host: EngineHost;
let phone: RemoteServer | null = null;

// Tests (and portable use) can keep all data in a folder of their choosing.
if (process.env.BLUNDER_USER_DATA) app.setPath('userData', process.env.BLUNDER_USER_DATA);

const exeName = process.platform === 'win32' ? 'stockfish.exe' : 'stockfish';

/** Synchronous on purpose: engine commands must reach Stockfish in the order they were sent. */
function resolveEnginePath(): string | null {
  let custom: string | undefined;
  try {
    custom = (JSON.parse(readFileSync(join(app.getPath('userData'), 'data', 'settings.json'), 'utf8')) as { enginePath?: string }).enginePath;
  } catch {
    /* no settings yet */
  }
  const candidates = [
    custom,
    join(process.resourcesPath ?? '', 'engine', exeName),
    join(app.getAppPath(), 'engine', exeName),
    join(process.cwd(), 'engine', exeName),
  ].filter((p): p is string => !!p);
  return candidates.find((p) => existsSync(p)) ?? null;
}

function engineInfo(): { path: string; found: boolean } {
  const path = resolveEnginePath();
  return { path: path ?? '', found: !!path };
}

function systemInfo() {
  const cores = os.availableParallelism();
  const totalMemMb = Math.round(os.totalmem() / 1048576);
  return {
    cpuModel: os.cpus()[0]?.model?.trim() ?? 'unknown CPU',
    logicalCores: cores,
    totalMemMb,
    platform: process.platform,
    appVersion: app.getVersion(),
    // Leave two threads for the interface and a quarter of the RAM for the rest of the system.
    recommended: { threads: Math.max(1, cores - 2), hashMb: Math.max(64, Math.min(16384, Math.floor((totalMemMb * 0.25) / 1024) * 1024 || 256)) },
  };
}

const HTTP_HOSTS = new Set(['api.chess.com']);
async function httpGet(url: string): Promise<{ status: number; body: string }> {
  const u = new URL(url);
  if (u.protocol !== 'https:' || !HTTP_HOSTS.has(u.hostname)) throw new Error(`host not allowed: ${u.hostname}`);
  const res = await net.fetch(u.toString(), { headers: { Accept: 'application/json', 'User-Agent': 'BlunderCheckDesktop/1.0' } });
  return { status: res.status, body: await res.text() };
}

async function importLichess(limit: number, send: (p: { phase: string; fraction: number; count: number }) => void, signal: { aborted: boolean }): Promise<{ count: number }> {
  send({ phase: 'Downloading', fraction: 0, count: 0 });
  const rows = await downloadLichessPuzzles({
    limit,
    signal,
    onDownload: (f) => send({ phase: 'Downloading and sorting by rating', fraction: f, count: 0 }),
    onProgress: (_n, kept) => send({ phase: 'Downloading and sorting by rating', fraction: 0, count: kept }),
  });
  send({ phase: 'Saving', fraction: 1, count: rows.length });
  await store.write('lichess-puzzles', { version: 1, importedAt: new Date().toISOString(), rows });
  return { count: rows.length };
}

// ---- phone access -----------------------------------------------------------------------------------------------
// Kept in its own file (not the JSON store) so a paired phone can never read or change it through the store API.
interface PhoneConfig {
  enabled: boolean;
  port: number;
  code: string;
}
interface PhoneStatus {
  enabled: boolean;
  running: boolean;
  port: number;
  links: RemoteLink[];
  error: string;
}
const phoneFile = (): string => join(app.getPath('userData'), 'phone-access.json');
let phoneError = '';

async function phoneConfig(): Promise<PhoneConfig> {
  let c: Partial<PhoneConfig> = {};
  try {
    c = JSON.parse(await readFile(phoneFile(), 'utf8')) as Partial<PhoneConfig>;
  } catch {
    /* first run */
  }
  const port = Number(c.port);
  const cfg: PhoneConfig = {
    enabled: !!c.enabled,
    port: Number.isInteger(port) && port >= 1024 && port < 65536 ? port : 8765,
    code: typeof c.code === 'string' && c.code.length >= 16 ? c.code : newPairingCode(),
  };
  if (cfg.code !== c.code) await writeFile(phoneFile(), JSON.stringify(cfg));
  return cfg;
}

async function phoneStatus(): Promise<PhoneStatus> {
  const cfg = await phoneConfig();
  const running = !!phone?.running;
  return { enabled: cfg.enabled, running, port: cfg.port, links: running ? phoneLinks(cfg.port, cfg.code) : [], error: phoneError };
}

async function startPhone(): Promise<void> {
  const cfg = await phoneConfig();
  phone ??= new RemoteServer(
    {
      uiRoot: resolve(app.getAppPath(), 'dist-desktop'),
      store,
      resolveEnginePath,
      engineInfo,
      systemInfo,
      httpGet,
      coach,
      importLichess,
      log: (m) => console.log(`[phone] ${m}`),
    },
    cfg.code,
  );
  phone.setCode(cfg.code);
  if (phone.running) return;
  try {
    await phone.start(cfg.port);
    phoneError = '';
    console.log(`[phone] listening on port ${cfg.port}`);
    for (const l of phoneLinks(cfg.port, cfg.code)) console.log(`[phone] ${l.label}: ${l.url}`);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    phoneError = code === 'EADDRINUSE' ? `Port ${cfg.port} is already in use (is Blunder Check already running in the background?).` : e instanceof Error ? e.message : String(e);
    console.error(`[phone] ${phoneError}`);
  }
}

async function setPhoneEnabled(on: boolean): Promise<PhoneStatus> {
  const cfg = await phoneConfig();
  await writeFile(phoneFile(), JSON.stringify({ ...cfg, enabled: !!on }));
  if (on) await startPhone();
  else {
    await phone?.stop();
    phoneError = '';
  }
  return phoneStatus();
}

/** A new pairing code: phones paired with the old one have to open the new link. */
async function newPhoneCode(): Promise<PhoneStatus> {
  const cfg = await phoneConfig();
  const code = newPairingCode();
  await writeFile(phoneFile(), JSON.stringify({ ...cfg, code }));
  phone?.setCode(code);
  return phoneStatus();
}

// ---- who may talk to the main process ------------------------------------------------------------------
function trusted(e: IpcMainEvent | IpcMainInvokeEvent): boolean {
  const url = e.senderFrame?.url ?? '';
  return url.startsWith(APP_ORIGIN) || (!!DEV_URL && url.startsWith(DEV_URL));
}
const guardInvoke =
  <A extends unknown[], R>(fn: (...a: A) => R | Promise<R>) =>
  async (e: IpcMainInvokeEvent, ...a: A): Promise<R> => {
    if (!trusted(e)) throw new Error('untrusted sender');
    return fn(...a);
  };

// ---- the bundled UI served from app://local ---------------------------------------------------------------
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
};
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://images.chesscomfiles.com https://*.chesscomfiles.com",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ');

function serveUi(): void {
  const root = resolve(app.getAppPath(), 'dist-desktop');
  protocol.handle('app', async (req) => {
    const u = new URL(req.url);
    let rel = decodeURIComponent(u.pathname);
    if (rel === '/' || rel === '') rel = '/index.html';
    const file = resolve(root, '.' + normalize(rel));
    if (!file.startsWith(root + sep)) return new Response('Forbidden', { status: 403 });
    try {
      if (!(await stat(file)).isFile()) throw new Error('not a file');
      const body = await readFile(file);
      return new Response(body, { headers: { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'content-security-policy': CSP } });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

// ---- IPC ----------------------------------------------------------------------------------------------------
function registerIpc(): void {
  ipcMain.handle('engine:info', guardInvoke(() => engineInfo()));
  ipcMain.on('engine:send', (e, cmd: unknown) => {
    if (!trusted(e) || typeof cmd !== 'string' || cmd.length > 20_000) return;
    host.send(cmd);
  });
  ipcMain.handle('engine:kill', guardInvoke(() => host.kill()));
  ipcMain.handle('engine:pick', guardInvoke(async () => {
    const r = await dialog.showOpenDialog(win!, {
      title: 'Choose a Stockfish executable',
      properties: ['openFile'],
      filters: process.platform === 'win32' ? [{ name: 'Executable', extensions: ['exe'] }] : [],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    const settings = (await store.read<Record<string, unknown>>('settings')) ?? {};
    await store.write('settings', { ...settings, enginePath: r.filePaths[0] });
    host.kill();
    return r.filePaths[0];
  }));

  ipcMain.handle('store:read', guardInvoke((key: string) => store.read(key)));
  ipcMain.handle('store:write', guardInvoke((key: string, value: unknown) => store.write(key, value)));
  ipcMain.handle('store:remove', guardInvoke((key: string) => store.remove(key)));
  ipcMain.handle('store:list', guardInvoke((prefix: string) => store.list(prefix)));

  ipcMain.handle('system:info', guardInvoke(() => systemInfo()));
  ipcMain.handle('http:get', guardInvoke((url: string) => httpGet(url)));

  ipcMain.handle('files:openText', guardInvoke(async (o: { title: string; extensions: string[]; multi?: boolean }) => {
    const r = await dialog.showOpenDialog(win!, {
      title: String(o.title).slice(0, 100),
      properties: o.multi ? ['openFile', 'multiSelections'] : ['openFile'],
      filters: [{ name: 'Files', extensions: o.extensions.filter((x) => /^[a-z0-9]{1,8}$/i.test(x)) }],
    });
    if (r.canceled) return [];
    const out: { name: string; text: string }[] = [];
    for (const p of r.filePaths.slice(0, 50)) {
      if ((await stat(p)).size > 100 * 1024 * 1024) continue;
      out.push({ name: p.split(/[\\/]/).pop() ?? p, text: await readFile(p, 'utf8') });
    }
    return out;
  }));

  let puzzleCancel = { aborted: false };
  ipcMain.on('puzzles:cancel', (e) => {
    if (trusted(e)) puzzleCancel.aborted = true;
  });
  ipcMain.handle('puzzles:importLichess', guardInvoke(async (o: { limit: number }) => {
    puzzleCancel = { aborted: false };
    const limit = Math.max(1000, Math.min(200_000, Math.floor(o.limit) || 40_000));
    return importLichess(limit, (p) => win?.webContents.send('puzzles:progress', p), puzzleCancel);
  }));

  // the optional AI coach: the key stays in this process
  ipcMain.handle('coach:hasKey', guardInvoke(() => coach.hasKey()));
  ipcMain.handle('coach:setKey', guardInvoke((key: unknown) => coach.setKey(key)));
  ipcMain.handle('coach:clearKey', guardInvoke(() => coach.clearKey()));
  ipcMain.handle('coach:ask', guardInvoke((req: unknown) => coach.ask(req)));

  ipcMain.handle('remote:status', guardInvoke(() => phoneStatus()));
  ipcMain.handle('remote:set', guardInvoke((on: unknown) => setPhoneEnabled(on === true)));
  ipcMain.handle('remote:newCode', guardInvoke(() => newPhoneCode()));

  ipcMain.on('app:openExternal', (e, url: unknown) => {
    if (!trusted(e) || typeof url !== 'string') return;
    if (/^https:\/\/([a-z0-9-]+\.)?(chess\.com|lichess\.org|github\.com|anthropic\.com)\//i.test(url)) void shell.openExternal(url);
  });
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: '#1d1c1a',
    title: 'Blunder Check',
    autoHideMenuBar: true,
    show: false,
    webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
  });
  win.once('ready-to-show', () => win?.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(APP_ORIGIN) && !(DEV_URL && url.startsWith(DEV_URL))) e.preventDefault();
  });
  void win.loadURL(DEV_URL ?? `${APP_ORIGIN}/index.html`);
  win.on('closed', () => {
    win = null;
  });
}

const single = app.requestSingleInstanceLock();
if (!single) app.quit();
else {
  app.on('second-instance', () => {
    if (!win) createWindow();
    else {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  void app.whenReady().then(() => {
    store = new JsonStore(join(app.getPath('userData'), 'data'));
    host = new EngineHost(resolveEnginePath, {
      lines: (lines) => win?.webContents.send('engine:lines', lines),
      exit: (i) => win?.webContents.send('engine:exit', { code: i.code, expected: i.expected }),
      error: (m) => win?.webContents.send('engine:lines', [`info string desktop-error ${m}`]),
    });
    if (!isDev) serveUi();
    registerIpc();
    if (headless) {
      console.log('[phone] Blunder Check is running without a window. Press Ctrl+C to stop.');
      void startPhone();
    } else {
      createWindow();
      void phoneConfig().then((c) => (c.enabled ? startPhone() : undefined));
    }
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
  app.on('before-quit', () => {
    host?.kill();
    void phone?.stop();
  });
  // Ctrl+C in the terminal: shut down cleanly so no Stockfish process is left running.
  process.on('SIGINT', () => app.quit());
  process.on('SIGTERM', () => app.quit());
  // Without a window (`--headless`) the app lives until Ctrl+C, even if a window was opened and closed in between.
  app.on('window-all-closed', () => {
    if (!headless) app.quit();
  });
}


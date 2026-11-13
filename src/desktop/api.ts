// The bridge the Electron preload script exposes as `window.desktop`. Only plain data crosses it.
export interface EngineInfo {
  /** where the binary was found (empty when missing) */
  path: string;
  found: boolean;
  /** "Stockfish 19" once the engine has answered `uci` */
  name?: string;
}

export interface SystemInfo {
  cpuModel: string;
  logicalCores: number;
  totalMemMb: number;
  platform: string;
  appVersion: string;
  /** what the app picks when the user has not chosen */
  recommended: { threads: number; hashMb: number };
}

export interface OpenedFile {
  name: string;
  text: string;
}

export interface PhoneLink {
  label: string;
  url: string;
}

/** Phone access: the desktop app serving itself to a phone over Tailscale or Wi-Fi. */
export interface PhoneStatus {
  enabled: boolean;
  running: boolean;
  port: number;
  /** pairing links, best first (empty while stopped) */
  links: PhoneLink[];
  error: string;
}

export interface DesktopApi {
  engine: {
    info(): Promise<EngineInfo>;
    send(cmd: string): void;
    onLines(cb: (lines: string[]) => void): () => void;
    onExit(cb: (info: { code: number | null; expected: boolean }) => void): () => void;
    /** kill the engine process; the next command starts a new one */
    kill(): Promise<void>;
    /** let the user pick a Stockfish executable; resolves with its path */
    pick(): Promise<string | null>;
  };
  store: {
    read<T = unknown>(key: string): Promise<T | null>;
    write(key: string, value: unknown): Promise<void>;
    remove(key: string): Promise<void>;
    list(prefix: string): Promise<string[]>;
  };
  system: { info(): Promise<SystemInfo> };
  /** GET requests to a short list of hosts (chess.com), made by the main process so CORS never gets in the way */
  http: { get(url: string): Promise<{ status: number; body: string }> };
  files: {
    /** open a file dialog and read the chosen text files */
    openText(opts: { title: string; extensions: string[]; multi?: boolean }): Promise<OpenedFile[]>;
  };
  puzzles: {
    /** download the Lichess puzzle database and keep a rating-balanced sample on disk */
    importLichess(opts: { limit: number }): Promise<{ count: number }>;
    onProgress(cb: (p: { phase: string; fraction: number; count: number }) => void): () => void;
    cancel(): void;
  };
  /** the optional AI coach; the API key is stored encrypted by the main process and never comes back to the page */
  coach: {
    hasKey(): Promise<boolean>;
    setKey(key: string): Promise<void>;
    clearKey(): Promise<void>;
    ask(req: { system: string; messages: { role: 'user' | 'assistant'; content: string }[] }): Promise<string>;
  };
  openExternal(url: string): void;
  /** Set on a phone or browser that reaches the app over the network instead of running inside the desktop window. */
  isRemote?: boolean;
  /** Phone access controls; only in the desktop window. */
  phone?: {
    status(): Promise<PhoneStatus>;
    setEnabled(on: boolean): Promise<PhoneStatus>;
    newCode(): Promise<PhoneStatus>;
  };
}

declare global {
  interface Window {
    desktop?: DesktopApi;
  }
}

export const hasDesktop = (): boolean => typeof window !== 'undefined' && !!window.desktop;

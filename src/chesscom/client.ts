// chess.com public API client (spec 5). Direct browser fetch first (CORS is open), then the /api/chesscom proxy.
export interface ChesscomPlayerResult {
  username: string;
  rating?: number;
  result?: string;
}
export interface ChesscomGame {
  url: string;
  pgn?: string;
  end_time: number;
  time_class: string;
  rules: string;
  white: ChesscomPlayerResult;
  black: ChesscomPlayerResult;
}

export class ChesscomError extends Error {
  constructor(
    message: string,
    readonly kind: 'notfound' | 'ratelimited' | 'network' | 'http',
    readonly status?: number,
  ) {
    super(message);
  }
}

export interface ClientOptions {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  apiBase?: string;
  proxyBase?: string;
  /** set to false in tests to skip the proxy fallback */
  useProxyFallback?: boolean;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export interface ChesscomClient {
  /** Resolves with the canonical username (lowercase) or throws ChesscomError('notfound'). */
  validateUsername(username: string): Promise<string>;
  /** Archive month URLs, oldest first. */
  getArchives(username: string): Promise<string[]>;
  getMonth(username: string, year: number, month: number): Promise<ChesscomGame[]>;
}

export function createChesscomClient(opts: ClientOptions = {}): ChesscomClient {
  const doFetch: typeof fetch = opts.fetch ?? ((...a) => fetch(...a));
  const sleep = opts.sleep ?? defaultSleep;
  const apiBase = opts.apiBase ?? 'https://api.chess.com';
  const proxyBase = opts.proxyBase ?? '/api/chesscom';
  const proxy = opts.useProxyFallback ?? true;

  async function once(url: string): Promise<Response> {
    return doFetch(url, { headers: { Accept: 'application/json' } });
  }

  /** GET with 429 backoff (2 s, up to 3 retries). */
  async function getWithRetry(url: string): Promise<Response> {
    let res = await once(url);
    for (let i = 0; i < 3 && res.status === 429; i++) {
      await sleep(2000);
      res = await once(url);
    }
    return res;
  }

  async function getJson<T>(path: string): Promise<T> {
    let res: Response;
    try {
      res = await getWithRetry(`${apiBase}${path}`);
    } catch (e) {
      // Network or CORS failure: retry through our serverless proxy.
      if (!proxy) throw new ChesscomError(`Could not reach chess.com (${String(e)})`, 'network');
      try {
        res = await getWithRetry(`${proxyBase}?path=${encodeURIComponent(path)}`);
      } catch (e2) {
        throw new ChesscomError(`Could not reach chess.com (${String(e2)})`, 'network');
      }
    }
    // Still rate limited directly: the proxy has its own User-Agent and edge cache, so try it once before giving up.
    if (res.status === 429 && proxy) {
      try {
        const viaProxy = await getWithRetry(`${proxyBase}?path=${encodeURIComponent(path)}`);
        if (viaProxy.ok) res = viaProxy;
      } catch {
        /* keep the original 429 */
      }
    }
    if (res.status === 404) throw new ChesscomError('Not found', 'notfound', 404);
    if (res.status === 429) throw new ChesscomError('chess.com is busy. Try again in a minute.', 'ratelimited', 429);
    if (!res.ok) throw new ChesscomError(`chess.com returned ${res.status}`, 'http', res.status);
    return (await res.json()) as T;
  }

  const u = (name: string): string => encodeURIComponent(name.trim().toLowerCase());

  return {
    async validateUsername(username) {
      const clean = username.trim().toLowerCase();
      if (!/^[a-z0-9_-]{2,50}$/.test(clean)) throw new ChesscomError('That does not look like a chess.com username.', 'notfound');
      const p = await getJson<{ username?: string }>(`/pub/player/${u(clean)}`);
      return (p.username ?? clean).toLowerCase();
    },
    async getArchives(username) {
      const r = await getJson<{ archives?: string[] }>(`/pub/player/${u(username)}/games/archives`);
      return r.archives ?? [];
    },
    async getMonth(username, year, month) {
      const r = await getJson<{ games?: ChesscomGame[] }>(`/pub/player/${u(username)}/games/${year}/${String(month).padStart(2, '0')}`);
      return r.games ?? [];
    },
  };
}

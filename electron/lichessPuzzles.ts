// Builds a local puzzle bank from the Lichess puzzle database (CC0): https://database.lichess.org/#puzzles
// The full file has ~5 million puzzles; we keep a rating-balanced sample of the good ones.
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { createZstdDecompress } from 'node:zlib';

/** [id, fen, moves (space separated), rating, themes (space separated)] */
export type PuzzleRowTuple = [string, string, string, number, string];

export interface SampleOptions {
  limit: number;
  /** Popularity is -100..100; unpopular puzzles are usually flawed or ambiguous */
  minPopularity?: number;
  minPlays?: number;
  bucket?: number;
  minRating?: number;
  maxRating?: number;
  onProgress?: (rows: number, kept: number) => void;
  signal?: { aborted: boolean };
}

/**
 * Reads the CSV (PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags) and keeps a uniform random
 * sample per rating bucket, so every difficulty from beginner to master is represented.
 */
export async function sampleLichessCsv(csv: Readable, o: SampleOptions): Promise<PuzzleRowTuple[]> {
  const bucket = o.bucket ?? 100;
  const lo = o.minRating ?? 400;
  const hi = o.maxRating ?? 3200;
  const nBuckets = Math.ceil((hi - lo) / bucket);
  const quota = Math.max(1, Math.floor(o.limit / nBuckets));
  const keep: PuzzleRowTuple[][] = Array.from({ length: nBuckets }, () => []);
  const seen: number[] = new Array(nBuckets).fill(0);
  const minPop = o.minPopularity ?? 80;
  const minPlays = o.minPlays ?? 300;
  let rows = 0;
  let first = true;
  const rl = createInterface({ input: csv, crlfDelay: Infinity });
  for await (const line of rl) {
    if (o.signal?.aborted) throw new Error('cancelled');
    if (first) {
      first = false;
      if (line.startsWith('PuzzleId')) continue;
    }
    rows++;
    if (rows % 200_000 === 0) o.onProgress?.(rows, keep.reduce((n, k) => n + k.length, 0));
    const c = line.split(',');
    if (c.length < 8) continue;
    const rating = +c[3];
    if (!(rating >= lo && rating < hi)) continue;
    if (+c[5] < minPop || +c[6] < minPlays) continue;
    const b = Math.floor((rating - lo) / bucket);
    seen[b]++;
    const row: PuzzleRowTuple = [c[0], c[1], c[2], rating, c[7]];
    if (keep[b].length < quota) keep[b].push(row);
    else {
      const j = Math.floor(Math.random() * seen[b]);
      if (j < quota) keep[b][j] = row;
    }
  }
  o.onProgress?.(rows, keep.reduce((n, k) => n + k.length, 0));
  return keep.flat();
}

export const LICHESS_PUZZLE_URL = 'https://database.lichess.org/lichess_db_puzzle.csv.zst';

/** Download + decompress + sample, streaming (the file is ~270 MB compressed and never held in memory). */
export async function downloadLichessPuzzles(
  o: SampleOptions & { onDownload?: (fraction: number) => void },
): Promise<PuzzleRowTuple[]> {
  const res = await fetch(LICHESS_PUZZLE_URL);
  if (!res.ok || !res.body) throw new Error(`Lichess answered ${res.status}`);
  const total = +(res.headers.get('content-length') ?? 0);
  let got = 0;
  const src = Readable.fromWeb(res.body as never);
  src.on('data', (b: Buffer) => {
    got += b.length;
    if (total) o.onDownload?.(got / total);
  });
  const csv = src.pipe(createZstdDecompress());
  try {
    return await sampleLichessCsv(csv, o);
  } finally {
    src.destroy();
  }
}

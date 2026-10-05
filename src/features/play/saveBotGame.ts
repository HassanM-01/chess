import { Chess, uciMove } from '@/chess/compat';
import { moveToUci } from '@/chess/helpers';
import { START_FEN, type Color, type Uci } from '@/chess/types';
import { outcomeFor } from '@/chesscom/parsePgn';
import type { Repo } from '@/db/repo';
import type { GameRow, GameSource } from '@/db/types';

export interface BotGameInput {
  source: Extract<GameSource, 'bot' | 'london'>;
  username: string;
  botName: string;
  userColor: Color;
  fen0: string;
  moves: Uci[];
  result: string; // '1-0' | '0-1' | '1/2-1/2'
  opening?: string | null;
}

/** Stores a finished bot / London game so it can be reviewed and walked through like any other game. */
export async function saveBotGame(repo: Repo, g: BotGameInput): Promise<GameRow> {
  const c = new Chess(g.fen0);
  const san: string[] = [];
  const uci: Uci[] = [];
  for (const u of g.moves) {
    const m = uciMove(c, u);
    if (!m) break;
    san.push(m.san);
    uci.push(moveToUci(m));
  }
  const white = g.userColor === 'w' ? g.username : g.botName;
  const black = g.userColor === 'b' ? g.username : g.botName;
  c.setHeader('Event', g.source === 'london' ? 'London System practice' : 'Practice game');
  c.setHeader('White', white);
  c.setHeader('Black', black);
  c.setHeader('Result', g.result);
  const [row] = await repo.insertGames([
    {
      source: g.source,
      externalId: null,
      pgn: c.pgn(),
      startFen: g.fen0 || START_FEN,
      movesUci: uci,
      movesSan: san,
      white,
      black,
      whiteRating: null,
      blackRating: null,
      userColor: g.userColor,
      result: g.result,
      outcome: outcomeFor(g.result, g.userColor),
      termination: c.isCheckmate() ? 'checkmate' : 'draw',
      timeClass: null,
      opening: g.opening ?? null,
      eco: null,
      playedAt: new Date().toISOString(),
    },
  ]);
  return row;
}

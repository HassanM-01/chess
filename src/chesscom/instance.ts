import { createChesscomClient } from './client';

/** The shared browser client (direct fetch first, then the /api/chesscom proxy). */
export const chesscomClient = createChesscomClient();

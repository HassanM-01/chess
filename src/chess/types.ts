export type Color = 'w' | 'b';
export type PieceType = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
export type Square = string; // 'e4'
export type Uci = string; // 'e2e4', 'e7e8q'

export interface BoardPiece {
  type: PieceType;
  color: Color;
}
/** square -> piece, parsed from a FEN by parseFen() */
export type BoardMap = Record<Square, BoardPiece>;

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export const FILES = 'abcdefgh';

export const colorName = (c: Color): string => (c === 'w' ? 'White' : 'Black');
export const otherColor = (c: Color): Color => (c === 'w' ? 'b' : 'w');

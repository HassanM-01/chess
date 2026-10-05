import { PIECE_SPRITE_DEFS } from './pieceSpriteData';

/** Mounted once at the app root: every <use href="#pc-wk"> in the Board references these symbols. */
export function PieceSprite(): JSX.Element {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true" focusable="false">
      <defs dangerouslySetInnerHTML={{ __html: PIECE_SPRITE_DEFS }} />
    </svg>
  );
}

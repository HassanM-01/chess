import { Link } from 'react-router-dom';
import { Hero } from '@/components/ui';

export function AboutPage(): JSX.Element {
  return (
    <div className="stack">
      <Hero eyebrow="About" title="Blunder Check" />
      <div className="card stack">
        <p>
          Blunder Check helps beginners (about 100 to 1000 rated) stop losing the same way. It pulls your chess.com games, checks every move with a chess engine that runs
          on your own device, finds the patterns that cost you games, and builds training from your own mistakes.
        </p>
        <p className="small muted">Your games are analysed in your browser. Only the results are saved to your account.</p>
      </div>
      <div className="card stack">
        <h3>Credits</h3>
        <ul className="credits small">
          <li>
            <b>Chess pieces:</b> the cburnett set by Colin M.L. Burnett, licensed{' '}
            <a href="https://creativecommons.org/licenses/by-sa/3.0/" target="_blank" rel="noopener noreferrer">
              CC BY-SA 3.0
            </a>{' '}
            (via Wikimedia Commons).
          </li>
          <li>
            <b>Engine:</b>{' '}
            <a href="https://github.com/nmrugg/stockfish.js" target="_blank" rel="noopener noreferrer">
              Stockfish.js 18
            </a>{' '}
            by Chess.com, based on Stockfish, licensed{' '}
            <a href="https://www.gnu.org/licenses/gpl-3.0.html" target="_blank" rel="noopener noreferrer">
              GPLv3
            </a>
            .
          </li>
          <li>
            <b>Chess rules:</b>{' '}
            <a href="https://github.com/jhlywa/chess.js" target="_blank" rel="noopener noreferrer">
              chess.js
            </a>{' '}
            (BSD 2-Clause).
          </li>
          <li>
            <b>Puzzles:</b> hand-verified beginner puzzles generated with Stockfish, plus (optionally) the{' '}
            <a href="https://database.lichess.org/#puzzles" target="_blank" rel="noopener noreferrer">
              Lichess puzzle database
            </a>{' '}
            (CC0).
          </li>
          <li>
            <b>Games:</b> your public games come from the chess.com public API. Blunder Check is not affiliated with chess.com or Lichess.
          </li>
          <li>
            <b>Fonts:</b> Atkinson Hyperlegible, Bricolage Grotesque and JetBrains Mono (SIL Open Font License) via Google Fonts.
          </li>
        </ul>
      </div>
      <Link className="btn" to="/">
        Back to the app
      </Link>
    </div>
  );
}

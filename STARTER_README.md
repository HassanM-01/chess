# Blunder Check: starter pack for Claude Code

## What's in here
- `KICKOFF_PROMPT.md`: the prompt to paste into Claude Code.
- `SPEC.md`: the full technical spec (stack, database schema with security rules, chess.com sync, analysis and learning model, screens, UX rules, build phases with acceptance tests).
- `reference/prototype/`: the working prototype's source, for Claude Code to port.
- `reference/data/puzzles.json`: 275 verified beginner puzzles.
- `reference/data/huhsaaan-games.pgn`: 35 real games, used as test fixtures.

## How to start
1. Unzip this into an empty folder and run `git init`.
2. Create a free Supabase project (supabase.com). Keep the project URL, anon key and service role key handy.
3. Open Claude Code in this folder.
4. Paste the text from `KICKOFF_PROMPT.md`.
5. Approve each phase when its checks pass.

## Credits
- Chess pieces: cburnett SVG set, CC BY-SA 3.0.
- Engine: Stockfish 18 (GPLv3) via the `stockfish` npm package.
- Optional puzzle import: the Lichess puzzle database (CC0).

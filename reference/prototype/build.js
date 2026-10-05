const fs = require('fs');
const { Chess } = require('chess.js');
const D = __dirname;
const rd = f => fs.readFileSync(D + '/' + f, 'utf8');

// ---- puzzles ----
const CAP = { mate1: 50, mate2: 32, free: 55, fork: 60, winmat: 45, save: 50, stopmate: 40 };
const seen = new Set(), by = {};
for (const f of ['pA.jsonl', 'pB.jsonl', 'fA.jsonl', 'fB.jsonl']) {
  if (!fs.existsSync(D + '/' + f)) continue;
  for (const line of rd(f).split('\n')) {
    if (!line.trim()) continue;
    let p; try { p = JSON.parse(line); } catch (e) { continue; }
    const key = p.fen.split(' ').slice(0, 4).join(' ');
    if (seen.has(key)) continue; seen.add(key);
    // verify legality of solution line
    const c = new Chess(p.fen); let ok = true;
    for (const u of p.moves) if (!c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || 'q' })) { ok = false; break; }
    if (!ok) continue;
    if (p.theme === 'mate1' && !c.in_checkmate()) continue;
    if (p.theme === 'mate2' && !c.in_checkmate()) continue;
    if (p.uciExplain) {
      const m = p.explain.match(/Follow-up: (.*)\.$/);
      const c2 = new Chess(p.fen); const sans = [];
      if (m) for (const u of m[1].split(' ')) { const mv = c2.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || 'q' }); if (!mv) break; sans.push(mv.san); }
      const first = sans[0] || '';
      p.explain = `${first} wins material.` + (sans.length > 2 ? ` The main line runs ${sans.slice(0, 4).join(', ')}.` : '') + ' Look for moves that attack something your opponent can\'t defend.';
    }
    (by[p.theme] = by[p.theme] || []).push(p);
  }
}
let h = 0; const hash = s => { let x = 0x811c9dc5; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); } return (x >>> 0).toString(36); };
const PUZ = [];
for (const [t, list] of Object.entries(by)) {
  for (const p of list.slice(0, CAP[t] || 40)) {
    const o = { id: 'p' + hash(p.fen), theme: t, fen: p.fen, moves: p.moves, explain: p.explain };
    if (p.alts && p.alts.length && (t === 'mate1' || t === 'stopmate')) o.alts = p.alts;
    if (p.lastMove) o.lastMove = p.lastMove;
    PUZ.push(o);
  }
}
console.log('puzzles', Object.fromEntries(Object.entries(by).map(([k, v]) => [k, Math.min(v.length, CAP[k] || 40)])), PUZ.length);

// ---- sprite ----
let sp = rd('node_modules/cm-chessboard/assets/pieces/standard.svg');
sp = sp.slice(sp.indexOf('<g id="wk"'), sp.lastIndexOf('</svg>'));
// keep only piece groups (drop any markers after the last piece)
const endIdx = sp.search(/<g id="(marker|m)/);
if (endIdx > 0) sp = sp.slice(0, endIdx);
sp = sp.replace(/<g id="([wb][kqrbnp])"/g, '<g id="pc-$1"').replace(/\s+id="Shape"/g, '').replace(/\n\s+/g, ' ');

const esc = s => s.replace(/<\/script/gi, '<\\/script');
const html = `<title>Blunder Check</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&family=Bricolage+Grotesque:opsz,wght@12..96,600..800&family=JetBrains+Mono:wght@500;700&display=swap">
<style>
${rd('app.css')}
</style>
<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs>${sp}</defs></svg>
<div class="app">
  <header class="top">
    <div class="brand"><span class="mark" aria-hidden="true"><svg viewBox="0 0 20 20"><rect x="2" y="2" width="8" height="8" fill="#fff" opacity=".9"/><rect x="10" y="10" width="8" height="8" fill="#fff" opacity=".9"/><path d="M5 11.5l3 3 7-8" fill="none" stroke="#F2C14E" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg></span>Blunder Check</div>
    <div class="who" id="who"></div>
  </header>
  <main id="main"></main>
</div>
<nav class="tabs" id="tabs" aria-label="Sections"><div class="inner"></div></nav>
<script>
${esc(rd('node_modules/chess.js/chess.js'))}
</script>
<script>
${esc(rd('logic.js'))}
</script>
<script>
${esc(rd('content.js'))}
const PUZZLES = ${JSON.stringify(PUZ)};
</script>
<script>
${esc(rd('app.js'))}
</script>
`;
fs.mkdirSync(D + '/site', { recursive: true });
fs.writeFileSync(D + '/site/index.html', html);
for (const f of ['stockfish-18-lite-single.js', 'stockfish-18-lite-single.wasm', 'stockfish-18-asm.js']) fs.copyFileSync(D + '/node_modules/stockfish/bin/' + f, D + '/site/' + f);
console.log('html bytes', html.length);

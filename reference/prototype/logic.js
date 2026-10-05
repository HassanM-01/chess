// Shared board logic (works in node and browser). No dependencies.
(function (root) {
  const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
  const NAME = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
  const FILES = 'abcdefgh';

  function parseFen(fen) {
    const rows = fen.split(' ')[0].split('/');
    const b = {}; // square -> {type, color}
    for (let r = 0; r < 8; r++) {
      let f = 0;
      for (const ch of rows[r]) {
        if (/\d/.test(ch)) { f += +ch; continue; }
        const sq = FILES[f] + (8 - r);
        b[sq] = { type: ch.toLowerCase(), color: ch === ch.toLowerCase() ? 'b' : 'w' };
        f++;
      }
    }
    return b;
  }
  const fx = s => FILES.indexOf(s[0]);
  const fy = s => +s[1] - 1;
  const sq = (x, y) => (x >= 0 && x < 8 && y >= 0 && y < 8) ? FILES[x] + (y + 1) : null;

  // squares attacked by the piece on `from`
  function attacksFrom(b, from) {
    const p = b[from]; if (!p) return [];
    const x = fx(from), y = fy(from), out = [];
    const ray = (dx, dy) => { let cx = x + dx, cy = y + dy; while (true) { const s = sq(cx, cy); if (!s) break; out.push(s); if (b[s]) break; cx += dx; cy += dy; } };
    const step = (dx, dy) => { const s = sq(x + dx, y + dy); if (s) out.push(s); };
    switch (p.type) {
      case 'p': { const d = p.color === 'w' ? 1 : -1; step(-1, d); step(1, d); break; }
      case 'n': [[1,2],[2,1],[-1,2],[-2,1],[1,-2],[2,-1],[-1,-2],[-2,-1]].forEach(([a,c]) => step(a,c)); break;
      case 'k': [[1,1],[1,0],[1,-1],[0,1],[0,-1],[-1,1],[-1,0],[-1,-1]].forEach(([a,c]) => step(a,c)); break;
      case 'b': [[1,1],[1,-1],[-1,1],[-1,-1]].forEach(([a,c]) => ray(a,c)); break;
      case 'r': [[1,0],[-1,0],[0,1],[0,-1]].forEach(([a,c]) => ray(a,c)); break;
      case 'q': [[1,1],[1,-1],[-1,1],[-1,-1],[1,0],[-1,0],[0,1],[0,-1]].forEach(([a,c]) => ray(a,c)); break;
    }
    return out;
  }
  function attackers(b, target, color) {
    const out = [];
    for (const s in b) if (b[s].color === color && attacksFrom(b, s).includes(target)) out.push(s);
    return out;
  }
  // A piece is "loose/hanging" if attacked and (undefended, or attacked by something cheaper)
  function hangingInfo(b, s) {
    const p = b[s]; if (!p || p.type === 'k') return null;
    const opp = p.color === 'w' ? 'b' : 'w';
    const att = attackers(b, s, opp);
    if (!att.length) return null;
    const def = attackers(b, s, p.color);
    const cheapest = Math.min(...att.map(a => VAL[b[a].type]));
    if (!def.length) return { square: s, piece: p, reason: 'undefended', by: att };
    if (cheapest < VAL[p.type]) return { square: s, piece: p, reason: 'cheaper', by: att.filter(a => VAL[b[a].type] === cheapest) };
    return null;
  }
  function hangingPieces(b, color) {
    const out = [];
    for (const s in b) if (b[s].color === color) { const h = hangingInfo(b, s); if (h) out.push(h); }
    return out;
  }
  function material(b) {
    let w = 0, bl = 0;
    for (const s in b) { const p = b[s]; if (p.type === 'k') continue; if (p.color === 'w') w += VAL[p.type]; else bl += VAL[p.type]; }
    return { w, b: bl };
  }
  // pieces worth >= 3 (or king) attacked by the piece on `s`
  function forkTargets(b, s) {
    const p = b[s]; if (!p) return [];
    return attacksFrom(b, s).filter(t => b[t] && b[t].color !== p.color && (b[t].type === 'k' || VAL[b[t].type] >= 3 && (VAL[b[t].type] > VAL[p.type] || attackers(b, t, b[t].color).length === 0)));
  }
  function phaseOf(b, ply) {
    const m = material(b);
    const nonPawn = Object.values(b).filter(p => p.type !== 'p' && p.type !== 'k').length;
    if (ply <= 20) return 'opening';
    if (nonPawn <= 6 || m.w + m.b <= 26) return 'endgame';
    return 'middlegame';
  }

  const api = { VAL, NAME, parseFen, attacksFrom, attackers, hangingInfo, hangingPieces, material, forkTargets, phaseOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.CL = api;
})(typeof self !== 'undefined' ? self : this);

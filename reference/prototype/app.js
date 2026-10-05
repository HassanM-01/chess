'use strict';
/* global Chess, CL, OPENINGS, LESSONS, THEMES, CATS, PUZZLES */
const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const ANALYSIS_DEPTH = 11;

// ---------- tiny DOM helper ----------
const $ = (s, r = document) => r.querySelector(s);
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat(Infinity)) { if (k == null || k === false) continue; el.append(k.nodeType ? k : document.createTextNode(String(k))); }
  return el;
}
function toast(msg) { document.querySelectorAll('.toast').forEach(x => x.remove()); const t = h('div', { class: 'toast', role: 'status' }, msg); document.body.append(t); setTimeout(() => t.remove(), 2600); }
const today = () => new Date().toISOString().slice(0, 10);
const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;
const colorName = c => (c === 'w' ? 'White' : 'Black');
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// ---------- state ----------
const S = {
  settings: { username: 'huhsaaan', level: 1, color: 'w', blunderCheck: true },
  pstats: {}, seen: {}, drills: {}, lessons: {}, openings: {},
  daily: { date: today(), drills: 0, puzzles: 0, lesson: 0 },
  play: { caught: 0, games: 0, wins: 0 }, removed: {}, mg: {}, london: { games: 0, wins: 0 },
  games: {},
};
const UI = { tab: 'coach', session: null, analyzing: false, progress: null, sync: 'local' };

const Store = {
  prof: null, gcol: null, chain: Promise.resolve(), timer: null,
  profileData() { const { games, ...rest } = S; return JSON.parse(JSON.stringify(rest)); },
  loadLocal() {
    try { const p = JSON.parse(localStorage.getItem('bc-prof') || 'null'); if (p) mergeProfile(p); } catch (e) {}
    try { const g = JSON.parse(localStorage.getItem('bc-games') || 'null'); if (g) S.games = g; } catch (e) {}
  },
  saveLocal() {
    try { localStorage.setItem('bc-prof', JSON.stringify(this.profileData())); } catch (e) {}
    try { localStorage.setItem('bc-games', JSON.stringify(S.games)); } catch (e) {}
  },
  saveProfile() {
    this.saveLocal();
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      if (!this.prof) return;
      const d = this.profileData(), ref = this.prof;
      this.chain = this.chain.then(() => ref.set(d)).catch(e => console.warn('save profile', e));
    }, 1200);
  },
  saveGame(g) {
    this.saveLocal();
    if (!this.gcol) return;
    const ref = this.gcol.doc(g.id), d = JSON.parse(JSON.stringify(g));
    this.chain = this.chain.then(() => ref.set(d)).catch(e => console.warn('save game', e));
  },
  deleteGame(id) {
    delete S.games[id]; S.removed = S.removed || {}; S.removed[id] = 1; this.saveProfile();
    if (this.gcol) { const ref = this.gcol.doc(id); this.chain = this.chain.then(() => ref.delete()).catch(() => {}); }
  },
  async connect() {
    let c = window.claude;
    for (let i = 0; i < 30 && !(c && c.use); i++) { await new Promise(r => setTimeout(r, 200)); c = window.claude; }
    if (!c || !c.use) return;
    try {
      const [db, user] = await Promise.all([c.use('db'), c.use('user')]);
      if (!db || !user) return;
      const uid = await user.id();
      if (!uid) return;
      this.prof = db.doc('data/users/' + uid + '/profile');
      this.gcol = this.prof.collection('games');
      const [p, gs] = await Promise.all([this.prof.get(), this.gcol.get()]);
      if (p.exists) mergeProfile(p.data()); else this.saveProfile();
      const remote = new Set();
      gs.docs.forEach(d => { if (d.exists) { S.games[d.id] = JSON.parse(JSON.stringify(d.data())); remote.add(d.id); } });
      Object.values(S.games).forEach(g => { if (!remote.has(g.id)) this.saveGame(g); });
      UI.sync = 'account';
      this.saveLocal();
      rerender();
    } catch (e) { console.warn('db connect', e); }
  },
};
function mergeProfile(p) {
  for (const k of ['pstats', 'seen', 'drills', 'lessons', 'openings', 'play', 'removed', 'mg', 'london']) if (p[k]) S[k] = { ...S[k], ...p[k] };
  if (p.settings) S.settings = { ...S.settings, ...p.settings };
  if (p.daily && p.daily.date === today()) S.daily = p.daily;
}
function ensureDaily() { if (S.daily.date !== today()) S.daily = { date: today(), drills: 0, puzzles: 0, lesson: 0 }; }

// ---------- engine ----------
const Engine = {
  w: null, ready: null, queue: Promise.resolve(), opts: {}, cur: null, status: 'idle', kind: '',
  boot() {
    if (this.ready) return this.ready;
    this.status = 'loading';
    this.ready = (async () => {
      for (const f of ['stockfish-18-lite-single.js', 'stockfish-18-asm.js']) {
        try { await this._start(f); this.status = 'ready'; this.kind = f.includes('asm') ? 'compat' : 'fast'; updateEngineBadge(); return true; }
        catch (e) { console.warn('engine failed', f, e); }
      }
      this.status = 'failed'; updateEngineBadge();
      throw new Error('Engine could not start');
    })();
    return this.ready;
  },
  _start(file) {
    return new Promise((res, rej) => {
      let w; try { w = new Worker(file); } catch (e) { rej(e); return; }
      const t = setTimeout(() => { w.terminate(); rej(new Error('timeout')); }, file.includes('asm') ? 60000 : 25000);
      w.onerror = e => { clearTimeout(t); try { w.terminate(); } catch (_) {} rej(e); };
      w.onmessage = e => {
        if (String(e.data).startsWith('uciok')) {
          clearTimeout(t); this.w = w;
          w.onerror = ev => console.warn('engine error', ev);
          w.onmessage = ev => { if (this.cur) this.cur(String(ev.data)); };
          res();
        }
      };
      w.postMessage('uci');
    });
  },
  send(c) { this.w.postMessage(c); },
  setopt(k, v) { if (this.opts[k] !== v) { this.send('setoption name ' + k + ' value ' + v); this.opts[k] = v; } },
  run(fen, o = {}) {
    const { depth = 10, skill = 20, multipv = 1 } = o;
    const job = async () => {
      await this.boot();
      this.setopt('Skill Level', skill); this.setopt('MultiPV', multipv);
      const turn = fen.split(' ')[1];
      return new Promise(res => {
        const lines = {};
        this.cur = l => {
          if (l.startsWith('info') && l.includes(' pv ') && l.includes(' score ')) {
            const mp = +(l.match(/ multipv (\d+)/) || [0, 1])[1];
            const m = l.match(/ score (cp|mate) (-?\d+)/);
            let cp = null, mate = null;
            if (m[1] === 'cp') cp = +m[2]; else mate = +m[2];
            if (turn === 'b') { if (cp != null) cp = -cp; if (mate != null) mate = -mate; }
            lines[mp] = { cp: cp == null ? (mate > 0 ? 10000 : -10000) : cp, mate, pv: l.split(' pv ')[1].trim().split(' ') };
          } else if (l.startsWith('bestmove')) {
            this.cur = null;
            const best = l.split(' ')[1];
            const top = lines[1] || { cp: 0, mate: null, pv: [] };
            res({ cp: top.cp, mate: top.mate, best: best && best !== '(none)' ? best : null, pv: top.pv, lines: Object.keys(lines).sort().map(k => lines[k]) });
          }
        };
        this.send('position fen ' + fen);
        this.send('go depth ' + depth);
      });
    };
    return new Promise((res, rej) => { (o.bg ? this.lo : this.hi).push({ job, res, rej }); this.pump(); });
  },
  hi: [], lo: [], running: false,
  async pump() {
    if (this.running) return;
    const j = this.hi.shift() || this.lo.shift(); if (!j) return;
    this.running = true;
    try { j.res(await j.job()); } catch (e) { j.rej(e); }
    this.running = false;
    this.pump();
  },
};
function wpWhite(e) {
  if (e.mate != null) return e.mate > 0 ? 100 : 0;
  const cp = Math.max(-2000, Math.min(2000, e.cp || 0));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}
const wpFor = (e, c) => (c === 'w' ? wpWhite(e) : 100 - wpWhite(e));
function terminalEval(fen) {
  const c = new Chess(fen);
  if (c.in_checkmate()) return { cp: c.turn() === 'w' ? -10000 : 10000, mate: c.turn() === 'w' ? -1 : 1, best: null };
  if (c.game_over()) return { cp: 0, mate: null, best: null };
  return null;
}
async function evalPos(fen, depth = 10, bg = false) { return terminalEval(fen) || Engine.run(fen, { depth, bg }); }

// ---------- chess helpers ----------
function uciMove(chess, u) { return chess.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || 'q' }); }
function moveInfo(fen, u) { if (!u) return null; const c = new Chess(fen); return uciMove(c, u); }
function sanOf(fen, u) { const m = moveInfo(fen, u); return m ? m.san : ''; }
function pvSan(fen, pv, n = 6) { const c = new Chess(fen), out = []; for (const u of pv.slice(0, n)) { const m = uciMove(c, u); if (!m) break; out.push(m.san); } return out; }
const PN = t => CL.NAME[t];

// ---------- board view ----------
class BoardView {
  constructor() {
    this.el = h('div', { class: 'board-wrap' });
    this.grid = h('div', { class: 'board' });
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.setAttribute('viewBox', '0 0 800 800'); this.svg.setAttribute('class', 'arrows');
    this.el.append(this.grid, this.svg);
    this.fen = START_FEN; this.orient = 'w'; this.sel = null; this.interactive = false; this.movable = null;
    this.onMove = null; this.lastMove = null; this.arrows = []; this.marks = {};
    this.grid.addEventListener('pointerdown', e => this.down(e));
    this.grid.addEventListener('pointerup', e => this.up(e));
    this.render();
  }
  set(o) { Object.assign(this, o); if (!('sel' in o)) this.sel = null; this.render(); }
  sqAt(e) { const t = document.elementFromPoint(e.clientX, e.clientY); const b = t && t.closest && t.closest('.sq'); return b && this.grid.contains(b) ? b.dataset.sq : null; }
  legal(from) { const c = new Chess(this.fen); return c.moves({ square: from, verbose: true }); }
  canPick(sq) {
    if (!this.interactive) return false;
    const c = new Chess(this.fen), p = c.get(sq);
    return p && p.color === c.turn() && (!this.movable || this.movable === p.color);
  }
  down(e) {
    if (this.onTap) { const t = this.sqAt(e); if (t) this.onTap(t); return; }
    const sq = this.sqAt(e); if (!sq) return;
    if (!this.interactive) { this.onIdleTap && this.onIdleTap(sq); return; }
    this.downSq = sq;
    if (this.sel && this.sel !== sq && this.legal(this.sel).some(m => m.to === sq)) { this.tryMove(this.sel, sq); return; }
    if (this.canPick(sq)) { this.sel = this.sel === sq ? null : sq; this.render(); }
    else if (this.sel) { this.sel = null; this.render(); }
    else if (this.onBadTap) this.onBadTap(sq);
  }
  up(e) {
    const sq = this.sqAt(e);
    if (!sq || !this.sel || sq === this.downSq) return;
    if (this.legal(this.sel).some(m => m.to === sq)) this.tryMove(this.sel, sq);
  }
  tryMove(from, to) {
    const ms = this.legal(from).filter(m => m.to === to);
    if (!ms.length) return;
    this.sel = null;
    if (ms.some(m => m.promotion)) { this.askPromo(from, to, this.fen.split(' ')[1]); return; }
    this.render();
    this.onMove && this.onMove(from + to);
  }
  askPromo(from, to, color) {
    const ov = h('div', { class: 'promo' }, h('div', { class: 'opts' }, ['q', 'r', 'b', 'n'].map(p =>
      h('button', { 'aria-label': PN(p), onclick: () => { ov.remove(); this.render(); this.onMove && this.onMove(from + to + p); } }, pieceSvg(color + p)))));
    this.el.append(ov);
  }
  xy(sq) { let x = 'abcdefgh'.indexOf(sq[0]), y = 8 - +sq[1]; if (this.orient === 'b') { x = 7 - x; y = 7 - y; } return [x * 100 + 50, y * 100 + 50]; }
  render() {
    const c = new Chess(this.fen);
    const check = c.in_check() ? c.board().flat().find(p => p && p.type === 'k' && p.color === c.turn()) : null;
    let checkSq = null;
    if (check) { const b = c.board(); for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) { const p = b[r][f]; if (p && p.type === 'k' && p.color === c.turn()) checkSq = 'abcdefgh'[f] + (8 - r); } }
    const targets = this.sel ? this.legal(this.sel) : [];
    this.grid.replaceChildren();
    for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
      const file = this.orient === 'w' ? f : 7 - f, rank = this.orient === 'w' ? 7 - r : r;
      const sq = 'abcdefgh'[file] + (rank + 1);
      const light = (file + rank) % 2 === 1;
      const cls = ['sq', light ? 'l' : 'd'];
      if (this.lastMove && (this.lastMove.slice(0, 2) === sq || this.lastMove.slice(2, 4) === sq)) cls.push('last');
      if (this.sel === sq) cls.push('sel');
      if (checkSq === sq) cls.push('check');
      if (this.marks[sq]) cls.push(this.marks[sq]);
      const p = c.get(sq);
      const b = h('div', { class: cls.join(' '), 'data-sq': sq, 'aria-label': sq + (p ? ' ' + colorName(p.color) + ' ' + PN(p.type) : '') });
      if (r === 7) b.append(h('span', { class: 'co f' }, 'abcdefgh'[file]));
      if (f === 0) b.append(h('span', { class: 'co r' }, rank + 1));
      if (p) b.append(pieceSvg(p.color + p.type));
      const t = targets.find(m => m.to === sq);
      if (t) b.append(h('span', { class: p ? 'ring' : 'dot' }));
      this.grid.append(b);
    }
    // arrows
    const NS = 'http://www.w3.org/2000/svg';
    this.svg.replaceChildren();
    const colors = { good: '#2E9E57', bad: '#D2462C', warn: '#E09A1B', info: '#2F6FB5' };
    const defs = document.createElementNS(NS, 'defs');
    for (const [k, col] of Object.entries(colors)) {
      const m = document.createElementNS(NS, 'marker');
      m.setAttribute('id', 'ah-' + k); m.setAttribute('viewBox', '0 0 10 10'); m.setAttribute('refX', '5'); m.setAttribute('refY', '5');
      m.setAttribute('markerWidth', '3.2'); m.setAttribute('markerHeight', '3.2'); m.setAttribute('orient', 'auto-start-reverse');
      const p = document.createElementNS(NS, 'path'); p.setAttribute('d', 'M0,0 L10,5 L0,10 z'); p.setAttribute('fill', col); m.append(p); defs.append(m);
    }
    this.svg.append(defs);
    for (const a of this.arrows) {
      if (!a || !a.from) continue;
      const [x1, y1] = this.xy(a.from), [x2, y2] = this.xy(a.to);
      const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
      const l = document.createElementNS(NS, 'line');
      l.setAttribute('x1', x1); l.setAttribute('y1', y1); l.setAttribute('x2', x2 - dx / len * 32); l.setAttribute('y2', y2 - dy / len * 32);
      l.setAttribute('stroke', colors[a.color] || colors.info); l.setAttribute('stroke-width', '18'); l.setAttribute('stroke-linecap', 'round');
      l.setAttribute('opacity', '.82'); l.setAttribute('marker-end', 'url(#ah-' + (a.color || 'info') + ')');
      this.svg.append(l);
    }
  }
}
function pieceSvg(code) {
  const NS = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(NS, 'svg'); s.setAttribute('viewBox', '0 0 40 40'); s.setAttribute('class', 'pc'); s.setAttribute('aria-hidden', 'true');
  const u = document.createElementNS(NS, 'use'); u.setAttribute('href', '#pc-' + code); s.append(u); return s;
}
const arrowOf = (u, color) => (u ? { from: u.slice(0, 2), to: u.slice(2, 4), color } : null);

// ---------- PGN import ----------
function hashStr(s) { let h1 = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h1 ^= s.charCodeAt(i); h1 = Math.imul(h1, 16777619); } return (h1 >>> 0).toString(36); }
function parsePGNs(text) {
  text = text.replace(/\r/g, '').trim();
  if (!text) return { games: [], errors: 0 };
  const chunks = /\[Event /.test(text) ? text.split(/\n(?=\s*\[Event )/) : [text];
  const games = []; let errors = 0;
  for (let chunk of chunks) {
    chunk = chunk.trim(); if (!chunk) continue;
    const c = new Chess();
    let ok = c.load_pgn(chunk, { sloppy: true });
    if (!ok) { const cleaned = chunk.replace(/\{[^}]*\}/g, ' ').replace(/\$\d+/g, ' ').replace(/\d+\.\.\./g, ' '); ok = c.load_pgn(cleaned, { sloppy: true }); }
    if (!ok) { errors++; continue; }
    const hd = c.header(), hist = c.history({ verbose: true });
    if (hist.length < 2) { errors++; continue; }
    const fen0 = hd.FEN || START_FEN;
    const g = {
      id: 'g' + hashStr((hd.Link || '') + '|' + (hd.Date || '') + '|' + (hd.White || '') + '|' + (hd.Black || '') + '|' + hist.map(m => m.from + m.to).join('')),
      white: hd.White || 'White', black: hd.Black || 'Black', result: hd.Result || '*', date: (hd.Date || '').replace(/\./g, '-'),
      termination: hd.Termination || '', tc: hd.TimeControl || '', eco: hd.ECO || '',
      opening: openingName(hd), link: hd.Link || '', fen0,
      moves: hist.map(m => m.from + m.to + (m.promotion || '')), sans: hist.map(m => m.san),
      myColor: null, source: 'import', added: Date.now(), analysis: null, mistakes: null, summary: null,
    };
    games.push(g);
  }
  return { games, errors };
}
function openingName(hd) {
  if (hd.ECOUrl) { const s = hd.ECOUrl.split('/').pop(); if (s) return decodeURIComponent(s).replace(/-/g, ' ').replace(/\.{3}/g, '...').slice(0, 70); }
  if (hd.Opening) return hd.Opening;
  return '';
}
function assignColor(g) {
  const u = (S.settings.username || '').trim().toLowerCase();
  if (!u) return;
  if (g.white.toLowerCase() === u) g.myColor = 'w'; else if (g.black.toLowerCase() === u) g.myColor = 'b';
}
function outcomeOf(g) {
  if (!g.myColor) return null;
  if (g.result === '1/2-1/2') return 'd';
  if (g.result === '1-0') return g.myColor === 'w' ? 'w' : 'l';
  if (g.result === '0-1') return g.myColor === 'b' ? 'w' : 'l';
  return null;
}
function howEnded(g) {
  const t = (g.termination || '').toLowerCase();
  if (t.includes('checkmate')) return 'checkmate';
  if (t.includes('resign')) return 'resignation';
  if (t.includes('time')) return 'time';
  if (t.includes('abandon')) return 'abandoned';
  if (/stalemate|repetition|agreement|insufficient|50/.test(t)) return 'draw';
  const c = new Chess(g.fen0); g.moves.forEach(u => uciMove(c, u));
  if (c.in_checkmate()) return 'checkmate';
  return 'other';
}
const oppName = g => (g.myColor === 'w' ? g.black : g.myColor === 'b' ? g.white : g.white + ' vs ' + g.black);

// ---------- game analysis ----------
function gameFens(g) { const c = new Chess(g.fen0); const f = [c.fen()]; for (const u of g.moves) { uciMove(c, u); f.push(c.fen()); } return f; }
async function analyzeGame(g, onProg) {
  const fens = gameFens(g), ev = [];
  for (let i = 0; i < fens.length; i++) {
    const r = await evalPos(fens[i], ANALYSIS_DEPTH, true);
    ev.push([Math.round(r.cp), r.mate, r.best]);
    onProg && onProg((i + 1) / fens.length);
  }
  g.analysis = { depth: ANALYSIS_DEPTH, ev };
  finishAnalysis(g);
}
function finishAnalysis(g) {
  if (!g.analysis) return;
  const fens = gameFens(g);
  g.mistakes = g.myColor ? findMistakes(g, fens) : [];
  g.summary = summarize(g);
}
const evObj = a => ({ cp: a[0], mate: a[1], best: a[2] });
function findMistakes(g, fens) {
  const me = g.myColor, ev = g.analysis.ev.map(evObj), out = [], seenKeys = new Set();
  for (let i = 0; i < g.moves.length; i++) {
    if (fens[i].split(' ')[1] !== me) continue;
    const before = wpFor(ev[i], me), after = wpFor(ev[i + 1], me), drop = before - after;
    if (drop < 18 || before < 6) continue;
    if (after > 88 && !(ev[i].mate != null)) continue;
    const c = categorize(fens[i], fens[i + 1], g.moves[i], ev[i], ev[i + 1], me);
    if (!c) continue;
    if (c.sq) { const key = (c.cat === 'ignored' ? 'hung' : c.cat) + ':' + c.sq; if (seenKeys.has(key)) continue; seenKeys.add(key); }
    out.push({
      ply: i, uci: g.moves[i], san: g.sans[i], best: ev[i].best, bestSan: sanOf(fens[i], ev[i].best),
      reply: ev[i + 1].best, replySan: sanOf(fens[i + 1], ev[i + 1].best), drop: Math.round(drop),
      sev: drop >= 30 ? 'blunder' : 'mistake', cat: c.cat, piece: c.piece || null, text: c.text,
      phase: CL.phaseOf(CL.parseFen(fens[i]), i),
    });
  }
  return out;
}
function categorize(f0, f1, uci, e0, e1, me) {
  const b0 = CL.parseFen(f0), b1 = CL.parseFen(f1);
  const mv = moveInfo(f0, uci); if (!mv) return null;
  const san = mv.san, bestSan = sanOf(f0, e0.best), replySan = sanOf(f1, e1.best);
  const mateMine = e => e.mate != null && (me === 'w' ? e.mate > 0 : e.mate < 0);
  const mateTheirs = e => e.mate != null && !mateMine(e);
  if (mateMine(e0) && !mateMine(e1)) {
    const n = Math.abs(e0.mate);
    return { cat: 'missed_mate', text: n === 1 ? `${bestSan} was checkmate in one! Always look at every check you can give.` : `You had a forced checkmate in ${n}, starting with ${bestSan}.` };
  }
  if (mateTheirs(e1) && !mateTheirs(e0) && Math.abs(e1.mate) <= 4) {
    return { cat: 'allowed_mate', text: Math.abs(e1.mate) === 1 ? `After ${san}, they have checkmate with ${replySan}.` : `After ${san}, they can force checkmate, starting with ${replySan}.` };
  }
  const rep = e1.best ? moveInfo(f1, e1.best) : null;
  if (rep && rep.captured && CL.VAL[rep.captured] >= 3) {
    const sq = rep.to, name = PN(rep.captured);
    const isTrade = mv.captured && rep.to === mv.to && CL.VAL[mv.captured] >= CL.VAL[rep.captured];
    const evenSwap = CL.attackers(b1, sq, me).length > 0 && CL.VAL[rep.piece] >= CL.VAL[rep.captured];
    if (evenSwap && !isTrade) { /* they can take, but we take back: not a loose piece */ }
    if (!isTrade && !evenSwap) {
      if (mv.to === sq) {
        const hi = CL.hangingInfo(b1, sq);
        return { cat: 'hung', sq, piece: rep.captured, text: `You moved your ${name} to ${sq}, where they can take it with ${replySan}.` + (hi && hi.reason === 'undefended' ? ' Nothing defends it there.' : hi && hi.reason === 'cheaper' ? ' A cheaper piece attacks it there.' : '') };
      }
      const was = b0[sq] && b0[sq].color === me ? CL.hangingInfo(b0, sq) : null;
      if (was) return { cat: 'ignored', sq, piece: rep.captured, text: `Your ${name} on ${sq} was already under attack, and ${san} didn't save it. They can take it with ${replySan}.` };
      return { cat: 'hung', sq, piece: rep.captured, text: `After ${san}, your ${name} on ${sq} loses its protection. They can take it with ${replySan}.` };
    }
  }
  if (rep) {
    const c2 = new Chess(f1); uciMove(c2, e1.best);
    const b2 = CL.parseFen(c2.fen());
    const ft = CL.forkTargets(b2, rep.to).filter(t => b2[t].color === me);
    if (ft.length >= 2) {
      const names = ft.slice(0, 2).map(t => (b2[t].type === 'k' ? 'king' : PN(b2[t].type) + ' on ' + t));
      return { cat: 'fork', piece: b2[ft.find(t => b2[t].type !== 'k')] ? b2[ft.find(t => b2[t].type !== 'k')].type : null, text: `After ${san}, they have ${replySan}, which attacks your ${names[0]} and your ${names[1]} at the same time.` };
    }
  }
  const bm = e0.best ? moveInfo(f0, e0.best) : null;
  if (bm && bm.captured && CL.VAL[bm.captured] >= 3 && !(mv.to === bm.to && mv.captured)) {
    const hi = CL.hangingInfo(b0, bm.to);
    if (hi) return { cat: 'missed_free', sq: bm.to, text: `Their ${PN(bm.captured)} on ${bm.to} was ${hi.reason === 'undefended' ? 'undefended' : 'attacked by your cheaper piece'}. ${bestSan} would have won it.` };
  }
  if (rep && rep.captured) return { cat: 'other', text: `${san} let them win a pawn with ${replySan}. ${bestSan ? bestSan + ' was better.' : ''}` };
  return { cat: 'other', text: `${san} handed them the advantage. ${bestSan ? bestSan + ' was a stronger choice.' : ''}` };
}
function summarize(g) {
  const me = g.myColor; const s = { castled: null, earlyQueen: false, out: outcomeOf(g), how: howEnded(g), eval10: null };
  if (!me) return s;
  const fens = gameFens(g); let myMoves = 0;
  for (let i = 0; i < g.moves.length; i++) {
    if (fens[i].split(' ')[1] !== me) continue;
    myMoves++;
    if (s.castled == null && g.sans[i].startsWith('O-O')) s.castled = myMoves;
    const p = CL.parseFen(fens[i])[g.moves[i].slice(0, 2)];
    if (p && p.type === 'q' && myMoves <= 5) s.earlyQueen = true;
  }
  if (g.analysis && g.analysis.ev.length > 20) s.eval10 = Math.round(wpFor(evObj(g.analysis.ev[20]), me));
  return s;
}

// ---------- report ----------
function buildReport() {
  const gs = Object.values(S.games).filter(g => g.myColor && g.source !== 'bot');
  const done = gs.filter(g => g.analysis && g.mistakes);
  const r = { total: gs.length, analyzed: done.length, w: 0, l: 0, d: 0, cats: {}, pieces: {}, phases: { opening: 0, middlegame: 0, endgame: 0 }, how: {}, castledGames: 0, earlyQueen: 0, blunders: 0, mistakes: 0, openingBad: 0, openingGames: 0 };
  for (const g of gs) { const o = outcomeOf(g); if (o) r[o]++; }
  for (const g of done) {
    const s = g.summary || {};
    if (s.out === 'l') r.how[s.how] = (r.how[s.how] || 0) + 1;
    if (s.castled != null && s.castled <= 12) r.castledGames++;
    if (s.earlyQueen) r.earlyQueen++;
    if (s.eval10 != null) { r.openingGames++; if (s.eval10 < 35) r.openingBad++; }
    const seenCat = new Set();
    for (const m of g.mistakes) {
      if (m.sev === 'blunder') r.blunders++; else r.mistakes++;
      r.phases[m.phase] = (r.phases[m.phase] || 0) + 1;
      const c = r.cats[m.cat] || (r.cats[m.cat] = { n: 0, games: 0 });
      c.n++; if (!seenCat.has(m.cat)) { c.games++; seenCat.add(m.cat); }
      if (m.piece && (m.cat === 'hung' || m.cat === 'ignored' || m.cat === 'fork')) r.pieces[m.piece] = (r.pieces[m.piece] || 0) + 1;
    }
  }
  const ranked = Object.entries(r.cats).filter(([k]) => k !== 'other').sort((a, b) => b[1].n - a[1].n);
  r.weak = ranked.slice(0, 3).map(([k, v]) => ({ key: k, ...v }));
  if (r.analyzed >= 3 && r.castledGames / r.analyzed < 0.5) r.weak.push({ key: 'nocastle', n: r.analyzed - r.castledGames, games: r.analyzed - r.castledGames });
  if (r.analyzed >= 3 && r.earlyQueen / r.analyzed >= 0.4) r.weak.push({ key: 'earlyqueen', n: r.earlyQueen, games: r.earlyQueen });
  r.weak = r.weak.slice(0, 4);
  const topPiece = Object.entries(r.pieces).sort((a, b) => b[1] - a[1])[0];
  r.topPiece = topPiece ? topPiece[0] : null;
  return r;
}
const HABITS = {
  nocastle: { label: 'Not castling', theme: null, lesson: 'principles', advice: 'Your king stayed in the middle in most games. Castle within your first 10 moves so your king is safe and your rook joins in.' },
  earlyqueen: { label: 'Bringing the queen out early', theme: null, lesson: 'principles', advice: 'You moved your queen in the first 5 moves in a lot of games. It gets chased around while your opponent develops. Knights and bishops first.' },
};
function weakInfo(key) { return CATS[key] || HABITS[key]; }

// ---------- drills from your games ----------
function allDrillItems() {
  const items = [];
  const gs = Object.values(S.games).filter(g => g.mistakes && g.mistakes.length).sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.added - a.added);
  for (const g of gs) {
    const fens = gameFens(g);
    for (const m of g.mistakes) {
      if (!m.best) continue;
      items.push({ kind: 'mine', id: g.id + '-' + m.ply, fen: fens[m.ply], best: m.best, bestSan: m.bestSan, san: m.san, uci: m.uci, text: m.text, cat: m.cat, game: g, ply: m.ply, evBest: evObj(g.analysis.ev[m.ply]), lastMove: m.ply > 0 ? g.moves[m.ply - 1] : null });
    }
  }
  return items;
}
// ---------- game trainer: drills built from your own games ----------
function trainerPools() {
  const pools = { threat: [], calm: [], blunder: [], safe: [], punish: [] };
  const gs = Object.values(S.games).filter(g => g.analysis && g.myColor);
  for (const g of gs) {
    const me = g.myColor, fens = gameFens(g), ev = g.analysis.ev.map(evObj);
    for (let i = 1; i < g.moves.length; i++) {
      if (fens[i].split(' ')[1] !== me) continue;
      const c0 = new Chess(fens[i]);
      if (c0.in_check()) continue;
      const b = CL.parseFen(fens[i]);
      const base = { game: g, ply: i, fen: fens[i], me, lastMove: g.moves[i - 1], lastSan: g.sans[i - 1] };
      // Spot the threat
      const hang = CL.hangingPieces(b, me).filter(x => CL.VAL[x.piece.type] >= 3);
      if (hang.length) {
        const h0 = hang[0];
        const desc = hang.map(x => `your ${PN(x.piece.type)} on ${x.square} (${x.reason === 'undefended' ? 'attacked and not defended' : 'attacked by a cheaper ' + PN(b[x.by[0]].type)})`).join(', and ');
        pools.threat.push({ ...base, type: 'threat', answer: hang.map(x => x.square), attackers: hang.flatMap(x => x.by.slice(0, 1).map(a => a + x.square)),
          explain: `In danger: ${desc}. ` + (g.moves[i].slice(0, 2) === h0.square ? `In the game you moved it (${g.sans[i]}).` : `In the game you played ${g.sans[i]}.`) });
      } else if (i < 40) {
        pools.calm.push({ ...base, type: 'threat', answer: [], attackers: [], explain: `Nothing of yours could be taken for free here, so you were free to make your own plan.` });
      }
      // Safe or blunder
      const drop = wpFor(ev[i], me) - wpFor(ev[i + 1], me), w0 = wpFor(ev[i], me);
      const judge = { ...base, type: 'judge', move: g.moves[i], san: g.sans[i], reply: ev[i + 1].best };
      if (drop >= 20 && w0 > 8) {
        const m = (g.mistakes || []).find(x => x.ply === i);
        const txt = m ? m.text : ((categorize(fens[i], fens[i + 1], g.moves[i], ev[i], ev[i + 1], me) || {}).text || `${g.sans[i]} gives away a lot.`);
        pools.blunder.push({ ...judge, verdict: 'blunder', explain: `Blunder. ${txt}` + (ev[i].best ? ` Better was ${sanOf(fens[i], ev[i].best)}.` : '') });
      } else if (drop <= 3 && w0 > 10 && w0 < 90) {
        pools.safe.push({ ...judge, verdict: 'safe', explain: `Safe. ${g.sans[i]} doesn't give anything away. Good move.` });
      }
      // Punish their mistake
      const gain = wpFor(ev[i], me) - wpFor(ev[i - 1], me);
      const bm = ev[i].best ? moveInfo(fens[i], ev[i].best) : null;
      if (gain >= 20 && bm && (bm.captured || ev[i].mate != null) && w0 > 60) {
        const found = g.moves[i] === ev[i].best;
        const hi = bm.captured ? CL.hangingInfo(b, bm.to) : null;
        const why = ev[i].mate != null && ev[i].mate !== 0 && ((me === 'w') === (ev[i].mate > 0))
          ? `${bm.san} leads to checkmate.`
          : `${bm.san} takes their ${PN(bm.captured)}` + (hi ? (hi.reason === 'undefended' ? ', which nothing was defending.' : ' with a cheaper piece.') : ' and wins material.');
        pools.punish.push({ kind: 'mine', punish: true, id: 'pun-' + g.id + '-' + i, fen: fens[i], best: ev[i].best, bestSan: bm.san, san: g.sans[i], uci: g.moves[i],
          text: found ? 'You found it in the game.' : `In the game you played ${g.sans[i]} instead.`, cat: 'missed_free', game: g, ply: i, evBest: ev[i], lastMove: g.moves[i - 1],
          sub: `vs ${oppName(g)}: they just played ${g.sans[i - 1]}, a mistake. Punish it.`,
          doneText: why + (found ? ' You found this in the game too.' : ` In the game you played ${g.sans[i]} and let them off the hook.`) });
      }
    }
  }
  return pools;
}
function trainerCounts() { const p = trainerPools(); return { threat: p.threat.length, judge: p.blunder.length + p.safe.length, punish: p.punish.length, fix: allDrillItems().length }; }
function pick(arr, n) { return shuffle(arr.slice()).slice(0, n); }
function startGameTrainer(mode) {
  const p = trainerPools();
  let items = [];
  if (mode === 'threat') items = shuffle([...pick(p.threat, 8), ...pick(p.calm, 2)]);
  else if (mode === 'judge') items = shuffle([...pick(p.blunder, 5), ...pick(p.safe, 5)]);
  else if (mode === 'punish') items = pick(p.punish, 8);
  else {
    const fix = shuffle(dueDrills()).slice(0, 3);
    items = shuffle([...pick(p.threat, 3), ...pick(p.calm, 1), ...pick(p.blunder, 2), ...pick(p.safe, 2), ...pick(p.punish, 2), ...fix]);
  }
  if (!items.length) { toast('Import and analyze a few games first.'); return; }
  const titles = { threat: 'Spot the threat', judge: 'Safe or blunder?', punish: 'Punish their mistakes' };
  runPuzzleSession(items, { title: titles[mode] || 'Your game trainer' });
}
function mgAcc(k) { const m = S.mg[k]; return m && m.n ? Math.round(100 * m.ok / m.n) : null; }

function dueDrills() {
  const now = Date.now();
  return allDrillItems().filter(it => { const d = S.drills[it.id]; return !d || d.due <= now; });
}
function gradeDrill(id, ok) {
  const d = S.drills[id] || { box: 0, due: 0 };
  const DAYS = [0, 1, 3, 7, 14, 30, 60];
  if (ok) { d.box = Math.min(d.box + 1, 6); d.due = Date.now() + DAYS[d.box] * 864e5; }
  else { d.box = 0; d.due = Date.now() + 10 * 60e3; }
  S.drills[id] = d;
}

// ---------- puzzles ----------
function themeAcc(t) { const p = S.pstats[t]; if (!p || !p.n) return null; return Math.round(100 * p.ok / p.n); }
function pickPuzzles(theme, n) {
  let pool;
  if (theme === 'mix') {
    const rep = buildReport();
    const w = {}; Object.keys(THEMES).forEach(k => (w[k] = 1));
    w.save += 1; w.free += 1;
    rep.weak.forEach((x, i) => { const t = (weakInfo(x.key) || {}).theme; if (t) w[t] += 3 - i; });
    Object.keys(THEMES).forEach(k => { const a = themeAcc(k); if (a != null && a < 60) w[k] += 2; });
    pool = [];
    const by = {}; PUZZLES.forEach(p => (by[p.theme] = by[p.theme] || []).push(p));
    Object.values(by).forEach(shuffle);
    const tot = Object.values(w).reduce((a, b) => a + b, 0);
    for (let i = 0; i < n; i++) {
      let x = Math.random() * tot, t = 'save';
      for (const [k, v] of Object.entries(w)) { if ((x -= v) <= 0) { t = k; break; } }
      const list = (by[t] || []).sort((a, b) => (S.seen[a.id] || 0) - (S.seen[b.id] || 0));
      const pz = list.find(p => !pool.includes(p)); if (pz) pool.push(pz);
    }
    return shuffle(pool);
  }
  pool = PUZZLES.filter(p => p.theme === theme);
  shuffle(pool);
  pool.sort((a, b) => (S.seen[a.id] || 0) - (S.seen[b.id] || 0));
  return pool.slice(0, n);
}
function recordPuzzle(p, ok) {
  const s = S.pstats[p.theme] || (S.pstats[p.theme] = { n: 0, ok: 0 });
  s.n++; if (ok) s.ok++;
  S.seen[p.id] = Date.now();
  ensureDaily(); S.daily.puzzles++;
}

// ---------- app shell ----------
const ICONS = {
  london: '<circle cx="12" cy="6" r="2.6" fill="currentColor"/><circle cx="6.5" cy="15.5" r="2.6" fill="currentColor"/><circle cx="17.5" cy="15.5" r="2.6" fill="currentColor"/><path d="M12 8.6 7.8 13.4M12 8.6l4.2 4.8M9.1 15.5h5.8" stroke="currentColor" stroke-width="1.6"/>',
  coach: '<path d="M4 19V9m6 10V5m6 14v-7m4 7H2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  train: '<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/>',
  learn: '<path d="M3 6.5 12 3l9 3.5-9 3.5z M7 8.5V14c0 1.5 2.5 3 5 3s5-1.5 5-3V8.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  play: '<path d="M9 20h6m-7-3h8l-1-5 2-3-3-1-2-3-2 1-2 4 2 2z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  games: '<rect x="4" y="3" width="16" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 8h8M8 12h8M8 16h5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
};
const TABS = [['coach', 'Coach'], ['london', 'London'], ['train', 'Train'], ['learn', 'Learn'], ['play', 'Play'], ['games', 'Games']];
function svgIcon(k) { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true'); s.innerHTML = ICONS[k]; return s; }
function go(tab) { UI.tab = tab; UI.session = null; document.body.classList.remove('in-session'); rerender(); window.scrollTo(0, 0); }
function rerender() {
  const main = $('#main');
  if (UI.session) { return; }
  main.replaceChildren(({ coach: viewCoach, london: viewLondon, train: viewTrain, learn: viewLearn, play: viewPlay, games: viewGames })[UI.tab]());
  document.querySelectorAll('.tab').forEach(b => b.setAttribute('aria-current', b.dataset.tab === UI.tab ? 'page' : 'false'));
}
function openSession(el) { UI.session = el; document.body.classList.add('in-session'); $('#main').replaceChildren(el); window.scrollTo(0, 0); }
function closeSession() { UI.session = null; document.body.classList.remove('in-session'); rerender(); window.scrollTo(0, 0); }
function updateEngineBadge() { const b = $('#engine-badge'); if (b) b.textContent = engineLabel(); }
function engineLabel() { return { idle: 'Engine: sleeping', loading: 'Engine: loading…', ready: 'Engine: ready', failed: 'Engine: unavailable' }[Engine.status]; }
function sessTop(title, sub, onBack) {
  return h('div', { class: 'sess-top' },
    h('button', { class: 'back', 'aria-label': 'Back', onclick: onBack || closeSession }, h('span', { 'aria-hidden': 'true', style: 'font-size:20px;line-height:1' }, '‹')),
    h('div', { style: 'flex:1;min-width:0' }, h('h2', null, title), sub ? h('div', { class: 'small muted' }, sub) : null));
}

// ---------- COACH ----------
function nextLesson() { return LESSONS.find(l => !S.lessons[l.id]) || null; }
function viewCoach() {
  ensureDaily();
  const r = buildReport();
  const wrap = h('div', { class: 'stack' });
  wrap.append(h('div', { class: 'hero stack-s' },
    h('div', { class: 'eyebrow' }, 'Your coach'),
    h('h1', null, r.analyzed ? 'Here\'s why you\'re losing, and what to train.' : 'Let\'s find out why you\'re losing.')));

  const lastG = Object.values(S.games).filter(x => x.source !== 'bot' && x.myColor).sort((x, y) => (y.date || '').localeCompare(x.date || '') || (y.link || '').localeCompare(x.link || ''))[0];
  if (lastG) {
    const o = outcomeOf(lastG);
    wrap.append(h('div', { class: 'card stack-s' },
      h('div', { class: 'spread' }, h('h3', null, 'Your last game'), o ? h('span', { class: 'pill ' + (o === 'w' ? 'good' : o === 'l' ? 'bad' : '') }, { w: 'Win', l: 'Loss', d: 'Draw' }[o]) : null),
      h('p', { class: 'small muted' }, `vs ${oppName(lastG)} · ${lastG.date}`),
      h('button', { class: 'btn primary', onclick: () => openWalkthrough(lastG.id, 0) }, 'Walk me through it, move by move')));
  }
  if (!r.analyzed) {
    wrap.append(h('div', { class: 'card stack-s' },
      h('h3', null, 'Step 1: bring in your games'),
      h('p', { class: 'muted' }, `Import your chess.com games (username ${S.settings.username}). The engine checks every move you made and finds the mistakes that keep costing you games. More games means a sharper report. 10 to 20 is a good start.`),
      h('button', { class: 'btn primary', onclick: () => go('games') }, 'Import games')));
  } else {
    const tot = r.w + r.l + r.d;
    wrap.append(h('div', { class: 'stats' },
      h('div', { class: 'stat' }, h('b', null, tot), h('span', null, 'Games')),
      h('div', { class: 'stat' }, h('b', null, `${r.w}-${r.l}-${r.d}`), h('span', null, 'Won-Lost-Drawn')),
      h('div', { class: 'stat' }, h('b', null, (r.blunders / r.analyzed).toFixed(1)), h('span', null, 'Blunders per game'))));
    const wc = h('div', { class: 'card stack' }, h('div', { class: 'spread' }, h('h2', null, 'What\'s costing you games'), h('span', { class: 'pill' }, `${r.analyzed} analyzed`)));
    if (!r.weak.length) wc.append(h('p', { class: 'muted' }, 'No clear pattern yet. Import a few more games.'));
    const maxN = Math.max(1, ...r.weak.map(w => w.n));
    r.weak.forEach((w, i) => {
      const info = weakInfo(w.key);
      const ev = CATS[w.key] ? `${w.n} time${w.n === 1 ? '' : 's'} in ${w.games} of ${r.analyzed} games` : `${w.games} of ${r.analyzed} games`;
      const extra = (w.key === 'hung' || w.key === 'ignored') && r.topPiece ? ` Most often your ${PN(r.topPiece)}.` : '';
      wc.append(h('div', { class: 'weak' },
        h('div', { class: 'rank' }, i + 1),
        h('h3', null, info.label), h('span', { class: 'small muted', style: 'font-variant-numeric:tabular-nums' }, ev),
        h('div', { class: 'meter' }, h('i', { style: `width:${Math.round(100 * w.n / maxN)}%` })),
        h('div', { class: 'stack-s' }, h('p', { class: 'small' }, info.advice + extra),
          h('div', { class: 'row' },
            info.theme ? h('button', { class: 'btn', onclick: () => startPuzzles({ theme: info.theme, n: 8, title: THEMES[info.theme].name }) }, 'Train this') : null,
            info.lesson ? h('button', { class: 'btn ghost', onclick: () => openLesson(info.lesson) }, 'Lesson') : null))));
    });
    wrap.append(wc);

    const ph = r.phases, phMax = Math.max(1, ph.opening, ph.middlegame, ph.endgame);
    const lossTot = Object.values(r.how).reduce((a, b) => a + b, 0);
    wrap.append(h('div', { class: 'card stack' },
      h('h3', null, 'When your mistakes happen'),
      h('div', { class: 'bars' }, ['opening', 'middlegame', 'endgame'].map(k =>
        h('div', { class: 'bar-row' }, h('span', null, cap(k)), h('div', { class: 'track' }, h('i', { style: `width:${Math.round(100 * (ph[k] || 0) / phMax)}%` })), h('span', { class: 'n' }, ph[k] || 0)))),
      lossTot ? h('p', { class: 'small muted' }, 'How your losses ended: ' + Object.entries(r.how).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ') + '.') : null,
      h('p', { class: 'small muted' }, `You castled early in ${r.castledGames} of ${r.analyzed} games.` + (r.openingGames ? ` After move 10 you were worse in ${r.openingBad} of ${r.openingGames}.` : ''))));
  }

  // Today's plan
  const due = dueDrills().length, nl = nextLesson();
  const plan = h('div', { class: 'card' }, h('div', { class: 'spread', style: 'margin-bottom:6px' }, h('h2', null, 'Today\'s 15 minutes'), h('span', { class: 'small muted' }, new Date().toLocaleDateString(undefined, { weekday: 'long' }))));
  const item = (done, title, sub, btn) => h('div', { class: 'plan-item' }, h('div', { class: 'tick' + (done ? ' done' : '') }, done ? '✓' : ''), h('div', null, h('b', null, title), h('div', { class: 'small muted' }, sub)), btn);
  if (r.analyzed) plan.append(item(!!S.daily.trainer, 'Game trainer: 15 positions from your games', 'Spot threats, judge your moves, punish their blunders', h('button', { class: 'btn', onclick: () => { ensureDaily(); S.daily.trainer = 1; Store.saveProfile(); startGameTrainer('mix'); } }, 'Go')));
  plan.append(item(S.daily.puzzles >= 10, 'Puzzle mix, aimed at your weak spots', `${Math.min(S.daily.puzzles, 10)}/10 solved today`, h('button', { class: 'btn', onclick: () => startPuzzles({ theme: 'mix', n: 10, title: 'Daily mix' }) }, 'Go')));
  if (nl) plan.append(item(S.daily.lesson > 0, 'Lesson: ' + nl.title, `${nl.mins} min`, h('button', { class: 'btn', onclick: () => openLesson(nl.id) }, 'Go')));
  plan.append(item(!!S.daily.played, 'Play one game with Blunder Check', 'It stops you before you hang a piece', h('button', { class: 'btn', onclick: () => go('play') }, 'Go')));
  wrap.append(plan);

  const accs = Object.keys(THEMES).map(k => [k, themeAcc(k), (S.pstats[k] || {}).n || 0]).filter(x => x[1] != null);
  if (accs.length) wrap.append(h('div', { class: 'card stack' }, h('h3', null, 'Puzzle accuracy'),
    h('div', { class: 'bars' }, accs.map(([k, a, n]) => h('div', { class: 'bar-row' }, h('span', null, THEMES[k].name), h('div', { class: 'track' }, h('i', { style: `width:${a}%;background:${a >= 70 ? 'var(--good)' : a >= 45 ? 'var(--warn)' : 'var(--bad)'}` })), h('span', { class: 'n' }, a + '%'))))));
  return wrap;
}

// ---------- TRAIN ----------
function viewTrain() {
  const wrap = h('div', { class: 'stack' });
  wrap.append(h('div', { class: 'hero stack-s' }, h('div', { class: 'eyebrow' }, 'Train'), h('h1', null, 'Practice the positions you get wrong.')));
  const tc = trainerCounts(), ng = Object.values(S.games).filter(g => g.analysis && g.myColor).length;
  const mode = (k, name, desc, n) => h('button', { class: 'theme-btn', disabled: !n, onclick: () => startGameTrainer(k) },
    h('b', null, name), h('span', { class: 'small muted' }, desc), h('span', { class: 'small' }, mgAcc(k) == null ? `${n} positions` : `${mgAcc(k)}% right · ${n} positions`));
  wrap.append(h('div', { class: 'card stack' },
    h('div', { class: 'spread' }, h('h2', null, 'Your game trainer'), h('span', { class: 'pill acc' }, `${ng} games`)),
    h('p', { class: 'muted small' }, ng ? 'Every position here comes from a game you played. It trains the exact habits your games show you need.' : 'Import your games and every drill here gets built from positions you actually played.'),
    h('button', { class: 'btn primary', disabled: !ng, onclick: () => startGameTrainer('mix') }, 'Start today\'s session (15 positions)'),
    h('div', { class: 'theme-grid' },
      mode('threat', 'Spot the threat', 'They just moved. What of yours is in danger?', tc.threat),
      mode('judge', 'Safe or blunder?', 'Judge your own move before you play it.', tc.judge),
      mode('punish', 'Punish mistakes', 'Your opponent blundered. Take what they gave you.', tc.punish),
      h('button', { class: 'theme-btn', disabled: !tc.fix, onclick: startDrills }, h('b', null, 'Fix your mistakes'), h('span', { class: 'small muted' }, 'Find the move you should have played.'), h('span', { class: 'small' }, `${dueDrills().length} due · ${tc.fix} total`)))));
  wrap.append(h('div', { class: 'card stack-s' },
    h('h2', null, 'Daily mix'),
    h('p', { class: 'muted small' }, 'Ten puzzles weighted toward your weakest themes. The theme is hidden, like in a real game.'),
    h('button', { class: 'btn primary', onclick: () => startPuzzles({ theme: 'mix', n: 10, title: 'Daily mix' }) }, 'Start 10 puzzles')));
  const grid = h('div', { class: 'theme-grid' });
  for (const [k, t] of Object.entries(THEMES)) {
    const a = themeAcc(k), cnt = PUZZLES.filter(p => p.theme === k).length;
    if (!cnt) continue;
    grid.append(h('button', { class: 'theme-btn', onclick: () => startPuzzles({ theme: k, n: 8, title: t.name }) },
      h('b', null, t.name), h('span', { class: 'small muted' }, a == null ? `${cnt} puzzles` : `${a}% of ${S.pstats[k].n} solved`),
      h('div', { class: 'meter good' }, h('i', { style: `width:${a || 0}%` }))));
  }
  wrap.append(h('div', { class: 'stack-s' }, h('h3', null, 'Pick a theme'), grid));
  return wrap;
}
function startDrills() {
  const items = shuffle(dueDrills().slice(0, 12)).slice(0, 8);
  if (!items.length) { toast('No mistakes due right now.'); return; }
  runPuzzleSession(items, { title: 'Your mistakes', mine: true });
}
function startPuzzles({ theme, n, title, onDone }) {
  const items = pickPuzzles(theme, n);
  if (!items.length) { toast('No puzzles for that theme yet.'); return; }
  runPuzzleSession(items.map(p => ({ kind: 'puz', ...p })), { title, hideTheme: theme === 'mix', onDone });
}

function positionHint(fen, u, it) {
  const b = CL.parseFen(fen), me = fen.split(' ')[1], opp = me === 'w' ? 'b' : 'w';
  const mv = moveInfo(fen, u);
  const theirLoose = CL.hangingPieces(b, opp).filter(x => CL.VAL[x.piece.type] >= 3);
  const mineLoose = CL.hangingPieces(b, me).filter(x => CL.VAL[x.piece.type] >= 3);
  if (it.kind === 'puz' && (it.theme === 'mate1' || it.theme === 'mate2')) return mv.san.includes('+') || mv.san.includes('#') ? 'Look at every check you can give. One of them leaves the king nowhere to go.' : 'Look for a move that takes away the king\'s last escape squares.';
  if (it.kind === 'puz' && it.theme === 'stopmate') return 'They are threatening checkmate next move. Find the square they want to mate on, and cover it or get your king out.';
  if (mv.captured && theirLoose.some(x => x.square === mv.to)) { const x = theirLoose.find(y => y.square === mv.to); return `Their ${PN(x.piece.type)} on ${x.square} is ${x.reason === 'undefended' ? 'not protected by anything' : 'attackable by one of your cheaper pieces'}.`; }
  if (mineLoose.some(x => x.square === mv.from)) { const x = mineLoose.find(y => y.square === mv.from); return `Your ${PN(x.piece.type)} on ${x.square} is in danger${x.reason === 'undefended' ? ': it is attacked and nothing defends it' : ': a cheaper piece is attacking it'}. Find it a safe square.`; }
  if (mineLoose.length) return `Your ${PN(mineLoose[0].piece.type)} on ${mineLoose[0].square} is in danger. Save it, or find something even bigger.`;
  if (mv.san.includes('+')) return 'Start by looking at every check you can give.';
  if (mv.captured) return 'Look at every capture you can make. One of them wins material.';
  const c = new Chess(fen); uciMove(c, u); const after = CL.parseFen(c.fen()); const ft = CL.forkTargets(after, mv.to);
  if (ft.length >= 2) return 'Look for a move that attacks two of their pieces at the same time.';
  return 'Ask: what is attacked, and what is undefended? Then look for the move that makes a threat.';
}
function runPuzzleSession(items, opt) {
  let idx = 0, score = 0, retrying = false;
  const missed = [];
  const board = new BoardView();
  board.onIdleTap = () => { if (st && st.busy) toast('Checking your move…'); else if (st && st.solved) { btns.scrollIntoView({ behavior: 'smooth', block: 'end' }); btns.classList.remove('pulse'); void btns.offsetWidth; btns.classList.add('pulse'); } };
  board.onBadTap = sq => { const p = new Chess(board.fen).get(sq); toast(p ? 'That\'s their piece. Tap one of yours, then tap where it should go.' : 'Tap one of your pieces first, then tap where it should go.'); };
  const counter = h('span', { class: 'pill' });
  const bar = h('div', { class: 'progress' }, h('i', { style: 'width:0%' }));
  const prompt = h('div', { class: 'prompt' });
  const sub = h('div', { class: 'small muted' });
  const fb = h('div');
  const btns = h('div', { class: 'row actions' });
  const el = h('div', { class: 'stack' }, sessTop(opt.title, null), h('div', { class: 'spread' }, bar, counter), board.el, h('div', { class: 'stack-s' }, prompt, sub), fb, btns);
  bar.style.flex = '1';
  openSession(el);
  Engine.boot().catch(() => {});

  let st;
  function load() {
    const it = items[idx]; window.__lastItem = it;
    board.sel = null;
    if (it.type === 'threat' || it.type === 'judge') return loadQuiz(it);
    const c = new Chess(it.fen), me = c.turn();
    st = { it, me, step: 0, tries: 0, first: true, solved: false, line: it.kind === 'puz' ? it.moves.slice() : [it.best], fen: it.fen };
    counter.textContent = `${idx + 1} / ${items.length}`;
    bar.firstChild.style.width = `${100 * idx / items.length}%`;
    prompt.textContent = `${colorName(me)} to move.`;
    if (it.sub) sub.textContent = it.sub;
    else if (it.kind === 'mine') sub.textContent = `From your game vs ${oppName(it.game)}. You played ${it.san} here. Find something better.`;
    else sub.textContent = opt.hideTheme ? 'Find the best move.' : THEMES[it.theme].prompt;
    fb.replaceChildren(); btns.replaceChildren(
      h('button', { class: 'btn ghost', onclick: hint }, 'Hint'),
      h('button', { class: 'btn ghost', onclick: () => reveal(true) }, 'Show answer'));
    board.set({ fen: it.fen, orient: me, interactive: true, movable: me, lastMove: it.lastMove || null, arrows: [], marks: {}, onMove: onMove, onTap: null });
  }
  function loadQuiz(it) {
    const me = it.me;
    st = { it, me, first: true, solved: false };
    counter.textContent = `${idx + 1} / ${items.length}`;
    bar.firstChild.style.width = `${100 * idx / items.length}%`;
    fb.replaceChildren();
    if (it.type === 'threat') {
      prompt.textContent = `They just played ${it.lastSan}. What's in danger?`;
      sub.textContent = `From your game vs ${oppName(it.game)}. Tap your piece that could be lost. If nothing is in danger, tap the button.`;
      btns.replaceChildren(h('button', { class: 'btn', onclick: () => answerThreat(null) }, 'Nothing is in danger'));
      board.set({ fen: it.fen, orient: me, interactive: false, lastMove: it.lastMove, arrows: [], marks: {}, onMove: null, onTap: sq => answerThreat(sq) });
    } else {
      prompt.textContent = `You're about to play ${it.san}.`;
      sub.textContent = `From your game vs ${oppName(it.game)}. Blunder Check: is this move safe?`;
      btns.replaceChildren(
        h('button', { class: 'btn', onclick: () => answerJudge('safe') }, 'Safe'),
        h('button', { class: 'btn', onclick: () => answerJudge('blunder') }, 'Blunder'));
      board.set({ fen: it.fen, orient: me, interactive: false, lastMove: it.lastMove, arrows: [arrowOf(it.move, 'info')], marks: {}, onMove: null, onTap: null });
    }
  }
  function answerThreat(sq) {
    if (st.solved) return;
    const it = st.it;
    if (sq && !it.answer.includes(sq)) {
      const p = new Chess(it.fen).get(sq);
      if (!p || p.color !== st.me) { toast(p ? 'That\'s their piece. Tap one of YOUR pieces that could be taken.' : 'Tap one of your pieces, or "Nothing is in danger".'); return; }
    }
    const ok = it.answer.length ? !!sq && it.answer.includes(sq) : sq === null;
    const marks = {}; it.answer.forEach(a => (marks[a] = 'bad'));
    if (sq && !ok) marks[sq] = 'sel';
    board.set({ marks, onTap: null, arrows: it.attackers.map(a => arrowOf(a, 'warn')) });
    finishQuiz(ok, it.explain);
  }
  function answerJudge(choice) {
    if (st.solved) return;
    const it = st.it, ok = choice === it.verdict;
    if (it.verdict === 'blunder' && it.reply) board.set({ arrows: [arrowOf(it.move, 'bad'), arrowOf(it.reply, 'warn')] });
    else board.set({ arrows: [arrowOf(it.move, 'good')] });
    finishQuiz(ok, it.explain);
  }
  function finishQuiz(ok, text) {
    st.solved = true;
    if (!retrying) {
      if (ok) score++; else missed.push(st.it);
      const t = st.it.type, m = S.mg[t] || (S.mg[t] = { n: 0, ok: 0 });
      m.n++; if (ok) m.ok++;
      ensureDaily(); S.daily.puzzles++; Store.saveProfile();
    }
    fb.replaceChildren(h('div', { class: 'feedback ' + (ok ? 'good' : 'bad') }, h('h3', null, ok ? 'Correct!' : 'Not quite'), h('p', { class: 'small' }, text)));
    nextBtns();
  }
  function goNext() { retrying = false; if (idx === items.length - 1) done(); else { idx++; load(); } }
  function nextBtns() {
    const last = idx === items.length - 1;
    btns.replaceChildren(
      h('button', { class: 'btn', onclick: () => { retrying = true; load(); } }, 'Try again'),
      h('button', { class: 'btn primary', style: 'flex:1', onclick: goNext }, last ? 'Finish' : 'Next'));
  }
  function hint() {
    const it = st.it, u = st.line[st.step];
    st.first = false;
    st.hintLevel = (st.hintLevel || 0) + 1;
    const mv = moveInfo(st.fen, u);
    let text;
    if (st.hintLevel === 1) text = positionHint(st.fen, u, it);
    else if (st.hintLevel === 2) { board.set({ marks: { [u.slice(0, 2)]: 'good' } }); text = `Move your ${PN(mv.piece)} on ${mv.from} (highlighted in green). Where can it go that hurts them most?`; }
    else { reveal(true); return; }
    fb.replaceChildren(h('div', { class: 'feedback' }, h('div', { class: 'eyebrow' }, `Hint ${st.hintLevel} of 3`), h('p', { class: 'small' }, text)));
  }
  function reveal(give) {
    if (give) st.first = false;
    const it = st.it, u = st.line[st.step], san = sanOf(st.fen, u);
    board.set({ arrows: [arrowOf(u, 'good')], marks: {} });
    if (!give) return;
    st.revealed = true; st.hintLevel = 3;
    let why = '';
    if (it.kind === 'puz') why = it.explain;
    else if (it.doneText) why = it.doneText;
    else why = `In the game you played ${it.san}. ${it.text}`;
    fb.replaceChildren(h('div', { class: 'feedback warn' }, h('div', { class: 'eyebrow' }, 'Answer'), h('h3', null, san), h('p', { class: 'small' }, why), h('p', { class: 'small muted' }, `Play ${san} on the board (follow the green arrow) to finish this one.`)));
  }
  async function onMove(u) {
    if (st.solved || st.busy) return;
    const it = st.it, exp = st.line[st.step];
    const c = new Chess(st.fen); const mv = uciMove(c, u);
    let ok = u === exp || (u.length === 4 && exp.startsWith(u) && exp[4] === 'q');
    if (!ok && it.kind === 'puz' && st.step === 0 && it.alts && it.alts.includes(u)) ok = true;
    if (!ok && it.kind === 'puz' && st.step === 2 && it.theme === 'mate2' && c.in_checkmate()) ok = true;
    let alsoGood = false;
    if (!ok && it.kind === 'mine' && u !== it.uci) {
      st.busy = true; board.set({ fen: c.fen(), lastMove: u, interactive: false });
      fb.replaceChildren(h('div', { class: 'feedback' }, h('p', null, 'Checking your move…')));
      try {
        const r = await evalPos(c.fen(), 11);
        if (wpFor(it.evBest, st.me) - wpFor(r, st.me) < 7) { ok = true; alsoGood = true; }
      } catch (e) {}
      st.busy = false;
    }
    if (!ok) {
      st.tries++; st.first = false;
      board.set({ fen: st.fen, lastMove: it.lastMove || null, interactive: true, arrows: [] });
      const why = it.punish && u === it.uci ? 'That\'s what you played in the game. Look for something that wins material.' : it.kind === 'mine' && u === it.uci ? 'That\'s the move you played in the game. ' + it.text : 'Not this one. Look again: what is attacked, and what is undefended?';
      fb.replaceChildren(h('div', { class: 'feedback bad' }, h('h3', null, 'Try again'), h('p', { class: 'small' }, why)));
      if (st.tries >= 2) reveal(false);
      return;
    }
    st.fen = c.fen(); st.step++;
    board.set({ fen: st.fen, lastMove: u, interactive: false, arrows: [], marks: {} });
    if (st.step < st.line.length && !alsoGood) {
      fb.replaceChildren(h('div', { class: 'feedback good' }, h('p', null, 'Good. Keep going.')));
      await new Promise(r => setTimeout(r, 550));
      const rep = st.line[st.step]; const c2 = new Chess(st.fen); uciMove(c2, rep);
      st.fen = c2.fen(); st.step++;
      board.set({ fen: st.fen, lastMove: rep, interactive: true, movable: st.me });
      return;
    }
    finish(alsoGood);
  }
  function finish(alsoGood) {
    st.solved = true;
    const it = st.it, ok = st.first;
    if (!retrying) {
      if (ok) score++; else missed.push(it);
      if (it.kind === 'puz') recordPuzzle(it, ok);
      else { gradeDrill(it.id, ok); ensureDaily(); S.daily.drills++; }
      if (it.punish) { const m = S.mg.punish || (S.mg.punish = { n: 0, ok: 0 }); m.n++; if (ok) m.ok++; }
      Store.saveProfile();
    }
    const expl = it.kind === 'puz' ? it.explain : it.doneText ? (alsoGood ? `Your move works too. The engine's top choice was ${it.bestSan}. ` : '') + it.doneText : `${alsoGood ? 'The engine\'s top choice was ' + it.bestSan + ', but your move works too.' : it.bestSan + ' is the move.'} In the game you played ${it.san}: ${it.text}`;
    fb.replaceChildren(h('div', { class: 'feedback ' + (ok ? 'good' : 'warn') }, h('h3', null, ok ? (alsoGood ? 'Also good!' : 'Correct!') : 'Solved, with help'), h('p', { class: 'small' }, expl)));
    nextBtns();
    if (it.kind === 'mine') btns.prepend(h('button', { class: 'btn', onclick: () => openReview(it.game.id, it.ply, () => { closeSession(); }) }, 'See game'));
  }
  function done() {
    bar.firstChild.style.width = '100%';
    opt.onDone && opt.onDone(score, items.length);
    const el2 = h('div', { class: 'stack' }, sessTop(opt.title, null),
      h('div', { class: 'card stack-s', style: 'text-align:center' },
        h('div', { class: 'eyebrow' }, 'Session done'),
        h('h1', null, `${score} / ${items.length}`),
        h('p', { class: 'muted' }, score === items.length ? 'Perfect. Every one on the first try.' : score >= items.length * 0.7 ? 'Solid. The ones you missed will come back for review.' : 'These are hard at first. Repetition is how the patterns stick.')),
      missed.length ? h('button', { class: 'btn primary block', onclick: () => runPuzzleSession(missed.slice(), { ...opt, title: opt.title + ': the ones you missed' }) }, `Redo the ${missed.length} you missed`) : null,
      h('button', { class: 'btn block', onclick: () => runPuzzleSession(items.slice(), opt) }, 'Do this whole set again'),
      h('button', { class: missed.length ? 'btn ghost block' : 'btn primary block', onclick: closeSession }, 'Done'));
    openSession(el2);
  }
  load();
}

// ---------- LEARN ----------
function viewLearn() {
  const wrap = h('div', { class: 'stack' });
  wrap.append(h('div', { class: 'hero stack-s' }, h('div', { class: 'eyebrow' }, 'Learn'), h('h1', null, 'A path from zero, in the order that wins games.')));
  const nl = nextLesson();
  const list = h('div', { class: 'card list' });
  LESSONS.forEach((l, i) => list.append(h('button', { class: 'lesson' + (S.lessons[l.id] ? ' done' : nl && nl.id === l.id ? ' next' : ''), onclick: () => openLesson(l.id) },
    h('span', { class: 'num' }, S.lessons[l.id] ? '✓' : i + 1), h('span', null, h('b', null, l.title), h('div', { class: 'small muted' }, `${l.mins} min · ${l.practice.label}`)), h('span', { class: 'muted', 'aria-hidden': 'true' }, '›'))));
  wrap.append(h('div', { class: 'stack-s' }, h('div', { class: 'spread' }, h('h2', null, 'Lessons'), h('span', { class: 'small muted' }, `${Object.keys(S.lessons).filter(k => S.lessons[k]).length} of ${LESSONS.length} done`)), list));
  const op = h('div', { class: 'stack-s' }, h('h2', null, 'Your openings'), h('p', { class: 'small muted' }, 'One plan as White, one answer to each first move as Black. You play your moves, the trainer plays theirs and explains every move.'));
  for (const [k, set] of Object.entries(OPENINGS)) {
    const c = h('div', { class: 'card stack-s' }, h('div', { class: 'spread' }, h('h3', null, set.title), h('span', { class: 'pill acc' }, 'You play ' + colorName(set.side))), h('p', { class: 'small muted' }, set.blurb));
    const l = h('div', { class: 'list' });
    set.lines.forEach((ln, i) => { const d = S.openings[k + i] || 0; l.append(h('button', { class: 'li', onclick: () => openOpening(k, i) }, h('span', { class: 'pill ' + (d ? 'good' : '') }, d ? `✓ ${d}` : 'New'), h('span', null, ln.name), h('span', { class: 'muted', 'aria-hidden': 'true' }, '›'))); });
    c.append(l); op.append(c);
  }
  wrap.append(op);
  return wrap;
}
function openLesson(id) {
  const l = LESSONS.find(x => x.id === id); if (!l) return;
  ensureDaily();
  const markDone = () => { if (!S.lessons[id]) { S.lessons[id] = true; S.daily.lesson++; Store.saveProfile(); } };
  const pr = l.practice;
  const startPractice = () => {
    if (pr.kind === 'puzzles') startPuzzles({ theme: pr.theme, n: pr.n, title: l.title, onDone: markDone });
    else if (pr.kind === 'opening') { markDone(); openOpening(pr.set, pr.line < 0 ? 0 : pr.line, pr.line < 0); }
    else if (pr.kind === 'play') { markDone(); UI.session = null; UI.tab = 'play'; Play.reset(pr.fen ? { fen: pr.fen, color: 'w', level: 4 } : { check: true }); rerender(); }
  };
  const el = h('div', { class: 'stack' }, sessTop(l.title, `${l.mins} min lesson`),
    h('div', { class: 'card stack' }, l.cards.map(t => h('p', null, t))),
    h('button', { class: 'btn primary block', onclick: startPractice }, pr.label),
    h('button', { class: 'btn ghost block', onclick: () => { markDone(); closeSession(); } }, S.lessons[id] ? 'Done' : 'Mark as done'));
  openSession(el);
}

// ---------- opening trainer ----------
function openOpening(setKey, lineIdx, cycle) {
  const set = OPENINGS[setKey];
  let li = lineIdx;
  const board = new BoardView();
  const title = h('h2'); const sub = h('div', { class: 'small muted' });
  const say = h('div'); const btns = h('div', { class: 'row' });
  const top = sessTop(set.title, null);
  const el = h('div', { class: 'stack' }, top, h('div', { class: 'stack-s' }, title, sub), board.el, say, btns);
  openSession(el);
  let st;
  function start() {
    const line = set.lines[li];
    title.textContent = line.name;
    st = { c: new Chess(), i: 0, wrong: 0, line };
    sub.textContent = `You play ${colorName(set.side)}. ${line.moves.length} moves.`;
    say.replaceChildren(); btns.replaceChildren();
    board.set({ fen: st.c.fen(), orient: set.side, interactive: false, movable: set.side, lastMove: null, arrows: [], onMove });
    step();
  }
  function expectedUci() { const t = new Chess(st.c.fen()); const m = t.move(st.line.moves[st.i][0]); return m.from + m.to + (m.promotion || ''); }
  function step() {
    if (st.i >= st.line.moves.length) return complete();
    const turn = st.c.turn();
    if (turn !== set.side) {
      board.set({ interactive: false });
      setTimeout(() => {
        const [san, txt] = st.line.moves[st.i];
        const m = st.c.move(san); st.i++;
        board.set({ fen: st.c.fen(), lastMove: m.from + m.to, arrows: [] });
        say.replaceChildren(h('div', { class: 'feedback' }, h('div', { class: 'eyebrow' }, 'They play ' + san), h('p', null, txt)));
        step();
      }, st.i === 0 ? 300 : 700);
    } else {
      board.set({ interactive: true });
      btns.replaceChildren(h('button', { class: 'btn ghost', onclick: () => { board.set({ arrows: [arrowOf(expectedUci(), 'good')] }); } }, 'Show me'));
      if (st.i === 0) say.replaceChildren(h('div', { class: 'feedback' }, h('p', null, 'Your move. Start by taking the center.')));
    }
  }
  function onMove(u) {
    const exp = expectedUci();
    if (u !== exp && !(u.length === 4 && exp.startsWith(u))) {
      st.wrong++;
      const [, txt] = st.line.moves[st.i];
      const t = new Chess(st.c.fen()); const m = uciMove(t, u);
      say.replaceChildren(h('div', { class: 'feedback bad' }, h('h3', null, m ? `${m.san} isn't the move in this line` : 'Not this one'), h('p', { class: 'small' }, 'Hint: ' + txt)));
      board.set({ fen: st.c.fen(), interactive: true });
      if (st.wrong >= 2) board.set({ arrows: [arrowOf(exp, 'good')] });
      return;
    }
    const [san, txt] = st.line.moves[st.i];
    const m = st.c.move(san); st.i++; st.wrong = 0;
    board.set({ fen: st.c.fen(), lastMove: m.from + m.to, arrows: [], interactive: false });
    say.replaceChildren(h('div', { class: 'feedback good' }, h('div', { class: 'eyebrow' }, 'You play ' + san), h('p', null, txt)));
    btns.replaceChildren();
    step();
  }
  function complete() {
    const k = setKey + li; S.openings[k] = (S.openings[k] || 0) + 1; Store.saveProfile();
    const hasNext = li + 1 < set.lines.length;
    say.append(h('div', { class: 'feedback good', style: 'margin-top:10px' }, h('h3', null, 'Line complete'), h('p', { class: 'small' }, 'Repeat each line a few times on different days until you can play it without thinking.')));
    btns.replaceChildren(
      h('button', { class: 'btn', onclick: start }, 'Repeat'),
      hasNext ? h('button', { class: 'btn primary', onclick: () => { li++; start(); } }, 'Next line') : h('button', { class: 'btn primary', onclick: closeSession }, 'Done'));
  }
  start();
}

// ---------- PLAY ----------
const LEVELS = [
  { name: 'Beginner', skill: 0, depth: 1, rand: 0.3 },
  { name: 'Friend', skill: 2, depth: 3, rand: 0.12 },
  { name: 'Club', skill: 6, depth: 6, rand: 0.03 },
  { name: 'Strong', skill: 12, depth: 9, rand: 0 },
  { name: 'Full', skill: 20, depth: 12, rand: 0 },
];
const Play = {
  g: null, board: null, el: null, statusEl: null, panel: null, pending: null, evBefore: null,
  reset(o = {}) {
    const color = o.color || (S.settings.color === 'r' ? (Math.random() < 0.5 ? 'w' : 'b') : S.settings.color || 'w');
    const fen0 = o.fen || START_FEN;
    this.g = { c: new Chess(fen0), fen0, me: color, level: o.level != null ? o.level : S.settings.level, over: false, caught: 0, started: false, custom: !!o.fen };
    if (o.check) S.settings.blunderCheck = true;
    this.pending = null; this.evBefore = null;
  },
  view() {
    if (!this.g) this.reset();
    const g = this.g;
    this.board = new BoardView();
    this.statusEl = h('div', { class: 'small muted' });
    this.panel = h('div');
    const lvl = h('div', { class: 'seg', role: 'group', 'aria-label': 'Bot level' }, LEVELS.map((l, i) => h('button', { 'aria-pressed': String(S.settings.level === i), onclick: () => { S.settings.level = i; Store.saveProfile(); if (!g.started || g.over) { this.reset(); } else g.level = i; rerender(); } }, l.name)));
    const col = h('div', { class: 'seg', role: 'group', 'aria-label': 'Your color' }, [['w', 'White'], ['b', 'Black'], ['r', 'Random']].map(([k, n]) => h('button', { 'aria-pressed': String((S.settings.color || 'w') === k), onclick: () => { S.settings.color = k; Store.saveProfile(); if (!g.started || g.over) this.reset(); rerender(); } }, n)));
    const sw = h('button', { class: 'switch', role: 'switch', 'aria-checked': String(!!S.settings.blunderCheck), 'aria-label': 'Blunder Check', onclick: () => { S.settings.blunderCheck = !S.settings.blunderCheck; sw.setAttribute('aria-checked', String(S.settings.blunderCheck)); Store.saveProfile(); } });
    const ctrl = h('div', { class: 'ctrl' },
      h('button', { class: 'btn', onclick: () => this.hint() }, 'Hint'),
      h('button', { class: 'btn', onclick: () => this.takeback() }, 'Undo'),
      h('button', { class: 'btn', onclick: () => this.flip() }, 'Flip'),
      h('button', { class: 'btn', onclick: () => { this.reset(g.custom ? { fen: g.fen0, color: g.me, level: g.level } : {}); rerender(); } }, 'New'));
    this.el = h('div', { class: 'stack' },
      h('div', { class: 'hero stack-s' }, h('div', { class: 'eyebrow' }, 'Play'), h('h1', null, g.custom ? 'Checkmate the lone king.' : 'Play the bot. Blunder Check has your back.')),
      g.custom ? null : h('div', { class: 'stack-s' }, lvl, col),
      h('div', { class: 'toggle' }, h('div', null, h('b', null, 'Blunder Check'), h('div', { class: 'small muted' }, 'Stops you when a move loses material and says why')), sw),
      h('div', { class: 'spread' }, h('span', { class: 'pill acc' }, `You: ${colorName(g.me)} · ${LEVELS[g.level].name}`), this.statusEl),
      this.board.el, this.panel, ctrl,
      h('p', { class: 'small muted' }, `Blunders caught so far: ${S.play.caught}. Each one is a piece you would have lost.`));
    this.board.set({ fen: g.c.fen(), orient: this.orient || g.me, interactive: false, movable: g.me, onMove: u => this.onMove(u), lastMove: g.last || null });
    this.orient = null;
    setTimeout(() => this.turn(), 0);
    return this.el;
  },
  flip() { this.board.set({ orient: this.board.orient === 'w' ? 'b' : 'w' }); },
  alive() { return this.el && document.body.contains(this.el); },
  status(t) { if (this.statusEl) this.statusEl.textContent = t; },
  async turn() {
    const g = this.g; if (!this.alive() || g.over) return;
    if (this.checkEnd()) return;
    if (g.c.turn() === g.me) {
      this.status('Your move');
      this.board.set({ interactive: true, fen: g.c.fen() });
      const fen = g.c.fen();
      this.evBefore = { fen, p: evalPos(fen, 10).catch(() => null) };
    } else {
      this.status('Bot is thinking…');
      this.board.set({ interactive: false });
      const lv = LEVELS[g.level], fen = g.c.fen();
      let u;
      await new Promise(r => setTimeout(r, 350));
      if (Math.random() < lv.rand) { const ms = g.c.moves({ verbose: true }); const m = ms[Math.floor(Math.random() * ms.length)]; u = m.from + m.to + (m.promotion || ''); }
      else { try { const r = await Engine.run(fen, { depth: lv.depth, skill: lv.skill }); u = r.best; } catch (e) { this.status('Engine unavailable'); return; } }
      if (!this.alive() || g.c.fen() !== fen) return;
      const m = uciMove(g.c, u); g.last = m.from + m.to;
      this.board.set({ fen: g.c.fen(), lastMove: g.last });
      this.turn();
    }
  },
  async onMove(u) {
    const g = this.g; if (g.over || g.c.turn() !== g.me) return;
    g.started = true;
    const f0 = g.c.fen();
    const m = uciMove(g.c, u); if (!m) return;
    const f1 = g.c.fen();
    this.board.set({ fen: f1, lastMove: u, interactive: false });
    this.panel.replaceChildren();
    if (S.settings.blunderCheck && !g.custom) {
      this.status('Blunder Check…');
      const e0 = this.evBefore && this.evBefore.fen === f0 ? await this.evBefore.p : await evalPos(f0, 10).catch(() => null);
      const e1 = await evalPos(f1, 10).catch(() => null);
      if (!this.alive()) return;
      if (e0 && e1) {
        const drop = wpFor(e0, g.me) - wpFor(e1, g.me);
        if (drop >= 15 && wpFor(e0, g.me) > 8) {
          const c = categorize(f0, f1, u, e0, e1, g.me);
          const msg = c ? c.text : `${m.san} gives away a lot. Look again.`;
          this.status('Wait!');
          this.panel.replaceChildren(h('div', { class: 'feedback bad stack-s' },
            h('h3', null, 'Blunder Check: are you sure?'), h('p', { class: 'small' }, msg),
            h('div', { class: 'row' },
              h('button', { class: 'btn primary', onclick: () => { g.c.undo(); S.play.caught++; g.caught++; Store.saveProfile(); this.panel.replaceChildren(h('div', { class: 'feedback good' }, h('p', { class: 'small' }, 'Good catch. Find a safer move.'))); this.board.set({ fen: g.c.fen(), lastMove: g.last || null, arrows: [] }); this.turn(); } }, 'Take it back'),
              h('button', { class: 'btn', onclick: () => { this.panel.replaceChildren(); g.last = u; this.turn(); } }, 'Play it anyway'))));
          this.board.set({ arrows: [arrowOf(e1.best, 'bad')] });
          return;
        }
      }
    }
    g.last = u;
    this.turn();
  },
  async hint() {
    const g = this.g; if (g.over || g.c.turn() !== g.me) return;
    this.status('Thinking…');
    const r = this.evBefore && this.evBefore.fen === g.c.fen() ? await this.evBefore.p : await evalPos(g.c.fen(), 10);
    if (!r || !r.best) return;
    const m = moveInfo(g.c.fen(), r.best);
    this.board.set({ marks: { [r.best.slice(0, 2)]: 'good' } });
    this.status('Your move');
    const threat = CL.hangingPieces(CL.parseFen(g.c.fen()), g.me).filter(x => CL.VAL[x.piece.type] >= 3);
    this.panel.replaceChildren(h('div', { class: 'feedback' }, h('p', { class: 'small' }, (threat.length ? `Careful: your ${PN(threat[0].piece.type)} on ${threat[0].square} is in danger. ` : '') + `Try moving your ${PN(m.piece)}.`)));
  },
  takeback() {
    const g = this.g; if (!g.c.history().length) return;
    g.c.undo(); if (g.c.turn() !== g.me && g.c.history().length) g.c.undo();
    g.over = false; g.last = null; this.panel.replaceChildren();
    this.board.set({ fen: g.c.fen(), lastMove: null, arrows: [], marks: {} });
    this.turn();
  },
  checkEnd() {
    const g = this.g, c = g.c;
    if (!c.game_over()) return false;
    g.over = true;
    let res, title;
    if (c.in_checkmate()) { const iWon = c.turn() !== g.me; res = iWon ? (g.me === 'w' ? '1-0' : '0-1') : (g.me === 'w' ? '0-1' : '1-0'); title = iWon ? 'Checkmate. You win!' : 'Checkmated.'; if (iWon) S.play.wins++; }
    else { res = '1/2-1/2'; title = c.in_stalemate() ? 'Stalemate. It\'s a draw.' : 'Draw.'; }
    S.play.games++; ensureDaily(); S.daily.played = 1; Store.saveProfile();
    this.status('Game over');
    this.board.set({ interactive: false });
    const btn = g.custom ? null : h('button', { class: 'btn primary', onclick: () => this.review(res) }, 'Review this game');
    this.panel.replaceChildren(h('div', { class: 'feedback ' + (title.includes('win') ? 'good' : 'warn') + ' stack-s' }, h('h3', null, title),
      g.custom && c.in_stalemate() ? h('p', { class: 'small' }, 'Stalemate: the king had no legal move but wasn\'t in check. Leave it a square next time.') : null,
      h('div', { class: 'row' }, btn, h('button', { class: 'btn', onclick: () => { this.reset(g.custom ? { fen: g.fen0, color: g.me, level: g.level } : {}); rerender(); } }, 'Play again'))));
    return true;
  },
  review(res) {
    const g = this.g, c = g.c;
    const hist = c.history({ verbose: true });
    const lv = LEVELS[g.level].name;
    const rec = { id: 'b' + Date.now().toString(36), white: g.me === 'w' ? S.settings.username : 'Bot (' + lv + ')', black: g.me === 'b' ? S.settings.username : 'Bot (' + lv + ')', result: res, date: today(), termination: c.in_checkmate() ? 'checkmate' : 'draw', tc: '', eco: '', opening: '', link: '', fen0: g.fen0, moves: hist.map(m => m.from + m.to + (m.promotion || '')), sans: hist.map(m => m.san), myColor: g.me, source: 'bot', added: Date.now(), analysis: null, mistakes: null, summary: null };
    S.games[rec.id] = rec; Store.saveGame(rec);
    openReview(rec.id, 0);
  },
};
function viewPlay() { return Play.view(); }
// ---------- LONDON SYSTEM SIMULATOR ----------
const LONDON_STEPS = [
  { uci: 'd2d4', san: 'd4', done: b => !(b.d2 && b.d2.type === 'p' && b.d2.color === 'w'), why: 'Take the center with the d-pawn. Everything in the London is built around this pawn.' },
  { uci: 'c1f4', san: 'Bf4', done: b => !(b.c1 && b.c1.type === 'b'), why: 'Bishop out to f4 BEFORE you play e3. If e3 comes first, this bishop gets locked behind your own pawns.' },
  { uci: 'e2e3', san: 'e3', done: b => !(b.e2 && b.e2.type === 'p' && b.e2.color === 'w'), why: 'Supports the d4 pawn and opens a path for your other bishop.' },
  { uci: 'g1f3', san: 'Nf3', done: b => !(b.g1 && b.g1.type === 'n'), why: 'Develops the knight toward the center. Later it can jump to e5.' },
  { uci: 'c2c3', san: 'c3', done: b => !(b.c2 && b.c2.type === 'p' && b.c2.color === 'w'), why: 'Completes the pawn triangle c3, d4, e3. Very hard for Black to break.' },
  { uci: 'f1d3', san: 'Bd3', done: b => !(b.f1 && b.f1.type === 'b'), why: 'Bishop to d3, aiming at h7 and Black\'s kingside.' },
  { uci: 'b1d2', san: 'Nbd2', done: b => !(b.b1 && b.b1.type === 'n'), why: 'Knight to d2, not c3, so it doesn\'t block your c-pawn. From d2 it supports e4 and Ne5.' },
  { uci: 'e1g1', san: 'O-O', done: b => !(b.e1 && b.e1.type === 'k'), why: 'Castle. Your king is safe and your rook joins the game.' },
  { uci: 'h2h3', san: 'h3', done: b => !(b.h2 && b.h2.type === 'p' && b.h2.color === 'w'), why: 'Gives your f4 bishop a safe retreat on h2 and stops ...Nh5 or ...Bg4 from bothering you.' },
];
const LONDON_PLANS = [
  { name: 'Classical', moves: ['d5', 'Nf6', 'e6', 'c5', 'Nc6', 'Bd6', 'O-O', 'Qc7', 'b6'] },
  { name: 'Queen raid on b2', moves: ['d5', 'c5', 'Nc6', 'Qb6', 'Nf6', 'Bf5', 'e6', 'Be7'] },
  { name: 'King\'s Indian', moves: ['Nf6', 'g6', 'Bg7', 'O-O', 'd6', 'Nbd7', 'c5', 'Qe8'] },
  { name: 'Knight hunts your bishop', moves: ['d5', 'Nf6', 'c5', 'e6', 'Nh5', 'Nc6', 'Bd6'] },
  { name: 'Mirror', moves: ['d5', 'Nf6', 'Bf5', 'e6', 'c5', 'Nc6', 'Bd6', 'O-O'] },
];
const LONDON_LEVELS = [
  { name: 'Friend', skill: 2, depth: 3, rand: 0.1 },
  { name: 'Club', skill: 6, depth: 6, rand: 0.03 },
  { name: 'Strong', skill: 12, depth: 9, rand: 0 },
];

async function londonAdvice(fen) {
  const c = new Chess(fen), b = CL.parseFen(fen);
  const best = await evalPos(fen, 11);
  const legal = c.moves({ verbose: true });
  const byUci = u => legal.find(m => m.from + m.to === u.slice(0, 4));
  const bySan = s => legal.find(m => m.san.replace(/[+#]/g, '') === s);
  const bestWp = wpFor(best, 'w');
  const safe = async m => { const c2 = new Chess(fen); c2.move(m); const e = await evalPos(c2.fen(), 10); return bestWp - wpFor(e, 'w') < 12; };
  const uciOf = m => m.from + m.to + (m.promotion || '');
  const bestSanTxt = best.best ? sanOf(fen, best.best) : '';

  if (best.mate != null && best.mate > 0) return { uci: best.best, kind: 'tactic', title: 'You have a checkmate!', text: best.mate === 1 ? `${bestSanTxt} is checkmate.` : `There's a forced checkmate starting with ${bestSanTxt}. Look at your checks.` };
  const hang = CL.hangingPieces(b, 'w').filter(x => CL.VAL[x.piece.type] >= 3);
  if (hang.length) {
    const x = hang[0];
    return { uci: best.best, kind: 'danger', title: `Your ${PN(x.piece.type)} on ${x.square} is in danger`, text: `It's ${x.reason === 'undefended' ? 'attacked and nothing defends it' : 'attacked by a cheaper piece'}. ${whyBest(fen, best.best) || bestSanTxt + ' handles it.'} The setup can wait. Saving material comes first.` };
  }
  const bm = best.best ? moveInfo(fen, best.best) : null;
  if (bm && bm.captured && CL.VAL[bm.captured] >= 3 && CL.hangingInfo(b, bm.to)) return { uci: best.best, kind: 'tactic', title: 'Free piece!', text: `${whyBest(fen, best.best)} Always take free material before continuing your setup.` };

  // Standard answers to Black's London tries
  const bq = Object.keys(b).find(s => b[s].type === 'q' && b[s].color === 'b');
  if (bq === 'b6' && b.b2 && b.b2.type === 'p' && b.b2.color === 'w' && CL.attackers(b, 'b2', 'w').length === 0 && CL.attacksFrom(b, 'b6').includes('b2')) {
    for (const s of ['Qb3', 'Qc1', 'b3', 'Qc2']) { const m = bySan(s); if (m && await safe(m)) return { uci: uciOf(m), kind: 'answer', title: 'Black is going after your b2 pawn', text: `This is the most common trick against the London. Your bishop left c1, so nothing protects b2. ${s === 'Qb3' ? 'Qb3 defends it and offers a queen trade. If Black trades, the game gets simpler, and your a-pawn recaptures toward the center.' : s === 'Qc1' ? 'Qc1 quietly defends b2.' : s + ' takes care of it.'}` }; }
  }
  if (b.f4 && b.f4.type === 'b' && b.f4.color === 'w') {
    const att = CL.attackers(b, 'f4', 'b');
    if (att.some(a => b[a].type === 'n')) {
      for (const s of ['Be5', 'Bg5', 'Bg3']) { const m = bySan(s); if (m && await safe(m)) return { uci: uciOf(m), kind: 'answer', title: 'The knight is hunting your bishop', text: `Black's knight wants to trade itself for your f4 bishop, your best piece in the London. ${s} keeps the bishop. This is why h3 is part of the setup: it gives the bishop a home on h2.` }; }
    }
    if (att.some(a => b[a].type === 'b')) {
      for (const s of ['Bg3', 'Bxd6']) { const m = bySan(s); if (m && await safe(m)) return { uci: uciOf(m), kind: 'answer', title: 'Black offers to trade bishops', text: s === 'Bg3' ? 'Bg3 keeps your bishop. It\'s the strongest piece in your setup, so don\'t give it away for free.' : 'Taking is fine here.' }; }
    }
  }
  // Next setup move
  const order = LONDON_STEPS.filter(st => !st.done(b));
  let blocked = null;
  for (const st of order) {
    if (st.uci === 'e2e3' && b.c1 && b.c1.type === 'b' && byUci('c1f4')) continue; // bishop first
    const m = byUci(st.uci); if (!m) continue;
    if (await safe(m)) {
      const left = order.length;
      const pre = blocked ? `${blocked.san} has to wait: ${blocked.why} So do this part of the setup first. ` : '';
      return { uci: uciOf(m), kind: 'setup', step: st.san, title: `Setup: ${m.san}`, text: pre + st.why + (left > 1 ? ` (${left - 1} setup move${left - 1 === 1 ? '' : 's'} left after this.)` : ' That finishes your London setup!') };
    } else if (!blocked) {
      const c2 = new Chess(fen); c2.move(m); const e1 = await evalPos(c2.fen(), 10);
      const cat = categorize(fen, c2.fen(), uciOf(m), best, e1, 'w');
      const rep = e1.best ? sanOf(c2.fen(), e1.best) : '';
      blocked = { san: m.san, why: cat && cat.cat !== 'other' ? cat.text.replace(/^After [^,]+, /, 'right now, ') : `right now Black would answer with ${rep} and come out better.` };
    }
  }
  if (blocked) return { uci: best.best, kind: 'careful', title: `Careful: ${blocked.san} doesn't work right now`, text: `Normally ${blocked.san} is next, but ${blocked.why} Play ${bestSanTxt} first. ${whyBest(fen, best.best)}` };
  // Middlegame plans
  const plan = [];
  if (b.f3 && b.f3.type === 'n') plan.push('jump a knight to e5');
  if (b.e3 && b.e3.type === 'p') plan.push('prepare the e4 push');
  plan.push('bring your queen to e2 or f3 and your rooks to the center');
  return { uci: best.best, kind: 'plan', title: `Setup complete. Best now: ${bestSanTxt}`, text: `${whyBest(fen, best.best) || ''} London plans from here: ${plan.join(', ')}. Before every move, check what Black's last move threatens.` };
}

const London = {
  g: null,
  reset() {
    const plan = LONDON_PLANS[Math.floor(Math.random() * LONDON_PLANS.length)];
    this.g = { c: new Chess(), plan, used: new Set(), level: S.settings.londonLevel != null ? S.settings.londonLevel : 0, over: false, adv: null, seq: 0, last: null, score: { london: 0, total: 0 } };
  },
  view() {
    if (!this.g) this.reset();
    const g = this.g; g.seq++;
    this.board = new BoardView();
    this.chips = h('div', { class: 'lchips' });
    this.fb = h('div'); this.adv = h('div');
    this.status = h('span', { class: 'small muted' });
    const guideSw = h('button', { class: 'switch', role: 'switch', 'aria-checked': String(S.settings.londonGuide !== false), 'aria-label': 'Show coach arrow', onclick: () => { S.settings.londonGuide = S.settings.londonGuide === false; guideSw.setAttribute('aria-checked', String(S.settings.londonGuide)); Store.saveProfile(); this.showAdvice(); } });
    const lvl = h('div', { class: 'seg', role: 'group', 'aria-label': 'Opponent level' }, LONDON_LEVELS.map((l, i) => h('button', { 'aria-pressed': String(g.level === i), onclick: () => { S.settings.londonLevel = i; Store.saveProfile(); if (g.c.history().length <= 1 || g.over) { this.reset(); } else g.level = i; rerender(); } }, l.name)));
    this.el = h('div', { class: 'stack' },
      h('div', { class: 'hero stack-s' }, h('div', { class: 'eyebrow' }, 'London System'), h('h1', null, 'Play the London. Your coach guides every move.')),
      lvl,
      h('div', { class: 'toggle' }, h('div', null, h('b', null, 'Show the coach\'s move'), h('div', { class: 'small muted' }, 'Green arrow on the board. Turn off to test yourself.')), guideSw),
      this.chips,
      h('div', { class: 'spread' }, h('span', { class: 'pill acc' }, 'You: White · ' + LONDON_LEVELS[g.level].name), this.status),
      this.board.el, this.adv, this.fb,
      h('div', { class: 'ctrl' },
        h('button', { class: 'btn', onclick: () => this.hint() }, 'Why?'),
        h('button', { class: 'btn', onclick: () => this.undo() }, 'Undo'),
        h('button', { class: 'btn', onclick: () => this.board.set({ orient: this.board.orient === 'w' ? 'b' : 'w' }) }, 'Flip'),
        h('button', { class: 'btn', onclick: () => { this.reset(); rerender(); } }, 'New')));
    this.board.set({ fen: g.c.fen(), orient: 'w', movable: 'w', interactive: false, onMove: u => this.onMove(u), lastMove: g.last });
    this.board.onBadTap = sq => { const p = g.c.get(sq); toast(p ? 'That\'s Black\'s piece. Tap one of your white pieces.' : 'Tap one of your white pieces first, then where it should go.'); };
    this.board.onIdleTap = () => { if (!g.over && g.c.turn() === 'b') toast('Black is thinking…'); };
    this.renderChips();
    setTimeout(() => this.turn(), 0);
    return this.el;
  },
  alive() { return this.el && document.body.contains(this.el); },
  renderChips() {
    const b = CL.parseFen(this.g.c.fen());
    this.chips.replaceChildren(h('span', { class: 'small muted', style: 'width:100%' }, 'Your setup'), ...LONDON_STEPS.map(st => h('span', { class: 'lchip' + (st.done(b) ? ' done' : '') }, (st.done(b) ? '✓ ' : '') + st.san)));
  },
  showAdvice() {
    const a = this.g.adv; if (!a || !this.alive()) return;
    const show = S.settings.londonGuide !== false;
    this.board.set({ arrows: show && a.uci ? [arrowOf(a.uci, 'good')] : [] });
    const cls = { danger: 'bad', tactic: 'good', careful: 'warn', answer: 'warn', setup: '', plan: '' }[a.kind] || '';
    this.adv.replaceChildren(h('div', { class: 'feedback ' + cls + ' stack-s' },
      h('div', { class: 'eyebrow' }, 'Coach'),
      h('h3', null, show ? a.title : (a.kind === 'setup' ? 'Your move. What\'s next in the setup?' : a.kind === 'plan' ? 'Your move. Setup is done, find a plan.' : 'Your move. Something important is happening.')),
      show ? h('p', { class: 'small' }, a.text) : h('p', { class: 'small muted' }, 'Tap "Why?" if you get stuck.')));
  },
  async turn() {
    const g = this.g; if (!this.alive() || g.over) return;
    this.renderChips();
    if (this.checkEnd()) return;
    const seq = ++g.seq;
    if (g.c.turn() === 'w') {
      this.status.textContent = 'Coach is looking…';
      this.board.set({ interactive: false });
      let a; try { a = await londonAdvice(g.c.fen()); } catch (e) { a = null; }
      if (!this.alive() || seq !== g.seq) return;
      g.adv = a; g.advFen = g.c.fen();
      this.status.textContent = 'Your move';
      this.board.set({ interactive: true, fen: g.c.fen() });
      this.showAdvice();
    } else {
      this.status.textContent = 'Black is thinking…';
      this.board.set({ interactive: false, arrows: [] });
      await new Promise(r => setTimeout(r, 400));
      g.pendingBook = null;
      const u = await this.botMove(g);
      if (!this.alive() || seq !== g.seq || !u) return;
      if (g.pendingBook) { g.used.add(g.pendingBook); g.pendingBook = null; }
      const m = uciMove(g.c, u); g.last = m.from + m.to;
      this.board.set({ fen: g.c.fen(), lastMove: g.last });
      this.turn();
    }
  },
  async botMove(g) {
    const fen = g.c.fen(), lv = LONDON_LEVELS[g.level];
    const blackMoves = Math.floor(g.c.history().length / 2);
    if (blackMoves < 10) {
      const legal = g.c.moves({ verbose: true });
      let base = null;
      for (const s of g.plan.moves) {
        if (g.used.has(s)) continue;
        const m = legal.find(x => x.san.replace(/[+#]/g, '') === s); if (!m) continue;
        try {
          base = base || await Engine.run(fen, { depth: 8 });
          const c2 = new Chess(fen); c2.move(m); const e = await evalPos(c2.fen(), 8);
          if (wpFor(e, 'b') >= wpFor(base, 'b') - 18) { g.pendingBook = s; return m.from + m.to + (m.promotion || ''); }
        } catch (e) { break; }
      }
    }
    if (Math.random() < lv.rand) { const ms = g.c.moves({ verbose: true }); const m = ms[Math.floor(Math.random() * ms.length)]; return m.from + m.to + (m.promotion || ''); }
    try { const r = await Engine.run(fen, { depth: lv.depth, skill: lv.skill }); return r.best; } catch (e) { this.status.textContent = 'Engine unavailable'; return null; }
  },
  async onMove(u) {
    const g = this.g; if (g.over || g.c.turn() !== 'w') return;
    const f0 = g.c.fen(), a = g.advFen === f0 ? g.adv : null;
    const m = uciMove(g.c, u); if (!m) return;
    const f1 = g.c.fen(); g.seq++;
    this.board.set({ fen: f1, lastMove: u, interactive: false, arrows: [] });
    this.adv.replaceChildren();
    const followed = a && a.uci && a.uci.slice(0, 4) === u.slice(0, 4);
    g.score.total++; if (followed) g.score.london++;
    if (followed) { this.say('good', `✓ ${m.san}`, a.kind === 'setup' ? 'Right on plan.' : 'Exactly what the coach wanted.'); g.last = u; this.renderChips(); return this.turn(); }
    // Blunder check
    this.status.textContent = 'Checking your move…';
    let e0 = null, e1 = null;
    try { e0 = await evalPos(f0, 10); e1 = await evalPos(f1, 10); } catch (e) {}
    if (!this.alive()) return;
    const drop = e0 && e1 ? wpFor(e0, 'w') - wpFor(e1, 'w') : 0;
    const takeBack = () => { g.c.undo(); g.score.total--; this.fb.replaceChildren(); this.board.set({ fen: g.c.fen(), lastMove: g.last }); this.turn(); };
    const playOn = () => { this.fb.replaceChildren(); g.last = u; this.renderChips(); this.turn(); };
    if (drop >= 15 && e0 && wpFor(e0, 'w') > 8) {
      const cat = categorize(f0, f1, u, e0, e1, 'w');
      this.board.set({ arrows: [arrowOf(e1.best, 'bad')] });
      this.status.textContent = 'Wait!';
      this.fb.replaceChildren(h('div', { class: 'feedback bad stack-s' }, h('h3', null, 'Blunder Check: are you sure?'), h('p', { class: 'small' }, cat ? cat.text : `${m.san} gives away a lot.`), h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: takeBack }, 'Take it back'), h('button', { class: 'btn', onclick: playOn }, 'Play it anyway'))));
      return;
    }
    const b0 = CL.parseFen(f0);
    if (u.startsWith('e2e3') && b0.c1 && b0.c1.type === 'b') {
      this.status.textContent = 'Move order';
      this.fb.replaceChildren(h('div', { class: 'feedback warn stack-s' }, h('h3', null, 'Move order: bishop first!'), h('p', { class: 'small' }, 'e3 before Bf4 locks your dark-squared bishop behind your pawns. That\'s the mistake from your 1. d4 d5 2. e3 games. In the London, play Bf4 first, then e3.'), h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: takeBack }, 'Take it back'), h('button', { class: 'btn', onclick: playOn }, 'Keep it'))));
      return;
    }
    if (u.startsWith('b1c3')) this.say('', `${m.san}: playable`, 'In the London the knight usually goes to d2 instead, so your c-pawn can go to c3 and finish the pawn triangle.');
    else if (a && a.kind === 'setup') this.say('', `${m.san}: playable`, `Not a mistake. The London move was ${sanOf(f0, a.uci)}: ${LONDON_STEPS.find(s => s.san === a.step).why}`);
    else if (a && (a.kind === 'answer' || a.kind === 'danger' || a.kind === 'tactic')) this.say(drop >= 7 ? 'warn' : '', `${m.san}: ${drop >= 7 ? 'not the best' : 'OK'}`, `The coach wanted ${sanOf(f0, a.uci)}. ${a.title}.`);
    else this.say('', `${m.san}`, drop >= 7 ? `A bit loose. ${a ? sanOf(f0, a.uci) + ' was stronger.' : ''}` : 'Fine move.');
    g.last = u; this.renderChips(); this.turn();
  },
  say(cls, title, text) { this.fb.replaceChildren(h('div', { class: 'feedback ' + cls }, h('h3', null, title), h('p', { class: 'small' }, text))); },
  hint() {
    const g = this.g, a = g.adv; if (!a || g.c.turn() !== 'w') return;
    this.board.set({ arrows: [arrowOf(a.uci, 'good')] });
    this.adv.replaceChildren(h('div', { class: 'feedback stack-s' }, h('div', { class: 'eyebrow' }, 'Coach'), h('h3', null, a.title), h('p', { class: 'small' }, a.text)));
  },
  undo() {
    const g = this.g; if (g.c.history().length < 2) return;
    g.c.undo(); if (g.c.turn() !== 'w') g.c.undo();
    g.over = false; g.last = null; g.seq++; this.fb.replaceChildren();
    this.board.set({ fen: g.c.fen(), lastMove: null, arrows: [] });
    this.turn();
  },
  checkEnd() {
    const g = this.g, c = g.c;
    if (!c.game_over()) return false;
    g.over = true;
    let res, title;
    if (c.in_checkmate()) { const won = c.turn() === 'b'; res = won ? '1-0' : '0-1'; title = won ? 'Checkmate. You win with the London!' : 'Checkmated.'; }
    else { res = '1/2-1/2'; title = 'Draw.'; }
    const L = S.london || (S.london = { games: 0, wins: 0 }); L.games++; if (res === '1-0') L.wins++; Store.saveProfile();
    this.status.textContent = 'Game over';
    this.board.set({ interactive: false, arrows: [] });
    this.adv.replaceChildren();
    this.fb.replaceChildren(h('div', { class: 'feedback ' + (res === '1-0' ? 'good' : 'warn') + ' stack-s' }, h('h3', null, title),
      h('p', { class: 'small' }, `Black played the "${g.plan.name}" setup. You matched the coach on ${g.score.london} of ${g.score.total} moves.`),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: () => this.review(res) }, 'Walk through this game'), h('button', { class: 'btn', onclick: () => { this.reset(); rerender(); } }, 'Play again'))));
    return true;
  },
  review(res) {
    const g = this.g, hist = g.c.history({ verbose: true }), lv = LONDON_LEVELS[g.level].name;
    const rec = { id: 'l' + Date.now().toString(36), white: S.settings.username, black: 'London bot (' + lv + ')', result: res, date: today(), termination: g.c.in_checkmate() ? 'checkmate' : 'draw', tc: '', eco: '', opening: 'London System vs ' + g.plan.name, link: '', fen0: START_FEN, moves: hist.map(m => m.from + m.to + (m.promotion || '')), sans: hist.map(m => m.san), myColor: 'w', source: 'bot', added: Date.now(), analysis: null, mistakes: null, summary: null };
    S.games[rec.id] = rec; Store.saveGame(rec);
    openWalkthrough(rec.id, 0);
  },
};
function viewLondon() { return London.view(); }


// ---------- GAMES ----------
function viewGames() {
  const wrap = h('div', { class: 'stack' });
  wrap.append(h('div', { class: 'hero stack-s' }, h('div', { class: 'eyebrow' }, 'Games'), h('h1', null, 'Import your chess.com games.')));
  const user = h('input', { type: 'text', id: 'username', value: S.settings.username, autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
  user.addEventListener('change', () => {
    S.settings.username = user.value.trim(); Store.saveProfile();
    Object.values(S.games).forEach(g => { if (g.source !== 'bot') { const was = g.myColor; assignColor(g); if (g.myColor !== was) { finishAnalysis(g); Store.saveGame(g); } } });
    toast('Username saved');
  });
  const ta = h('textarea', { id: 'pgn-input', placeholder: '[Event "Live Chess"]\n[White "huhsaaan"] ...\n\n1. e4 e5 2. Nf3 ...', 'aria-label': 'Paste PGN' });
  const file = h('input', { type: 'file', accept: '.pgn,.txt,text/plain', hidden: true, multiple: true });
  file.addEventListener('change', async () => { let t = ''; for (const f of file.files) t += '\n\n' + await f.text(); doImport(t); file.value = ''; });
  wrap.append(h('div', { class: 'card stack' },
    h('div', null, h('label', { class: 'lbl', for: 'username' }, 'Your chess.com username'), user),
    h('div', null, h('label', { class: 'lbl', for: 'pgn-input' }, 'Paste one or more games (PGN)'), ta),
    h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: () => doImport(ta.value) }, 'Import'), h('button', { class: 'btn', onclick: () => file.click() }, 'Upload .pgn file'), file),
    monthLinks(),
    h('details', null, h('summary', null, 'Other ways to get your games'),
      h('p', { class: 'small', style: 'margin-top:8px' }, h('b', null, 'One game from the chess.com app:')),
      h('ol', { class: 'steps small' },
        h('li', null, 'Tap into a finished game to open its review.'),
        h('li', null, 'Look for a share or ••• menu and choose PGN, then Copy.'),
        h('li', null, 'Paste it in the box above and tap Import.')),
      h('p', { class: 'small', style: 'margin-top:8px' }, h('b', null, 'On a computer (fastest for many games):')),
      h('ol', { class: 'steps small' },
        h('li', null, 'Go to chess.com, then Games, then Archive.'),
        h('li', null, 'Tick the games you want (or select all) and press Download.'),
        h('li', null, 'Upload that .pgn file here with "Upload .pgn file".')),
      h('p', { class: 'small muted', style: 'margin-top:8px' }, 'Button names on chess.com change now and then. Look for "Share" and "PGN" or "Download".'))));

  const gs = Object.values(S.games).sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.added - a.added);
  const pendingN = gs.filter(g => !g.analysis).length;
  const an = h('div', { class: 'card stack-s' },
    h('div', { class: 'spread' }, h('h3', null, 'Analysis'), h('span', { class: 'small muted', id: 'engine-badge' }, engineLabel())),
    UI.analyzing ? h('div', { class: 'stack-s' }, h('div', { class: 'progress' }, h('i', { id: 'an-prog', style: `width:${UI.progress || 0}%` })), h('div', { class: 'small muted', id: 'an-label' }, UI.anLabel || 'Starting…'))
      : pendingN ? h('button', { class: 'btn primary', onclick: analyzeAll }, `Analyze ${pendingN} game${pendingN === 1 ? '' : 's'}`)
        : h('p', { class: 'small muted' }, gs.length ? 'All games analyzed.' : 'No games yet.'),
    h('p', { class: 'small muted' }, 'The engine runs on your phone. It takes roughly 10 to 30 seconds per game. Keep this screen open while it works. ' + (UI.sync === 'account' ? 'Your games and progress are saved to your account.' : 'Progress is saved in this browser.')));
  wrap.append(an);

  if (gs.length) {
    const list = h('div', { class: 'card list' });
    for (const g of gs) {
      const o = outcomeOf(g), nb = g.mistakes ? g.mistakes.filter(m => m.sev === 'blunder').length : null;
      list.append(h('button', { class: 'li', onclick: () => openReview(g.id, 0) },
        h('span', { class: 'res ' + (o || 'd') }, o ? o.toUpperCase() : '?'),
        h('span', { style: 'min-width:0' }, h('b', null, 'vs ' + oppName(g)), h('div', { class: 'small muted', style: 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis' }, [g.date, g.opening || (g.source === 'bot' ? 'Bot game' : '')].filter(Boolean).join(' · '))),
        nb == null ? h('span', { class: 'pill' }, 'Not analyzed') : h('span', { class: 'pill ' + (nb ? 'bad' : 'good') }, nb ? `${nb} blunder${nb === 1 ? '' : 's'}` : 'Clean')));
    }
    wrap.append(h('div', { class: 'stack-s' }, h('h2', null, `Your games (${gs.length})`), list));
  }
  return wrap;
}
function monthLinks() {
  const u = encodeURIComponent((S.settings.username || '').trim().toLowerCase());
  const d = new Date(), months = [];
  for (let i = 0; i < 3; i++) { const x = new Date(d.getFullYear(), d.getMonth() - i, 1); months.push([x.getFullYear(), String(x.getMonth() + 1).padStart(2, '0'), x.toLocaleDateString(undefined, { month: 'long' })]); }
  return h('div', { class: 'feedback stack-s' },
    h('b', null, 'Fastest: grab a whole month of games'),
    h('ol', { class: 'steps small' },
      h('li', null, 'Tap a month below. It opens your games as a page of text or a .pgn download.'),
      h('li', null, 'Text: tap and hold, Select All, Copy, then paste above and tap Import.'),
      h('li', null, 'Download: tap "Upload .pgn file" and pick it from Downloads.')),
    h('div', { class: 'row' }, months.map(([y, m, n]) => h('a', { class: 'btn', href: `https://api.chess.com/pub/player/${u}/games/${y}/${m}/pgn`, target: '_blank', rel: 'noopener' }, n))));
}
async function loadBundledGames() {
  try {
    const r = await fetch('my-games.pgn', { cache: 'no-cache' });
    if (!r.ok) return;
    const { games } = parsePGNs(await r.text());
    let added = 0;
    for (const g of games) { if (S.games[g.id] || (S.removed && S.removed[g.id])) continue; assignColor(g); S.games[g.id] = g; Store.saveGame(g); added++; }
    if (added) { toast(`${added} of your chess.com games loaded`); rerender(); analyzeAll(); }
  } catch (e) { console.warn('bundled games', e); }
}
function doImport(text) {
  const { games, errors } = parsePGNs(text || '');
  if (!games.length) { toast(errors ? 'Couldn\'t read that. Make sure you pasted the full PGN.' : 'Paste a game first.'); return; }
  let added = 0, mine = 0;
  for (const g of games) { if (S.games[g.id]) continue; assignColor(g); if (g.myColor) mine++; S.games[g.id] = g; added++; Store.saveGame(g); }
  toast(`${added} game${added === 1 ? '' : 's'} added` + (games.length - added ? `, ${games.length - added} already here` : '') + (errors ? `, ${errors} unreadable` : ''));
  if (added && !mine) toast(`None of these have ${S.settings.username} as a player. Check your username.`);
  rerender();
  if (added) analyzeAll();
}
async function analyzeAll() {
  if (UI.analyzing) return;
  const todo = Object.values(S.games).filter(g => !g.analysis);
  if (!todo.length) return;
  UI.analyzing = true; UI.progress = 0; rerender();
  try { await Engine.boot(); } catch (e) { UI.analyzing = false; toast('The engine could not start in this browser.'); rerender(); return; }
  let i = 0;
  for (const g of todo) {
    i++;
    UI.anLabel = `Game ${i} of ${todo.length}: vs ${oppName(g)}`;
    const lab = $('#an-label'); if (lab) lab.textContent = UI.anLabel;
    try {
      await analyzeGame(g, p => { UI.progress = Math.round(100 * ((i - 1) + p) / todo.length); const pr = $('#an-prog'); if (pr) pr.style.width = UI.progress + '%'; });
      Store.saveGame(g);
    } catch (e) { console.warn('analysis failed', e); }
  }
  UI.analyzing = false; UI.progress = null;
  toast('Analysis done. Check the Coach tab.');
  rerender();
}

// ---------- game review ----------
function openReview(id, startPly, onBack) {
  const g = S.games[id]; if (!g) return;
  const fens = gameFens(g);
  let cur = startPly || 0;
  const board = new BoardView();
  const evbar = h('div', { class: 'evalbar', title: 'Evaluation' }, h('i', { style: 'width:50%' }));
  const movesEl = h('div', { class: 'moves' });
  const info = h('div');
  const mlist = h('div');
  const o = outcomeOf(g);
  const el = h('div', { class: 'stack' },
    sessTop('vs ' + oppName(g), [g.date, g.opening].filter(Boolean).join(' · '), onBack),
    h('div', { class: 'row' }, o ? h('span', { class: 'pill ' + (o === 'w' ? 'good' : o === 'l' ? 'bad' : '') }, { w: 'Win', l: 'Loss', d: 'Draw' }[o]) : null, g.summary ? h('span', { class: 'pill' }, cap(g.summary.how)) : null, g.link ? h('a', { href: g.link, target: '_blank', rel: 'noopener', class: 'small' }, 'Open on chess.com') : null),
    h('button', { class: 'btn primary block', onclick: () => openWalkthrough(g.id, 0, () => openReview(g.id, 0, onBack)) }, 'Walk me through this game, move by move'),
    board.el, evbar,
    h('div', { class: 'ctrl' },
      h('button', { class: 'btn', 'aria-label': 'Start', onclick: () => show(0) }, '«'),
      h('button', { class: 'btn', 'aria-label': 'Previous move', onclick: () => show(cur - 1) }, '‹'),
      h('button', { class: 'btn', 'aria-label': 'Next move', onclick: () => show(cur + 1) }, '›'),
      h('button', { class: 'btn', 'aria-label': 'End', onclick: () => show(fens.length - 1) }, '»')),
    info, movesEl, mlist,
    h('button', { class: 'btn ghost', onclick: () => { Store.deleteGame(g.id); toast('Game removed'); (onBack || closeSession)(); } }, 'Remove this game'));
  openSession(el);

  function mistakeAt(ply) { return g.mistakes ? g.mistakes.find(m => m.ply === ply) : null; }
  function renderMoves() {
    movesEl.replaceChildren();
    const startB = g.fen0.split(' ')[1] === 'b';
    let mn = +g.fen0.split(' ')[5] || 1;
    g.sans.forEach((s, i) => {
      const white = startB ? i % 2 === 1 : i % 2 === 0;
      if (white || i === 0) movesEl.append(h('span', { class: 'mn' }, mn + (white ? '.' : '...')));
      const m = mistakeAt(i);
      movesEl.append(h('button', { class: (cur === i + 1 ? 'cur ' : '') + (m ? (m.sev === 'blunder' ? 'blun' : 'mist') : ''), onclick: () => show(i + 1) }, s + (m ? (m.sev === 'blunder' ? '??' : '?') : '')));
      if (!white) mn++;
    });
    const c = movesEl.querySelector('.cur'); if (c) c.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  function renderMistakeList() {
    mlist.replaceChildren();
    if (!g.myColor) {
      mlist.append(h('div', { class: 'card stack-s' }, h('p', null, 'Which side were you?'), h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: () => { g.myColor = 'w'; finishAnalysis(g); Store.saveGame(g); openReview(id, cur, onBack); } }, 'White'),
        h('button', { class: 'btn', onclick: () => { g.myColor = 'b'; finishAnalysis(g); Store.saveGame(g); openReview(id, cur, onBack); } }, 'Black'))));
      return;
    }
    if (!g.analysis) {
      const prog = h('div', { class: 'progress' }, h('i', { style: 'width:0%' }));
      const b = h('button', { class: 'btn primary block', onclick: async () => {
        b.disabled = true; b.textContent = 'Analyzing…'; mlist.append(prog);
        try { await analyzeGame(g, p => (prog.firstChild.style.width = Math.round(p * 100) + '%')); Store.saveGame(g); openReview(id, cur, onBack); }
        catch (e) { toast('The engine could not start.'); b.disabled = false; b.textContent = 'Analyze this game'; }
      } }, 'Analyze this game');
      mlist.append(h('div', { class: 'card stack-s' }, h('p', { class: 'small muted' }, 'Run the engine to find your mistakes in this game.'), b));
      return;
    }
    const ms = g.mistakes || [];
    const card = h('div', { class: 'card' }, h('h3', { style: 'margin-bottom:4px' }, ms.length ? `Your ${ms.length} biggest mistake${ms.length === 1 ? '' : 's'}` : 'No big mistakes in this game'));
    const list = h('div', { class: 'list' });
    ms.forEach(m => list.append(h('button', { class: 'mistake-card', onclick: () => { show(m.ply); window.scrollTo({ top: 0, behavior: 'smooth' }); } },
      h('span', { class: 'pill ' + (m.sev === 'blunder' ? 'bad' : 'warn') }, moveLabel(m.ply)),
      h('span', null, h('div', { class: 'chip-cat' }, CATS[m.cat].short), h('div', { class: 'small' }, m.text)))));
    card.append(list);
    mlist.append(card);
  }
  function moveLabel(ply) { const startB = g.fen0.split(' ')[1] === 'b'; const n = (+g.fen0.split(' ')[5] || 1) + Math.floor((ply + (startB ? 1 : 0)) / 2); const white = startB ? ply % 2 === 1 : ply % 2 === 0; return n + (white ? '. ' : '... ') + g.sans[ply]; }
  function show(i) {
    cur = Math.max(0, Math.min(fens.length - 1, i));
    const m = mistakeAt(cur);
    const arrows = [], marks = {};
    if (m) { arrows.push(arrowOf(m.uci, 'bad')); if (m.best) arrows.push(arrowOf(m.best, 'good')); }
    const prevM = cur > 0 ? mistakeAt(cur - 1) : null;
    if (prevM && prevM.reply) arrows.push(arrowOf(prevM.reply, 'warn'));
    board.set({ fen: fens[cur], orient: g.myColor || 'w', lastMove: cur > 0 ? g.moves[cur - 1] : null, arrows, marks, interactive: false });
    if (g.analysis) { const e = evObj(g.analysis.ev[cur]); const flip = g.myColor === 'b'; evbar.classList.toggle('flip', flip); evbar.firstChild.style.width = (flip ? 100 - wpWhite(e) : wpWhite(e)) + '%'; }
    info.replaceChildren();
    if (m) {
      const out = h('div', { class: 'small coach-out' });
      info.append(h('div', { class: 'feedback ' + (m.sev === 'blunder' ? 'bad' : 'warn') + ' stack-s' },
        h('div', { class: 'eyebrow' }, `${m.sev === 'blunder' ? 'Blunder' : 'Mistake'} · ${CATS[m.cat].short}`),
        h('h3', null, `You played ${m.san}`),
        h('p', { class: 'small' }, m.text + (m.bestSan && m.cat !== 'missed_mate' && m.cat !== 'missed_free' ? ` Better was ${m.bestSan}.` : '')),
        h('p', { class: 'small muted' }, 'Red arrow: your move. Green: the better move. Tap › to see their reply.'),
        h('div', { class: 'row' },
          h('button', { class: 'btn', onclick: () => runPuzzleSession([{ kind: 'mine', id: g.id + '-' + m.ply, fen: fens[m.ply], best: m.best, bestSan: m.bestSan, san: m.san, uci: m.uci, text: m.text, cat: m.cat, game: g, ply: m.ply, evBest: evObj(g.analysis.ev[m.ply]), lastMove: m.ply ? g.moves[m.ply - 1] : null }], { title: 'Practice this position' }) }, 'Practice it'),
          h('button', { class: 'btn ghost', onclick: () => askCoach(out, g, m, fens) }, 'Ask Coach why')),
        out));
    } else if (prevM) {
      info.append(h('div', { class: 'feedback warn' }, h('p', { class: 'small' }, prevM.replySan ? `Orange arrow: ${prevM.replySan}, the reply your move allowed.` : 'This is the position after your mistake.')));
    }
    renderMoves();
  }
  renderMistakeList();
  show(cur);
}

// ---------- step-by-step walkthrough ----------
function verdictOf(drop, played, best) {
  if (played === best) return { k: 'best', label: 'Best move', cls: 'good' };
  if (drop < 4) return { k: 'good', label: 'Good move', cls: 'good' };
  if (drop < 10) return { k: 'inacc', label: 'Inaccuracy', cls: '' };
  if (drop < 20) return { k: 'mistake', label: 'Mistake', cls: 'warn' };
  return { k: 'blunder', label: 'Blunder', cls: 'bad' };
}
function standing(wp) {
  if (wp >= 90) return 'You are winning easily.';
  if (wp >= 70) return 'You are clearly better.';
  if (wp >= 55) return 'You are slightly better.';
  if (wp > 45) return 'The game is about equal.';
  if (wp > 30) return 'You are slightly worse.';
  if (wp > 10) return 'You are clearly worse.';
  return 'You are losing badly.';
}
function whyBest(fen, u) {
  const mv = moveInfo(fen, u); if (!mv) return '';
  const b = CL.parseFen(fen), opp = mv.color === 'w' ? 'b' : 'w';
  if (mv.san.includes('#')) return `${mv.san} is checkmate.`;
  if (mv.captured) {
    const hi = CL.hangingInfo(b, mv.to);
    if (hi && b[mv.to] && b[mv.to].color === opp) return `${mv.san} takes their ${PN(mv.captured)}${hi.reason === 'undefended' ? ', which nothing was protecting' : ' with a cheaper piece'}.`;
    return `${mv.san} captures their ${PN(mv.captured)}.`;
  }
  const mineLoose = CL.hangingPieces(b, mv.color).filter(x => CL.VAL[x.piece.type] >= 3);
  if (mineLoose.some(x => x.square === mv.from)) return `${mv.san} gets your ${PN(mv.piece)} out of danger.`;
  const c = new Chess(fen); uciMove(c, u);
  const ft = CL.forkTargets(CL.parseFen(c.fen()), mv.to);
  if (ft.length >= 2) return `${mv.san} attacks two of their pieces at once.`;
  if (mv.san.includes('+')) return `${mv.san} gives check and keeps the pressure on.`;
  return '';
}
function walkSteps(g) {
  const me = g.myColor, fens = gameFens(g), ev = g.analysis.ev.map(evObj), steps = [];
  for (let i = 0; i < g.moves.length; i++) {
    const turn = fens[i].split(' ')[1], mine = turn === me;
    const before = wpFor(ev[i], me), after = wpFor(ev[i + 1], me);
    const s = { ply: i, mine, fen: fens[i], uci: g.moves[i], san: g.sans[i], best: ev[i].best, bestSan: sanOf(fens[i], ev[i].best), wpBefore: before, wpAfter: after };
    if (mine) {
      s.drop = before - after;
      s.v = verdictOf(s.drop, s.uci, s.best);
      if (s.best && s.uci !== s.best && s.v.k !== 'blunder') {
        const bm = moveInfo(fens[i], s.best), b0 = CL.parseFen(fens[i]);
        const hi = bm && bm.captured && CL.VAL[bm.captured] >= 3 ? CL.hangingInfo(b0, bm.to) : null;
        if (hi && g.moves[i].slice(2, 4) !== bm.to) { s.v = { k: 'mistake', label: 'Missed free piece', cls: 'warn' }; s.problem = `Their ${PN(bm.captured)} on ${bm.to} was ${hi.reason === 'undefended' ? 'not protected' : 'attackable by your cheaper piece'}, and you didn't take it.`; }
      }
      if (!s.problem && (s.v.k === 'mistake' || s.v.k === 'blunder' || s.v.k === 'inacc')) {
        const m = (g.mistakes || []).find(x => x.ply === i);
        s.problem = m ? m.text : ((categorize(fens[i], fens[i + 1], s.uci, ev[i], ev[i + 1], me) || {}).text || '');
      }
    } else {
      s.gain = after - before;
      if (s.gain >= 15 && i + 1 < g.moves.length) s.punish = { best: ev[i + 1].best, bestSan: sanOf(fens[i + 1], ev[i + 1].best), played: g.sans[i + 1], found: g.moves[i + 1] === ev[i + 1].best || (wpFor(ev[i + 1], me) - wpFor(ev[i + 2], me)) < 5 };
    }
    steps.push(s);
  }
  return { steps, fens, ev };
}
function moveNo(g, ply) { const startB = g.fen0.split(' ')[1] === 'b'; const n = (+g.fen0.split(' ')[5] || 1) + Math.floor((ply + (startB ? 1 : 0)) / 2); const white = startB ? ply % 2 === 1 : ply % 2 === 0; return n + (white ? '.' : '...'); }

function openWalkthrough(id, startPly, onBack) {
  const g = S.games[id]; if (!g) return;
  if (!g.myColor) { openReview(id, 0, onBack); toast('Pick which side you played first.'); return; }
  if (!g.analysis) {
    const prog = h('div', { class: 'progress' }, h('i', { style: 'width:0%' }));
    openSession(h('div', { class: 'stack' }, sessTop('Walkthrough', 'vs ' + oppName(g), onBack), h('div', { class: 'card stack-s' }, h('p', null, 'Analyzing this game first…'), prog)));
    analyzeGame(g, p => (prog.firstChild.style.width = Math.round(p * 100) + '%')).then(() => { Store.saveGame(g); openWalkthrough(id, startPly, onBack); }).catch(() => toast('The engine could not start.'));
    return;
  }
  const { steps } = walkSteps(g);
  let k = Math.max(0, Math.min(steps.length - 1, startPly || 0));
  const board = new BoardView();
  const evbar = h('div', { class: 'evalbar' + (g.myColor === 'b' ? ' flip' : ''), title: 'Who is winning' }, h('i', { style: 'width:50%' }));
  const timeline = h('div', { class: 'timeline', role: 'group', 'aria-label': 'Your moves' });
  const card = h('div');
  const headline = h('div', { class: 'headline' });
  const quizSw = h('button', { class: 'switch', role: 'switch', 'aria-checked': String(!!S.settings.wtQuiz), 'aria-label': 'Quiz me on my mistakes', onclick: () => { S.settings.wtQuiz = !S.settings.wtQuiz; quizSw.setAttribute('aria-checked', String(S.settings.wtQuiz)); Store.saveProfile(); show(k); } });
  const prevB = h('button', { class: 'btn', 'aria-label': 'Previous move', onclick: () => show(k - 1) }, '‹');
  const nextB = h('button', { class: 'btn primary', onclick: () => show(k + 1) }, 'Next ›');
  const jumpB = h('button', { class: 'btn', onclick: () => { const n = steps.findIndex((s, j) => j > k && ((s.mine && s.v && (s.v.k === 'mistake' || s.v.k === 'blunder')) || (s.punish && !s.punish.found))); if (n >= 0) show(n); else toast('No more big moments after this one.'); } }, 'Mistakes »');
  const actions = h('div', { class: 'actions walk' }, prevB, nextB, jumpB);
  const o = outcomeOf(g);
  const counts = { best: 0, good: 0, inacc: 0, mistake: 0, blunder: 0 };
  steps.forEach(s => { if (s.mine) counts[s.v.k]++; });
  const el = h('div', { class: 'stack' },
    sessTop('Walkthrough vs ' + oppName(g), [g.date, o ? { w: 'Win', l: 'Loss', d: 'Draw' }[o] : null].filter(Boolean).join(' · '), onBack),
    h('div', { class: 'row' },
      h('span', { class: 'pill good' }, `${counts.best + counts.good} good`),
      h('span', { class: 'pill' }, `${counts.inacc} inaccurate`),
      h('span', { class: 'pill warn' }, `${counts.mistake} mistakes`),
      h('span', { class: 'pill bad' }, `${counts.blunder} blunders`)),
    timeline, h('p', { class: 'small muted' }, 'Each square is one of your moves. Red arrow: your move. Green: the better move.'),
    headline, board.el, evbar, card,
    h('div', { class: 'toggle' }, h('div', null, h('b', null, 'Quiz me on my mistakes'), h('div', { class: 'small muted' }, 'At each mistake, try to find the better move before seeing it')), quizSw),
    actions);
  openSession(el);
  // timeline of your moves
  steps.forEach((s, j) => {
    if (!s.mine) return;
    timeline.append(h('button', { class: 'tl ' + s.v.k, title: moveNo(g, s.ply) + ' ' + s.san, 'aria-label': `${moveNo(g, s.ply)} ${s.san}: ${s.v.label}`, onclick: () => show(j) }));
  });

  function setEval(wpMe) { evbar.firstChild.style.width = (g.myColor === 'b' ? wpMe : wpMe) + '%'; }
  function show(j) {
    k = Math.max(0, Math.min(steps.length - 1, j));
    const s = steps[k];
    [...timeline.children].forEach(b => b.classList.remove('cur'));
    const tIdx = steps.slice(0, k + 1).filter(x => x.mine).length - 1;
    if (s.mine && timeline.children[tIdx]) { timeline.children[tIdx].classList.add('cur'); timeline.children[tIdx].scrollIntoView({ block: 'nearest', inline: 'center' }); }
    prevB.disabled = k === 0; nextB.disabled = k === steps.length - 1;
    // eval bar shows white's share; flip class handles orientation
    const wW = g.myColor === 'w' ? s.wpBefore : 100 - s.wpBefore;
    evbar.firstChild.style.width = (g.myColor === 'b' ? 100 - wW : wW) + '%';
    const label = `${moveNo(g, s.ply)} `;
    if (!s.mine) headline.replaceChildren(h('span', { class: 'muted' }, `${label}${oppName(g)} plays `), h('b', null, s.san), s.punish && !s.punish.found ? h('span', { class: 'pill warn' }, 'Chance for you') : null);
    else headline.replaceChildren(h('span', { class: 'muted' }, `${label}You played `), h('b', null, s.san), h('span', { class: 'pill ' + s.v.cls }, s.v.label), s.v.k === 'best' || s.v.k === 'good' ? null : h('span', { class: 'better' }, 'Better: ', h('b', null, s.bestSan)));
    if (!s.mine) {
      board.set({ fen: s.fen, orient: g.myColor, lastMove: s.ply ? g.moves[s.ply - 1] : null, arrows: [arrowOf(s.uci, 'info')], marks: {}, interactive: false, onMove: null });
      const kids = [h('div', { class: 'eyebrow' }, `${label}${oppName(g)}'s move`), h('h3', null, `They play ${s.san}`)];
      if (s.punish) kids.push(h('p', { class: 'small' }, `That was a mistake by them. ${s.punish.found ? `You punished it with ${s.punish.played}. Nice.` : `Your best answer was ${s.punish.bestSan}, but you played ${s.punish.played}.`}`));
      else kids.push(h('p', { class: 'small muted' }, standing(100 - (100 - s.wpAfter)) ));
      card.replaceChildren(h('div', { class: 'feedback' + (s.punish ? ' warn' : '') + ' stack-s' }, kids));
      return;
    }
    const bad = s.v.k === 'mistake' || s.v.k === 'blunder';
    const quiz = bad && S.settings.wtQuiz && !s.quizDone;
    if (quiz) {
      board.set({ fen: s.fen, orient: g.myColor, lastMove: s.ply ? g.moves[s.ply - 1] : null, arrows: [], marks: {}, interactive: true, movable: g.myColor, onMove: u => tryQuiz(s, u) });
      card.replaceChildren(h('div', { class: 'feedback warn stack-s' },
        h('div', { class: 'eyebrow' }, `${label}Your move · ${standing(s.wpBefore)}`),
        h('h3', null, `In the game you played ${s.san}, a ${s.v.label.toLowerCase()}. Find something better.`),
        h('p', { class: 'small muted' }, 'Make a move on the board.'),
        h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => { s.quizDone = true; show(k); } }, 'Show me'))));
      return;
    }
    const arrows = [];
    if (s.uci === s.best) arrows.push(arrowOf(s.uci, 'good'));
    else { arrows.push(arrowOf(s.uci, bad ? 'bad' : 'info')); if (s.best) arrows.push(arrowOf(s.best, 'good')); }
    board.set({ fen: s.fen, orient: g.myColor, lastMove: s.ply ? g.moves[s.ply - 1] : null, arrows, marks: {}, interactive: false, onMove: null });
    const kids = [h('div', { class: 'spread' }, h('div', { class: 'eyebrow' }, `${label}Your move`), h('span', { class: 'pill ' + s.v.cls }, s.v.label)), h('h3', null, `You played ${s.san}`)];
    if (s.v.k === 'best') kids.push(h('p', { class: 'small' }, `That's exactly what the engine would play. ${whyBest(s.fen, s.uci)}`));
    else if (s.v.k === 'good') kids.push(h('p', { class: 'small' }, `Fine move. The engine slightly preferred ${s.bestSan}.`));
    else {
      if (s.problem) kids.push(h('p', { class: 'small' }, s.problem));
      kids.push(h('p', { class: 'small' }, h('b', null, `Better: ${s.bestSan}. `), whyBest(s.fen, s.best)));
      const lineEl = h('p', { class: 'small muted' }, 'Finding the best line…');
      kids.push(lineEl);
      Engine.run(s.fen, { depth: 12 }).then(r => { if (r.pv[0] !== s.best) { lineEl.remove(); return; } lineEl.textContent = 'How it continues: ' + pvSan(s.fen, r.pv, 6).join(' '); }).catch(() => lineEl.remove());
    }
    kids.push(h('p', { class: 'small muted' }, standing(s.wpBefore) + (s.mine && s.drop >= 10 ? ` After your move: ${standing(s.wpAfter).toLowerCase()}` : '')));
    card.replaceChildren(h('div', { class: 'feedback ' + (bad ? (s.v.k === 'blunder' ? 'bad' : 'warn') : s.v.cls === 'good' ? 'good' : '') + ' stack-s' }, kids));
  }
  async function tryQuiz(s, u) {
    board.set({ interactive: false });
    let ok = u === s.best;
    if (!ok) {
      const c = new Chess(s.fen); uciMove(c, u);
      try { const r = await evalPos(c.fen(), 11); ok = s.wpBefore - wpFor(r, g.myColor) < 5; } catch (e) {}
    }
    s.quizDone = true; show(k);
    const head = card.querySelector('.feedback');
    head && head.prepend(h('div', { class: 'pill ' + (ok ? 'good' : 'bad') }, ok ? `Your answer ${sanOf(s.fen, u)} works!` : `${sanOf(s.fen, u)} isn't it. Here's the better move.`));
  }
  show(k);
}

async function askCoach(out, g, m, fens) {
  out.textContent = 'Thinking…';
  let s = null;
  try { s = window.claude && window.claude.use ? await window.claude.use('sample') : null; } catch (e) {}
  if (!s) { out.textContent = 'Coach chat isn\'t available here. The explanation above comes from the engine.'; return; }
  let line = [];
  try { const r = await Engine.run(fens[m.ply + 1], { depth: 12 }); line = pvSan(fens[m.ply + 1], r.pv, 5); } catch (e) {}
  const me = g.myColor === 'w' ? 'White' : 'Black';
  const facts = [
    `Position before the move (FEN): ${fens[m.ply]}`,
    `The student plays ${me}. They played ${m.san}.`,
    `Engine's best move instead: ${m.bestSan || 'unknown'}.`,
    `Opponent's best reply after ${m.san}: ${m.replySan || 'unknown'}. Engine line after ${m.san}: ${line.join(' ') || 'n/a'}.`,
    `Category: ${CATS[m.cat].label}. Summary: ${m.text}`,
    `Win chance dropped by about ${m.drop} percentage points.`,
  ].join('\n');
  const prompt = `You are a warm, direct chess coach for a complete beginner who keeps losing to friends.\nFacts from a chess engine (trust them; do not invent other tactics or piece locations beyond what the FEN shows):\n${facts}\n\nIn 3 or 4 short sentences of plain English: say what went wrong with ${m.san}, why ${m.bestSan || 'the better move'} is better, and one habit that would have caught it. Use square names only when they help. No headings, no lists, no em dashes.`;
  try { await s(prompt, { onText: ({ text }) => { out.textContent = text; } }); }
  catch (e) { out.textContent = e && e.text ? e.text : (e && e.code === 'rate_limited' ? 'The coach is busy. Try again in a minute.' : 'Coach isn\'t available right now.'); }
}

// ---------- boot ----------
function boot() {
  const nav = $('#tabs .inner');
  TABS.forEach(([k, n]) => nav.append(h('button', { class: 'tab', 'data-tab': k, onclick: () => go(k) }, svgIcon(k), n)));
  Store.loadLocal();
  ensureDaily();
  $('#who').textContent = S.settings.username;
  rerender();
  Store.connect().then(() => { $('#who').textContent = S.settings.username; return loadBundledGames(); });
  // warm the engine a little after load so it's ready when needed
  setTimeout(() => Engine.boot().catch(() => {}), 1500);
  if (Object.values(S.games).some(g => !g.analysis)) setTimeout(analyzeAll, 2500);
}
boot();

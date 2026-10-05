// Puzzle generator: beginner-strength self-play, extract unique-solution tactics.
const { spawn } = require('child_process');
const fs = require('fs');
const { Chess } = require('chess.js');
const CL = require('./logic.js');

const OUT = process.argv[2] || 'puz.jsonl';
const DEADLINE = Date.now() + (+process.argv[3] || 20) * 60000;
let seed = +(process.argv[4] || 1);
const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

class Engine {
  constructor() {
    this.p = spawn('node', [__dirname + '/node_modules/stockfish/bin/stockfish-18-lite-single.js']);
    this.buf = ''; this.lines = []; this.waiter = null;
    this.p.stdout.on('data', d => {
      this.buf += d; let i;
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const l = this.buf.slice(0, i).trim(); this.buf = this.buf.slice(i + 1);
        this.lines.push(l);
        if (this.waiter && this.waiter.test(l)) { const w = this.waiter; this.waiter = null; w.res(this.lines); this.lines = []; }
      }
    });
  }
  send(c) { this.p.stdin.write(c + '\n'); }
  wait(re) { return new Promise(res => { this.waiter = { test: l => re.test(l), res }; }); }
  async init(opts) { this.send('uci'); await this.wait(/^uciok/); for (const [k, v] of Object.entries(opts)) this.send(`setoption name ${k} value ${v}`); this.send('isready'); await this.wait(/^readyok/); }
  async go(fen, cmd) {
    this.lines = []; this.send('position fen ' + fen); this.send(cmd);
    const lines = await this.wait(/^bestmove/);
    const pv = {};
    for (const l of lines) {
      if (!l.startsWith('info') || !l.includes(' pv ')) continue;
      const mp = +(l.match(/multipv (\d+)/) || [0, 1])[1];
      const m = l.match(/score (cp|mate) (-?\d+)/); if (!m) continue;
      const score = m[1] === 'cp' ? +m[2] : (+m[2] > 0 ? 100000 - +m[2] : -100000 - +m[2]);
      pv[mp] = { score, mate: m[1] === 'mate' ? +m[2] : null, pv: l.split(' pv ')[1].split(' ') };
    }
    return { best: lines[lines.length - 1].split(' ')[1], pv };
  }
}

const OPENINGS = [
  [], ['e2e4', 'e7e5'], ['e2e4', 'e7e5', 'g1f3', 'b8c6'], ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4'], ['d2d4', 'd7d5'],
  ['e2e4', 'c7c5'], ['e2e4', 'e7e5', 'd1h5'], ['e2e4', 'e7e5', 'f1c4', 'g8f6'], ['d2d4', 'g8f6'], ['e2e4', 'd7d5'],
  ['e2e4', 'e7e6'], ['c2c4', 'e7e5'], ['g1f3', 'd7d5'], ['e2e4', 'e7e5', 'g1f3', 'd7d6'], ['e2e4', 'e7e5', 'b1c3'],
];
const TARGET = { mate1: 45, mate2: 35, free: 45, fork: 40, winmat: 35, save: 45, stopmate: 25 };
const counts = Object.fromEntries(Object.keys(TARGET).map(k => [k, 0]));
const seen = new Set();

const sqName = s => s;
const colorName = c => (c === 'w' ? 'white' : 'black');

function uciToMove(ch, u) { return ch.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || 'q' }); }

function classify(fen, first, top, second, prevScoreForMover) {
  const ch = new Chess(fen);
  const b0 = CL.parseFen(fen);
  const me = ch.turn(), opp = me === 'w' ? 'b' : 'w';
  const mv = uciToMove(ch, first); if (!mv) return null;
  const b1 = CL.parseFen(ch.fen());
  // Mates
  if (top.mate === 1) {
    const c2 = new Chess(fen); const alts = c2.moves({ verbose: true }).filter(m => { c2.move(m); const ok = c2.in_checkmate(); c2.undo(); return ok; }).map(m => m.from + m.to + (m.promotion || ''));
    return { theme: 'mate1', moves: [first], alts, explain: `${mv.san.replace('#','')} is checkmate. The king is in check and has no safe square to escape to.` };
  }
  if (top.mate === 2) {
    if (second && second.mate != null && second.mate > 0 && second.mate <= 2) return null; // must be unique first move
    if (top.pv.length < 3) return null;
    return { theme: 'mate2', moves: top.pv.slice(0, 3), alts: [], explain: `${mv.san} forces checkmate next move. Whatever they reply, you finish with a mate.` };
  }
  if (top.mate != null) return null;
  // Material/only-move puzzles
  const gap = top.score - (second ? second.score : -9999);
  if (gap < 250) return null;
  if (second && second.mate != null && second.mate < 0 && top.score > -200) {
    return { theme: 'stopmate', moves: [first], alts: [], explain: `They were threatening checkmate. ${mv.san} is the only move that stops it. Always ask: what does their last move threaten?` };
  }
  const myHang = CL.hangingPieces(b0, me).filter(h => CL.VAL[h.piece.type] >= 3);
  if (top.score >= 250 && prevScoreForMover <= 120) {
    if (mv.captured) {
      const recapt = CL.attackers(b1, mv.to, opp).length > 0;
      if (!recapt && CL.VAL[mv.captured] >= 3)
        return { theme: 'free', moves: [first], alts: [], explain: `The ${colorName(opp)} ${CL.NAME[mv.captured]} on ${mv.to} had no defender. ${mv.san} wins it for free.` };
    }
    const ft = CL.forkTargets(b1, mv.to);
    if (ft.length >= 2) {
      const names = ft.map(t => CL.NAME[b1[t].type] + ' on ' + t);
      return { theme: 'fork', moves: [first], alts: [], explain: `${mv.san} attacks two things at once: the ${names[0]} and the ${names[1]}. They can only save one.` };
    }
    if (mv.captured && CL.VAL[mv.captured] > CL.VAL[mv.piece])
      return { theme: 'winmat', moves: [first], alts: [], explain: `Your ${CL.NAME[mv.piece]} takes a ${CL.NAME[mv.captured]}, which is worth more. Even if they take back, you come out ahead.` };
    return { theme: 'winmat', moves: [first], alts: [], explain: `${mv.san} wins material. Follow-up: ${top.pv.slice(0, 4).join(' ')}.`, uciExplain: true };
  }
  if (top.score > -150 && top.score < 250 && myHang.length) {
    const h = myHang.find(h => h.square === mv.from);
    const b1Hang = CL.hangingPieces(b1, me).filter(x => CL.VAL[x.piece.type] >= 3);
    if (h && !b1Hang.length)
      return { theme: 'save', moves: [first], alts: [], explain: `Your ${CL.NAME[h.piece.type]} on ${h.square} was under attack${h.reason === 'undefended' ? ' with no defender' : ' by a cheaper piece'}. ${mv.san} moves it to safety. Every other move loses material.` };
    if (!b1Hang.length)
      return { theme: 'save', moves: [first], alts: [], explain: `Your ${CL.NAME[myHang[0].piece.type]} on ${myHang[0].square} was in danger. ${mv.san} solves the problem. Every other move loses material.` };
  }
  return null;
}

(async () => {
  const player = new Engine(), analyst = new Engine();
  await player.init({ 'Skill Level': 2, Hash: 16 });
  await analyst.init({ MultiPV: 2, Hash: 32 });
  const out = fs.createWriteStream(OUT, { flags: 'a' });
  let games = 0;
  while (Date.now() < DEADLINE && Object.keys(TARGET).some(k => counts[k] < TARGET[k])) {
    games++;
    const ch = new Chess();
    for (const u of OPENINGS[Math.floor(rnd() * OPENINGS.length)]) uciToMove(ch, u);
    const skW = Math.floor(rnd() * 5), skB = Math.floor(rnd() * 5);
    let prev = null; // analysis of previous position
    const perGame = {}; let gameTotal = 0;
    for (let ply = 0; ply < 120 && !ch.game_over(); ply++) {
      const fen = ch.fen();
      const a = await analyst.go(fen, 'go depth 11');
      const top = a.pv[1], second = a.pv[2];
      if (top && prev && prev.pv[1] && ch.history().length >= 6) {
        const prevForMover = -prev.pv[1].score;
        const key = fen.split(' ').slice(0, 2).join(' ');
        const legal = ch.moves().length;
        if (!seen.has(key) && legal >= 3) {
          const c = classify(fen, top.pv[0], top, second, prevForMover);
          const mm = CL.material(CL.parseFen(fen));
          if (c && counts[c.theme] < TARGET[c.theme] && !perGame[c.theme] && gameTotal < 2 && Math.abs(mm.w - mm.b) <= 6) {
            // verify deeper
            const v = await analyst.go(fen, 'go depth 17');
            const c2 = v.pv[1] && v.pv[1].pv[0] === top.pv[0] ? classify(fen, v.pv[1].pv[0], v.pv[1], v.pv[2], prevForMover) : null;
            if (c2 && c2.theme === c.theme) {
              seen.add(key); counts[c.theme]++; perGame[c.theme] = 1; gameTotal++;
              const m = CL.material(CL.parseFen(fen));
              out.write(JSON.stringify({ fen, ...c2, score: v.pv[1].score, lastMove: ch.history({ verbose: true }).slice(-1)[0] ? (() => { const l = ch.history({ verbose: true }).slice(-1)[0]; return l.from + l.to; })() : null, mat: m.w + m.b }) + '\n');
            }
          }
        }
      }
      // pick move
      if (ch.history().length >= 4 && rnd() < 0.18) {
        const ms = ch.moves({ verbose: true });
        ch.move(ms[Math.floor(rnd() * ms.length)]);
      } else {
        await player.init({ 'Skill Level': ch.turn() === 'w' ? skW : skB });
        const p = await player.go(fen, 'go depth 6');
        if (!p.best || p.best === '(none)') break;
        uciToMove(ch, p.best);
      }
      prev = a;
    }
    if (games % 5 === 0) console.log(games, JSON.stringify(counts));
  }
  console.log('done', games, JSON.stringify(counts));
  out.end(); process.exit(0);
})();

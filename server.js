const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const rooms = new Map();

// ── Helpers ───────────────────────────────────────────────────────────────────
function randCode() {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 4 }, () => c[Math.floor(Math.random() * c.length)]).join('');
}
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function deal(deck, n) { return deck.splice(0, Math.min(n, deck.length)); }

// ── Card Definitions ──────────────────────────────────────────────────────────
const GENERIC_QUESTIONS = [
  "What's my all-time favorite food or dish?",
  "What song always puts me in a good mood?",
  "What's my biggest dream or goal in life?",
  "What's one thing that always makes me laugh?",
  "What's my love language?",
  "What's one thing I'm secretly really proud of?"
];

const LUCK_CARDS = [
  { subtype: 'roll_standard',  desc: "1–2: lose 1pt · 3–4: gain 1pt · 5–6: gain 2pts" },
  { subtype: 'roll_steal',     desc: "Odd roll: steal 1pt from partner · Even roll: gain 1pt" },
  { subtype: 'roll_extremes',  desc: "Roll 6: gain 3pts · Roll 1: lose 2pts · Anything else: gain 1pt" },
  { subtype: 'roll_high',      desc: "Roll above 3: gain 2pts · Roll 3 or less: nothing happens" },
  { subtype: 'roll_partner',   desc: "Roll for your partner — they gain that many points ÷ 2 (rounded up)" },
  { subtype: 'roll_evenodd',   desc: "Even roll: gain 2pts · Odd roll: lose 1pt" },
  { subtype: 'roll_jackpot',   desc: "Roll 1: nothing · Roll 2–5: gain 1pt · Roll 6: gain 3pts!" },
  { subtype: 'roll_threshold', desc: "Roll 4 or higher: gain that many points · Roll 3 or less: nothing" }
];

const SHIELD_DESCS = [
  "Guard! Your next point loss is blocked.",
  "Fortify! Block your next incoming point loss.",
  "Barrier! Next time you'd lose points, you don't.",
  "Ward! Cancel your next score penalty.",
  "Protect! Your score is safe for one incoming hit.",
  "Deflect! Block the next thing that would cost you points."
];

const WILD_CARDS = [
  { subtype: 'swap_hands',  desc: "Swap your entire hand with your partner's!" },
  { subtype: 'double_next', desc: "Your next point gain this turn is doubled." },
  { subtype: 'peek',        desc: "Peek at your partner's entire hand for 5 seconds." },
  { subtype: 'extra_turn',  desc: "Play another card immediately — take an extra turn!" },
  { subtype: 'both_draw',   desc: "Both players draw 2 extra cards from the deck." },
  { subtype: 'draw_three',  desc: "Draw 3 cards from the deck directly into your hand." }
];

function buildDeck(customCards) {
  const deck = [];
  GENERIC_QUESTIONS.forEach((q, i) =>
    deck.push({ id: `gm${i}`, type: 'memory', subtype: 'generic', icon: '💌', name: 'Memory', question: q, owner: null }));
  customCards.forEach((c, i) =>
    deck.push({ id: `cm${i}`, type: 'memory', subtype: 'custom', icon: '💌', name: 'Memory', question: c.question, owner: c.owner, ownerName: c.ownerName }));
  for (let i = 0; i < 4; i++)
    deck.push({ id: `dr${i}`, type: 'duel', subtype: 'rps', icon: '✊', name: 'Duel', desc: 'Both pick secretly — Rock, Paper, or Scissors. Winner gets 2 pts!' });
  for (let i = 0; i < 4; i++)
    deck.push({ id: `dt${i}`, type: 'duel', subtype: 'tap', icon: '⚡', name: 'Speed Duel', desc: 'A button appears after a random delay — tap it first to win 2 pts!' });
  LUCK_CARDS.forEach((l, i) =>
    deck.push({ id: `lk${i}`, type: 'luck', icon: '🎲', name: 'Luck', ...l }));
  SHIELD_DESCS.forEach((desc, i) =>
    deck.push({ id: `sh${i}`, type: 'shield', icon: '🛡️', name: 'Shield', desc }));
  WILD_CARDS.forEach((w, i) =>
    deck.push({ id: `wl${i}`, type: 'wild', icon: '✨', name: 'Wild', ...w }));
  return shuffle(deck);
}

// ── Room Helpers ──────────────────────────────────────────────────────────────
function newRoom() {
  let code;
  do { code = randCode(); } while (rooms.has(code));
  const room = {
    code, phase: 'lobby', players: [], deck: [], customQs: {},
    activeCard: null, currentTurn: 0, rpsChoices: {}, tapWinner: null,
    shielded: {}, doubleNext: {}, extraTurn: false
  };
  rooms.set(code, room);
  return room;
}
function bySocket(sid) {
  for (const r of rooms.values()) if (r.players.some(p => p.id === sid)) return r;
  return null;
}
function getMe(room, sid)  { return room.players.find(p => p.id === sid); }
function getOpp(room, sid) { return room.players.find(p => p.id !== sid); }

function broadcast(room) {
  room.players.forEach((p, i) => {
    const o = room.players[1 - i];
    io.to(p.id).emit('state', {
      myIndex: i, myHand: p.hand, myScore: p.score,
      myName: p.name, opName: o?.name || '...', opScore: o?.score || 0,
      opCards: o?.hand?.length || 0, deckLeft: room.deck.length,
      currentTurn: room.currentTurn, isMyTurn: room.currentTurn === i,
      phase: room.phase, shielded: !!room.shielded[p.id],
      doubleActive: !!room.doubleNext[p.id]
    });
  });
}

function checkWin(room) {
  for (const p of room.players) if (p.score >= 10) return p;
  if (room.deck.length === 0 && room.players.every(p => p.hand.length === 0)) {
    const [a, b] = room.players;
    return a.score >= b.score ? a : b;
  }
  return null;
}

function advance(room) {
  if (room.extraTurn) {
    room.extraTurn = false; room.activeCard = null; broadcast(room); return;
  }
  room.currentTurn = 1 - room.currentTurn;
  room.activeCard = null;
  const p = room.players[room.currentTurn];
  if (p.hand.length < 5 && room.deck.length > 0)
    p.hand.push(...deal(room.deck, Math.min(5 - p.hand.length, room.deck.length)));
  const winner = checkWin(room);
  if (winner) {
    room.phase = 'over';
    io.to(room.code).emit('gameover', { winner: winner.name, winnerId: winner.id });
    return;
  }
  broadcast(room);
}

function resolveLuck(room, card, sid) {
  const p = getMe(room, sid);
  const o = getOpp(room, sid);
  const roll = Math.floor(Math.random() * 6) + 1;
  let pd = 0, od = 0, note = '';
  const mult = room.doubleNext[sid] ? 2 : 1;
  room.doubleNext[sid] = false;

  switch (card.subtype) {
    case 'roll_standard':  pd = roll <= 2 ? -1 : roll <= 4 ? 1 : 2; break;
    case 'roll_steal':
      if (roll % 2 !== 0) { pd = 1; od = -1; } else { pd = 1; } break;
    case 'roll_extremes':  pd = roll === 6 ? 3 : roll === 1 ? -2 : 1; break;
    case 'roll_high':      pd = roll > 3 ? 2 : 0; break;
    case 'roll_partner':   if (o) od = Math.ceil(roll / 2); break;
    case 'roll_evenodd':   pd = roll % 2 === 0 ? 2 : -1; break;
    case 'roll_jackpot':   pd = roll === 1 ? 0 : roll <= 5 ? 1 : 3; break;
    case 'roll_threshold': pd = roll >= 4 ? roll : 0; break;
  }

  pd *= mult;

  // Shield checks
  if (pd < 0 && room.shielded[sid]) {
    note = '🛡️ Your Shield blocked the point loss!'; pd = 0; room.shielded[sid] = false;
  }
  if (od < 0 && o && room.shielded[o.id]) {
    note = "🛡️ Partner's Shield blocked the steal!"; od = 0; room.shielded[o.id] = false;
  }

  p.score = Math.max(0, p.score + pd);
  if (o) o.score = Math.max(0, o.score + od);
  return { roll, pd, od, note, playerName: p.name, opName: o?.name };
}

function resolveWild(room, card, sid) {
  const p = getMe(room, sid);
  const o = getOpp(room, sid);
  let msg = '';
  switch (card.subtype) {
    case 'swap_hands':
      if (o) { const t = p.hand; p.hand = o.hand; o.hand = t; }
      msg = `✨ ${p.name} swapped hands with ${o?.name || 'partner'}!`; break;
    case 'double_next':
      room.doubleNext[sid] = true;
      msg = `✨ ${p.name}'s next point gain is doubled!`; break;
    case 'peek':
      if (o) io.to(sid).emit('peek', { hand: o.hand });
      msg = `✨ ${p.name} peeked at ${o?.name || 'partner'}'s hand!`; break;
    case 'extra_turn':
      room.extraTurn = true;
      msg = `✨ ${p.name} gets an extra turn!`; break;
    case 'both_draw':
      [p, o].forEach(pl => { if (pl && room.deck.length > 0) pl.hand.push(...deal(room.deck, Math.min(2, room.deck.length))); });
      msg = '✨ Both players drew 2 extra cards!'; break;
    case 'draw_three':
      p.hand.push(...deal(room.deck, Math.min(3, room.deck.length)));
      msg = `✨ ${p.name} drew 3 cards!`; break;
  }
  return { msg };
}

// ── Socket.IO ─────────────────────────────────────────────────────────────────
io.on('connection', socket => {

  socket.on('create', ({ name }) => {
    const room = newRoom();
    room.players.push({ id: socket.id, name: (name || 'Player 1').trim().slice(0, 20), score: 0, hand: [] });
    socket.join(room.code);
    socket.emit('created', { code: room.code });
  });

  socket.on('join', ({ code, name }) => {
    const room = rooms.get(code?.toUpperCase().trim());
    if (!room) return socket.emit('err', 'Room not found — double-check the code!');
    if (room.players.length >= 2) return socket.emit('err', 'This room is already full!');
    if (room.phase !== 'lobby') return socket.emit('err', 'This game has already started.');
    room.players.push({ id: socket.id, name: (name || 'Player 2').trim().slice(0, 20), score: 0, hand: [] });
    socket.join(room.code);
    socket.emit('joined', { code: room.code, partnerName: room.players[0].name });
    io.to(room.code).emit('ready', { names: room.players.map(p => p.name) });
    room.phase = 'setup';
    io.to(room.code).emit('phase', 'setup');
  });

  socket.on('questions', ({ qs }) => {
    const room = bySocket(socket.id);
    if (!room || room.phase !== 'setup') return;
    const p = getMe(room, socket.id);
    room.customQs[socket.id] = qs.slice(0, 3).filter(q => q.trim()).map(q => ({
      question: q.trim().slice(0, 150), owner: socket.id, ownerName: p.name
    }));
    socket.emit('qsaved');
    if (Object.keys(room.customQs).length === 2) {
      const allCustom = Object.values(room.customQs).flat();
      room.deck = buildDeck(allCustom);
      room.players.forEach(p => { p.hand = deal(room.deck, 5); p.score = 0; });
      room.phase = 'game';
      io.to(room.code).emit('phase', 'game');
      broadcast(room);
    }
  });

  socket.on('play', ({ id }) => {
    const room = bySocket(socket.id);
    if (!room || room.phase !== 'game') return;
    const pidx = room.players.findIndex(p => p.id === socket.id);
    if (room.currentTurn !== pidx) return socket.emit('err', 'Not your turn!');
    const p = room.players[pidx];
    const ci = p.hand.findIndex(c => c.id === id);
    if (ci === -1) return;
    const card = p.hand.splice(ci, 1)[0];
    room.activeCard = card;
    io.to(room.code).emit('played', { card, by: p.name, byIdx: pidx });

    if (card.type === 'memory') {
      io.to(room.code).emit('memoryq', { card, askerId: socket.id, askerName: p.name });
    } else if (card.type === 'luck') {
      const res = resolveLuck(room, card, socket.id);
      io.to(room.code).emit('luckresolve', { card, ...res });
      setTimeout(() => { broadcast(room); advance(room); }, 3000);
    } else if (card.type === 'shield') {
      room.shielded[socket.id] = true;
      io.to(room.code).emit('shieldset', { playerName: p.name, desc: card.desc });
      setTimeout(() => { broadcast(room); advance(room); }, 2500);
    } else if (card.type === 'wild') {
      const { msg } = resolveWild(room, card, socket.id);
      io.to(room.code).emit('wildresolve', { card, msg });
      setTimeout(() => { broadcast(room); advance(room); }, 2800);
    } else if (card.type === 'duel') {
      if (card.subtype === 'rps') {
        room.rpsChoices = {};
        io.to(room.code).emit('rpsstart', { card });
      } else {
        room.tapWinner = null;
        const delay = 2000 + Math.random() * 3000;
        io.to(room.code).emit('tapstart', { card });
        setTimeout(() => io.to(room.code).emit('tapgo'), delay);
      }
    }
    broadcast(room);
  });

  socket.on('memoryanswer', ({ answer }) => {
    const room = bySocket(socket.id);
    if (!room || !room.activeCard || room.activeCard.type !== 'memory') return;
    const p = getMe(room, socket.id);
    const asker = getOpp(room, socket.id);
    if (asker) io.to(asker.id).emit('memoryanswerreceived', { answer: answer.slice(0, 200), answererName: p.name });
  });

  socket.on('judge', ({ correct }) => {
    const room = bySocket(socket.id);
    if (!room || !room.activeCard || room.activeCard.type !== 'memory') return;
    const asker = getMe(room, socket.id);
    const answerer = getOpp(room, socket.id);
    let pts = 0, scorerName = '';
    if (correct) {
      const mult = room.doubleNext[answerer?.id] ? 2 : 1;
      room.doubleNext[answerer?.id] = false;
      pts = 2 * mult;
      if (answerer) { answerer.score += pts; scorerName = answerer.name; }
    } else {
      const mult = room.doubleNext[socket.id] ? 2 : 1;
      room.doubleNext[socket.id] = false;
      pts = 1 * mult;
      asker.score += pts; scorerName = asker.name;
    }
    io.to(room.code).emit('memoryjudged', { correct, pts, scorerName });
    setTimeout(() => { broadcast(room); advance(room); }, 2800);
  });

  socket.on('rpschoice', ({ choice }) => {
    const room = bySocket(socket.id);
    if (!room || !room.activeCard || room.activeCard.subtype !== 'rps') return;
    room.rpsChoices[socket.id] = choice;
    if (Object.keys(room.rpsChoices).length === 2) {
      const [p0, p1] = room.players;
      const c0 = room.rpsChoices[p0.id], c1 = room.rpsChoices[p1.id];
      const beats = { rock: 'scissors', scissors: 'paper', paper: 'rock' };
      let wid = null;
      if (beats[c0] === c1) wid = p0.id;
      else if (beats[c1] === c0) wid = p1.id;
      if (wid) {
        const w = getMe(room, wid);
        const mult = room.doubleNext[wid] ? 2 : 1;
        room.doubleNext[wid] = false;
        w.score += 2 * mult;
      }
      io.to(room.code).emit('rpsresult', {
        choices: { [p0.id]: c0, [p1.id]: c1 },
        names: { [p0.id]: p0.name, [p1.id]: p1.name },
        winnerId: wid, winnerName: wid ? getMe(room, wid)?.name : null
      });
      setTimeout(() => { broadcast(room); advance(room); }, 3000);
    }
  });

  socket.on('tap', () => {
    const room = bySocket(socket.id);
    if (!room || !room.activeCard || room.activeCard.subtype !== 'tap' || room.tapWinner) return;
    room.tapWinner = socket.id;
    const w = getMe(room, socket.id);
    const mult = room.doubleNext[socket.id] ? 2 : 1;
    room.doubleNext[socket.id] = false;
    w.score += 2 * mult;
    io.to(room.code).emit('tapresult', { winnerId: socket.id, winnerName: w.name });
    setTimeout(() => { broadcast(room); advance(room); }, 2500);
  });

  socket.on('disconnect', () => {
    const room = bySocket(socket.id);
    if (!room) return;
    const p = getMe(room, socket.id);
    const o = getOpp(room, socket.id);
    if (o) io.to(o.id).emit('partnerleft', { name: p?.name });
    setTimeout(() => rooms.delete(room.code), 90000);
  });
});

server.listen(PORT, () => console.log(`💌 Us: The Deck running on http://localhost:${PORT}`));

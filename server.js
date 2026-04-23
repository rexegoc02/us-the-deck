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

// ── Question Pool (auto-generated, no player input needed) ────────────────────
const QUESTION_POOL = [
  "What's my all-time favorite food or dish?",
  "What song instantly puts me in a good mood?",
  "Where in the world do I most want to take you?",
  "What's my love language?",
  "What always makes me laugh without fail?",
  "What's my biggest dream in life?",
  "What's my idea of a perfect date night?",
  "What's the sweetest thing I've ever done for you?",
  "What always cheers me up when I'm feeling down?",
  "What do I find most attractive about you?",
  "What's my go-to drink order?",
  "What's something small I do that makes you feel loved?",
  "What's my most embarrassing habit you've witnessed?",
  "Rate my cooking honestly from 1 to 10!",
  "What do I do that secretly annoys you the most?",
  "What's the weirdest thing I've ever said to you?",
  "What's the most ridiculous argument we've ever had?",
  "What am I most likely doing at 2am?",
  "What nickname best describes my personality?",
  "What would be the title of my autobiography?",
  "What's something I'm surprisingly competitive about?",
  "What's the strangest food combination I actually enjoy?",
  "What celebrity do I secretly think I resemble?",
  "If I were a TV show character, who would I be?",
  "What's the dumbest thing I've ever done in front of you?",
  "What's my biggest guilty pleasure I try to hide?",
  "What would I do first if I won the lottery tomorrow?",
  "What's my worst quality that you've learned to love?",
  "What's one thing you wish I would stop doing forever?",
  "What's the most trouble I've ever gotten us into?"
];

// ── Card Definitions ──────────────────────────────────────────────────────────
const LUCK_CARDS = [
  { subtype: 'roll_standard',  desc: "1–2: lose 1pt · 3–4: gain 1pt · 5–6: gain 2pts" },
  { subtype: 'roll_steal',     desc: "Odd: steal 1pt from partner · Even: gain 1pt" },
  { subtype: 'roll_extremes',  desc: "6 = gain 3pts · 1 = lose 2pts · else = gain 1pt" },
  { subtype: 'roll_high',      desc: "Roll above 3: gain 2pts · 3 or less: nothing" },
  { subtype: 'roll_partner',   desc: "Roll for your partner — they gain that many ÷ 2 pts" },
  { subtype: 'roll_evenodd',   desc: "Even roll: gain 2pts · Odd roll: lose 1pt" },
  { subtype: 'roll_jackpot',   desc: "1: nothing · 2–5: gain 1pt · 6: gain 3pts!" },
  { subtype: 'roll_threshold', desc: "Roll 4+: gain that many points · 3 or less: nothing" }
];

// Shield cards with real offensive effects when they activate
const SHIELD_CARDS = [
  { subtype: 'basic',      desc: "Guard! Block your next point loss.",                icon: '🛡️' },
  { subtype: 'retaliate',  desc: "Counter! Block + deal 1pt damage to partner!",      icon: '⚔️' },
  { subtype: 'mirror',     desc: "Mirror! Reflect the luck effect back at partner!",  icon: '🪞' },
  { subtype: 'steal',      desc: "Thief! Block + steal 1pt from your partner!",       icon: '💰' },
  { subtype: 'fortress',   desc: "Fortress! Block + draw 1 bonus card from deck!",    icon: '🏰' },
  { subtype: 'invincible', desc: "Invincible! Block your next 2 point losses!",       icon: '💎' }
];

const WILD_CARDS = [
  { subtype: 'swap_hands',  desc: "Swap your entire hand with your partner's!" },
  { subtype: 'double_next', desc: "Your next point gain is doubled." },
  { subtype: 'peek',        desc: "Peek at your partner's entire hand for 5 seconds." },
  { subtype: 'extra_turn',  desc: "Play another card immediately — take an extra turn!" },
  { subtype: 'both_draw',   desc: "Both players draw 2 extra cards from the deck." },
  { subtype: 'draw_three',  desc: "Draw 3 cards from the deck directly into your hand." }
];

function buildDeck() {
  const deck = [];
  const questions = shuffle([...QUESTION_POOL]).slice(0, 12);
  questions.forEach((q, i) =>
    deck.push({ id: `m${i}`, type: 'memory', icon: '💌', name: 'Memory', question: q }));
  for (let i = 0; i < 4; i++)
    deck.push({ id: `dr${i}`, type: 'duel', subtype: 'rps', icon: '✊', name: 'Duel', desc: 'Pick Rock, Paper, or Scissors secretly. Winner gets 2 pts!' });
  for (let i = 0; i < 4; i++)
    deck.push({ id: `dt${i}`, type: 'duel', subtype: 'tug', icon: '🪢', name: 'Tug of War', desc: 'Tap as fast as you can for 7 seconds! Most taps wins 2 pts!' });
  LUCK_CARDS.forEach((l, i) =>
    deck.push({ id: `lk${i}`, type: 'luck', icon: '🎲', name: 'Luck', ...l }));
  SHIELD_CARDS.forEach((s, i) =>
    deck.push({ id: `sh${i}`, type: 'shield', icon: s.icon, name: 'Shield', ...s }));
  WILD_CARDS.forEach((w, i) =>
    deck.push({ id: `wl${i}`, type: 'wild', icon: '✨', name: 'Wild', ...w }));
  return shuffle(deck);
}

// ── Room helpers ──────────────────────────────────────────────────────────────
function newRoom() {
  let code;
  do { code = randCode(); } while (rooms.has(code));
  const room = {
    code, phase: 'lobby', players: [], deck: [],
    activeCard: null, currentTurn: 0,
    rpsChoices: {}, tugClicks: {}, tugActive: false, tugTimer: null,
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
      phase: room.phase,
      shielded: !!room.shielded[p.id],
      opShielded: !!room.shielded[o?.id],
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
    case 'roll_steal':     if (roll % 2 !== 0) { pd = 1; od = -1; } else { pd = 1; } break;
    case 'roll_extremes':  pd = roll === 6 ? 3 : roll === 1 ? -2 : 1; break;
    case 'roll_high':      pd = roll > 3 ? 2 : 0; break;
    case 'roll_partner':   if (o) od = Math.ceil(roll / 2); break;
    case 'roll_evenodd':   pd = roll % 2 === 0 ? 2 : -1; break;
    case 'roll_jackpot':   pd = roll === 1 ? 0 : roll <= 5 ? 1 : 3; break;
    case 'roll_threshold': pd = roll >= 4 ? roll : 0; break;
  }
  pd *= mult;

  // ── Shield activation (with real effects) ───────────────────────────────────
  const shieldCard = room.shielded[sid];
  if (pd < 0 && shieldCard) {
    let shieldFx = '';
    const originalPd = pd;
    pd = 0; // block the loss

    switch (shieldCard.subtype) {
      case 'basic':
        shieldFx = 'Point loss blocked!';
        room.shielded[sid] = null;
        break;
      case 'retaliate':
        if (o) { o.score = Math.max(0, o.score - 1); }
        shieldFx = `Counter-attack! ${o?.name} loses 1pt!`;
        room.shielded[sid] = null;
        break;
      case 'mirror':
        if (o) { o.score = Math.max(0, o.score + originalPd); }
        shieldFx = `Effect mirrored! ${o?.name} takes the hit instead!`;
        room.shielded[sid] = null;
        break;
      case 'steal':
        if (o && o.score > 0) { o.score--; p.score++; }
        shieldFx = `Stole 1pt from ${o?.name}!`;
        room.shielded[sid] = null;
        break;
      case 'fortress':
        if (room.deck.length > 0) p.hand.push(...deal(room.deck, 1));
        shieldFx = 'Blocked + drew a bonus card!';
        room.shielded[sid] = null;
        break;
      case 'invincible': {
        const blocksLeft = (shieldCard.blocksLeft || 2) - 1;
        shieldFx = blocksLeft > 0 ? `Invincible! ${blocksLeft} block(s) remaining!` : 'Last invincible block used!';
        if (blocksLeft > 0) room.shielded[sid] = { ...shieldCard, blocksLeft };
        else room.shielded[sid] = null;
        break;
      }
    }
    note = shieldFx;
    io.to(room.code).emit('shieldblocked', {
      playerName: p.name, effect: shieldFx,
      icon: shieldCard.icon, subtype: shieldCard.subtype
    });
  }

  // Opponent steal shield
  if (od < 0 && o && room.shielded[o.id]) {
    const oShield = room.shielded[o.id];
    od = 0;
    room.shielded[o.id] = null;
    const fxMsg = `${o.name}'s shield blocked the steal!`;
    io.to(room.code).emit('shieldblocked', { playerName: o.name, effect: fxMsg, icon: oShield.icon, subtype: oShield.subtype });
    note += (note ? ' · ' : '') + fxMsg;
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
      msg = `✨ ${p.name} swapped hands with ${o?.name}!`; break;
    case 'double_next':
      room.doubleNext[sid] = true;
      msg = `✨ ${p.name}'s next point gain is doubled!`; break;
    case 'peek':
      if (o) io.to(sid).emit('peek', { hand: o.hand });
      msg = `✨ ${p.name} peeked at ${o?.name}'s hand!`; break;
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
    if (bySocket(socket.id)) return; // already in a room, ignore duplicate
    const room = newRoom();
    room.players.push({ id: socket.id, name: (name || 'Player 1').trim().slice(0, 20), score: 0, hand: [] });
    socket.join(room.code);
    socket.emit('created', { code: room.code });
  });

  socket.on('join', ({ code, name }) => {
    // Ignore if this socket is already in any room (prevents double-click joining)
    if (bySocket(socket.id)) return;

    const room = rooms.get(code?.toUpperCase().trim());
    if (!room) return socket.emit('err', 'Room not found — double-check the code!');
    // Extra guard: prevent the same socket ID appearing twice in one room
    if (room.players.some(p => p.id === socket.id)) return;
    if (room.players.length >= 2) return socket.emit('err', 'This room is already full!');
    if (room.phase !== 'lobby') return socket.emit('err', 'This game has already started.');
    room.players.push({ id: socket.id, name: (name || 'Player 2').trim().slice(0, 20), score: 0, hand: [] });
    socket.join(room.code);

    // Build deck and start game immediately — no setup needed
    room.deck = buildDeck();
    room.players.forEach(p => { p.hand = deal(room.deck, 5); p.score = 0; });
    room.phase = 'game';
    room.currentTurn = 0;

    io.to(room.code).emit('gamestart', { names: room.players.map(p => p.name) });
    broadcast(room);
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
      setTimeout(() => { broadcast(room); advance(room); }, 3200);
    } else if (card.type === 'shield') {
      room.shielded[socket.id] = card;
      io.to(room.code).emit('shieldset', { playerName: p.name, card });
      setTimeout(() => { broadcast(room); advance(room); }, 2500);
    } else if (card.type === 'wild') {
      const { msg } = resolveWild(room, card, socket.id);
      io.to(room.code).emit('wildresolve', { card, msg });
      setTimeout(() => { broadcast(room); advance(room); }, 2800);
    } else if (card.type === 'duel') {
      if (card.subtype === 'rps') {
        room.rpsChoices = {};
        io.to(room.code).emit('rpsstart', { card });
      } else if (card.subtype === 'tug') {
        room.tugClicks = {};
        room.players.forEach(pl => room.tugClicks[pl.id] = 0);
        room.tugActive = true;
        const DURATION = 7000;
        io.to(room.code).emit('tugstart', { card, duration: DURATION });
        room.tugTimer = setTimeout(() => {
          if (!room.tugActive) return;
          room.tugActive = false;
          const [p0, p1] = room.players;
          const c0 = room.tugClicks[p0.id] || 0;
          const c1 = room.tugClicks[p1.id] || 0;
          let wid = null;
          if (c0 > c1) wid = p0.id;
          else if (c1 > c0) wid = p1.id;
          if (wid) {
            const w = getMe(room, wid);
            const mult = room.doubleNext[wid] ? 2 : 1;
            room.doubleNext[wid] = false;
            w.score += 2 * mult;
          }
          const wname = wid ? getMe(room, wid)?.name : null;
          io.to(room.code).emit('tugresult', {
            winnerId: wid, winnerName: wname,
            clicks: room.tugClicks,
            names: { [p0.id]: p0.name, [p1.id]: p1.name }
          });
          setTimeout(() => { broadcast(room); advance(room); }, 2800);
        }, DURATION);
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
    // Notify partner that this player has chosen (without revealing choice)
    const opp = getOpp(room, socket.id);
    if (opp) io.to(opp.id).emit('rps_opponent_chose');
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
      setTimeout(() => { broadcast(room); advance(room); }, 3200);
    }
  });

  socket.on('tugclick', () => {
    const room = bySocket(socket.id);
    if (!room || !room.tugActive) return;
    room.tugClicks[socket.id] = (room.tugClicks[socket.id] || 0) + 1;
    const [p0, p1] = room.players;
    const c0 = room.tugClicks[p0.id] || 0;
    const c1 = room.tugClicks[p1.id] || 0;
    io.to(room.code).emit('tugupdate', { p0id: p0.id, p1id: p1.id, c0, c1 });
    // Instant win at 35-click difference
    const diff = c0 - c1;
    if (Math.abs(diff) >= 35) {
      clearTimeout(room.tugTimer);
      room.tugActive = false;
      const wid = diff > 0 ? p0.id : p1.id;
      const w = getMe(room, wid);
      const mult = room.doubleNext[wid] ? 2 : 1;
      room.doubleNext[wid] = false;
      w.score += 2 * mult;
      io.to(room.code).emit('tugresult', {
        winnerId: wid, winnerName: w.name,
        clicks: room.tugClicks,
        names: { [p0.id]: p0.name, [p1.id]: p1.name }
      });
      setTimeout(() => { broadcast(room); advance(room); }, 2800);
    }
  });

  socket.on('disconnect', () => {
    const room = bySocket(socket.id);
    if (!room) return;
    if (room.tugTimer) clearTimeout(room.tugTimer);
    const p = getMe(room, socket.id);
    const o = getOpp(room, socket.id);
    if (o) io.to(o.id).emit('partnerleft', { name: p?.name });
    setTimeout(() => rooms.delete(room.code), 90000);
  });
});

server.listen(PORT, () => console.log(`💌 Us: The Deck running on http://localhost:${PORT}`));

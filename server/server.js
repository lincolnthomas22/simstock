// SimStock — the 1v1 match server.
//
// It is the referee, not a relay. It holds the clock, the money and the price
// path, and a client is only ever told what has already happened. That last
// part is the whole reason this exists: the market is worked out from a seed
// the moment a match starts, but prices are handed over one tick at a time, so
// neither player can read the end of the match out of their own memory.
//
// Rooms are keyed by the match password. Two players to a room; the second one
// through the door starts the match.
'use strict';

const http = require('http');
const { WebSocketServer } = require('ws');
const VS = require('../sim.js');

// PORT=0 is a legitimate "pick me a free one", so it cannot be treated as unset.
const PORT = process.env.PORT ? Number(process.env.PORT) : (process.env.PORT === '0' ? 0 : 8080);
const TICK_MS = 1000;              // one trading day a second, as everywhere else
const SWEEP_MS = 15000;
const ROOM_IDLE_MS = 10 * 60 * 1000;   // a room nobody joins is eventually swept
const MAX_ROOMS = 500;
const MAX_ORDERS_PER_TICK = 4;         // enough to change your mind, not enough to flood
const MAX_FRAME = 4096;
const NAME_MAX = 18;

// Set ALLOWED_ORIGINS to a comma-separated list to lock the server to your own
// pages. Left unset it accepts anyone, which is what you want while testing.
const ALLOWED = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);

const rooms = new Map();   // password -> room
const startedAt = Date.now();
let matchesPlayed = 0;

// ===========================================================
// HELPERS
// ===========================================================
const send = (ws, msg) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); };
const fail = (ws, code, message) => send(ws, { t: 'error', code, message });

// Passwords are matched exactly, so they are cleaned the same way the client
// cleans them: lower case, and the separators that split a match code are not
// allowed inside one.
const cleanPassword = text => String(text == null ? '' : text)
  .trim().toLowerCase().replace(/[\s/|]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);

// Names are shown to the other player, so nothing but ordinary printable text.
const cleanName = text => {
  const s = String(text == null ? '' : text).replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim().slice(0, NAME_MAX);
  return s || 'Trader';
};

const worthOf = (p, price) => p.cash + p.shares * price;

const publicPlayer = p => ({ name: p.name });

// ===========================================================
// ROOMS
// ===========================================================
function makePlayer(ws, name) {
  return {
    ws, name: cleanName(name),
    cash: VS.STARTING_CASH, shares: 0,
    spent: 0, bought: 0, trades: 0, fees: 0,
    sentTick: -1,          // the last tick whose prices this player has been given
    ordersThisTick: 0,
    room: null,
  };
}

function hostRoom(ws, msg) {
  const password = cleanPassword(msg.password);
  if (!password) return fail(ws, 'bad_password', 'A match needs a password.');
  if (rooms.has(password)) return fail(ws, 'taken', 'Somebody is already waiting on that password. Pick another, or join theirs.');
  if (rooms.size >= MAX_ROOMS) return fail(ws, 'busy', 'The server is full. Try again in a minute.');

  const risk = Math.round(Number(msg.risk));
  const ticks = Math.round(Number(msg.ticks));
  if (!VS.RISKS[risk]) return fail(ws, 'bad_risk', 'That is not a risk level.');
  if (!VS.DURATIONS.some(d => d.ticks === ticks)) return fail(ws, 'bad_length', 'That is not a match length.');

  const player = makePlayer(ws, msg.name);
  const room = {
    password, risk, ticks,
    seed: VS.randomSeed(),
    players: [player],
    match: null,
    tick: 0,
    stage: 'waiting',
    timer: null,
    startedAt: 0,
    createdAt: Date.now(),
  };
  player.room = room;
  ws.player = player;
  rooms.set(password, room);
  send(ws, { t: 'hosted', password, risk, ticks, code: `${password}/${risk}/${ticks}`, you: publicPlayer(player) });
}

function joinRoom(ws, msg) {
  const password = cleanPassword(msg.password);
  if (!password) return fail(ws, 'bad_password', 'Type the password your opponent gave you.');
  const room = rooms.get(password);
  if (!room) return fail(ws, 'no_room', 'Nobody is waiting on that password.');
  if (room.stage !== 'waiting' || room.players.length >= 2) return fail(ws, 'full', 'That match has already started.');

  const player = makePlayer(ws, msg.name);
  player.room = room;
  ws.player = player;
  room.players.push(player);
  startMatch(room);
}

function startMatch(room) {
  // The whole path is worked out now and revealed a tick at a time. Generating
  // it up front is what lets a match be replayed from its seed afterwards.
  room.match = VS.generateMatch({ seed: room.seed, risk: room.risk, ticks: room.ticks });
  room.stage = 'running';
  room.tick = 0;
  room.startedAt = Date.now();
  matchesPlayed += 1;

  const { stock, startingCash, prices } = room.match;
  room.players.forEach((p, i) => {
    const them = room.players[1 - i];
    send(p.ws, {
      t: 'start',
      password: room.password,
      risk: room.risk,
      ticks: room.ticks,
      seed: room.seed,
      startingCash,
      stock,
      price: prices[0],        // only the opening price; the rest arrives as it happens
      you: publicPlayer(p),
      them: publicPlayer(them),
    });
    p.sentTick = 0;
  });

  room.timer = setInterval(() => stepRoom(room), 250);
}

// The clock is read off the wall rather than counted, so a slow interval or a
// busy moment cannot make one room's match quietly shorter than another's.
function stepRoom(room) {
  if (room.stage !== 'running') return;
  const tick = Math.min(room.ticks, Math.floor((Date.now() - room.startedAt) / 1000));
  if (tick !== room.tick) {
    room.tick = tick;
    room.players.forEach(p => { p.ordersThisTick = 0; });
  }
  broadcastTick(room);
  if (tick >= room.ticks) endMatch(room, 'bell');
}

function broadcastTick(room) {
  const { prices, news } = room.match;
  const price = prices[room.tick];
  room.players.forEach((p, i) => {
    const them = room.players[1 - i];
    if (p.sentTick >= room.tick) return;
    // Everything the player has not been shown yet, so a stalled connection
    // catches up in one message instead of falling behind for good.
    const from = p.sentTick + 1;
    send(p.ws, {
      t: 'tick',
      tick: room.tick,
      prices: prices.slice(from, room.tick + 1),
      news: news.filter(n => n.tick >= from && n.tick <= room.tick),
      you: { cash: round2(p.cash), shares: p.shares, worth: round2(worthOf(p, price)) },
      them: { worth: round2(worthOf(them, price)) },
    });
    p.sentTick = room.tick;
  });
}

function placeOrder(ws, msg) {
  const p = ws.player;
  if (!p || !p.room) return fail(ws, 'no_match', 'You are not in a match.');
  const room = p.room;
  if (room.stage !== 'running') return fail(ws, 'no_match', 'That match is not running.');
  if (p.ordersThisTick >= MAX_ORDERS_PER_TICK) return fail(ws, 'too_fast', 'Slow down — that is too many orders in one day.');

  const side = msg.side === 'sell' ? 'sell' : 'buy';
  const qty = Math.floor(Number(msg.qty));
  if (!Number.isFinite(qty) || qty <= 0) return fail(ws, 'bad_qty', 'That is not a number of shares.');

  // The price is whatever the server's clock says it is. A client that thinks
  // it is on a different tick does not get to trade on that.
  const price = room.match.prices[room.tick];

  if (side === 'buy') {
    const cost = qty * price;
    const fee = VS.commission(cost);
    if (cost + fee > p.cash + 1e-9) return fail(ws, 'no_cash', 'You cannot afford that.');
    p.cash -= cost + fee;
    p.shares += qty;
    p.spent += cost;
    p.bought += qty;
    p.fees += fee;
  } else {
    if (qty > p.shares) return fail(ws, 'no_shares', 'You do not hold that many.');
    const value = qty * price;
    const fee = VS.commission(value);
    p.cash += value - fee;
    p.shares -= qty;
    p.fees += fee;
  }
  p.trades += 1;
  p.ordersThisTick += 1;
  send(ws, { t: 'filled', tick: room.tick, side, qty, price, fee: round2(VS.commission(qty * price)), cash: round2(p.cash), shares: p.shares });
}

function endMatch(room, reason, quitter) {
  if (room.stage === 'over') return;
  room.stage = 'over';
  clearInterval(room.timer);
  room.timer = null;
  rooms.delete(room.password);

  const price = room.match.prices[Math.min(room.tick, room.ticks)];
  const finals = room.players.map(p => worthOf(p, price));

  room.players.forEach((p, i) => {
    const them = room.players[1 - i];
    // Walking out hands the match over. Anything else is decided on the money.
    const forfeit = reason === 'forfeit';
    const wonByDefault = forfeit && quitter !== p;
    const outcome = forfeit
      ? (wonByDefault ? 'win' : 'loss')
      : finals[i] > finals[1 - i] ? 'win' : finals[i] < finals[1 - i] ? 'loss' : 'draw';
    send(p.ws, {
      t: 'over',
      reason,
      outcome,
      tick: room.tick,
      you: { worth: round2(finals[i]), cash: round2(p.cash), shares: p.shares, trades: p.trades, fees: round2(p.fees) },
      them: { name: them.name, worth: round2(finals[1 - i]) },
      // Handed over only now the match is done, so it can be replayed or checked.
      seed: room.seed,
      prices: room.match.prices,
    });
    p.room = null;
  });
}

function dropPlayer(ws) {
  const p = ws.player;
  if (!p || !p.room) return;
  const room = p.room;
  if (room.stage === 'running') return endMatch(room, 'forfeit', p);
  // Still waiting: the room goes with them.
  room.players = room.players.filter(x => x !== p);
  if (!room.players.length) {
    clearInterval(room.timer);
    rooms.delete(room.password);
  }
  p.room = null;
}

const round2 = n => Math.round(n * 100) / 100;

// ===========================================================
// PLUMBING
// ===========================================================
const server = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    const body = JSON.stringify({
      ok: true,
      uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
      rooms: rooms.size,
      waiting: [...rooms.values()].filter(r => r.stage === 'waiting').length,
      matchesPlayed,
    });
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    return res.end(body);
  }
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('Not found. The game itself is a static site; this is only the match server.\n');
});

const wss = new WebSocketServer({
  server,
  maxPayload: MAX_FRAME,
  verifyClient: ({ origin }) => !ALLOWED.length || !origin || ALLOWED.includes(origin),
});

wss.on('connection', ws => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return fail(ws, 'bad_json', 'That was not a message.'); }
    if (!msg || typeof msg.t !== 'string') return fail(ws, 'bad_message', 'That was not a message.');
    try {
      switch (msg.t) {
        case 'host': return ws.player ? fail(ws, 'busy', 'You are already in a match.') : hostRoom(ws, msg);
        case 'join': return ws.player ? fail(ws, 'busy', 'You are already in a match.') : joinRoom(ws, msg);
        case 'order': return placeOrder(ws, msg);
        case 'leave': { dropPlayer(ws); ws.player = null; return send(ws, { t: 'left' }); }
        case 'ping': return send(ws, { t: 'pong', now: Date.now() });
        default: return fail(ws, 'unknown', `No idea what "${String(msg.t).slice(0, 20)}" means.`);
      }
    } catch (err) {
      console.error('handler failed', msg.t, err);
      fail(ws, 'server_error', 'Something went wrong at our end.');
    }
  });

  ws.on('close', () => { dropPlayer(ws); ws.player = null; });
  ws.on('error', () => { dropPlayer(ws); ws.player = null; });

  send(ws, { t: 'hello', version: 1, risks: VS.RISKS.filter(Boolean), durations: VS.DURATIONS, startingCash: VS.STARTING_CASH });
});

// Drop connections that have gone quiet, and sweep rooms nobody ever joined.
setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
  const now = Date.now();
  for (const room of [...rooms.values()]) {
    if (room.stage === 'waiting' && now - room.createdAt > ROOM_IDLE_MS) {
      room.players.forEach(p => { fail(p.ws, 'expired', 'Nobody joined, so the room was closed.'); p.room = null; p.ws.player = null; });
      rooms.delete(room.password);
    }
  }
}, SWEEP_MS).unref();

const shutdown = () => {
  console.log('shutting down');
  for (const room of [...rooms.values()]) endMatch(room, 'server_stopping');
  wss.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

server.listen(PORT, () => console.log(`SimStock match server listening on ${server.address().port}`));

module.exports = { server, wss, rooms };

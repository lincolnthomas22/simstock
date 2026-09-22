// SimStock — the 1v1 match server.
//
// It is the referee, not a relay. It holds the clock, the money and the price
// path, and a client is only ever told what has already happened. That last
// part is the whole reason this exists: the market is worked out from a seed
// the moment a match starts, but prices are handed over one tick at a time, so
// neither player can read the end of the match out of their own memory.
//
// Rooms are keyed by the match password. Two players to a room. The second one
// through the door lands in the room's lobby next to the host, and the match
// starts when the host says so, after a short countdown both of them can see.
'use strict';

const crypto = require('crypto');
const http = require('http');
const { WebSocketServer } = require('ws');
const VS = require('../sim.js');

// PORT=0 is a legitimate "pick me a free one", so it cannot be treated as unset.
const PORT = process.env.PORT ? Number(process.env.PORT) : (process.env.PORT === '0' ? 0 : 8080);
const TICK_MS = 1000;              // one trading day a second, as everywhere else
const SWEEP_MS = 15000;
const ROOM_IDLE_MS = 10 * 60 * 1000;   // a room nobody joins is eventually swept
const REMATCH_MS = 2 * 60 * 1000;      // how long a finished room stays up for a rematch
// How long a dropped player has to get back in before it becomes a forfeit.
// Configurable because it is a judgement call about somebody else's wifi, and
// because the tests would rather not wait three quarters of a minute.
const GRACE_MS = Number(process.env.GRACE_SECONDS || 45) * 1000;
// The count the host's "start" sets off, so both players are looking at the
// market when the bell goes rather than one of them finding it already moving.
const COUNTDOWN_MS = Number(process.env.COUNTDOWN_SECONDS ?? 3) * 1000;
const MAX_ROOMS = 500;
const MAX_ORDERS_PER_TICK = 4;         // enough to change your mind, not enough to flood
const MAX_FRAME = 4096;
const NAME_MAX = 18;

// Set ALLOWED_ORIGINS to a comma-separated list to lock the server to your own
// pages. Left unset it accepts anyone, which is what you want while testing.
const ALLOWED = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);

const rooms = new Map();   // password -> room
// A resume ticket is what makes a dropped socket survivable: the player is a
// row in a room, not a connection, and this is how a new connection proves it
// is that row. It is handed to one player over their own socket and to nobody
// else, so possession of it is the proof.
const tickets = new Map();   // token -> player
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
    spent: 0, bought: 0, trades: 0, fees: 0, dividends: 0,
    token: crypto.randomBytes(16).toString('hex'),
    gone: false,            // the socket dropped, and the clock is running on getting back
    graceTimer: null,
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
  if (room.stage !== 'waiting' || room.players.length >= 2) return fail(ws, 'full', room.stage === 'waiting' ? 'That room already has two players.' : 'That match has already started.');

  const player = makePlayer(ws, msg.name);
  player.room = room;
  ws.player = player;
  room.players.push(player);
  sendLobby(room);
}

// Who is in the room, sent to everyone in it whenever that changes. Nothing
// is moving yet: the host starts the match from here.
function sendLobby(room) {
  room.players.forEach((p, i) => send(p.ws, {
    t: 'lobby',
    password: room.password,
    risk: room.risk,
    ticks: room.ticks,
    host: i === 0,
    players: room.players.map(publicPlayer),
  }));
}

// The host's say-so. Only the host can give it, and only with somebody to play.
function beginMatch(ws) {
  const p = ws.player;
  if (!p || !p.room) return fail(ws, 'no_room', 'You are not in a room.');
  const room = p.room;
  if (room.players[0] !== p) return fail(ws, 'not_host', 'Only the host can start the match.');
  if (room.stage !== 'waiting') return fail(ws, 'not_waiting', 'That match is already under way.');
  if (room.players.length < 2) return fail(ws, 'alone', 'Wait for your opponent to join first.');
  room.stage = 'countdown';
  const seconds = Math.round(COUNTDOWN_MS / 1000);
  room.players.forEach(x => send(x.ws, { t: 'countdown', seconds }));
  room.countdownTimer = setTimeout(() => {
    room.countdownTimer = null;
    if (room.stage === 'countdown' && room.players.length === 2) startMatch(room);
  }, COUNTDOWN_MS);
}

function startMatch(room) {
  // The whole path is worked out now and revealed a tick at a time. Generating
  // it up front is what lets a match be replayed from its seed afterwards.
  room.match = VS.generateMatch({ seed: room.seed, risk: room.risk, ticks: room.ticks });
  room.stage = 'running';
  room.tick = 0;
  room.startedAt = Date.now();
  clearTimeout(room.rematchTimer);
  room.rematchTimer = null;
  matchesPlayed += 1;

  // A rematch reuses the room, so everybody starts from a clean desk rather
  // than from whatever they were left holding.
  room.players.forEach(p => {
    p.cash = VS.STARTING_CASH;
    p.shares = 0;
    p.spent = 0;
    p.bought = 0;
    p.trades = 0;
    p.fees = 0;
    p.dividends = 0;
    p.ordersThisTick = 0;
    p.wantsRematch = false;
  });

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
      // Their own ticket back into this match, if the socket drops under them.
      token: p.token,
      graceSec: Math.round(GRACE_MS / 1000),
    });
    tickets.set(p.token, p);
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
    // Every tick the clock passed over, not just the one it landed on: a busy
    // moment must not cost a player a dividend they were holding through.
    for (let t = room.tick + 1; t <= tick; t++) payDividends(room, t);
    room.tick = tick;
    room.players.forEach(p => { p.ordersThisTick = 0; });
  }
  broadcastTick(room);
  if (tick >= room.ticks) endMatch(room, 'bell');
}

// A dividend is paid on the shares held at that tick, to whoever holds them.
// The money is the server's to move, so it moves it here and the clients are
// told what their cash is in the same tick message as everything else.
function payDividends(room, tick) {
  const perShare = VS.dividendAt(room.match, tick);
  if (!perShare) return;
  room.players.forEach(p => {
    if (p.shares <= 0) return;
    const paid = round2(perShare * p.shares);
    p.cash = round2(p.cash + paid);
    p.dividends = round2((p.dividends || 0) + paid);
  });
}

function broadcastTick(room) {
  const { prices, news, eps } = room.match;
  const price = prices[room.tick];
  room.players.forEach((p, i) => {
    const them = room.players[1 - i];
    if (!p.ws || p.sentTick >= room.tick) return;   // away: they are caught up when they get back
    // Everything the player has not been shown yet, so a stalled connection
    // catches up in one message instead of falling behind for good.
    const from = p.sentTick + 1;
    send(p.ws, {
      t: 'tick',
      tick: room.tick,
      prices: prices.slice(from, room.tick + 1),
      // The profits behind the price, so a player's panel can show the P/E and
      // the earnings the same way the trading floor's does.
      eps: eps.slice(from, room.tick + 1),
      news: news.filter(n => n.tick >= from && n.tick <= room.tick),
      you: { cash: round2(p.cash), shares: p.shares, dividends: round2(p.dividends || 0), worth: round2(worthOf(p, price)) },
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
  // Whatever happens next, this match is done, so nobody is resuming into it.
  room.players.forEach(forgetTicket);

  const price = room.match.prices[Math.min(room.tick, room.ticks)];
  const finals = room.players.map(p => worthOf(p, price));
  // A rematch needs two people who are both still on the line. Nobody is
  // offered another go against an opponent who has just walked out.
  const canRematch = reason === 'bell'
    && room.players.length === 2
    && room.players.every(p => p.ws && p.ws.readyState === 1);

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
      you: { worth: round2(finals[i]), cash: round2(p.cash), shares: p.shares, trades: p.trades, fees: round2(p.fees), dividends: round2(p.dividends || 0) },
      them: { name: them.name, worth: round2(finals[1 - i]) },
      // Handed over only now the match is done, so it can be replayed or checked.
      seed: room.seed,
      prices: room.match.prices,
      // Both still here, so either can ask for another one on the same terms.
      rematch: canRematch,
    });
  });

  // The room stays up for a couple of minutes with both players still in it,
  // so a rematch costs nobody a trip back to the lobby and a new password.
  if (!canRematch) {
    room.players.forEach(p => { p.room = null; });
    room.players = [];
    return;
  }
  room.finishedAt = Date.now();
  room.rematchTimer = setTimeout(() => closeRoom(room, 'rematch_timeout'), REMATCH_MS);
  if (room.rematchTimer.unref) room.rematchTimer.unref();
}

// Everybody out, and the room is gone. Used when a rematch window runs out or
// the last player of a finished room leaves.
function closeRoom(room, why) {
  clearInterval(room.timer);
  clearTimeout(room.rematchTimer);
  room.timer = null;
  room.rematchTimer = null;
  room.players.forEach(p => {
    if (why) send(p.ws, { t: 'rematch_off', reason: why });
    forgetTicket(p);
    p.room = null;
    p.wantsRematch = false;
  });
  room.players = [];
  room.stage = 'closed';
  rooms.delete(room.password);
}

// A rematch is the same two people, the same settings and a brand new market.
// It takes both of them: one asking is an offer, not a match.
function askRematch(ws) {
  const p = ws.player;
  if (!p || !p.room) return fail(ws, 'no_match', 'There is no match to play again.');
  const room = p.room;
  if (room.stage !== 'over') return fail(ws, 'not_over', 'That match is still going.');
  if (room.players.length < 2) return fail(ws, 'alone', 'Your opponent has gone.');
  p.wantsRematch = true;
  const them = room.players.find(x => x !== p);
  if (!them.wantsRematch) return send(them.ws, { t: 'rematch_offer', name: p.name });
  room.seed = VS.randomSeed();     // a new market, not the one they have both now seen
  startMatch(room);
}

// A socket that drops mid-match no longer ends it. The player keeps their
// money, their shares and their place in the room, the clock keeps running,
// and they have GRACE_MS to come back with their ticket. Walking out on
// purpose is a different thing and still forfeits on the spot.
function suspendPlayer(room, p) {
  if (p.gone) return;
  p.gone = true;
  p.ws = null;
  p.goneAt = Date.now();
  clearTimeout(p.graceTimer);
  p.graceTimer = setTimeout(() => {
    // Time up: it is a walkout after all.
    if (room.stage === 'running' && p.gone) endMatch(room, 'forfeit', p);
  }, GRACE_MS);
  if (p.graceTimer.unref) p.graceTimer.unref();
  const them = room.players.find(x => x !== p);
  if (them) send(them.ws, { t: 'opponent_gone', name: p.name, seconds: Math.round(GRACE_MS / 1000) });
}

// The other half: a fresh socket proving, with the ticket, that it is the
// player who dropped. Everything they missed goes back in one message, and the
// server's figures are the ones they come back to.
function resumeMatch(ws, msg) {
  if (ws.player) return fail(ws, 'busy', 'You are already in a match.');
  const p = tickets.get(String(msg.token || ''));
  if (!p || !p.room) return fail(ws, 'no_match', 'That match is over.');
  const room = p.room;
  if (room.stage !== 'running') return fail(ws, 'no_match', 'That match is over.');
  if (!p.gone) return fail(ws, 'still_here', 'That match already has a connection.');

  clearTimeout(p.graceTimer);
  p.graceTimer = null;
  p.gone = false;
  p.ws = ws;
  ws.player = p;

  const them = room.players.find(x => x !== p);
  const price = room.match.prices[room.tick];
  send(ws, {
    t: 'resumed',
    password: room.password,
    risk: room.risk,
    ticks: room.ticks,
    tick: room.tick,
    startingCash: VS.STARTING_CASH,
    stock: room.match.stock,
    token: p.token,
    graceSec: Math.round(GRACE_MS / 1000),
    // Everything up to now, and not one tick more.
    prices: room.match.prices.slice(0, room.tick + 1),
    eps: room.match.eps.slice(0, room.tick + 1),
    news: room.match.news.filter(n => n.tick <= room.tick),
    you: {
      cash: round2(p.cash), shares: p.shares, trades: p.trades,
      fees: round2(p.fees), dividends: round2(p.dividends || 0), worth: round2(worthOf(p, price)),
      // What they paid for what they are holding, so the average cost comes
      // back with everything else rather than reading as zero.
      spent: round2(p.spent), bought: p.bought,
    },
    them: { name: them ? them.name : 'Opponent', worth: them ? round2(worthOf(them, price)) : VS.STARTING_CASH, gone: !!(them && them.gone) },
  });
  p.sentTick = room.tick;
  if (them) send(them.ws, { t: 'opponent_back', name: p.name });
}

function dropPlayer(ws, deliberate) {
  const p = ws.player;
  if (!p || !p.room) return;
  const room = p.room;
  if (room.stage === 'running') {
    return deliberate ? endMatch(room, 'forfeit', p) : suspendPlayer(room, p);
  }
  // Out of a finished room: whoever is left is told the rematch is off rather
  // than waiting on an answer that is not coming.
  if (room.stage === 'over') {
    room.players = room.players.filter(x => x !== p);
    p.room = null;
    p.wantsRematch = false;
    if (!room.players.length) return closeRoom(room);
    return closeRoom(room, 'opponent_left');
  }
  // Still in the lobby, or counting down. Anything counting stops: it takes two.
  clearTimeout(room.countdownTimer);
  room.countdownTimer = null;
  room.stage = 'waiting';
  const wasHost = room.players[0] === p;
  room.players = room.players.filter(x => x !== p);
  p.room = null;
  // The host leaving closes the room: it was theirs, on their settings.
  if (wasHost) {
    room.players.forEach(x => {
      fail(x.ws, 'host_left', 'The host closed the room.');
      x.room = null;
      if (x.ws) x.ws.player = null;
    });
    room.players = [];
  }
  if (!room.players.length) {
    clearInterval(room.timer);
    rooms.delete(room.password);
    return;
  }
  // The opponent leaving puts the host back to waiting for somebody.
  sendLobby(room);
}

// A ticket is only good for the match it was issued for.
function forgetTicket(p) {
  clearTimeout(p.graceTimer);
  p.graceTimer = null;
  p.gone = false;
  tickets.delete(p.token);
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
        case 'begin': return beginMatch(ws);
        case 'order': return placeOrder(ws, msg);
        case 'rematch': return askRematch(ws);
        case 'resume': return resumeMatch(ws, msg);
        case 'leave': { dropPlayer(ws, true); ws.player = null; return send(ws, { t: 'left' }); }
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
    if (room.stage === 'over' && now - (room.finishedAt || 0) > REMATCH_MS) closeRoom(room, 'rematch_timeout');
    if (room.stage === 'waiting' && now - room.createdAt > ROOM_IDLE_MS) {
      const why = room.players.length > 1 ? 'The match never started, so the room was closed.' : 'Nobody joined, so the room was closed.';
      room.players.forEach(p => { fail(p.ws, 'expired', why); p.room = null; p.ws.player = null; });
      rooms.delete(room.password);
    }
  }
}, SWEEP_MS).unref();

const shutdown = () => {
  console.log('shutting down');
  for (const room of [...rooms.values()]) {
    // A room still in its lobby has no match to end, only people to tell.
    if (room.match) endMatch(room, 'server_stopping');
    else room.players.forEach(p => fail(p.ws, 'server_stopping', 'The match server is restarting.'));
  }
  wss.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

server.listen(PORT, () => console.log(`SimStock match server listening on ${server.address().port}`));

module.exports = { server, wss, rooms };

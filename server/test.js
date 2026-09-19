// Protocol tests for the match server. No browser: two WebSocket clients, a
// real server, and a stopwatch. Run with `npm test`.
'use strict';

const assert = require('assert');
const WebSocket = require('ws');

// A match is two minutes at its shortest, which is a long time to watch a test
// run, so a five-tick length is added before the server reads the list.
const VS = require('../sim.js');
VS.DURATIONS.push({ id: 'test', label: 'Test', ticks: 5, note: '5 seconds' });

process.env.PORT = '0';
const { server, rooms } = require('./server.js');

const PASS = [];
const ok = (name, fn) => { try { fn(); PASS.push(name); } catch (e) { console.error('FAIL', name, '\n ', e.message); process.exitCode = 1; } };

function client() {
  const ws = new WebSocket(`ws://127.0.0.1:${server.address().port}`);
  const seen = [];
  const waiters = [];
  ws.on('message', raw => {
    const m = JSON.parse(raw);
    seen.push(m);
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i].match(m)) { waiters[i].resolve(m); waiters.splice(i, 1); }
    }
  });
  return {
    ws, seen,
    send: m => ws.send(JSON.stringify(m)),
    raw: s => ws.send(s),
    mark: () => seen.length,
    // waits for the next message of a type, or returns one already seen
    want(t, after = 0) {
      const found = seen.slice(after).find(m => m.t === t);
      if (found) return Promise.resolve(found);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timed out waiting for "${t}"`)), 12000);
        waiters.push({ match: m => m.t === t, resolve: m => { clearTimeout(timer); resolve(m); } });
      });
    },
    open: () => new Promise(r => ws.on('open', r)),
    close: () => ws.close(),
  };
}

(async () => {
  await new Promise(r => server.listening ? r() : server.on('listening', r));
  console.log('server on port', server.address().port);

  // ---- a whole match, end to end ----
  const a = client();
  const b = client();
  await Promise.all([a.open(), b.open()]);

  const helloA = await a.want('hello');
  ok('greets a new connection with the rules', () => {
    assert.strictEqual(helloA.startingCash, 1000);
    assert.ok(helloA.risks.length === 5);
  });

  a.send({ t: 'host', password: 'Copper Otter', risk: 3, ticks: 5, name: 'Ada' });
  const hosted = await a.want('hosted');
  ok('hosting cleans the password and hands back a code', () => {
    assert.strictEqual(hosted.password, 'copper-otter');
    assert.strictEqual(hosted.code, 'copper-otter/3/5');
  });

  // a second host on the same password is turned away
  const c = client();
  await c.open();
  c.send({ t: 'host', password: 'copper-otter', risk: 3, ticks: 5, name: 'Interloper' });
  const clash = await c.want('error');
  ok('refuses a password somebody is already waiting on', () => assert.strictEqual(clash.code, 'taken'));

  const cAt = c.mark();
  c.send({ t: 'join', password: 'nobody-here' });
  const missing = await c.want('error', cAt);
  ok('refuses a join for a room that is not there', () => assert.strictEqual(missing.code, 'no_room'));
  c.close();

  b.send({ t: 'join', password: 'copper-otter', name: 'Grace' });
  const startA = await a.want('start');
  const startB = await b.want('start');
  ok('both players are started on the same stock', () => {
    assert.strictEqual(startA.stock.id, startB.stock.id);
    assert.strictEqual(startA.price, startB.price);
    assert.strictEqual(startA.ticks, 5);
  });
  ok('each player is told who they are up against', () => {
    assert.strictEqual(startA.them.name, 'Grace');
    assert.strictEqual(startB.them.name, 'Ada');
  });
  ok('the future is NOT in the start message', () => {
    assert.ok(!('prices' in startA), 'start must not carry the price path');
    assert.strictEqual(typeof startA.price, 'number');
  });

  // ---- trading ----
  const price0 = startA.price;
  let at = a.mark();
  a.send({ t: 'order', side: 'buy', qty: 1000000 });
  const broke = await a.want('error', at);
  ok('refuses an order you cannot afford', () => assert.strictEqual(broke.code, 'no_cash'));

  at = a.mark();
  a.send({ t: 'order', side: 'sell', qty: 1 });
  const naked = await a.want('error', at);
  ok('refuses a sale of shares you do not hold', () => assert.strictEqual(naked.code, 'no_shares'));

  const qty = Math.floor(1000 / (price0 * 1.0025));
  const beforeFill = a.mark();
  a.send({ t: 'order', side: 'buy', qty });
  const filled = await a.want('filled', beforeFill);
  ok('fills a good order and returns the authoritative cash', () => {
    assert.strictEqual(filled.shares, qty);
    const expected = Math.round((1000 - qty * filled.price - VS.commission(qty * filled.price)) * 100) / 100;
    assert.ok(Math.abs(filled.cash - expected) < 0.02, `${filled.cash} vs ${expected}`);
    assert.ok(filled.cash >= 0);
  });

  // spam the ticket
  const beforeSpam = a.mark();
  for (let i = 0; i < 8; i++) a.send({ t: 'order', side: 'sell', qty: 1 });
  const tooFast = await a.want('error', beforeSpam);
  ok('caps how many orders one player can fire in a tick', () => assert.strictEqual(tooFast.code, 'too_fast'));

  // ---- the price reveal ----
  const tick1 = await a.want('tick');
  ok('a tick reveals only prices up to now', () => {
    assert.ok(Array.isArray(tick1.prices));
    assert.ok(tick1.prices.length <= tick1.tick + 1);
    assert.ok(tick1.tick <= 5);
  });
  ok('a tick carries the opponent’s worth but not their position', () => {
    assert.strictEqual(typeof tick1.them.worth, 'number');
    assert.ok(!('shares' in tick1.them) && !('cash' in tick1.them));
  });

  // ---- the bell ----
  const overA = await a.want('over');
  const overB = await b.want('over');
  ok('both players are told the result, and they agree', () => {
    assert.strictEqual(overA.reason, 'bell');
    assert.ok(Math.abs(overA.you.worth - overB.them.worth) < 0.01);
    assert.ok(Math.abs(overB.you.worth - overA.them.worth) < 0.01);
    const pair = [overA.outcome, overB.outcome].sort().join('/');
    assert.ok(pair === 'loss/win' || pair === 'draw/draw', pair);
  });
  ok('the full price path is only handed over once the match is done', () => {
    assert.strictEqual(overA.prices.length, 6);
    assert.strictEqual(typeof overA.seed, 'number');
  });
  ok('the result can be replayed from its seed', () => {
    const replay = VS.generateMatch({ seed: overA.seed, risk: startA.risk, ticks: 5 });
    assert.deepStrictEqual(replay.prices, overA.prices);
    assert.strictEqual(replay.stock.id, startA.stock.id);
  });
  ok('the room is cleaned up after the bell', () => assert.strictEqual(rooms.size, 0));
  a.close(); b.close();

  // ---- walking out ----
  const d = client(); const e = client();
  await Promise.all([d.open(), e.open()]);
  d.send({ t: 'host', password: 'walkout', risk: 2, ticks: 5, name: 'Quitter' });
  await d.want('hosted');
  e.send({ t: 'join', password: 'walkout', name: 'Stayer' });
  await e.want('start');
  await new Promise(r => setTimeout(r, 300));
  d.close();
  const forfeit = await e.want('over');
  ok('walking out hands the match to the other player', () => {
    assert.strictEqual(forfeit.reason, 'forfeit');
    assert.strictEqual(forfeit.outcome, 'win');
  });
  ok('a forfeited room is cleaned up too', () => assert.strictEqual(rooms.size, 0));
  e.close();

  // ---- bad input ----
  const f = client();
  await f.open(); await f.want('hello');
  let fAt = f.mark();
  f.raw('not json at all');
  const bad = await f.want('error', fAt);
  ok('survives a frame that is not JSON', () => assert.strictEqual(bad.code, 'bad_json'));
  fAt = f.mark();
  f.raw('[1,2,3]');
  const notMsg = await f.want('error', fAt);
  ok('survives JSON that is not a message', () => assert.strictEqual(notMsg.code, 'bad_message'));
  fAt = f.mark();
  f.send({ t: 'host', password: 'x', risk: 99, ticks: 5 });
  const badRisk = await f.want('error', fAt);
  ok('refuses a risk level that does not exist', () => assert.strictEqual(badRisk.code, 'bad_risk'));
  fAt = f.mark();
  f.send({ t: 'host', password: 'x', risk: 3, ticks: 7 });
  const badLen = await f.want('error', fAt);
  ok('refuses a match length that does not exist', () => assert.strictEqual(badLen.code, 'bad_length'));
  f.close();

  console.log(`\n${PASS.length} passed`);
  PASS.forEach(n => console.log('  ✓', n));
  server.close();
  process.exit(process.exitCode || 0);
})().catch(e => { console.error(e); process.exit(1); });

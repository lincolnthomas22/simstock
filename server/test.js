// Protocol tests for the match server. No browser: two WebSocket clients, a
// real server, and a stopwatch. Run with `npm test`.
'use strict';

const assert = require('assert');
const WebSocket = require('ws');

// A match is two minutes at its shortest, which is a long time to watch a test
// run, so a five-tick length is added before the server reads the list.
const VS = require('../sim.js');
VS.DURATIONS.push({ id: 'test', label: 'Test', ticks: 5, note: '5 seconds' });
// And a slightly longer one, for the tests that need a match still running
// after somebody has dropped out of it and climbed back in.
VS.DURATIONS.push({ id: 'test-long', label: 'Test', ticks: 30, note: '30 seconds' });

process.env.PORT = '0';
process.env.GRACE_SECONDS = '2';   // a dropped player's window, short enough to watch close
process.env.COUNTDOWN_SECONDS = '1';   // the host's "start" to the bell, kept short
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

  // ---- the market a match is played on ----
  // sim.js is shared with the browser, so what holds here holds there.
  {
    const m = VS.generateMatch({ seed: 4242, risk: 3, ticks: 300 });
    ok('a match stock has profits behind its price', () => {
      assert.strictEqual(m.eps.length, m.prices.length);
      assert.ok(m.eps.every(e => e > 0), 'a share of the profits went to nothing');
      // Fair value is profits times the P/E, and the price is pulled toward
      // it, so the ratio should stay in the same country as the company's.
      const pe = m.prices[300] / m.eps[300];
      assert.ok(pe > m.stock.pe / 3 && pe < m.stock.pe * 3, `P/E drifted to ${pe.toFixed(1)} from ${m.stock.pe}`);
    });
    ok('it opens fairly valued, as a listed company does', () => {
      assert.ok(Math.abs(m.prices[0] / (m.eps[0] * m.stock.pe) - 1) < 0.001);
    });
    ok('there is an index behind it, and it is not the stock', () => {
      assert.strictEqual(m.market.length, m.prices.length);
      assert.notStrictEqual(m.market[300], m.prices[300]);
    });
    ok('the economy gets a word in as well as the company', () => {
      const kinds = new Set(m.news.map(n => n.kind));
      assert.ok(kinds.has('market'), 'no market news in 300 ticks');
      assert.ok(kinds.has('earnings'), 'no earnings report in 300 ticks');
    });
    ok('earnings land on the quarter, not at random', () => {
      const reports = m.news.filter(n => n.kind === 'earnings');
      assert.ok(reports.length >= 4, `only ${reports.length} reports in 300 ticks`);
      reports.forEach(r => assert.strictEqual(r.tick % VS.DAYS_PER_QUARTER, m.stock.earningsDay));
    });
    ok('a dividend follows its report three weeks later', () => {
      const payer = [4242, 7, 19, 23, 88, 101].map(s => VS.generateMatch({ seed: s, risk: 3, ticks: 300 })).find(x => x.stock.divYield);
      assert.ok(payer, 'no seed in the sample landed on a company that pays one');
      assert.ok(payer.dividends.length >= 4, `only ${payer.dividends.length} dividends`);
      payer.dividends.forEach(d => {
        assert.strictEqual(d.tick % VS.DAYS_PER_QUARTER, payer.stock.dividendDay);
        assert.strictEqual(VS.dividendAt(payer, d.tick), d.perShare);
      });
      assert.strictEqual(VS.dividendAt(payer, payer.dividends[0].tick + 1), 0);
    });
    ok('a company that pays nothing pays nothing', () => {
      const dry = [1, 2, 3, 5, 8, 13, 21, 34].map(s => VS.generateMatch({ seed: s, risk: 3, ticks: 300 })).find(x => !x.stock.divYield);
      if (dry) assert.strictEqual(dry.dividends.length, 0);
    });
    ok('the same seed still gives the same market, to the cent', () => {
      assert.deepStrictEqual(VS.generateMatch({ seed: 4242, risk: 3, ticks: 300 }), m);
    });
  }

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

  const earlyAt = a.mark();
  a.send({ t: 'begin' });
  const early = await a.want('error', earlyAt);
  ok('the host cannot start a match with nobody to play', () => assert.strictEqual(early.code, 'alone'));

  b.send({ t: 'join', password: 'copper-otter', name: 'Grace' });
  const lobbyA = await a.want('lobby');
  const lobbyB = await b.want('lobby');
  ok('joining puts both players in the lobby, not in a running match', () => {
    assert.deepStrictEqual(lobbyA.players.map(p => p.name), ['Ada', 'Grace']);
    assert.deepStrictEqual(lobbyB.players.map(p => p.name), ['Ada', 'Grace']);
    assert.strictEqual(lobbyA.host, true);
    assert.strictEqual(lobbyB.host, false);
    assert.strictEqual(lobbyB.risk, 3);
  });
  await new Promise(r => setTimeout(r, 1500));
  ok('and nothing starts until the host says so', () => {
    assert.ok(!a.seen.some(m => m.t === 'start' || m.t === 'tick'));
    assert.ok(!b.seen.some(m => m.t === 'start' || m.t === 'tick'));
  });

  const bBeginAt = b.mark();
  b.send({ t: 'begin' });
  const notHost = await b.want('error', bBeginAt);
  ok('only the host can start the match', () => assert.strictEqual(notHost.code, 'not_host'));

  const unreadyAt = a.mark();
  a.send({ t: 'begin' });
  const unready = await a.want('error', unreadyAt);
  ok('the host cannot start until the opponent is ready', () => assert.strictEqual(unready.code, 'not_ready'));
  ok('and the lobby says who is ready', () => assert.deepStrictEqual(lobbyA.players.map(p => p.ready), [true, false]));

  const hostReadyAt = a.mark();
  a.send({ t: 'ready', ready: true });
  const hostReady = await a.want('error', hostReadyAt);
  ok('the host has no ready of their own to give', () => assert.strictEqual(hostReady.code, 'is_host'));

  // The host changes the market; the opponent is asked again.
  let lat = b.mark();
  b.send({ t: 'ready', ready: true });
  const readied = await b.want('lobby', lat);
  ok('the opponent saying ready is shown to both', () => assert.strictEqual(readied.players[1].ready, true));
  lat = b.mark();
  a.send({ t: 'settings', risk: 4, ticks: 5 });
  const changed = await b.want('lobby', lat);
  ok('the host can change the risk in the lobby, and both see it', () => assert.strictEqual(changed.risk, 4));
  ok('and changing it takes the opponent\'s ready back', () => assert.strictEqual(changed.players[1].ready, false));
  lat = b.mark();
  b.send({ t: 'settings', risk: 1 });
  const guestSettings = await b.want('error', lat);
  ok('only the host can change the match', () => assert.strictEqual(guestSettings.code, 'not_host'));
  lat = a.mark();
  a.send({ t: 'settings', risk: 9 });
  const badChange = await a.want('error', lat);
  ok('a lobby change is checked like a new room is', () => assert.strictEqual(badChange.code, 'bad_risk'));
  lat = b.mark();
  a.send({ t: 'settings', risk: 3 });
  await b.want('lobby', lat);

  // A countdown either of them can stop.
  lat = b.mark();
  b.send({ t: 'ready', ready: true });
  await b.want('lobby', lat);
  lat = b.mark();
  a.send({ t: 'begin' });
  await b.want('countdown', lat);
  lat = b.mark();
  b.send({ t: 'hold' });
  const held = await b.want('lobby', lat);
  ok('the opponent can hold the countdown, and is no longer ready', () => {
    assert.strictEqual(held.counting, false);
    assert.strictEqual(held.players[1].ready, false);
    assert.strictEqual(rooms.get('copper-otter').stage, 'waiting');
  });
  lat = b.mark();
  b.send({ t: 'ready', ready: true });
  await b.want('lobby', lat);
  lat = a.mark();
  a.send({ t: 'begin' });
  await a.want('countdown', lat);
  a.send({ t: 'settings', risk: 2 });
  const counting = await a.want('error', lat);
  ok('the match cannot be changed mid-countdown', () => assert.strictEqual(counting.code, 'counting'));
  lat = a.mark();
  a.send({ t: 'hold' });
  const hostHeld = await a.want('lobby', lat);
  ok('the host can hold the countdown too, and the opponent stays ready', () => {
    assert.strictEqual(hostHeld.counting, false);
    assert.strictEqual(hostHeld.players[1].ready, true);
  });
  await new Promise(r => setTimeout(r, 1300));
  ok('and a held countdown never starts the match', () => {
    assert.ok(!a.seen.some(m => m.t === 'start'));
    assert.ok(!b.seen.some(m => m.t === 'start'));
  });

  const goA = a.mark(); const goB = b.mark();
  a.send({ t: 'begin' });
  const countA = await a.want('countdown', goA);
  const countB = await b.want('countdown', goB);
  ok('the host starting it counts both players down together', () => {
    assert.strictEqual(countA.seconds, 1);
    assert.strictEqual(countB.seconds, 1);
  });
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
  ok('the result offers a rematch while both players are still there', () => {
    assert.strictEqual(overA.rematch, true);
    assert.strictEqual(overB.rematch, true);
  });

  // ---- a rematch, without either of them going back to the lobby ----
  const askedAt = b.mark();
  a.send({ t: 'rematch' });
  const offer = await b.want('rematch_offer');
  ok('one player asking is an offer, not a match', () => {
    assert.strictEqual(offer.name, 'Ada');
    assert.ok(!b.seen.slice(askedAt).some(m => m.t === 'start'), 'started on one say-so');
  });

  const againAt = a.mark();
  b.send({ t: 'rematch' });
  const againA = await a.want('start', againAt);
  const againB = await b.want('start');
  ok('both of them asking starts another match', () => {
    assert.strictEqual(againA.ticks, 5);
    assert.strictEqual(againA.risk, startA.risk);
    assert.strictEqual(againA.startingCash, 1000);
  });
  ok('the rematch is a new market, not the one they have both seen', () => {
    assert.notStrictEqual(againA.seed, overA.seed);
  });
  ok('and both of them start it from a clean desk', () => {
    assert.strictEqual(againA.startingCash, againB.startingCash);
  });

  const endAgainA = await a.want('over', againAt);
  await b.want('over', againAt);
  ok('the rematch plays out and is refereed the same way', () => {
    assert.strictEqual(endAgainA.reason, 'bell');
    assert.strictEqual(endAgainA.prices.length, 6);
  });

  // ---- leaving a finished room takes the rematch off the table ----
  a.send({ t: 'leave' });
  const off = await b.want('rematch_off');
  ok('a player leaving tells the other one the rematch is off', () => {
    assert.strictEqual(off.reason, 'opponent_left');
  });
  ok('and the finished room is gone with them', () => assert.strictEqual(rooms.size, 0));
  a.close(); b.close();

  // ---- leaving the lobby before the match starts ----
  {
    const host = client(); const guest = client();
    await Promise.all([host.open(), guest.open()]);
    host.send({ t: 'host', password: 'lobby-test', risk: 2, ticks: 5, name: 'Host' });
    await host.want('hosted');
    guest.send({ t: 'join', password: 'lobby-test', name: 'Guest' });
    await host.want('lobby');
    const leftAt = host.mark();
    guest.send({ t: 'leave' });
    const alone = await host.want('lobby', leftAt);
    ok('an opponent leaving the lobby puts the host back to waiting', () => {
      assert.deepStrictEqual(alone.players.map(p => p.name), ['Host']);
      assert.strictEqual(rooms.get('lobby-test').stage, 'waiting');
    });
    const guestAt = guest.mark();
    guest.send({ t: 'join', password: 'lobby-test', name: 'Guest' });
    await guest.want('lobby', guestAt);
    host.send({ t: 'leave' });
    const closed = await guest.want('error', guestAt);
    ok('the host leaving the lobby closes the room', () => {
      assert.strictEqual(closed.code, 'host_left');
      assert.ok(!rooms.has('lobby-test'));
    });
    host.close(); guest.close();
  }

  // ---- walking out, which is a decision and not an accident ----
  const d = client(); const e = client();
  await Promise.all([d.open(), e.open()]);
  d.send({ t: 'host', password: 'walkout', risk: 2, ticks: 5, name: 'Quitter' });
  await d.want('hosted');
  e.send({ t: 'join', password: 'walkout', name: 'Stayer' });
  await d.want('lobby');
  e.send({ t: 'ready', ready: true });
  await d.want('lobby', 1 + d.seen.findIndex(m => m.t === 'lobby'));
  d.send({ t: 'begin' });
  await e.want('start');
  await new Promise(r => setTimeout(r, 300));
  d.send({ t: 'leave' });
  const forfeit = await e.want('over');
  ok('walking out hands the match to the other player', () => {
    assert.strictEqual(forfeit.reason, 'forfeit');
    assert.strictEqual(forfeit.outcome, 'win');
  });
  ok('a forfeited room is cleaned up too', () => assert.strictEqual(rooms.size, 0));
  d.close(); e.close();

  // ---- a dropped socket, which is not a decision ----
  const g = client(); const h = client();
  await Promise.all([g.open(), h.open()]);
  g.send({ t: 'host', password: 'dropout', risk: 2, ticks: 30, name: 'Flaky' });
  await g.want('hosted');
  h.send({ t: 'join', password: 'dropout', name: 'Patient' });
  await g.want('lobby');
  h.send({ t: 'ready', ready: true });
  await g.want('lobby', 1 + g.seen.findIndex(m => m.t === 'lobby'));
  g.send({ t: 'begin' });
  const startG = await g.want('start');
  await h.want('start');
  ok('a match hands each player a ticket back into it', () => {
    assert.strictEqual(typeof startG.token, 'string');
    assert.ok(startG.token.length >= 16, startG.token);
    assert.strictEqual(startG.graceSec, 2);
  });

  // buy something, so there is a position to come back to
  await new Promise(r => setTimeout(r, 1100));
  g.send({ t: 'order', side: 'buy', qty: 3 });
  const bought = await g.want('filled');
  const droppedAt = h.mark();
  g.ws.terminate();

  const gone = await h.want('opponent_gone', droppedAt);
  ok('a dropped socket does not end the match', () => {
    assert.strictEqual(gone.name, 'Flaky');
    assert.strictEqual(gone.seconds, 2);
    assert.ok(!h.seen.slice(droppedAt).some(m => m.t === 'over'), 'the match was ended by a dropped socket');
    assert.strictEqual(rooms.size, 1);
  });

  // back in, on the ticket, before the window closes
  const g2 = client();
  await g2.open();
  await g2.want('hello');
  const backAt = h.mark();
  g2.send({ t: 'resume', token: startG.token });
  const resumed = await g2.want('resumed');
  ok('the ticket gets them back into the same match', () => {
    assert.strictEqual(resumed.stock.id, startG.stock.id);
    assert.strictEqual(resumed.ticks, 30);
    assert.strictEqual(resumed.them.name, 'Patient');
  });
  ok('they come back to their own money and shares', () => {
    assert.strictEqual(resumed.you.shares, 3);
    assert.strictEqual(resumed.you.cash, bought.cash);
  });
  ok('and to everything they missed, but no more', () => {
    assert.strictEqual(resumed.prices.length, resumed.tick + 1);
    assert.strictEqual(resumed.eps.length, resumed.tick + 1);
    assert.ok(resumed.news.every(n => n.tick <= resumed.tick), 'news from the future');
    assert.ok(resumed.tick < 30, `the clock stopped at ${resumed.tick}`);
  });
  const back = await h.want('opponent_back', backAt);
  ok('the one who stayed is told they are back', () => assert.strictEqual(back.name, 'Flaky'));

  // the clock kept running while they were away
  const nextTick = await g2.want('tick');
  ok('the match carries on from where it got to', () => assert.ok(nextTick.tick >= resumed.tick));
  const spare = client();
  await spare.open(); await spare.want('hello');
  const spareAt = spare.mark();
  spare.send({ t: 'resume', token: startG.token });
  const refused = await spare.want('error', spareAt);
  ok('a ticket cannot be used while its match already has a connection',
    () => assert.strictEqual(refused.code, 'still_here'));
  spare.close();

  // ---- and when nobody comes back, it is a forfeit after all ----
  const lostAt = h.mark();
  g2.ws.terminate();
  await h.want('opponent_gone', lostAt);
  const lost = await h.want('over', lostAt);
  ok('a player who never comes back forfeits when the window closes', () => {
    assert.strictEqual(lost.reason, 'forfeit');
    assert.strictEqual(lost.outcome, 'win');
  });
  ok('and the room goes with them', () => assert.strictEqual(rooms.size, 0));

  const late = client();
  await late.open(); await late.want('hello');
  const lateAt = late.mark();
  late.send({ t: 'resume', token: startG.token });
  const tooLate = await late.want('error', lateAt);
  ok('a ticket for a finished match is no ticket at all',
    () => assert.strictEqual(tooLate.code, 'no_match'));
  late.close(); h.close();

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

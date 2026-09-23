// Two browsers playing each other through a real match server. The server is
// started here rather than by the workflow, so this is one command anywhere.
//
//   npm run test:online
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const { launch, results } = require('./helpers.js');

const SERVER_DIR = path.join(__dirname, '..', 'server');
const PORT = Number(process.env.PORT) || 8099;
const ADDRESS = `ws://127.0.0.1:${PORT}`;

function startServer() {
  const proc = spawn(process.execPath, ['server.js'], {
    cwd: SERVER_DIR,
    // The dropped player's window: long enough that the test can look at an
    // outage and still get back in well inside it, short enough not to sit
    // through the real 45 seconds.
    env: { ...process.env, PORT: String(PORT), GRACE_SECONDS: '30', COUNTDOWN_SECONDS: '2' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stderr.on('data', d => process.stderr.write(`[server] ${d}`));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('the server did not start in time')), 10000);
    proc.stdout.on('data', d => {
      process.stdout.write(`[server] ${d}`);
      if (String(d).includes('listening')) { clearTimeout(timer); resolve(proc); }
    });
    proc.on('exit', code => { clearTimeout(timer); reject(new Error(`the server exited with ${code}`)); });
  });
}

// Two pages are read one after the other, so a tick can land between the
// reads. A few tries in step is the honest version of "the same".
async function inStep(a, selA, b, selB) {
  for (let i = 0; i < 4; i++) {
    if ((await a.textContent(selA)) === (await b.textContent(selB))) return true;
    await a.waitForTimeout(250);
  }
  return false;
}

// Opens the game, connects to the server, and waits until the lobby says so.
async function player(browser, name, watch) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  page.on('pageerror', e => watch(`PAGEERROR(${name}): ${e.message}`));
  await page.goto('file://' + path.join(__dirname, '..', 'index.html'));
  await page.waitForTimeout(400);
  await page.click('.landing-buttons [data-screen="versus"]');
  await page.fill('#vsServerUrl', ADDRESS);
  await page.fill('#vsName', name);
  await page.click('#vsConnectBtn');
  await page.waitForFunction(() => document.querySelector('#vsStatus').textContent === 'Live', null, { timeout: 10000 });
  return page;
}

// The same player, on a context where the test owns the page's sockets: it can
// pull the live one out from under the game, and it can keep the next one from
// connecting for as long as it wants to look at what the game does about it.
//
// Both halves have to be under the test's control. setOffline is no use for
// either: it leaves an open socket open, and it does not reliably stop a new
// one reaching a server on loopback — so an outage built out of it can be over
// before the assertion runs, which is exactly how this test first failed on
// CI and not here. Pointing a blocked socket at a dead port is a refused
// connection on any machine.
const DEAD_PORT = 'ws://127.0.0.1:1';

async function flakyPlayer(browser, name, watch) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  await ctx.addInitScript(dead => {
    const Real = window.WebSocket;
    window.__sockets = [];
    window.__blockSockets = false;
    const Wrapped = function (url, ...rest) {
      const ws = new Real(window.__blockSockets ? dead : url, ...rest);
      window.__sockets.push(ws);
      return ws;
    };
    Wrapped.prototype = Real.prototype;
    ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach(k => { Wrapped[k] = Real[k]; });
    window.WebSocket = Wrapped;
  }, DEAD_PORT);
  const page = await ctx.newPage();
  page.on('pageerror', e => watch(`PAGEERROR(${name}): ${e.message}`));
  await page.goto('file://' + path.join(__dirname, '..', 'index.html'));
  await page.waitForTimeout(400);
  await page.click('.landing-buttons [data-screen="versus"]');
  await page.fill('#vsServerUrl', ADDRESS);
  await page.fill('#vsName', name);
  await page.click('#vsConnectBtn');
  await page.waitForFunction(() => document.querySelector('#vsStatus').textContent === 'Live', null, { timeout: 10000 });
  return page;
}

(async () => {
  const r = results();
  const server = await startServer();
  const browser = await launch();

  try {
    // ---- nobody should have to type an address ----
    // DEFAULT_SERVER in game.js, a desktop build's baked-in address and a
    // player's own saved one all land in the same box and are connected by
    // the same code, so seeding the saved one tests all three.
    {
      const ctx = await browser.newContext();
      await ctx.addInitScript(addr => {
        try { localStorage.setItem('simstock.versus.server', addr); } catch { /* storage off */ }
      }, ADDRESS);
      const page = await ctx.newPage();
      page.on('pageerror', e => r.fail(`PAGEERROR(auto): ${e.message}`));
      await page.goto('file://' + path.join(__dirname, '..', 'index.html'));
      await page.waitForTimeout(400);
      await page.click('.landing-buttons [data-screen="versus"]');
      await page.waitForFunction(() => document.querySelector('#vsStatus').textContent === 'Live',
        null, { timeout: 10000 }).catch(() => {});
      r.check('a known server is connected to without anyone typing anything',
        (await page.textContent('#vsStatus')) === 'Live', await page.textContent('#vsStatus'));
      r.check('and the address is already in the box',
        (await page.inputValue('#vsServerUrl')) === ADDRESS, await page.inputValue('#vsServerUrl'));

      // Disconnecting on purpose has to stick, or the room argues with you.
      await page.click('#vsConnectBtn');
      await page.waitForTimeout(400);
      await page.click('.task-switch [data-screen="home"]');
      await page.waitForTimeout(300);
      await page.click('.task-switch [data-screen="versus"]');
      await page.waitForTimeout(1200);
      r.check('but a deliberate disconnect is not undone on the way back in',
        (await page.textContent('#vsStatus')) === 'Offline', await page.textContent('#vsStatus'));
      await ctx.close();
    }

    const ada = await player(browser, 'Ada', r.fail);
    const grace = await player(browser, 'Grace', r.fail);
    r.check('both clients connect', true);
    r.check('online, joining asks only for a password',
      (await ada.getAttribute('#vsJoinPass', 'placeholder')) === 'their password');
    r.check('the host button says it opens a room', (await ada.textContent('#vsHostBtn')) === 'Open the room');

    // ---- hosting ----
    await ada.fill('#vsHostPass', 'Copper Otter');
    await ada.click('#vsRiskSeg button[data-risk="4"]');
    await ada.click('#vsLenSeg button[data-ticks="120"]');
    await ada.click('#vsHostBtn');
    await ada.waitForSelector('#vsWaiting:not([hidden])', { timeout: 8000 });
    r.check('the password is cleaned before it becomes a room', (await ada.textContent('#vsWaitCode')) === 'copper-otter',
      await ada.textContent('#vsWaitCode'));
    r.check('the waiting room shows the settings the host picked',
      (await ada.textContent('#vsWaitSettings')).includes('Risk 4'), await ada.textContent('#vsWaitSettings'));

    // ---- joining ----
    await grace.fill('#vsJoinPass', 'copper-otter');
    await grace.click('#vsJoinBtn');

    // ---- the lobby: both in the room, nothing moving until the host says go ----
    await grace.waitForSelector('#vsWaiting:not([hidden])', { timeout: 8000 });
    await ada.waitForFunction(() => document.querySelectorAll('#vsWaitPlayers li:not(.empty)').length === 2, null, { timeout: 8000 });
    r.check('joining lands in the lobby, not a running match', await grace.isHidden('#vsLive') && await ada.isHidden('#vsLive'));
    r.check('both players see who is in the room',
      (await ada.textContent('#vsWaitPlayers')).includes('Grace') && (await grace.textContent('#vsWaitPlayers')).includes('Ada'));
    r.check('the joiner is asked to say they are ready', (await grace.textContent('#vsWaitNote')).includes('say you are ready'),
      await grace.textContent('#vsWaitNote'));
    r.check('only the host gets a start button', await ada.isVisible('#vsStartBtn') && await grace.isHidden('#vsStartBtn'));
    r.check('only the joiner gets a ready button', await grace.isVisible('#vsReadyBtn') && await ada.isHidden('#vsReadyBtn'));
    r.check('and the host cannot start before they are ready', await ada.isDisabled('#vsStartBtn'));

    // ---- the host changing the market from the lobby ----
    r.check('only the host can change the market in the lobby', await ada.isVisible('#vsWaitSetup') && await grace.isHidden('#vsWaitSetup'));
    await grace.click('#vsReadyBtn');
    await ada.waitForSelector('#vsStartBtn:not([disabled])', { timeout: 8000 });
    await ada.click('#vsWaitRiskSeg button[data-risk="2"]');
    const graceSawChange = await grace.waitForFunction(() => document.querySelector('#vsWaitSettings').textContent.includes('Risk 2'), null, { timeout: 8000 })
      .then(() => true, () => false);
    r.check('a change the host makes in the lobby reaches the joiner', graceSawChange, await grace.textContent('#vsWaitSettings'));
    const adaWaits = await ada.waitForSelector('#vsStartBtn[disabled]', { timeout: 8000 }).then(() => true, () => false);
    r.check('and asks them to be ready again', (await grace.textContent('#vsReadyBtn')) === "I'm ready" && adaWaits,
      await grace.textContent('#vsReadyBtn'));
    await ada.click('#vsWaitRiskSeg button[data-risk="4"]');
    await grace.waitForFunction(() => document.querySelector('#vsWaitSettings').textContent.includes('Risk 4'), null, { timeout: 8000 });

    await grace.click('#vsReadyBtn');
    await ada.waitForSelector('#vsStartBtn:not([disabled])', { timeout: 8000 });
    r.check('the host sees the joiner is ready', !(await ada.textContent('#vsWaitPlayers')).includes('not ready'), await ada.textContent('#vsWaitPlayers'));
    // Each page hears about the ready on its own socket, so the joiner's can
    // be a moment behind the host's.
    const graceTold = await grace.waitForFunction(() => document.querySelector('#vsWaitNote').textContent.includes('Ada to start'), null, { timeout: 8000 })
      .then(() => true, () => false);
    r.check('the joiner is told the host starts it', graceTold, await grace.textContent('#vsWaitNote'));
    await ada.waitForTimeout(1500);
    r.check('and the market waits for them', await grace.isHidden('#vsLive'));

    // ---- a countdown either of them can hold ----
    await ada.click('#vsStartBtn');
    await grace.waitForSelector('#vsHoldBtn:not([hidden])', { timeout: 8000 });
    await grace.click('#vsHoldBtn');
    await ada.waitForFunction(() => !/Starting in/.test(document.querySelector('#vsWaitHead').textContent), null, { timeout: 8000 });
    await ada.waitForTimeout(2500);
    r.check('holding the countdown keeps the market shut', await ada.isHidden('#vsLive') && await grace.isHidden('#vsLive'));
    r.check('and the one who held it is no longer ready', await ada.isDisabled('#vsStartBtn'));
    await grace.click('#vsReadyBtn');
    await ada.waitForSelector('#vsStartBtn:not([disabled])', { timeout: 8000 });
    await ada.click('#vsStartBtn');
    await grace.waitForFunction(() => /Starting in/.test(document.querySelector('#vsWaitHead').textContent), null, { timeout: 8000 });
    const adaCounts = await ada.waitForFunction(() => /Starting in/.test(document.querySelector('#vsWaitHead').textContent), null, { timeout: 8000 })
      .then(() => true, () => false);
    r.check('both screens count down to the bell', adaCounts, await ada.textContent('#vsWaitHead'));
    await ada.waitForSelector('#vsLive:not([hidden])', { timeout: 8000 });
    await grace.waitForSelector('#vsLive:not([hidden])', { timeout: 8000 });
    const stock = await ada.textContent('#vsStockName');
    r.check('both players land in the same market', stock === (await grace.textContent('#vsStockName')),
      `${stock} vs ${await grace.textContent('#vsStockName')}`);
    r.check('and the market has a company behind it', !!stock.trim(), `"${stock}"`);
    r.check('each sees the other by name',
      (await ada.textContent('#vsThemName')) === 'Grace' && (await grace.textContent('#vsThemName')) === 'Ada');

    // The client must not be holding the rest of the match.
    const known = await ada.evaluate(() => {
      // reaching the match through the only handle a page has: the rendered chart
      const canvas = document.querySelector('#vsChart');
      return canvas ? canvas.width > 0 : false;
    });
    r.check('the match chart is drawing', known);

    await ada.waitForTimeout(3000);
    r.check('prices stay in step across both clients',
      await inStep(ada, '#vsPrice', grace, '#vsPrice'),
      `${await ada.textContent('#vsPrice')} vs ${await grace.textContent('#vsPrice')}`);
    r.check('the clock is running', (await ada.textContent('#vsClock')) !== '2:00', await ada.textContent('#vsClock'));

    // ---- trading ----
    await ada.click('#vsQtyMax');
    const qty = Number(await ada.inputValue('#vsQty'));
    await ada.click('#vsOrderBtn');
    await ada.waitForTimeout(1500);
    r.check('the server fills the order', (await ada.textContent('#vsPShares')) === qty.toLocaleString('en-US'),
      `asked ${qty}, holds ${await ada.textContent('#vsPShares')}`);
    r.check('the cash the server sends back is never negative',
      !(await ada.textContent('#vsPCash')).includes('-'), await ada.textContent('#vsPCash'));

    await ada.waitForTimeout(2000);
    r.check('the opponent panel matches the real net worth, to the penny',
      await inStep(grace, '#vsThemWorth', ada, '#vsMeWorth'),
      `${await grace.textContent('#vsThemWorth')} vs ${await ada.textContent('#vsMeWorth')}`);

    await ada.fill('#vsQty', '999999');
    await ada.waitForTimeout(200);
    r.check('an unaffordable order is stopped before it reaches the server',
      await ada.isDisabled('#vsOrderBtn'));

    // ---- a dropped socket is not a walkout ----
    {
      const flaky = await flakyPlayer(browser, 'Flaky', r.fail);
      const patient = await player(browser, 'Patient', r.fail);
      await flaky.fill('#vsHostPass', 'dropout');
      await flaky.click('#vsHostBtn');
      await flaky.waitForSelector('#vsWaiting:not([hidden])', { timeout: 8000 });
      await patient.fill('#vsJoinPass', 'dropout');
      await patient.click('#vsJoinBtn');
      await patient.waitForSelector('#vsReadyBtn:not([hidden])', { timeout: 8000 });
      await patient.click('#vsReadyBtn');
      await flaky.waitForSelector('#vsStartBtn:not([disabled])', { timeout: 8000 });
      await flaky.click('#vsStartBtn');
      await flaky.waitForSelector('#vsLive:not([hidden])', { timeout: 8000 });
      await patient.waitForSelector('#vsLive:not([hidden])', { timeout: 8000 });

      await flaky.waitForTimeout(1500);
      await flaky.click('#vsQtyMax');
      const held = Number(await flaky.inputValue('#vsQty'));
      await flaky.click('#vsOrderBtn');
      await flaky.waitForTimeout(1200);

      // The socket goes, rather than the player. The line is held down first,
      // so the game's own retry cannot get back in before the test has looked
      // at what a player sees while they are out.
      await flaky.evaluate(() => { window.__blockSockets = true; });
      await flaky.evaluate(() => window.__sockets[window.__sockets.length - 1].close());
      await flaky.waitForSelector('#vsNetNote:not([hidden])', { timeout: 15000 });
      r.check('a dropped socket leaves the match on screen', await flaky.isVisible('#vsLive'));
      r.check('and says it is getting back in',
        (await flaky.textContent('#vsNetNote')).includes('Getting back in'), await flaky.textContent('#vsNetNote'));
      r.check('with no orders going anywhere in the meantime', await flaky.isDisabled('#vsOrderBtn'));

      await patient.waitForSelector('#vsNetNote:not([hidden])', { timeout: 15000 });
      r.check('the other player is told who is missing',
        (await patient.textContent('#vsNetNote')).includes('Flaky'), await patient.textContent('#vsNetNote'));
      r.check('and that the match is still theirs to lose', await patient.isVisible('#vsLive'));

      // and when the line comes back the retry gets in on its own, with no
      // help from the player
      await flaky.evaluate(() => { window.__blockSockets = false; });
      await flaky.waitForSelector('#vsNetNote', { state: 'hidden', timeout: 25000 });
      r.check('the match is resumed, not restarted', await flaky.isVisible('#vsLive'));
      r.check('the position survived the drop',
        Number((await flaky.textContent('#vsPShares')).replace(/,/g, '')) === held,
        `held ${held}, back with ${await flaky.textContent('#vsPShares')}`);
      r.check('the lobby says it is live again', (await flaky.textContent('#vsStatus')) === 'Live',
        await flaky.textContent('#vsStatus'));
      await patient.waitForSelector('#vsNetNote', { state: 'hidden', timeout: 15000 });
      r.check('and the other player is told they are back', await patient.isVisible('#vsLive'));

      await flaky.waitForTimeout(1500);
      r.check('prices are in step again across both clients',
        await inStep(flaky, '#vsPrice', patient, '#vsPrice'),
        `${await flaky.textContent('#vsPrice')} vs ${await patient.textContent('#vsPrice')}`);
      r.check('and trading is open again', !(await flaky.isDisabled('#vsQtyMax')));

      // ---- and the other half of a lost connection: a lost page ----
      const heldNow = await flaky.textContent('#vsPShares');
      await flaky.reload();
      await flaky.waitForSelector('#vsLive:not([hidden])', { timeout: 20000 });
      r.check('a reload mid-match goes back to the match, not the front page',
        (await flaky.textContent('#vsStockName')).trim() === (await patient.textContent('#vsStockName')).trim(),
        `${await flaky.textContent('#vsStockName')} vs ${await patient.textContent('#vsStockName')}`);
      r.check('with the position still on the book',
        (await flaky.textContent('#vsPShares')) === heldNow,
        `held ${heldNow}, back with ${await flaky.textContent('#vsPShares')}`);
      r.check('and the average cost it was bought at',
        (await flaky.textContent('#vsPAvg')) !== '—', await flaky.textContent('#vsPAvg'));

      await flaky.click('#vsQuitBtn');
      await flaky.close();
      await patient.close();
    }

    // ---- walking out ----
    await grace.click('#vsQuitBtn');
    await ada.waitForSelector('#vsOver:not([hidden])', { timeout: 10000 });
    r.check('a walkout ends the other player’s match', true);
    r.check('and is won by the one who stayed, whatever the money said',
      (await ada.textContent('#vsVerdict')) === 'You win', await ada.textContent('#vsVerdict'));
    r.check('the verdict explains why', (await ada.textContent('#vsVerdictNote')).includes('walked out'),
      await ada.textContent('#vsVerdictNote'));
    const stats = await ada.$$eval('#vsResStats div', ds => ds.map(d => d.textContent));
    r.check('the result carries the seed, so the match can be replayed',
      stats.some(s => s.startsWith('Seed')), JSON.stringify(stats));
    r.check('the full price path arrives only now, at the end',
      stats.some(s => s.startsWith('The stock itself')), JSON.stringify(stats));
    // A rematch takes two, and one of them has just walked out — so the
    // button is not offered, and it says why. (The rematch itself is a
    // protocol matter, and lives in the match server's own tests: a match
    // here would have to run the full two minutes to reach the bell.)
    r.check('a walkout leaves no rematch to ask for', await ada.isHidden('#vsAgainBtn'));
    r.check('and the result says so rather than going quiet',
      (await ada.textContent('#vsAgainNote')).toLowerCase().includes('lobby'),
      await ada.textContent('#vsAgainNote'));

    // ---- and back ----
    await ada.click('#vsLobbyBtn');
    r.check('the lobby is still connected afterwards', (await ada.textContent('#vsStatus')) === 'Live');
    await ada.click('#vsConnectBtn');
    await ada.waitForTimeout(400);
    r.check('disconnecting falls back to offline', (await ada.textContent('#vsStatus')) === 'Offline');
    await ada.click('#vsBotBtn');
    await ada.waitForTimeout(900);
    r.check('and the practice bot still works with no server', await ada.isVisible('#vsLive'));
  } finally {
    await browser.close();
    server.kill();
  }

  r.report('online');
})().catch(e => { console.error(e); process.exit(1); });

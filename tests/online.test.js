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
    env: { ...process.env, PORT: String(PORT) },
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
    await ada.waitForSelector('#vsLive:not([hidden])', { timeout: 8000 });
    await grace.waitForSelector('#vsLive:not([hidden])', { timeout: 8000 });
    const stock = await ada.textContent('#vsName');
    r.check('both players land in the same market', stock === (await grace.textContent('#vsName')),
      `${stock} vs ${await grace.textContent('#vsName')}`);
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
      (await ada.textContent('#vsPrice')) === (await grace.textContent('#vsPrice')),
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
      (await grace.textContent('#vsThemWorth')) === (await ada.textContent('#vsMeWorth')),
      `${await grace.textContent('#vsThemWorth')} vs ${await ada.textContent('#vsMeWorth')}`);

    await ada.fill('#vsQty', '999999');
    await ada.waitForTimeout(200);
    r.check('an unaffordable order is stopped before it reaches the server',
      await ada.isDisabled('#vsOrderBtn'));

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
    r.check('there is no rematch button for an online match', await ada.isHidden('#vsAgainBtn'));

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

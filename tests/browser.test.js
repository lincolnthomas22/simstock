// The game on its own: no match server, no desktop shell. Everything here has
// to hold for someone who just opened index.html.
//
//   npm run test:browser
'use strict';
const { launch, results, openGame, GAME } = require('./helpers.js');

(async () => {
  const r = results();
  const browser = await launch();

  // ---- it runs with nothing fetched from anywhere ----
  {
    const page = await browser.newPage();
    const outside = [];
    page.on('request', req => { if (!req.url().startsWith('file://')) outside.push(req.url()); });
    await page.goto(GAME);
    await page.waitForTimeout(1200);
    // Faces load lazily, when a glyph on screen needs one, so counting what
    // happens to have loaded is a coin toss. Asking for each family outright
    // is deterministic, and tests the thing that matters: the face resolves,
    // from the bundle, with nothing fetched.
    const fonts = await page.evaluate(async () => {
      const out = {};
      for (const family of ['IBM Plex Mono', 'IBM Plex Sans', 'Newsreader']) {
        out[family] = (await document.fonts.load(`16px "${family}"`)).length;
      }
      return out;
    });
    r.check('every font family resolves from the bundle',
      Object.values(fonts).every(n => n > 0), JSON.stringify(fonts));
    r.check('nothing is fetched from off the machine', outside.length === 0, outside.join(', '));
    await page.close();
  }

  // ---- the rooms ----
  {
    const page = await openGame(browser, { screen: 'home', watch: r.fail });

    // The trading floor has always needed a brokerage account. Versus does not.
    await page.click('.task-switch [data-screen="trade"]');
    await page.waitForTimeout(250);
    r.check('the trading floor still asks for an account first', await page.isVisible('.modal-backdrop'));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);

    await page.click('.task-switch [data-screen="versus"]');
    await page.waitForTimeout(250);
    r.check('versus opens without an account', await page.isVisible('#vsLobby'));
    r.check('the room is titled', (await page.textContent('#pageTitle')) === 'Versus');
    r.check('a password is rolled to start with', /\w+-\w+/.test(await page.inputValue('#vsHostPass')));
    r.check('offline, the join card asks for the whole code',
      (await page.textContent('#vsJoinCardNote')).includes('whole code'));

    // ---- a practice match ----
    await page.click('#vsRiskSeg button[data-risk="3"]');
    await page.click('#vsLenSeg button[data-ticks="120"]');
    await page.click('#vsBotBtn');
    await page.waitForTimeout(2200);
    r.check('a practice match starts', await page.isVisible('#vsLive'));
    r.check('it is against one of the desk bots', (await page.textContent('#vsThemName')).includes('desk'),
      await page.textContent('#vsThemName'));

    await page.click('#vsQtyMax');
    const qty = Number(await page.inputValue('#vsQty'));
    await page.click('#vsOrderBtn');
    await page.waitForTimeout(800);
    r.check('an order fills', (await page.textContent('#vsPShares')) === qty.toLocaleString('en-US'),
      `asked ${qty}, holds ${await page.textContent('#vsPShares')}`);

    // ---- the match stock is a company, the way the floor's stocks are ----
    const stats = await page.textContent('#vsStatGrid');
    for (const label of ['Market cap', 'P/E ratio', 'Earnings per share', 'Dividend yield', 'Beta']) {
      r.check(`the match stock shows its ${label.toLowerCase()}`, stats.includes(label), stats.slice(0, 120));
    }
    r.check('the P/E is a number, not a dash',
      /P\/E ratio\s*[\d.]+/.test((await page.textContent('#vsStatGrid')).replace(/\s+/g, ' ')),
      (await page.textContent('#vsStatGrid')).replace(/\s+/g, ' ').slice(0, 200));
    r.check('the calendar says when the next report is due',
      !!(await page.textContent('#vsCalEarnings')).trim(), await page.textContent('#vsCalEarnings'));
    r.check('the chart opens on the price, as the trading floor does',
      (await page.getAttribute('#vsChartSeg button[data-chart=\"price\"]', 'class') || '').includes('active'));
    await page.click('#vsChartSeg button[data-chart="race"]');
    await page.waitForTimeout(250);
    r.check('and the race is still there to switch to',
      (await page.getAttribute('#vsChartSeg button[data-chart=\"race\"]', 'class') || '').includes('active'));
    await page.click('#vsChartSeg button[data-chart="price"]');

    // ---- the career game is untouched by any of it ----
    r.check('the career cash is untouched', (await page.textContent('#topCash')) === '$1,000.00');
    for (const screen of ['home', 'portfolio', 'achievements', 'tutorial', 'versus']) {
      await page.click(`.task-switch [data-screen="${screen}"]`);
      await page.waitForTimeout(250);
    }
    r.check('a match survives walking round the rest of the game',
      Number(await page.textContent('#vsPShares')) === qty, await page.textContent('#vsPShares'));
    await page.close();
  }

  // ---- a password match is the same market for both players ----
  {
    const page = await openGame(browser, { screen: 'versus', watch: r.fail });
    await page.fill('#vsHostPass', 'copper-otter');
    await page.click('#vsRiskSeg button[data-risk="2"]');
    await page.click('#vsLenSeg button[data-ticks="120"]');
    r.check('the host is told the whole code to hand over',
      (await page.textContent('#vsFootnote')).includes('copper-otter/2/120'), await page.textContent('#vsFootnote'));
    await page.click('#vsHostBtn');
    await page.waitForTimeout(600);
    const hostStock = await page.textContent('#vsStockName');
    // Named, not blank: the heading and the lobby's name box once shared an
    // id, so the company's name went into an input nobody could see.
    r.check('the match names the company it is on', !!hostStock.trim(), `"${hostStock}"`);

    await page.click('#vsQuitBtn');
    await page.waitForTimeout(300);
    await page.fill('#vsJoinPass', 'copper-otter/2/120');
    await page.click('#vsJoinBtn');
    await page.waitForTimeout(600);
    r.check('the same code gives the same market', (await page.textContent('#vsStockName')) === hostStock,
      `${hostStock} vs ${await page.textContent('#vsStockName')}`);

    await page.click('#vsQuitBtn');
    await page.fill('#vsJoinPass', 'just-a-word');
    await page.click('#vsJoinBtn');
    await page.waitForTimeout(200);
    r.check('a bare password is refused rather than guessed at',
      (await page.textContent('#vsJoinNote')).includes('whole match code'), await page.textContent('#vsJoinNote'));
    r.check('and no match was started', await page.isHidden('#vsLive'));
    await page.close();
  }

  // ---- progress survives a reload ----
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    page.on('pageerror', e => r.fail(`PAGEERROR: ${e.message}`));
    await page.goto(GAME);
    await page.waitForTimeout(400);
    await page.click('.landing-buttons [data-screen="home"]');
    await page.waitForTimeout(7000);   // the game saves every five ticks
    const before = await page.evaluate(() => {
      const s = localStorage.getItem('simstock.save.v2');
      return s ? JSON.parse(s).day : null;
    });
    await page.reload();
    await page.waitForTimeout(2000);
    const after = await page.evaluate(() => JSON.parse(localStorage.getItem('simstock.save.v2')).day);
    r.check('a career save is written to localStorage', before !== null, 'nothing was saved');
    r.check('and picked back up on reload', after !== null && after >= before, `${before} -> ${after}`);
    await ctx.close();
  }

  await browser.close();
  r.report('browser');
})().catch(e => { console.error(e); process.exit(1); });

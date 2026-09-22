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
    r.check('offline, the join card asks for the match code',
      (await page.textContent('#vsJoinCardNote')).includes('match code'));

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
    r.check('the host is told the code to hand over, in words',
      (await page.textContent('#vsFootnote')).includes('copper-otter-ordinary-quick'), await page.textContent('#vsFootnote'));
    await page.click('#vsHostBtn');
    await page.waitForTimeout(200);
    r.check('the host is shown the code before the clock starts',
      (await page.textContent('#vsWaitCode')) === 'copper-otter-ordinary-quick', await page.textContent('#vsWaitCode'));
    r.check('and nothing is traded until they say go', await page.isHidden('#vsLive'));
    await page.click('#vsStartBtn');
    await page.waitForTimeout(600);
    const hostStock = await page.textContent('#vsStockName');
    // Named, not blank: the heading and the lobby's name box once shared an
    // id, so the company's name went into an input nobody could see.
    r.check('the match names the company it is on', !!hostStock.trim(), `"${hostStock}"`);

    await page.click('#vsQuitBtn');
    await page.waitForTimeout(300);
    await page.fill('#vsJoinPass', 'copper-otter-ordinary-quick');
    await page.click('#vsJoinBtn');
    await page.waitForTimeout(600);
    r.check('the same code gives the same market', (await page.textContent('#vsStockName')) === hostStock,
      `${hostStock} vs ${await page.textContent('#vsStockName')}`);

    await page.click('#vsQuitBtn');
    await page.waitForTimeout(300);
    await page.fill('#vsJoinPass', 'Copper Otter Ordinary Quick');
    await page.click('#vsJoinBtn');
    await page.waitForTimeout(600);
    r.check('a code typed with spaces and capitals is the same market', (await page.textContent('#vsStockName')) === hostStock,
      `${hostStock} vs ${await page.textContent('#vsStockName')}`);

    await page.click('#vsQuitBtn');
    await page.waitForTimeout(300);
    await page.fill('#vsJoinPass', 'copper-otter/2/120');
    await page.click('#vsJoinBtn');
    await page.waitForTimeout(600);
    r.check('an old numbered code still works', (await page.textContent('#vsStockName')) === hostStock,
      `${hostStock} vs ${await page.textContent('#vsStockName')}`);
    await page.click('#vsQuitBtn');
    await page.waitForTimeout(300);

    // On the usual settings the password is the whole code.
    await page.fill('#vsHostPass', 'quiet-walnut');
    await page.click('#vsRiskSeg button[data-risk="3"]');
    await page.click('#vsLenSeg button[data-ticks="300"]');
    await page.click('#vsHostBtn');
    await page.waitForTimeout(200);
    r.check('on the usual settings the code is just the password',
      (await page.textContent('#vsWaitCode')) === 'quiet-walnut', await page.textContent('#vsWaitCode'));
    await page.click('#vsStartBtn');
    await page.waitForTimeout(600);
    const plainStock = await page.textContent('#vsStockName');
    await page.click('#vsQuitBtn');
    await page.waitForTimeout(300);
    await page.fill('#vsJoinPass', 'quiet walnut');
    await page.click('#vsJoinBtn');
    await page.waitForTimeout(600);
    r.check('and the password alone joins the same market', (await page.textContent('#vsStockName')) === plainStock,
      `${plainStock} vs ${await page.textContent('#vsStockName')}`);
    await page.click('#vsQuitBtn');
    await page.waitForTimeout(300);

    // A password that ends in a setting's word is spelled out in full, so it
    // cannot be misread as a shorter password on other settings.
    await page.fill('#vsHostPass', 'so-long');
    await page.click('#vsHostBtn');
    await page.waitForTimeout(200);
    r.check('a password ending in a setting word gets both words spelled out',
      (await page.textContent('#vsWaitCode')) === 'so-long-lively-standard', await page.textContent('#vsWaitCode'));
    await page.click('#vsCancelBtn');
    await page.close();
  }

  // ---- playing it with a controller ----
  //
  // A real pad cannot be plugged into a headless browser, so navigator's pad
  // list is replaced with one the test holds the buttons of, and the module is
  // stepped a frame at a time. That keeps this deterministic: no waiting on an
  // animation frame to see whether a press landed.
  {
    const page = await openGame(browser, { screen: 'home', watch: r.fail });
    await page.waitForTimeout(400);

    const plugIn = () => page.evaluate(() => {
      window.__pad = { buttons: Array.from({ length: 17 }, () => ({ pressed: false })), axes: [0, 0] };
      window.simstockPad.source = () => [window.__pad];
    });
    // A press and a release, one frame apart.
    const tap = code => page.evaluate(c => {
      const t = performance.now();
      window.__pad.buttons[c].pressed = true;
      window.simstockPad.poll(t);
      window.__pad.buttons[c].pressed = false;
      window.simstockPad.poll(t + 1);
    }, code);
    const focused = () => page.evaluate(() => {
      const el = document.activeElement;
      return el ? `${el.tagName.toLowerCase()}:${el.dataset.screen || el.id || (el.textContent || '').trim().slice(0, 18)}` : null;
    });
    const UP = 12, DOWN = 13, LEFT = 14, RIGHT = 15, A = 0, B = 1, LB = 4, RB = 5, START = 9;

    await plugIn();

    r.check('the focus ring is off until a pad is actually used',
      !(await page.evaluate(() => document.body.classList.contains('using-pad'))));

    await tap(DOWN);
    r.check('using the pad turns the focus ring on',
      await page.evaluate(() => document.body.classList.contains('using-pad')));
    r.check('and something is focused to start from', (await focused()) !== 'body:');

    const before = await focused();
    await tap(RIGHT);
    r.check('a push moves the focus somewhere else', (await focused()) !== before,
      `${before} -> ${await focused()}`);

    // Left after right should come back: navigation that is not reversible is
    // navigation a player gets lost in.
    await tap(LEFT);
    r.check('and pushing back returns to where it came from', (await focused()) === before,
      `${before} -> ${await focused()}`);

    const modalOpen = () => page.evaluate(() => !!document.getElementById('modalRoot').firstElementChild);
    const screenNow = () => page.evaluate(() => {
      const on = document.querySelector('.task-switch [aria-current]');
      return on ? on.dataset.screen : null;
    });

    // Pushes until the named thing is under the focus, the way a player would,
    // rather than reaching in and focusing it. Returns false if it could not
    // be got to, which is the answer that matters.
    const padTo = async (sel, tries = 16) => {
      for (let i = 0; i < tries; i++) {
        if (await page.evaluate(s => document.activeElement === document.querySelector(s), sel)) return true;
        await tap(i % 2 ? DOWN : RIGHT);
      }
      return page.evaluate(s => document.activeElement === document.querySelector(s), sel);
    };

    // The first thing the game asks of a player is to open an account, and
    // that runs the whole opening tutorial: several modal steps, each wanting
    // a button pressed. If a pad cannot get through this, it cannot start the
    // game at all — so this is the test that decides whether any of the rest
    // matters.
    await page.evaluate(() => document.getElementById('openAccountBtn').focus());
    await tap(A);
    await page.waitForTimeout(250);
    r.check('pressing A on the front page opens the tutorial', await modalOpen());

    let steps = 0;
    while ((await modalOpen()) && steps < 12) {
      if (!(await padTo('#modalRoot [data-act="next"]'))) break;
      await tap(A);
      await page.waitForTimeout(180);
      steps++;
    }
    // Finishing it opens the account and drops the player on the trading
    // floor, which was locked a moment ago. That is the proof it worked.
    r.check('the opening tutorial can be worked through with the pad alone',
      await page.evaluate(() => !document.getElementById('tradeScreen').hidden),
      `gave up after ${steps} steps, modal ${await modalOpen() ? 'still open' : 'closed'}`);
    r.check('and that unlocks the trading floor', (await screenNow()) === 'trade',
      `on ${await screenNow()}`);

    // The shoulders are what make every screen reachable without a spatial
    // route to each one.
    const first = await screenNow();
    await tap(RB);
    const second = await screenNow();
    r.check('a shoulder button changes screen', first !== second, `${first} -> ${second}`);
    await tap(LB);
    r.check('and the other one comes back', (await screenNow()) === first, `now ${await screenNow()}`);

    // Every tab, by shoulder alone, with no mouse anywhere.
    //
    // On a new game most of the floor is still locked, and asking for a locked
    // screen is answered with the game's own "not yet" modal rather than a
    // screen change. That is the real thing a player meets, so it is what is
    // tested: every tab either opens or says why, and B always gets back out.
    const tabs = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.task-switch [data-screen]'))
        .filter(b => b.getBoundingClientRect().width > 0).map(b => b.dataset.screen));
    const reached = new Set();
    let refused = 0;
    let stuck = false;
    for (let i = 0; i < tabs.length; i++) {
      await tap(RB);
      if (await modalOpen()) {
        refused++;
        await tap(B);                       // the pad has to be able to get out
        await page.waitForTimeout(80);
        if (await modalOpen()) { stuck = true; break; }
      } else {
        reached.add(await screenNow());
      }
    }
    r.check('the shoulders answer for every tab, opening it or saying why not',
      reached.size + refused === tabs.length,
      `${reached.size} opened + ${refused} refused, of ${tabs.length}`);
    r.check('and a refusal never traps the pad behind a modal', !stuck);
    r.check('the shoulders open more than one screen', reached.size > 1,
      `only ${[...reached].join(', ')}`);

    // Start says the same thing the space bar says, so there is one pause.
    const paused = () => page.evaluate(() => document.getElementById('clockText').classList.contains('paused'));
    const wasPaused = await paused();
    await tap(START);
    r.check('start stops and starts the market', (await paused()) !== wasPaused);
    await tap(START);

    // A is the click. Focus a tab and press it.
    await page.evaluate(() => {
      document.querySelector('.task-switch [data-screen="portfolio"]').focus();
    });
    await tap(A);
    r.check('A presses the button under the focus', (await screenNow()) === 'portfolio',
      `on ${await screenNow()}`);

    // B is back, and out of a modal first.
    await page.evaluate(() => document.querySelector('.task-switch [data-screen="home"]').click());
    await page.waitForTimeout(200);
    await page.evaluate(() => document.getElementById('settingsBtn').click());
    await page.waitForTimeout(250);
    const open = await modalOpen();
    await tap(B);
    await page.waitForTimeout(250);
    r.check('B closes an open modal', open && !(await modalOpen()),
      `open=${open} stillOpen=${await modalOpen()}`);

    await page.evaluate(() => document.querySelector('.task-switch [data-screen="upgrades"]').click());
    await tap(B);
    r.check('B with nothing open goes back to the front page', (await screenNow()) === 'home',
      `on ${await screenNow()}`);

    // The stick should feel like the d-pad rather than like a second thing.
    await page.evaluate(() => {
      document.querySelector('.task-switch [data-screen="home"]').focus();
      const t = performance.now();
      window.__pad.axes = [0.9, 0];
      window.simstockPad.poll(t);
      window.__pad.axes = [0, 0];
      window.simstockPad.poll(t + 1);
    });
    r.check('the stick moves focus the way the d-pad does',
      (await focused()) !== 'button:home', `on ${await focused()}`);

    // Holding a direction should repeat, or a long row is a long press. The
    // nav is used because it is a row with somewhere to keep going; a column
    // that runs out after two stops would prove nothing either way.
    const repeats = await page.evaluate(() => {
      document.querySelector('.task-switch [data-screen="home"]').focus();
      const seen = new Set([document.activeElement]);
      let t = performance.now();
      window.__pad.buttons[15].pressed = true;      // right, and held
      for (let i = 0; i < 10; i++) {
        window.simstockPad.poll(t);
        seen.add(document.activeElement);
        t += 200;          // past the first delay, then past each repeat
      }
      window.__pad.buttons[15].pressed = false;
      window.simstockPad.poll(t + 1);
      return seen.size;
    });
    r.check('holding a direction keeps moving', repeats > 3, `${repeats} different elements`);

    // And one press is one move, however long the frame took.
    const single = await page.evaluate(() => {
      document.querySelector('.task-switch [data-screen="home"]').focus();
      const t = performance.now();
      window.__pad.buttons[15].pressed = true;
      window.simstockPad.poll(t);
      const after = document.activeElement;
      window.simstockPad.poll(t + 50);              // still held, not yet repeating
      const same = document.activeElement === after;
      window.__pad.buttons[15].pressed = false;
      window.simstockPad.poll(t + 51);
      return same;
    });
    r.check('but a press that is only held briefly moves once', single);

    // A number field has −, + and Max beside it, so A should not try to type.
    await page.evaluate(() => document.querySelector('.task-switch [data-screen="trade"]').click());
    await page.waitForTimeout(300);
    const numberSafe = await page.evaluate(() => {
      const input = document.getElementById('qtyInput');
      if (!input) return true;
      input.focus();
      return window.simstockPad.press(0) === false;
    });
    r.check('A does not try to type into a number field', numberSafe);

    // Reaching things by pushing is the whole point. Flood-fill the trading
    // floor from the first stop and see what a player could never get to.
    const stranded = await page.evaluate(() => {
      const all = window.simstockPad.stops();
      if (!all.length) return { total: 0, missed: [] };
      const seen = new Set([all[0]]);
      const queue = [all[0]];
      while (queue.length) {
        const from = queue.shift();
        for (const dir of ['up', 'down', 'left', 'right']) {
          const next = window.simstockPad.pick(from, all, dir);
          if (next && !seen.has(next)) { seen.add(next); queue.push(next); }
        }
      }
      return {
        total: all.length,
        missed: all.filter(el => !seen.has(el))
          .map(el => el.id || (el.textContent || '').trim().slice(0, 20) || el.tagName),
      };
    });
    r.check('everything on the trading floor can be pushed to',
      stranded.total > 0 && stranded.missed.length === 0,
      `${stranded.missed.length} of ${stranded.total} stranded: ${stranded.missed.slice(0, 8).join(' | ')}`);

    // ---- the bar that says what the buttons do ----
    //
    // Deck Verified wants the game to say which button does what, and a bar
    // that offers a button doing nothing is worse than no bar.
    const hintBar = () => page.evaluate(() => {
      const el = document.getElementById('padHints');
      if (!el) return null;
      return Array.from(el.querySelectorAll('.pad-hint')).map(h => ({
        glyphs: Array.from(h.querySelectorAll('.pad-glyph')).map(g => g.textContent),
        label: h.querySelector('span').textContent,
      }));
    });
    const labelled = list => (list || []).map(h => `${h.glyphs.join('/')}:${h.label}`).join(' ');

    await page.evaluate(() => document.querySelector('.task-switch [data-screen="home"]').click());
    await tap(DOWN);
    await page.waitForTimeout(150);
    const onScreen = await hintBar();
    r.check('the hints say what the buttons do', (onScreen || []).length > 0, labelled(onScreen));
    r.check('A is offered for pressing things', labelled(onScreen).includes('A:Select'), labelled(onScreen));
    r.check('and the shoulders are offered for screens',
      labelled(onScreen).includes('LB/RB:Screens'), labelled(onScreen));
    r.check('the hints are hidden from a screen reader, which already reads the buttons',
      await page.evaluate(() => document.getElementById('padHints').getAttribute('aria-hidden') === 'true'));

    // Inside a modal the shoulders do nothing, so they are not offered.
    await page.evaluate(() => document.getElementById('settingsBtn').click());
    await page.waitForTimeout(250);
    await page.evaluate(() => window.simstockPad.poll(performance.now()));
    const inModal = await hintBar();
    r.check('in a modal the hints change to match', labelled(inModal).includes('B:Close'), labelled(inModal));
    r.check('and stop offering the shoulders, which a modal ignores',
      !labelled(inModal).includes('Screens'), labelled(inModal));

    // The shoulders really are ignored: they used to change the screen behind
    // an open modal, so it closed onto a room nobody asked for.
    const behind = await screenNow();
    await tap(RB);
    await page.waitForTimeout(150);
    r.check('and a shoulder press cannot move the screen behind a modal',
      (await screenNow()) === behind && (await modalOpen()), `${behind} -> ${await screenNow()}`);
    await tap(B);
    await page.waitForTimeout(200);

    // Nothing to press means nothing offered.
    await page.evaluate(() => document.querySelector('.task-switch [data-screen="trade"]').click());
    await page.waitForTimeout(400);
    const onTheField = await page.evaluate(() => {
      const input = document.getElementById('qtyInput');
      input.focus();
      window.simstockPad.poll(performance.now());
      return document.activeElement === input;
    });
    const onNumber = await hintBar();
    r.check('a number field, which A leaves alone, is not offered an A',
      onTheField && !labelled(onNumber).includes('A:'),
      onTheField ? labelled(onNumber) : 'the field never took focus, so this proved nothing');

    // A mouse is still a mouse.
    await page.mouse.move(400, 400);
    await page.waitForTimeout(100);
    r.check('a mouse puts the focus ring away again',
      !(await page.evaluate(() => document.body.classList.contains('using-pad'))));

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

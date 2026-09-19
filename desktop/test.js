// Tests for the desktop shell. Launches the real app through Electron and
// checks the things the shell is there to do: a save in a real file, the
// bridge on the window, fonts from the bundle, and nothing of Node reachable
// from the page.
//
//   npm test                  (needs a display; on a headless box: xvfb-run -a npm test)
'use strict';

const { _electron: electron } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');

const passed = [];
const failed = [];
const check = (name, cond, detail = '') => (cond ? passed : failed).push(name + (cond ? '' : `  <-- ${detail}`));

const launch = userData => electron.launch({
  args: [__dirname, `--user-data-dir=${userData}`, '--no-sandbox'],
  env: { ...process.env, SIMSTOCK_SERVER: 'ws://127.0.0.1:8090' },
});

(async () => {
  if (!fs.existsSync(path.join(__dirname, 'app', 'index.html'))) {
    throw new Error('desktop/app is missing — run `npm run sync` first');
  }
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'simstock-test-'));

  const app = await launch(userData);
  const win = await app.firstWindow();
  win.on('pageerror', e => failed.push(`PAGEERROR: ${e.message}`));
  await win.waitForLoadState('domcontentloaded');
  await win.waitForTimeout(1500);

  const chrome = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    return { title: w.getTitle(), bg: w.getBackgroundColor(), min: w.getMinimumSize(), autoHide: w.isMenuBarAutoHide() };
  });
  check('the window is titled for a game, not for a search engine', chrome.title === 'SimStock', chrome.title);
  check('the window starts on the game’s own background', chrome.bg.toLowerCase() === '#0d0c0a', chrome.bg);
  check('the window has a sensible minimum size', chrome.min[0] === 900 && chrome.min[1] === 640, chrome.min.join('x'));
  check('there is no menu bar in the way', chrome.autoHide);

  const bridge = await win.evaluate(() => (window.simstock ? { desktop: window.simstock.desktop, version: window.simstock.version, server: window.simstock.defaultServer } : null));
  check('the bridge is on the window', bridge && bridge.desktop === true, JSON.stringify(bridge));
  check('the bridge carries the app version', bridge && /^\d+\.\d+\.\d+$/.test(bridge.version), bridge && bridge.version);
  check('the default match server reaches the game', bridge && bridge.server === 'ws://127.0.0.1:8090', bridge && bridge.server);
  check('no Node is reachable from the page', await win.evaluate(() => typeof require === 'undefined' && typeof process === 'undefined'));

  // Faces load lazily as glyphs are needed, so a count would be flaky. What
  // matters is that each family resolved, from the bundle rather than a CDN.
  const families = await win.evaluate(async () => {
    await document.fonts.ready;
    return [...new Set([...document.fonts].filter(f => f.status === 'loaded').map(f => f.family))];
  });
  check('every font family loads from the bundle',
    ['IBM Plex Mono', 'IBM Plex Sans', 'Newsreader'].every(f => families.includes(f)), JSON.stringify(families));

  // Play for long enough that the game saves (it writes every five ticks).
  await win.click('.landing-buttons [data-screen="home"]');
  await win.waitForTimeout(7000);

  const saveFile = path.join(userData, 'simstock-save.json');
  check('the save goes to a real file, which is what Steam Cloud can sync', fs.existsSync(saveFile), saveFile);
  let day = null;
  if (fs.existsSync(saveFile)) {
    const saved = JSON.parse(fs.readFileSync(saveFile, 'utf8'));
    day = saved.day;
    check('the file holds a real save', typeof saved.day === 'number' && typeof saved.cash === 'number');
    check('nothing was left in localStorage instead', (await win.evaluate(() => localStorage.getItem('simstock.save.v2'))) === null);
    check('no half-written temp file is left behind', !fs.existsSync(`${saveFile}.tmp`));
  }

  await win.click('.task-switch [data-screen="versus"]');
  await win.waitForTimeout(400);
  check('the versus lobby is prefilled with the server', (await win.inputValue('#vsServerUrl')) === 'ws://127.0.0.1:8090', await win.inputValue('#vsServerUrl'));

  await app.close();

  // A relaunch has to find the save again.
  const again = await launch(userData);
  const win2 = await again.firstWindow();
  await win2.waitForLoadState('domcontentloaded');
  await win2.waitForTimeout(1200);
  const after = await win2.evaluate(() => JSON.parse(window.simstock.readSave()).day);
  check('a relaunch picks the save back up', after !== null && after >= day, `${day} -> ${after}`);
  await again.close();

  fs.rmSync(userData, { recursive: true, force: true });

  console.log(`\n${passed.length} passed`);
  passed.forEach(n => console.log('  ✓', n));
  if (failed.length) {
    console.log(`\n${failed.length} FAILED`);
    failed.forEach(n => console.log('  ✗', n));
    process.exit(1);
  }
})().catch(e => { console.error(e); process.exit(1); });

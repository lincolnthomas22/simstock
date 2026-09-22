// Tests for the desktop shell. Launches the real app through Electron and
// checks the things the shell is there to do: a save in a real file, the
// bridge on the window, fonts from the bundle, and nothing of Node reachable
// from the page.
//
//   npm test                  (needs a display; on a headless box: xvfb-run -a npm test)
'use strict';

const { _electron: electron } = require('playwright');
const sandbox = require('./sandbox.js');
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

// ---------------------------------------------------------------
// The sandbox decision
// A Steam Deck is described here rather than borrowed: every file the decision
// reads is injected, so the container that breaks the game is a few lines.
// ---------------------------------------------------------------
const nothing = { read: () => null, stat: () => null };
const present = map => ({
  read: f => (f in map ? map[f] : null),
  stat: f => (f in map ? map[f] : null),
});
const NS_MAX = '/proc/sys/user/max_user_namespaces';
const NS_CLONE = '/proc/sys/kernel/unprivileged_userns_clone';
const HELPER = '/game/chrome-sandbox';
const setuidRoot = { uid: 0, mode: 0o104755 };
const stripped = { uid: 0, mode: 0o100755 };     // root's, but the setuid bit is gone
const ordinary = { uid: 1000, mode: 0o100755 };
const onLinux = extra => ({ platform: 'linux', argv: [], env: {}, uid: 1000, execPath: '/game/SimStock', ...extra });

function sandboxTests() {
  const roomy = sandbox.decide(onLinux(present({ [NS_MAX]: '15000\n' })));
  check('a kernel that hands out user namespaces keeps the sandbox', roomy.sandbox, roomy.reason);

  // The Deck: Steam's container caps namespaces and strips the setuid bit, and
  // until now that was a game that exited before it drew a window.
  const deck = sandbox.decide(onLinux(present({ [NS_MAX]: '0\n', [HELPER]: stripped })));
  check('a Steam Deck container starts the game instead of failing to', !deck.sandbox, deck.reason);
  check('and the log says which half of the sandbox was missing',
    /capped at zero/.test(deck.reason) && /not setuid/.test(deck.reason), deck.reason);

  // Same container, a helper that is set up properly: no reason to give up.
  const helper = sandbox.decide(onLinux(present({ [NS_MAX]: '0\n', [HELPER]: setuidRoot })));
  check('a working setuid helper is enough on its own', helper.sandbox, helper.reason);

  const rootless = sandbox.decide(onLinux(present({ [NS_MAX]: '0\n', [HELPER]: { uid: 1000, mode: 0o104755 } })));
  check('a setuid helper root does not own is not trusted', !rootless.sandbox, rootless.reason);

  // Chromium treats a sandbox under root as fatal, so this one is not a
  // preference — it is the difference between a window and an exit code.
  const asRoot = sandbox.decide(onLinux({ ...present({ [NS_MAX]: '15000\n' }), uid: 0 }));
  check('running as root stands the sandbox down rather than dying', !asRoot.sandbox, asRoot.reason);

  const older = sandbox.decide(onLinux(present({ [NS_CLONE]: '1' })));
  check('an older kernel’s own namespace switch is read too', older.sandbox, older.reason);

  const off = sandbox.decide(onLinux(present({ [NS_CLONE]: '0', [NS_MAX]: '15000\n', [HELPER]: ordinary })));
  check('namespaces switched off outrank a generous cap', !off.sandbox, off.reason);

  // "Cannot tell" is the dangerous answer, and it is answered in the player's
  // favour: a sandbox we gave up on beats a game that will not open.
  const blind = sandbox.decide(onLinux(nothing));
  check('a machine that tells us nothing still starts the game', !blind.sandbox, blind.reason);

  const win = sandbox.decide({ platform: 'win32', argv: [], env: {}, ...nothing });
  const mac = sandbox.decide({ platform: 'darwin', argv: [], env: {}, ...nothing });
  check('Windows and macOS are left sandboxed', win.sandbox && mac.sandbox, `${win.reason} / ${mac.reason}`);

  const asked = sandbox.decide(onLinux({ ...present({ [NS_MAX]: '15000\n' }), argv: ['--no-sandbox'] }));
  check('a launch option still wins', !asked.sandbox, asked.reason);
}

// The decision is only worth anything if it reaches a built game, and the way
// it gets there is easy to break silently: sandbox.js has to stay inside the
// archive for main.js AND exist as a real file for the launcher to run, which
// is what asarUnpack is for. extraFiles instead of asarUnpack ships a build
// that crashes on start, and nothing else here would notice.
function packagingTests() {
  const build = require('./package.json').build;
  const unpack = build.linux.asarUnpack || [];
  check('the probe is unpacked beside the binary for the launcher', unpack.includes('sandbox.js'), JSON.stringify(unpack));
  check('and is still bundled for the app itself to require', build.files.includes('sandbox.js'), JSON.stringify(build.files));

  // It has to land at the root of the build, not in a build/ subdirectory, or
  // the launcher will not find the binary it is meant to be standing beside.
  const extra = build.linux.extraFiles || [];
  const shipped = extra.some(e => e && e.to === 'launch-linux.sh');
  check('the Linux launcher is shipped beside the binary', shipped, JSON.stringify(extra));

  const launcher = path.join(__dirname, 'build', 'launch-linux.sh');
  check('the launcher exists', fs.existsSync(launcher), launcher);
  if (fs.existsSync(launcher)) {
    check('the launcher is executable, because Steam runs it as one',
      !!(fs.statSync(launcher).mode & 0o111), (fs.statSync(launcher).mode & 0o777).toString(8));
    const text = fs.readFileSync(launcher, 'utf8');
    check('the launcher looks for the probe where asarUnpack puts it',
      text.includes('resources/app.asar.unpacked/sandbox.js'));
    check('the launcher hands the game its own arguments', text.includes('"$@"'));
  }
}

(async () => {
  sandboxTests();
  packagingTests();

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

  // Faces load lazily, when a glyph on screen needs one, so counting what
  // happens to have loaded is a coin toss. Asking for each family outright is
  // deterministic, and tests what matters: the face resolves from the bundle.
  const fonts = await win.evaluate(async () => {
    const out = {};
    for (const family of ['IBM Plex Mono', 'IBM Plex Sans', 'Newsreader']) {
      out[family] = (await document.fonts.load(`16px "${family}"`)).length;
    }
    return out;
  });
  check('every font family resolves from the bundle', Object.values(fonts).every(n => n > 0), JSON.stringify(fonts));

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

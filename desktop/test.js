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

  // Every module main.js requires has to be in the build, or the packaged
  // game throws before it draws anything. This is easy to forget when adding
  // one, and nothing else here would catch it.
  const required = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8')
    .match(/require\('\.\/([\w-]+\.js)'\)/g).map(m => m.replace(/.*\.\/|'\)/g, ''));
  const missing = required.filter(f => !build.files.includes(f));
  check('every module the shell requires is in the packaged build',
    missing.length === 0, `missing: ${missing.join(', ')}`);

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

// ---------------------------------------------------------------
// Two machines, one save
// All of this is plain files, so it runs without Electron: a second machine
// is a second temporary directory and a copy between them.
// ---------------------------------------------------------------
const save = require('./save.js');

const game = (day, worth, level = 1) => JSON.stringify({
  version: 3, day, cash: worth, level,
  worth: { history: [worth] },
  lastSeen: Date.UTC(2026, 0, 1) + day * 1000,
});

function saveTests() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'simstock-save-'));
  const files = () => fs.readdirSync(dir);
  const backups = () => files().filter(n => n.endsWith('.bak'));

  // Ordinary play: one machine, saving over itself, never asked anything.
  save.write(dir, game(100, 5000));
  check('a save is written where Steam Cloud can find it',
    files().includes('simstock-save.json'), files().join(', '));
  check('with a mirror beside it that Cloud is told to leave alone',
    files().includes('simstock-local.mirror'), files().join(', '));
  check('no half-written temp files are left behind',
    !files().some(n => n.endsWith('.tmp')), files().join(', '));
  save.write(dir, game(200, 9000));
  check('saving over your own game is never a conflict', save.inspect(dir) === null);

  // The Deck played too. Steam brings its save back over the top of this one,
  // which is exactly what a cloud sync does: the file changes underneath.
  fs.writeFileSync(path.join(dir, 'simstock-save.json'), game(60, 2500, 2));
  const clash = save.inspect(dir);
  check('a save this machine did not write is noticed', !!clash && clash.kind === 'replaced',
    clash ? clash.kind : 'nothing noticed');
  check('and both sides are described in the game’s own terms',
    !!clash && clash.incoming.netWorth === 2500 && clash.mine.netWorth === 9000,
    clash ? `${clash.incoming.netWorth} vs ${clash.mine.netWorth}` : '');
  check('including which year each run had reached',
    !!clash && clash.incoming.year === 1 && clash.mine.year === 1 && clash.mine.day === 201,
    clash ? `day ${clash.mine.day}` : '');
  check('the renderer is handed summaries and no save data',
    !JSON.stringify(save.forDisplay(clash)).includes('worth'),
    JSON.stringify(save.forDisplay(clash)).slice(0, 80));

  // The at-risk copy goes to disk before the player is even asked, because the
  // game carries on autosaving behind the prompt.
  save.preserve(dir, clash);
  check('this machine’s copy is kept before anyone is asked', backups().length === 1, files().join(', '));

  // And now the game does exactly that: saves over both the file and the
  // mirror while the prompt is still open. The choice has to survive it.
  save.write(dir, game(61, 2600, 2));
  const out = save.resolve(dir, 'mine', clash);
  check('choosing this machine’s save works even after an autosave landed',
    out.ok && out.reload, JSON.stringify(out));
  const restored = save.summarise(save.read(dir));
  check('and the game that comes back is the right one',
    restored.netWorth === 9000, `${restored.netWorth}`);
  check('the save that was passed over is kept too', backups().length === 2, files().join(', '));
  check('settling it leaves nothing to ask about next time', save.inspect(dir) === null);

  // Keeping the arriving save needs no write at all — the game is already
  // playing it — but the other one still has to be on disk.
  save.write(dir, game(300, 12000));
  fs.writeFileSync(path.join(dir, 'simstock-save.json'), game(80, 3000));
  const second = save.inspect(dir);
  save.preserve(dir, second);
  const kept = save.resolve(dir, 'incoming', second);
  check('keeping the cloud save asks the game for nothing', kept.ok && !kept.reload, JSON.stringify(kept));
  // preserve() already kept this machine's side, so accepting the arriving
  // save adds no second copy of the same thing.
  check('and the one given up is still on disk', backups().length === 3, backups().join(', '));

  // Two backups in the same millisecond must not land on the same name.
  const before = backups().length;
  save.backup(dir, game(1, 1));
  save.backup(dir, game(2, 2));
  check('two backups at the same instant do not overwrite each other',
    backups().length === before + 2, `${before} -> ${backups().length}`);

  // A save that disappears is not the same as a save that changed.
  fs.unlinkSync(path.join(dir, 'simstock-save.json'));
  const gone = save.inspect(dir);
  check('a save that has vanished is noticed separately',
    !!gone && gone.kind === 'vanished' && gone.incoming === null, gone ? gone.kind : 'nothing noticed');
  check('and can still be put back', save.resolve(dir, 'mine', gone).ok && save.read(dir) !== null);

  // Backups must not pile up forever on a machine that syncs badly.
  for (let i = 0; i < 8; i++) save.backup(dir, game(i, i * 10));
  check('old conflict backups are pruned rather than piling up',
    backups().length <= 5, `${backups().length} kept`);

  // A machine that has never saved here is not in conflict with anything: a
  // fresh install picking up a synced game must not be interrogated.
  const fresh = fs.mkdtempSync(path.join(os.tmpdir(), 'simstock-fresh-'));
  fs.writeFileSync(path.join(fresh, 'simstock-save.json'), game(500, 40000));
  check('a fresh machine picking up a synced save is not asked anything',
    save.inspect(fresh) === null);

  // Nothing here may throw on a save that is not a save.
  const junk = fs.mkdtempSync(path.join(os.tmpdir(), 'simstock-junk-'));
  save.write(junk, game(10, 100));
  fs.writeFileSync(path.join(junk, 'simstock-save.json'), 'this is not json');
  const broken = save.inspect(junk);
  check('an unreadable save still offers the readable one',
    !!broken && broken.incoming === null && broken.mine.netWorth === 100,
    JSON.stringify(broken && broken.incoming));
  check('and summarising rubbish returns nothing rather than throwing',
    save.summarise('{{{') === null && save.summarise('null') === null);

  [dir, fresh, junk].forEach(d => fs.rmSync(d, { recursive: true, force: true }));
}

(async () => {
  sandboxTests();
  packagingTests();
  saveTests();

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

  // ---- a save that came back from the cloud ----
  //
  // Driven through the real app because the interesting failure is not in the
  // file handling at all: reloading onto the restored save fires pagehide, and
  // the game that is being replaced will happily save itself over its own
  // replacement on the way out. Only a real reload shows that.
  {
    const here = save.read(userData);
    const elsewhere = JSON.parse(here);
    elsewhere.day += 400;                       // the other machine played on
    elsewhere.cash = 50000;
    elsewhere.worth.history = elsewhere.worth.history.concat([50000]);
    fs.writeFileSync(path.join(userData, 'simstock-save.json'), JSON.stringify(elsewhere));

    const third = await launch(userData);
    const win3 = await third.firstWindow();
    await win3.waitForLoadState('domcontentloaded');
    await win3.waitForTimeout(2500);

    const asked = await win3.evaluate(() => {
      const h = document.querySelector('#modalRoot .modal h3');
      return h ? h.textContent : null;
    });
    check('a save the cloud brought back is noticed and asked about',
      asked === 'Two saves, one game', String(asked));

    const shown = await win3.evaluate(() =>
      Array.from(document.querySelectorAll('.save-choice-worth')).map(e => e.textContent));
    check('both runs are shown in money, not in timestamps',
      shown.length === 2 && shown[0].includes('50,000') && shown[1].includes('1,000'), shown.join(' / '));

    await win3.click('[data-act="mine"]');
    await win3.waitForTimeout(3000);
    const kept = save.summarise(save.read(userData));
    check('taking this machine’s game really leaves it in place afterwards',
      kept && kept.netWorth < 50000, kept ? `net worth ${kept.netWorth}` : 'no save');
    check('the game that was passed over is kept as a backup',
      fs.readdirSync(userData).some(n => n.endsWith('.bak')), fs.readdirSync(userData).join(', '));
    check('and the same question is not asked twice',
      await win3.evaluate(() => !document.querySelector('#modalRoot .modal')));
    await third.close();
  }

  fs.rmSync(userData, { recursive: true, force: true });

  console.log(`\n${passed.length} passed`);
  passed.forEach(n => console.log('  ✓', n));
  if (failed.length) {
    console.log(`\n${failed.length} FAILED`);
    failed.forEach(n => console.log('  ✗', n));
    process.exit(1);
  }
})().catch(e => { console.error(e); process.exit(1); });

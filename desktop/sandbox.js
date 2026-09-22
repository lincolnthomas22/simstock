// Whether Chromium's sandbox can actually work here.
//
// This exists for the Steam Deck. Linux Electron builds ship a `chrome-sandbox`
// helper that has to be owned by root with the setuid bit set, and Steam runs
// games inside a `pressure-vessel` container where it usually is not. Chromium
// finds the helper, refuses to trust it, and exits before a window is ever
// shown — the player double-clicks Play and nothing happens.
//
// The switch that avoids this has to be on the process from the outside.
// Chromium builds its zygote before the JS in main.js ever runs, so
// `app.commandLine.appendSwitch('no-sandbox')` there is measurably too late —
// the game still aborts. That is why the decision lives here and is applied by
// `build/launch-linux.sh`, which probes, then execs the real binary with or
// without the switch.
//
// A blanket `--no-sandbox` launch option in Steamworks would also work, and is
// what most games do. This is the same thing without the blanket: the sandbox
// is stood down only where it demonstrably cannot run.
//
// Chromium has two ways to sandbox on Linux. It prefers unprivileged user
// namespaces, and falls back to the setuid helper when the kernel will not give
// it those. So the sandbox only fails when BOTH are unavailable, and that is
// the one case where we disable it.
//
// Where the evidence runs out, this errs towards the game starting. A sandbox
// we gave up on costs a layer of defence around a page that loads no remote
// code; a sandbox we insisted on costs the player the game.
'use strict';

const fs = require('fs');
const path = require('path');

const NS_MAX = '/proc/sys/user/max_user_namespaces';
const NS_CLONE = '/proc/sys/kernel/unprivileged_userns_clone';   // older Debian/Ubuntu

// Positive evidence only: a kernel that will hand out user namespaces says so
// in one of these two files. Anything else — unreadable, absent, unparseable —
// counts as "cannot confirm", which sends us on to the setuid helper.
function userNamespaces(read) {
  const clone = read(NS_CLONE);
  if (clone !== null && clone.trim() === '0') {
    return { ok: false, why: 'unprivileged user namespaces are switched off' };
  }
  const max = read(NS_MAX);
  if (max !== null) {
    const n = Number(max.trim());
    if (Number.isFinite(n)) {
      return n > 0
        ? { ok: true, why: `the kernel allows ${n} user namespaces` }
        : { ok: false, why: 'user namespaces are capped at zero' };
    }
  }
  if (clone !== null && clone.trim() === '1') {
    return { ok: true, why: 'unprivileged user namespaces are switched on' };
  }
  return { ok: false, why: 'user namespace support could not be read' };
}

// The helper sits next to the Electron binary. It is only any use if root owns
// it and it carries the setuid bit — the exact thing Steam's container strips.
function suidHelper(execPath, stat) {
  const file = path.join(path.dirname(execPath), 'chrome-sandbox');
  const st = stat(file);
  if (!st) return { ok: false, why: 'chrome-sandbox is not there' };
  if (st.uid !== 0) return { ok: false, why: 'chrome-sandbox is not owned by root' };
  if (!(st.mode & 0o4000)) return { ok: false, why: 'chrome-sandbox is not setuid' };
  return { ok: true, why: 'the setuid sandbox helper is set up correctly' };
}

// { sandbox: boolean, reason: string }. Everything it looks at is injectable so
// the tests can describe a Deck without being one.
function decide(opts = {}) {
  const platform = opts.platform || process.platform;
  const argv = opts.argv || process.argv;
  const env = opts.env || process.env;
  const execPath = opts.execPath || process.execPath;
  const read = opts.read || (f => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } });
  const stat = opts.stat || (f => { try { return fs.statSync(f); } catch { return null; } });

  // Somebody who has already made the call — a launch option, a dev run, the
  // test suite — is not second-guessed.
  if (argv.includes('--no-sandbox')) {
    return { sandbox: false, reason: '--no-sandbox was asked for on the command line' };
  }
  if (env.SIMSTOCK_NO_SANDBOX === '1') {
    return { sandbox: false, reason: 'SIMSTOCK_NO_SANDBOX is set' };
  }
  // Windows and macOS sandbox without a helper binary or a kernel setting.
  if (platform !== 'linux') {
    return { sandbox: true, reason: `${platform} needs no help to sandbox` };
  }

  // Chromium refuses outright to run as root with a sandbox — not a warning, a
  // fatal exit before any window. Rare for a player, normal in a container.
  const uid = opts.uid !== undefined ? opts.uid : (process.getuid ? process.getuid() : -1);
  if (uid === 0) {
    return { sandbox: false, reason: 'Chromium will not sandbox while running as root' };
  }

  const ns = userNamespaces(read);
  if (ns.ok) return { sandbox: true, reason: ns.why };
  const suid = suidHelper(execPath, stat);
  if (suid.ok) return { sandbox: true, reason: suid.why };
  return { sandbox: false, reason: `${ns.why}, and ${suid.why}` };
}

// What the running game says about its own sandbox. It cannot change it from
// here — see the note at the top — so this only reports, and says so loudly
// when it finds itself sandboxed on a machine where that will not hold. That
// is the signature of a build started without the launcher.
function report(app) {
  const off = app.commandLine.hasSwitch('no-sandbox') || process.argv.includes('--no-sandbox');
  const { sandbox, reason } = decide();
  if (off) {
    console.log(`[sandbox] off — ${sandbox ? 'asked for on the command line' : reason}`);
  } else if (sandbox) {
    console.log(`[sandbox] on — ${reason}`);
  } else {
    console.log(`[sandbox] on, but this machine cannot hold it (${reason}) — started without the launcher?`);
  }
  return !off;
}

// Run as a program, this is the probe the launcher uses: exit 0 to keep the
// sandbox, 1 to stand it down, with the reason on stdout either way. Under
// ELECTRON_RUN_AS_NODE process.execPath is the game's own binary, so
// chrome-sandbox is looked for in the right place.
if (require.main === module) {
  // The launcher's own argv must not be mistaken for the game's.
  const { sandbox, reason } = decide({ argv: [] });
  console.log(reason);
  process.exit(sandbox ? 0 : 1);
}

module.exports = { decide, report, userNamespaces, suidHelper };

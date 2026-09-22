// The save file, and noticing when Steam Cloud has handed back a different one.
//
// Steam Auto-Cloud syncs one file. Play on a desktop, play on a Deck without
// the desktop having synced, and the next launch has two saves that both moved
// on from the same ancestor. Steam's own conflict dialog asks the player to
// choose between two timestamps, outside the game, with no idea which one holds
// the better run — and whichever they do not pick is gone.
//
// So this keeps a second copy that Steam never sees. After every successful
// save the same bytes are written to a mirror alongside, and their hash with
// them. On the next start the save on disk either hashes to what this machine
// last wrote, or it does not; if it does not, something replaced it, and both
// versions still exist to choose between.
//
// The save's own format is untouched — no marker, no version field, nothing
// added to what game.js writes. A save from an older build, or one exported
// from the browser, is still just the game's state, and the browser build
// knows nothing about any of this.
//
// IMPORTANT for Steamworks: point Auto-Cloud at `simstock-save.json` alone.
// The mirror and the conflict backups must stay local — syncing them would
// sync the very thing that is meant to survive a sync. They are deliberately
// not .json so that even a careless *.json pattern leaves them behind.
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SAVE = 'simstock-save.json';
const MIRROR = 'simstock-local.mirror';
const BACKUP_KEEP = 5;              // conflict backups to keep before pruning

const DAYS_PER_YEAR = 252;          // matches game.js
const DAYS_PER_QUARTER = 63;

const hash = text => crypto.createHash('sha256').update(text).digest('hex');

const savePath = dir => path.join(dir, SAVE);
const mirrorPath = dir => path.join(dir, MIRROR);

function readFile(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') console.error(`[save] could not read ${path.basename(file)}:`, err.message);
    return null;
  }
}

// Written to a neighbouring file and renamed over the real one, so a crash or
// a power cut halfway through leaves the previous save intact rather than a
// half-written one. A corrupted save is the one bug a player cannot forgive.
function writeAtomic(file, text) {
  const temp = `${file}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(temp, text, 'utf8');
    fs.renameSync(temp, file);
    return true;
  } catch (err) {
    console.error(`[save] could not write ${path.basename(file)}:`, err.message);
    try { fs.unlinkSync(temp); } catch { /* nothing to clean up */ }
    return false;
  }
}

const read = dir => readFile(savePath(dir));

// The mirror follows the save; it never leads. If it cannot be written the
// save has still happened, and the worst case is a conflict prompt that could
// have been avoided — not a lost game.
function write(dir, json) {
  if (typeof json !== 'string' || !json) return false;
  if (!writeAtomic(savePath(dir), json)) return false;
  writeAtomic(mirrorPath(dir), JSON.stringify({ hash: hash(json), at: Date.now(), json }));
  return true;
}

// ---------------------------------------------------------------
// Describing a save in the game's own terms
// A player choosing between two saves needs to know which run is which, and
// "modified 3 days ago" does not tell them. Year, money and level do.
// ---------------------------------------------------------------
function summarise(json, at) {
  let state;
  try { state = JSON.parse(json); } catch { return null; }
  if (!state || typeof state !== 'object') return null;

  const day = Math.max(0, Number(state.day) || 0);
  const history = state.worth && Array.isArray(state.worth.history) ? state.worth.history : [];
  const last = history.length ? Number(history[history.length - 1]) : null;
  const cash = Number(state.cash) || 0;

  return {
    year: Math.floor(day / DAYS_PER_YEAR) + 1,
    quarter: Math.min(Math.floor((day % DAYS_PER_YEAR) / DAYS_PER_QUARTER) + 1, 4),
    day: day + 1,
    netWorth: Number.isFinite(last) ? last : cash,
    cash,
    level: Number(state.level) || 1,
    // What the game itself recorded on its way out, which survives a copy
    // between machines in a way a file's mtime does not.
    savedAt: Number(state.lastSeen) || at || null,
  };
}

// ---------------------------------------------------------------
// Has something else been here
// ---------------------------------------------------------------

// { kind, incoming, mine } or null when there is nothing to ask about.
//
//   'replaced' — the save on disk is not the one this machine wrote
//   'vanished' — there is no save, but this machine has one mirrored
//
// A machine with no mirror has never saved here, so whatever is on disk is
// simply the save: a fresh install picking up a synced game is not a conflict.
// Both sides are carried on the returned object, because neither file can be
// trusted to still be there when the player answers: the game goes on playing
// behind the prompt, and its next autosave rewrites the save and the mirror
// together. Whatever is decided is decided from these copies.
function inspect(dir) {
  const current = read(dir);
  const raw = readFile(mirrorPath(dir));
  if (!raw) return null;

  let mirror;
  try { mirror = JSON.parse(raw); } catch { return null; }
  if (!mirror || typeof mirror.json !== 'string') return null;

  if (current === null) {
    return {
      kind: 'vanished',
      incoming: null,
      mine: summarise(mirror.json, mirror.at),
      mineJson: mirror.json,
      incomingJson: null,
    };
  }
  if (hash(current) === mirror.hash) return null;

  const incoming = summarise(current, null);
  const mine = summarise(mirror.json, mirror.at);
  // Two saves that cannot be read are not a choice worth offering; the game
  // will fall back to a fresh state on its own.
  if (!incoming && !mine) return null;
  return { kind: 'replaced', incoming, mine, mineJson: mirror.json, incomingJson: current };
}

// Called as soon as a conflict is found, before the game has drawn anything.
// The mirror is the copy at risk — the next autosave overwrites it — so it
// goes to a backup file now rather than at the moment it is chosen. A player
// who closes the game without answering still has it.
function preserve(dir, conflict) {
  if (!conflict || !conflict.mineJson) return null;
  return backup(dir, conflict.mineJson);
}

// What the renderer is allowed to see: two summaries, no save data.
const forDisplay = conflict => (conflict
  ? { kind: conflict.kind, incoming: conflict.incoming, mine: conflict.mine }
  : null);

// Keeps the losing side, named for when it was set aside. Nothing a player
// spent hours on is deleted because of a prompt they answered in a hurry.
function backup(dir, json) {
  if (!json) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  // Two backups in the same millisecond would otherwise land on the same name
  // and the first would be gone — which is the one thing this must not do.
  let file = path.join(dir, `simstock-conflict-${stamp}.bak`);
  for (let n = 2; fs.existsSync(file) && n < 100; n++) {
    file = path.join(dir, `simstock-conflict-${stamp}-${n}.bak`);
  }
  if (!writeAtomic(file, json)) return null;
  prune(dir);
  return file;
}

function prune(dir) {
  try {
    const old = fs.readdirSync(dir)
      .filter(n => n.startsWith('simstock-conflict-') && n.endsWith('.bak'))
      .sort();
    for (const name of old.slice(0, Math.max(0, old.length - BACKUP_KEEP))) {
      fs.unlinkSync(path.join(dir, name));
    }
  } catch (err) {
    console.error('[save] could not tidy old backups:', err.message);
  }
}

// 'mine' puts this machine's save back; 'incoming' accepts what arrived. Both
// work from the copies taken when the conflict was found, not from whatever is
// on disk now — by the time a player answers, the game has probably saved over
// it. Returns whether the game needs to start again: it is already running the
// incoming save, so only 'mine' does.
function resolve(dir, which, conflict) {
  if (!conflict) return { ok: false, reload: false };

  if (which === 'mine') {
    if (!conflict.mineJson) return { ok: false, reload: false };
    // The arriving save is the one being set aside. The mirror was already
    // backed up by preserve(), so this is the side still missing a copy.
    backup(dir, conflict.incomingJson);
    if (!write(dir, conflict.mineJson)) return { ok: false, reload: false };
    return { ok: true, reload: true };
  }

  if (which === 'incoming') {
    if (!conflict.incomingJson) return { ok: false, reload: false };
    // Nothing to write: the game has been playing this save all along, and
    // its own saving has already made it this machine's. preserve() kept the
    // side being given up.
    return { ok: true, reload: false };
  }

  return { ok: false, reload: false };
}

module.exports = {
  SAVE, MIRROR,
  read, write, inspect, preserve, forDisplay, resolve, summarise, backup,
  _hash: hash,
};

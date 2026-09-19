// Reads the achievements out of game.js and writes:
//   desktop/achievements.json       the game's id -> the API name used on Steam
//   desktop/steam-achievements.tsv  a row per achievement, to work from when
//                                   entering them in the Steamworks web UI
//
// Generated rather than hand-kept, so adding an achievement to the game cannot
// leave the Steam side quietly out of date.
//
// The array literal is evaluated rather than picked apart with a regular
// expression: the entries vary (quoting, a hidden flag, multi-line checks) and
// a pattern that misses one fails silently, which is the worst way to lose an
// achievement. The `check` closures are only created here, never called, so
// evaluating the literal is safe without the rest of the game around it.
//
//   node tools/steam-achievements.js
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'game.js'), 'utf8');

const open = src.indexOf('const ACHIEVEMENTS = [');
if (open < 0) throw new Error('could not find ACHIEVEMENTS in game.js');
const bodyStart = src.indexOf('[', open);
const close = src.indexOf('\n  ];', open);
if (close < 0) throw new Error('could not find the end of ACHIEVEMENTS');
const literal = src.slice(bodyStart, close + 4);

let list;
try {
  list = new Function(`"use strict"; return ${literal};`)();
} catch (err) {
  throw new Error(`could not evaluate the ACHIEVEMENTS literal: ${err.message}`);
}

const ids = new Set();
for (const a of list) {
  if (!a || !a.id || !a.name || !a.blurb) throw new Error(`an achievement is missing id, name or blurb: ${JSON.stringify(a)}`);
  if (ids.has(a.id)) throw new Error(`two achievements share the id "${a.id}"`);
  ids.add(a.id);
}

// Cross-check against a plain count of `id:` keys, so a change to the shape of
// the array shows up as an error rather than a quietly shorter list.
const declared = (src.slice(open, close).match(/\{\s*id: '/g) || []).length;
if (declared !== list.length) throw new Error(`parsed ${list.length} achievements but ${declared} are declared`);

const rows = list.map(a => ({ ...a, api: 'ACH_' + a.id.toUpperCase() }));

fs.writeFileSync(
  path.join(ROOT, 'desktop', 'achievements.json'),
  JSON.stringify(Object.fromEntries(rows.map(a => [a.id, a.api])), null, 2) + '\n'
);

fs.writeFileSync(
  path.join(ROOT, 'desktop', 'steam-achievements.tsv'),
  ['API Name\tDisplay Name\tDescription\tHidden\tCategory']
    .concat(rows.map(a => [a.api, a.name, a.blurb, a.hidden ? 'Yes' : 'No', a.category].join('\t')))
    .join('\n') + '\n'
);

console.log(`${rows.length} achievements (${rows.filter(a => a.hidden).length} hidden)`
  + ' -> desktop/achievements.json, desktop/steam-achievements.tsv');

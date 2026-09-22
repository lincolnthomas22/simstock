// Copies the game into desktop/app/ so the packaged build and a dev run load
// from exactly the same place. The web root is never packaged directly:
// electron-builder cannot reach above its own directory, and having one
// answer to "where does the game live" is worth the copy.
//
//   node sync-game.js
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const APP = path.join(__dirname, 'app');
const TAKE = ['index.html', 'style.css', 'game.js', 'sim.js', 'gamepad.js', 'favicon.svg', 'fonts'];

fs.rmSync(APP, { recursive: true, force: true });
fs.mkdirSync(APP, { recursive: true });

let files = 0;
for (const name of TAKE) {
  const from = path.join(ROOT, name);
  if (!fs.existsSync(from)) throw new Error(`${name} is missing from the repository root`);
  fs.cpSync(from, path.join(APP, name), { recursive: true });
  files += fs.statSync(from).isDirectory() ? fs.readdirSync(from).length : 1;
}

// Anything a build needs baked into it goes here. It has to be written at sync
// time rather than read from the environment when the game runs, because a
// player double-clicking an icon has none of the build's environment.
const config = { defaultServer: process.env.SIMSTOCK_SERVER || '' };
fs.writeFileSync(path.join(APP, 'build-config.json'), JSON.stringify(config, null, 2) + '\n');

console.log(`synced ${files} files into desktop/app`
  + (config.defaultServer ? `, pointing at ${config.defaultServer}` : ', with no match server set'));

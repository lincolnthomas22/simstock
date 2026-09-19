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
const TAKE = ['index.html', 'style.css', 'game.js', 'sim.js', 'favicon.svg', 'fonts'];

fs.rmSync(APP, { recursive: true, force: true });
fs.mkdirSync(APP, { recursive: true });

let files = 0;
for (const name of TAKE) {
  const from = path.join(ROOT, name);
  if (!fs.existsSync(from)) throw new Error(`${name} is missing from the repository root`);
  fs.cpSync(from, path.join(APP, name), { recursive: true });
  files += fs.statSync(from).isDirectory() ? fs.readdirSync(from).length : 1;
}
console.log(`synced ${files} files into desktop/app`);

// Stamps the game's own files with a content hash, so a browser that has an
// old copy fetches the new one.
//
// GitHub Pages serves index.html with a short cache and game.js and style.css
// with a longer one, and neither carries a fingerprint. So a returning player
// gets the new page around the old code: on the day the match screen was
// rewritten, the new HTML arrived with the old JavaScript behind it, and the
// screen it drew was neither version. A hash in the query string makes the
// address of a changed file different from the address of the old one, which
// is the only thing a cache reliably respects.
//
// Run it after changing any of the files below and commit the result. CI
// checks that it was run, the same way it checks the Steam achievement list.
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PAGE = path.join(ROOT, 'index.html');

// Everything index.html pulls in that a change can land in. The fonts are
// already named by their own hashes, but the stylesheet that points at them
// is not.
const ASSETS = ['fonts/fonts.css', 'style.css', 'sim.js', 'game.js'];

const hashOf = file => crypto
  .createHash('sha256')
  .update(fs.readFileSync(path.join(ROOT, file)))
  .digest('hex')
  .slice(0, 8);

let page = fs.readFileSync(PAGE, 'utf8');
const stamped = [];

for (const asset of ASSETS) {
  const hash = hashOf(asset);
  // Matches the reference whether or not it has been stamped before.
  const ref = new RegExp(`((?:href|src)=")${asset.replace(/[.\/]/g, '\\$&')}(?:\\?v=[0-9a-f]+)?(")`, 'g');
  if (!ref.test(page)) {
    console.error(`index.html does not pull in ${asset}; nothing to stamp`);
    process.exit(1);
  }
  ref.lastIndex = 0;
  page = page.replace(ref, `$1${asset}?v=${hash}$2`);
  stamped.push(`${asset} -> ${hash}`);
}

fs.writeFileSync(PAGE, page);
console.log(`stamped ${stamped.length} files into index.html`);
stamped.forEach(line => console.log('  ' + line));

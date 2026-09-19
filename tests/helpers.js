// Shared bits for the browser tests.
'use strict';
const path = require('path');
const { chromium } = require('playwright');

const GAME = 'file://' + path.join(__dirname, '..', 'index.html');

// CI installs Playwright's own Chromium and needs no help finding it. A
// machine with one already on it can point at that instead, which is what
// keeps these runnable where a download is not on.
const launch = () => chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}
);

// A tiny result collector, so a failing check reports and carries on rather
// than throwing away the rest of the run.
function results() {
  const passed = [];
  const failed = [];
  return {
    check: (name, cond, detail = '') => (cond ? passed : failed).push(name + (cond ? '' : `  <-- ${detail}`)),
    fail: msg => failed.push(msg),
    report(title) {
      console.log(`\n${title}: ${passed.length} passed`);
      passed.forEach(n => console.log('  ✓', n));
      if (failed.length) {
        console.log(`\n${failed.length} FAILED`);
        failed.forEach(n => console.log('  ✗', n));
        process.exitCode = 1;
      }
      return !failed.length;
    },
  };
}

// Opens the game and steps off the title screen into the given room.
async function openGame(browser, { screen = null, watch = null } = {}) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  if (watch) page.on('pageerror', e => watch(`PAGEERROR: ${e.message}`));
  await page.goto(GAME);
  await page.waitForTimeout(500);
  if (screen) await page.click(`.landing-buttons [data-screen="${screen}"]`);
  return page;
}

module.exports = { GAME, launch, results, openGame };

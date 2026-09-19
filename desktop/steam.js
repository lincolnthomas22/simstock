// Steam, if it is there.
//
// The Steamworks SDK is not redistributable and needs a partner account and an
// app ID, so it is an optional dependency: without it every call here is a
// no-op and the game is exactly the game. That is deliberate — the desktop
// build has to run for anyone who checks this repository out, not only for
// someone with a Steam partner account.
//
// To turn it on:
//   npm install steamworks.js
//   put your app ID in desktop/steam_appid.txt (and in STEAM_APP_ID to override)
'use strict';
const fs = require('fs');
const path = require('path');

const MAP = require('./achievements.json');

let client = null;
let state = 'off';   // off | on | failed

function appId() {
  if (process.env.STEAM_APP_ID) return Number(process.env.STEAM_APP_ID);
  const file = path.join(__dirname, 'steam_appid.txt');
  if (fs.existsSync(file)) {
    const n = Number(fs.readFileSync(file, 'utf8').trim());
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

function init() {
  const id = appId();
  if (!id) {
    console.log('[steam] no app ID, so Steam features are off — the game runs the same without them');
    return false;
  }
  let steamworks;
  try {
    steamworks = require('steamworks.js');
  } catch {
    console.log('[steam] steamworks.js is not installed, so Steam features are off');
    return false;
  }
  try {
    client = steamworks.init(id);
    state = 'on';
    console.log(`[steam] connected as ${client.localplayer.getName()} (app ${id})`);
    return true;
  } catch (err) {
    // Steam not running, or the app ID is not one this account owns. Not fatal.
    state = 'failed';
    console.log(`[steam] could not connect (${err.message}); carrying on without it`);
    return false;
  }
}

// The game's own achievement id, translated to the API name set in Steamworks.
// An id with no mapping is simply not a Steam achievement.
function unlock(gameId) {
  if (state !== 'on' || !client) return false;
  const apiName = MAP[gameId];
  if (!apiName) return false;
  try {
    client.achievement.activate(apiName);
    return true;
  } catch (err) {
    console.log(`[steam] could not unlock ${apiName}: ${err.message}`);
    return false;
  }
}

const isOn = () => state === 'on';

module.exports = { init, unlock, isOn };

// The only bridge between the game and the desktop shell. The renderer runs
// sandboxed with no Node in it, so everything it can do is on this object and
// nothing else.
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('simstock', {
  desktop: true,
  platform: process.platform,
  version: ipcRenderer.sendSync('app:version'),

  // Saving is synchronous on purpose. The game reads its save at the top of
  // game.js, before anything is on screen, exactly the way it reads
  // localStorage — making this a promise would mean restructuring the boot for
  // no gain, and the file is a few hundred kilobytes at most.
  readSave: () => ipcRenderer.sendSync('save:read'),
  writeSave: json => ipcRenderer.sendSync('save:write', json),

  // Fire and forget: an achievement that fails to reach Steam must never
  // interrupt the game.
  unlockAchievement: id => ipcRenderer.send('steam:achievement', id),

  // So a player never has to know a server address to play online.
  defaultServer: ipcRenderer.sendSync('net:default-server'),

  toggleFullscreen: () => ipcRenderer.send('window:fullscreen'),
});

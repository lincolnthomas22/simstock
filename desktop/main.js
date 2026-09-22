// SimStock, as a desktop game.
//
// The shell does four things the browser cannot: it keeps the save in a real
// file Steam Cloud can sync, it passes achievements to Steam when Steam is
// there, it knows the address of the match server so nobody has to type one,
// and it puts the game in a window with no browser around it.
//
// The game itself is untouched. It is the same index.html that runs on the
// web, loaded from desktop/app, and it checks for `window.simstock` before
// using any of this.
'use strict';

const { app, BrowserWindow, Menu, ipcMain, shell, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const steam = require('./steam.js');
const sandbox = require('./sandbox.js');

// Where the online lobby points when a player has not set an address. It is
// baked in at sync time from SIMSTOCK_SERVER — see sync-game.js — because a
// packaged game has none of the build machine's environment. The environment
// still wins during a dev run, which is how the tests point it at a local one.
function defaultServer() {
  if (process.env.SIMSTOCK_SERVER) return process.env.SIMSTOCK_SERVER;
  try {
    return require('./app/build-config.json').defaultServer || '';
  } catch {
    return '';   // an unsynced checkout: the lobby just starts empty
  }
}
const DEFAULT_SERVER = defaultServer();

const isDev = !app.isPackaged;
const SAVE_NAME = 'simstock-save.json';

// Say which way the sandbox went. The decision itself belongs to the launcher
// — by the time this file runs, Chromium has already built its zygote and a
// switch appended here would do nothing. See sandbox.js.
sandbox.report(app);

// Steam has to be initialised before the app is ready, and it must never stop
// the game starting.
steam.init();

// Steam relaunches the game through its own client on a double-click, and a
// second copy would fight the first over the save file.
if (!app.requestSingleInstanceLock()) app.quit();

let win = null;

// ---------------------------------------------------------------
// The save file
// One file, written whole, in the place the operating system keeps this app's
// data. That is the path to point Steam Cloud at — see the README.
// ---------------------------------------------------------------
const savePath = () => path.join(app.getPath('userData'), SAVE_NAME);

function readSave() {
  try {
    return fs.readFileSync(savePath(), 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('[save] could not read:', err.message);
    return null;
  }
}

// Written to a neighbouring file and renamed over the real one, so a crash or
// a power cut halfway through leaves the previous save intact rather than a
// half-written one. A corrupted save is the one bug a player cannot forgive.
function writeSave(json) {
  if (typeof json !== 'string' || !json) return false;
  const target = savePath();
  const temp = `${target}.tmp`;
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(temp, json, 'utf8');
    fs.renameSync(temp, target);
    return true;
  } catch (err) {
    console.error('[save] could not write:', err.message);
    try { fs.unlinkSync(temp); } catch { /* nothing to clean up */ }
    return false;
  }
}

// ---------------------------------------------------------------
// The window
// ---------------------------------------------------------------
function createWindow() {
  win = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: '#0d0c0a',   // the game's own paper, so there is no white flash
    show: false,
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'build', 'icon.png'),
    title: 'SimStock',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,   // stood down at startup where the OS cannot honour it — see sandbox.js
      spellcheck: false,
    },
  });

  win.once('ready-to-show', () => win.show());
  // The page's <title> is written for a search engine. In a window it should
  // just be the name of the game.
  win.on('page-title-updated', e => e.preventDefault());
  win.on('closed', () => { win = null; });

  // Nothing in this game should ever navigate the window somewhere else, and a
  // link that wants a browser gets the real one.
  const external = url => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  };
  win.webContents.setWindowOpenHandler(({ url }) => external(url));
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win.webContents.getURL()) { e.preventDefault(); external(url); }
  });

  win.loadFile(path.join(__dirname, 'app', 'index.html'));
  if (isDev && process.env.SIMSTOCK_DEVTOOLS) win.webContents.openDevTools({ mode: 'detach' });
}

// No menu bar in a game, but the shortcuts people expect still have to work.
function installShortcuts() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([{
    label: 'SimStock',
    submenu: [
      { label: 'Toggle Full Screen', accelerator: process.platform === 'darwin' ? 'Ctrl+Cmd+F' : 'F11',
        click: () => win && win.setFullScreen(!win.isFullScreen()) },
      { role: 'reload', accelerator: 'CmdOrCtrl+R', visible: false },
      { role: 'toggleDevTools', accelerator: 'CmdOrCtrl+Shift+I', visible: false },
      { type: 'separator' },
      { role: 'quit' },
    ],
  }]));
}

// ---------------------------------------------------------------
// What the game can ask for
// All synchronous, because the game reads and writes its save the same way it
// reads and writes localStorage: in a line, with no waiting.
// ---------------------------------------------------------------
ipcMain.on('save:read', e => { e.returnValue = readSave(); });
ipcMain.on('save:write', (e, json) => { e.returnValue = writeSave(json); });
ipcMain.on('app:version', e => { e.returnValue = app.getVersion(); });
ipcMain.on('net:default-server', e => { e.returnValue = DEFAULT_SERVER; });
ipcMain.on('steam:achievement', (e, id) => { if (typeof id === 'string') steam.unlock(id); });
ipcMain.on('window:fullscreen', () => { if (win) win.setFullScreen(!win.isFullScreen()); });

app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

app.whenReady().then(() => {
  installShortcuts();
  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

process.on('uncaughtException', err => {
  console.error('[main] uncaught:', err);
  if (app.isReady()) dialog.showErrorBox('SimStock hit a problem', String(err && err.stack || err));
});

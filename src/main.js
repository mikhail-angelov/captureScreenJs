// ShotMark (JS) — application backend on the tinyjs runtime.
// A port of the Go version (github.com/mikhail-angelov/captureScreen): instead of
// an HTTP server on 127.0.0.1 plus a browser tab, the app runs in a native window
// and talks to the page through tiny.api (request/response) and app.push (events).
//
// Kept from the original: screenshot folder watching, debounce, dedupe, the
// "file inside the folder" guard and the editor in ui/ (moved to src/frontend).
// Added: native window, menu-bar icon, notifications, global hotkey, native
// clipboard, native save dialog, launch at login, work with the window closed.

import { Watcher, isValidFile, statSize, statMtime } from './watcher.js';
import { bytesToBase64, base64ToBytes } from './base64.js';
import { resolveWatchFolder, defaultWatchFolder, joinPath, baseName, isSafeName } from './config.js';

const APP_NAME = 'ShotMark';
const TRAY_ICON = 'sf:camera.viewfinder';
const SHOW_HOTKEY = 'cmd+alt+s';
const HOTKEY_ID = 'show-window';
const STORE_KEY = 'watchFolder';

const log = (...a) => console.log('[shotmark]', ...a);

let watcher = null;
let watchFolder = '';
let folderError = null;
let lastAccepted = null;

// ─────────────────────────── helpers ───────────────────────────

/** Directory entries: tjs.readDir returns an async iterator or an array. */
async function readDirNames(dir) {
  const names = [];
  let it;
  try { it = await tjs.readDir(dir); } catch (e) { log('cannot read folder:', e.message); return names; }
  const push = (e) => {
    if (typeof e === 'string') names.push(e);
    else if (e && typeof e.name === 'string') names.push(e.name);
  };
  if (it && typeof it[Symbol.asyncIterator] === 'function') {
    for await (const e of it) push(e);
  } else if (it && typeof it[Symbol.iterator] === 'function') {
    for (const e of it) push(e);
  }
  return names;
}

/** Recent screenshots in the watched folder, newest first. */
async function listShots(limit = 50) {
  const names = await readDirNames(watchFolder);
  const shots = [];
  for (const name of names) {
    if (!isValidFile(name) || !isSafeName(name)) continue;
    const full = joinPath(watchFolder, name);
    let size = null;
    try { size = statSize(await tjs.stat(full)); } catch { continue; }
    shots.push({ name, size: size ?? 0, path: full });
  }
  for (const s of shots) {
    try {
      s.mtime = statMtime(await tjs.stat(s.path));
    } catch { s.mtime = 0; }
  }
  shots.sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
  return shots.slice(0, limit);
}

async function readShotBase64(name) {
  if (!isSafeName(name) || !isValidFile(name)) throw new Error('invalid file name: ' + name);
  const full = joinPath(watchFolder, name);
  const bytes = await tjs.readFile(full);
  return { full, bytes, dataBase64: bytesToBase64(bytes) };
}

async function switchFolder(dir, app) {
  const res = await resolveWatchFolder(dir);
  if (!res.ok) {
    folderError = res.error;
    log('folder rejected:', res.error);
    if (app) app.push('folderInvalid', { folder: dir, error: res.error });
    return { ok: false, error: res.error, folder: watchFolder };
  }
  if (watcher) watcher.stop();
  watchFolder = res.path;
  folderError = null;
  try { app && app.store && app.store.set(STORE_KEY, watchFolder); } catch (e) { log('store:', e.message); }
  watcher = new Watcher(watchFolder, (filePath) => onNewShot(filePath, app));
  watcher.start();
  log('watch folder:', watchFolder);
  if (app) app.push('folderChanged', { folder: watchFolder });
  return { ok: true, folder: watchFolder, error: null };
}

async function onNewShot(filePath, app) {
  const name = baseName(filePath);
  log('new file:', name);
  try {
    const { bytes } = await readShotBase64(name);
    lastAccepted = name;
    if (app) {
      app.push('newShot', { name, bytes: bytes.byteLength });
      app.show();
      app.notify({ title: APP_NAME, body: `Opened screenshot: ${name}` });
    }
  } catch (e) {
    log('cannot read the screenshot:', e.message);
  }
}

// ─────────────────────────── page-facing API ───────────────────────────

export const api = {
  /** Application state for the initial render. */
  getState: async (_params, app) => ({
    folder: watchFolder,
    folderError,
    launchAtLogin: await app.launchAtLogin.get().catch(() => 'unknown'),
    lastShot: lastAccepted,
    shots: await listShots(50),
  }),

  listShots: async () => listShots(50),

  /** Screenshot metadata; the page loads the image itself via tiny.fileURL(path). */
  readShot: async ({ name }) => {
    if (!isSafeName(name) || !isValidFile(name)) throw new Error('invalid file name: ' + name);
    const full = joinPath(watchFolder, name);
    let size = null;
    try { size = statSize(await tjs.stat(full)); } catch { /* size is optional */ }
    return { name, path: full, bytes: size ?? 0 };
  },

  /** Fallback: the image bytes in base64, used when fileURL is unavailable. */
  readShotBase64: async ({ name }) => {
    const { dataBase64, bytes, full } = await readShotBase64(name);
    return { name, path: full, dataBase64, bytes: bytes.byteLength };
  },

  /** Folder picking: the page calls tiny.dialog.pickFolder(), the path lands here. */
  setFolder: async ({ path }, app) => switchFolder(path, app),

  /** Save the PNG rendered by the editor (the path comes from the native dialog). */
  savePng: async ({ path, dataBase64 }) => {
    if (!path) throw new Error('no save path given');
    const bytes = base64ToBytes(dataBase64);
    await tjs.writeFile(path, bytes);
    log('saved:', path, bytes.byteLength, 'bytes');
    return { path, bytes: bytes.byteLength };
  },

  /** Copy the image to the clipboard natively (NSPasteboard). */
  copyImage: async ({ dataBase64 }, app) => {
    const bytes = base64ToBytes(dataBase64);
    // tjs.makeTempFile fails with EINVAL in the current runtime, so build the path here.
    const tmpPath = joinPath(tjs.tmpDir, `shotmark-clipboard-${Date.now()}.png`);
    await tjs.writeFile(tmpPath, bytes);
    await app.clipboard.write({ image: tmpPath });
    log('copied to clipboard:', tmpPath);
    return { ok: true, path: tmpPath };
  },

  reveal: async ({ name }, app) => {
    const target = name ? joinPath(watchFolder, name) : watchFolder;
    await app.shell.reveal(target);
    return { ok: true };
  },

  openFolder: async (_p, app) => { await app.shell.open(watchFolder); return { ok: true }; },

  getLaunchAtLogin: async (_p, app) => ({ value: await app.launchAtLogin.get() }),

  setLaunchAtLogin: async ({ value }, app) => {
    await app.launchAtLogin.set(!!value);
    return { value: await app.launchAtLogin.get() };
  },

  quit: async (_p, app) => { app.quit(); return { ok: true }; },
};

// ─────────────────────────── startup ───────────────────────────

export function init(app) {
  // Closing the window does not quit the app: folder watching continues and the
  // window comes back on the next screenshot. (In the Go version this was a
  // separate daemon plus a browser tab.)
  try { app.setHideOnClose(true); } catch (e) { log('setHideOnClose:', e.message); }

  const stored = (() => { try { return app.store.get(STORE_KEY); } catch { return null; } })();
  const initial = stored || defaultWatchFolder();

  resolveWatchFolder(initial).then(async (res) => {
    if (res.ok) {
      watchFolder = res.path;
      watcher = new Watcher(watchFolder, (filePath) => onNewShot(filePath, app));
      watcher.start();
      log('watch folder:', watchFolder);
    } else {
      folderError = res.error;
      log('default folder did not work:', res.error);
      if (app) app.push('folderInvalid', { folder: initial, error: res.error });
    }
    if (app) {
      app.push('ready', {
        folder: watchFolder,
        folderError,
        launchAtLogin: await app.launchAtLogin.get().catch(() => 'unknown'),
        shots: await listShots(50),
      });
    }
  });

  // Menu-bar icon.
  const trayMenu = [
    { id: 'show', label: 'Show Window' },
    { id: 'folder', label: 'Choose Folder…' },
    { id: 'latest', label: 'Latest Screenshot' },
    { separator: true },
    { id: 'quit', label: 'Quit' },
  ];
  try {
    app.tray.set({ title: APP_NAME, icon: TRAY_ICON, tooltip: APP_NAME, menu: trayMenu });
  } catch (e) {
    log('tray with icon failed, retrying without it:', e.message);
    try { app.tray.set({ title: APP_NAME, menu: trayMenu }); } catch (e2) { log('tray unavailable:', e2.message); }
  }

  // Global hotkey to bring the window up.
  try { app.hotkey.register(HOTKEY_ID, SHOW_HOTKEY); } catch (e) { log('hotkey:', e.message); }
}

export function onTray(id, app) {
  if (id === 'quit') { app.quit(); return; }
  if (id === 'show') { app.show(); return; }
  if (id === 'folder') { app.show(); app.push('requestFolder'); return; }
  if (id === 'latest') {
    app.show();
    if (lastAccepted) app.push('openShot', { name: lastAccepted });
    else app.push('newestShot');
  }
}

export function onHotkey(id, app) {
  if (id === HOTKEY_ID) app.show();
}

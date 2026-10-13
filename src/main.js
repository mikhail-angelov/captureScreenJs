// This process hosts the editor; the windowless tray agent owns the Watcher.
import { isValidFile, isRegularFileStat, statSize, statMtime } from './watcher.js';
import { bytesToBase64, base64ToBytes } from './base64.js';
import { readWatchFolder, saveWatchFolder, daemonRunning } from './settings.js';
import { getLaunchAtLogin, setLaunchAtLogin } from './launch-at-login.js';
import { watcherCommand } from './processes.js';
import { resolveWatchFolder, joinPath, baseName, isSafeName } from './config.js';

const APP_NAME = 'ShotMark';
const EDITOR = 'main';
const log = (...args) => console.log('[shotmark]', ...args);

let watchFolder = '';
let folderError = null;
let lastAccepted = null;
let initialization = Promise.resolve();
let editorReady = false;
let pendingPath = null;
let initialized = false;
let pendingAction = null;

function pushEditor(app, event, data) {
  if (editorReady) app.push(event, data);
}

async function ensureWatcher() {
  if (await daemonRunning()) return;
  const process = tjs.spawn(watcherCommand(), { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' });
  process.wait().then((status) => {
    if (status.exit_status !== 0) log('watcher exited:', status.exit_status);
  });
}

async function screenshot(name) {
  if (!isSafeName(name) || !isValidFile(name)) throw new Error('invalid filename: ' + name);
  const path = joinPath(watchFolder, name);
  const st = await tjs.lstat(path);
  if (!isRegularFileStat(st)) throw new Error('screenshot must be a regular file: ' + name);
  return { name, path, bytes: statSize(st) ?? 0 };
}

async function listShots(limit = 50) {
  if (!watchFolder) return [];
  const shots = [];
  const entries = await tjs.readDir(watchFolder);
  for await (const entry of entries) {
    const name = entry.name;
    if (!isSafeName(name) || !isValidFile(name)) continue;
    try {
      const path = joinPath(watchFolder, name);
      const st = await tjs.lstat(path);
      if (isRegularFileStat(st)) shots.push({ name, path, size: statSize(st), mtime: statMtime(st) });
    } catch { /* A file may disappear while listing. */ }
  }
  shots.sort((a, b) => b.mtime - a.mtime);
  return shots.slice(0, limit);
}

async function getState(app) {
  await initialization;
  return {
    folder: watchFolder,
    folderError,
    launchAtLogin: await getLaunchAtLogin(),
    lastShot: lastAccepted,
    shots: await listShots().catch(() => []),
  };
}

async function switchFolder(dir, app) {
  const result = await resolveWatchFolder(dir);
  if (!result.ok) return { ok: false, error: result.error, folder: watchFolder };
  await saveWatchFolder(result.path);
  await ensureWatcher();
  watchFolder = result.path;
  folderError = null;
  lastAccepted = null;
  pendingPath = null;
  initialized = true;
  pushEditor(app, 'folderChanged', { folder: watchFolder });
  return { ok: true, folder: watchFolder, error: null };
}

async function acceptPending(app) {
  if (!pendingPath) return;
  const path = pendingPath;
  pendingPath = null;
  const folder = await resolveWatchFolder(await readWatchFolder());
  if (!folder.ok) throw new Error(folder.error);
  watchFolder = folder.path;
  const shot = await screenshot(baseName(path));
  if (await tjs.realPath(path) !== shot.path) throw new Error('screenshot is outside the watch folder');
  lastAccepted = shot.name;
  folderError = null;
  app.show();
  pushEditor(app, 'newShot', { name: shot.name });
}

export const api = {
  getState: async (_params, app) => getState(app),
  // Called after subscriptions and the initial image load: catches shots and
  // file-open events that arrived while the new page was still booting.
  editorReady: async (_params, _app, meta) => {
    if (meta?.window !== EDITOR) throw new Error('not the editor window');
    editorReady = true;
    const action = pendingAction;
    pendingAction = null;
    return { lastShot: lastAccepted, requestFolder: action === 'settings', showHistory: action === 'history' };
  },
  listShots: async () => { await initialization; return listShots(); },
  readShot: async ({ name }) => { await initialization; return screenshot(name); },
  readShotBase64: async ({ name }) => {
    await initialization;
    const meta = await screenshot(name);
    const bytes = await tjs.readFile(meta.path);
    return { ...meta, dataBase64: bytesToBase64(bytes) };
  },
  setFolder: async ({ path }, app) => { await initialization; return switchFolder(path, app); },
  savePng: async ({ path, dataBase64 }) => {
    if (!path) throw new Error('no save path specified');
    const bytes = base64ToBytes(dataBase64);
    await tjs.writeFile(path, bytes);
    return { path, bytes: bytes.byteLength };
  },
  copyImage: async ({ dataBase64 }, app) => {
    // tinyjs accepts base64 directly; no temporary PNG or cleanup race.
    await app.clipboard.write({ image: dataBase64 });
    return { ok: true };
  },
  reveal: async ({ name }, app) => {
    await initialization;
    const path = name ? (await screenshot(name)).path : watchFolder;
    await app.shell.reveal(path);
    return { ok: true };
  },
  openFolder: async (_params, app) => { await initialization; await app.shell.open(watchFolder); return { ok: true }; },
  getLaunchAtLogin: async () => ({ value: await getLaunchAtLogin() }),
  setLaunchAtLogin: async ({ value }, app) => {
    await setLaunchAtLogin(!!value, watcherCommand());
    return { value: await getLaunchAtLogin() };
  },
  quit: async (_params, app) => { app.quit(); return { ok: true }; },
};

async function initialize(app) {
  await ensureWatcher();
  const folder = await resolveWatchFolder(await readWatchFolder());
  if (!folder.ok) throw new Error(folder.error);
  watchFolder = folder.path;
  await saveWatchFolder(watchFolder);
  initialized = true;
  await acceptPending(app);
}

export function init(app) {
  app.setHideOnClose(false);
  // The main window's native close exits the launcher and its backend.
  // The watcher was spawned with detached stdio and survives that exit.
  initialization = initialize(app).catch((error) => {
    folderError = error.message;
    log('startup:', folderError);
  });
}

export function onOpenFiles(paths, app) {
  const images = paths.filter((path) => typeof path === 'string' && isValidFile(path));
  if (!images.length) return;
  pendingPath = images[images.length - 1];
  if (initialized) return acceptPending(app);
}

export function onOpenUrl(url, app) {
  const target = new URL(url);
  if (target.protocol !== 'shotmark-editor:') return;
  app.show();
  if (!['settings', 'history'].includes(target.hostname)) return;
  if (editorReady) pushEditor(app, target.hostname === 'settings' ? 'requestFolder' : 'requestHistory');
  else pendingAction = target.hostname;
}

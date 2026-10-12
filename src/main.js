// ShotMark (JS) — бэкенд приложения на рантайме tinyjs.
// Порт Go-версии (github.com/mikhail-angelov/captureScreen): вместо HTTP-сервера
// на 127.0.0.1 и вкладки браузера — нативное окно, а связь со страницей идёт
// через tiny.api (запрос/ответ) и app.push (события).
//
// Что осталось от оригинала: слежение за папкой скриншотов, дебаунс, дедуп,
// защита «файл внутри папки», редактор в ui/ (перенесён в src/frontend без изменений).
// Что появилось: нативное окно, иконка в строке меню, уведомления, глобальная
// горячая клавиша, нативный буфер обмена, системный диалог сохранения,
// автозапуск при логине, работа в фоне при закрытом окне.

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

// ─────────────────────────── служебное ───────────────────────────

/** Список имён в папке: tjs.readDir отдаёт асинхронный итератор либо массив. */
async function readDirNames(dir) {
  const names = [];
  let it;
  try { it = await tjs.readDir(dir); } catch (e) { log('не читается папка:', e.message); return names; }
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

/** Свежие картинки в папке наблюдения (сначала новые). */
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
  // Свежие сверху: сортируем по времени изменения (tjs.stat отдаёт mtim).
  for (const s of shots) {
    try {
      s.mtime = statMtime(await tjs.stat(s.path));
    } catch { s.mtime = 0; }
  }
  shots.sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
  return shots.slice(0, limit);
}

async function readShotBase64(name) {
  if (!isSafeName(name) || !isValidFile(name)) throw new Error('недопустимое имя файла: ' + name);
  const full = joinPath(watchFolder, name);
  const bytes = await tjs.readFile(full);
  return { full, bytes, dataBase64: bytesToBase64(bytes) };
}

async function switchFolder(dir, app) {
  const res = await resolveWatchFolder(dir);
  if (!res.ok) {
    folderError = res.error;
    log('папка отклонена:', res.error);
    if (app) app.push('folderInvalid', { folder: dir, error: res.error });
    return { ok: false, error: res.error, folder: watchFolder };
  }
  if (watcher) watcher.stop();
  watchFolder = res.path;
  folderError = null;
  try { app && app.store && app.store.set(STORE_KEY, watchFolder); } catch (e) { log('store:', e.message); }
  watcher = new Watcher(watchFolder, (filePath) => onNewShot(filePath, app));
  watcher.start();
  log('папка наблюдения:', watchFolder);
  if (app) app.push('folderChanged', { folder: watchFolder });
  return { ok: true, folder: watchFolder, error: null };
}

async function onNewShot(filePath, app) {
  const name = baseName(filePath);
  log('новый файл:', name);
  try {
    const { dataBase64, bytes } = await readShotBase64(name);
    lastAccepted = name;
    if (app) {
      app.push('newShot', { name, dataBase64, bytes: bytes.byteLength });
      app.show();
      app.notify({ title: APP_NAME, body: `Открыт снимок: ${name}` });
    }
  } catch (e) {
    log('не смог прочитать снимок:', e.message);
  }
}

// ─────────────────────────── API для страницы ───────────────────────────

export const api = {
  /** Состояние приложения для стартовой отрисовки. */
  getState: async (_params, app) => ({
    folder: watchFolder,
    folderError,
    launchAtLogin: await app.launchAtLogin.get().catch(() => 'unknown'),
    lastShot: lastAccepted,
    shots: await listShots(50),
  }),

  listShots: async () => listShots(50),

  /** Снимок для редактора: страница сама грузит его по tiny.fileURL(path). */
  readShot: async ({ name }) => {
    if (!isSafeName(name) || !isValidFile(name)) throw new Error('недопустимое имя файла: ' + name);
    const full = joinPath(watchFolder, name);
    let size = null;
    try { size = statSize(await tjs.stat(full)); } catch { /* размер не критичен */ }
    return { name, path: full, bytes: size ?? 0 };
  },

  /** Запасной путь: байты картинки в base64, если fileURL недоступен. */
  readShotBase64: async ({ name }) => {
    const { dataBase64, bytes, full } = await readShotBase64(name);
    return { name, path: full, dataBase64, bytes: bytes.byteLength };
  },

  /** Выбор папки: страница зовёт tiny.dialog.pickFolder(), путь приходит сюда. */
  setFolder: async ({ path }, app) => switchFolder(path, app),

  /** Сохранить PNG, собранный в редакторе (путь выбран в native save dialog). */
  savePng: async ({ path, dataBase64 }) => {
    if (!path) throw new Error('путь сохранения не задан');
    const bytes = base64ToBytes(dataBase64);
    await tjs.writeFile(path, bytes);
    log('сохранено:', path, bytes.byteLength, 'байт');
    return { path, bytes: bytes.byteLength };
  },

  /** Скопировать картинку в буфер обмена нативно (NSPasteboard). */
  copyImage: async ({ dataBase64 }, app) => {
    const bytes = base64ToBytes(dataBase64);
    // tjs.makeTempFile в текущем рантайме падает с EINVAL, поэтому путь строим сами.
    const tmpPath = joinPath(tjs.tmpDir, `shotmark-clipboard-${Date.now()}.png`);
    await tjs.writeFile(tmpPath, bytes);
    await app.clipboard.write({ image: tmpPath });
    log('скопировано в буфер:', tmpPath);
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

// ─────────────────────────── запуск ───────────────────────────

export function init(app) {
  // Закрытие окна не завершает приложение: наблюдение за папкой продолжается,
  // окно открывается заново при новом скриншоте. (В Go-версии за это отвечал
  // отдельный демон + вкладка браузера.)
  try { app.setHideOnClose(true); } catch (e) { log('setHideOnClose:', e.message); }

  const stored = (() => { try { return app.store.get(STORE_KEY); } catch { return null; } })();
  const initial = stored || defaultWatchFolder();

  resolveWatchFolder(initial).then(async (res) => {
    if (res.ok) {
      watchFolder = res.path;
      watcher = new Watcher(watchFolder, (filePath) => onNewShot(filePath, app));
      watcher.start();
      log('папка наблюдения:', watchFolder);
    } else {
      folderError = res.error;
      log('папка по умолчанию не подошла:', res.error);
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

  // Иконка в строке меню.
  const trayMenu = [
    { id: 'show', label: 'Показать окно' },
    { id: 'folder', label: 'Выбрать папку…' },
    { id: 'latest', label: 'Последний снимок' },
    { separator: true },
    { id: 'quit', label: 'Выход' },
  ];
  try {
    app.tray.set({ title: APP_NAME, icon: TRAY_ICON, tooltip: APP_NAME, menu: trayMenu });
  } catch (e) {
    log('tray с иконкой не поднялся, пробую без неё:', e.message);
    try { app.tray.set({ title: APP_NAME, menu: trayMenu }); } catch (e2) { log('tray недоступен:', e2.message); }
  }

  // Глобальная клавиша «показать окно».
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

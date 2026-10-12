// Watcher — порт server/watcher.go на рантайм txiki.js.
// Логика сохранена один в один: fsnotify → tjs.watch, дебаунс 500 мс,
// проверка стабильности размера (200 мс), дедуп обработанных и «файл внутри папки».
//
// Отличия от Go-версии:
//  - tjs.watch отдаёт callback либо имя файла (строка), либо объект — принимаем оба вида;
//  - фильтра создания/записи от ядра нет: те же события отсекаются дедупом и
//    проверкой расширения/приватности (см. isValidFile).

export const DEBOUNCE_MS = 500;       // WatcherDebounceDelay
export const STABLE_CHECK_MS = 200;   // StableCheckInterval
export const SUPPORTED_EXT = ['.png', '.jpg', '.jpeg'];

const log = (...a) => console.log('[watcher]', ...a);

/** Размер файла в байтах или null. Понимает разные формы ответа tjs.stat. */
export function statSize(st) {
  if (st == null) return null;
  if (typeof st === 'number') return st;
  if (Array.isArray(st)) return st[8] ?? st[7] ?? null;
  if (typeof st.size === 'number') return st.size;
  if (typeof st.st_size === 'number') return st.st_size;
  return null;
}

/** Время изменения файла (мс) или 0. Учитывает форму ответа tjs.stat: mtim строкой. */
export function statMtime(st) {
  if (st == null) return 0;
  if (Array.isArray(st)) return st[11] ?? 0;
  const v = st.mtime ?? st.mtimeMs ?? st.mtim ?? null;
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : 0;
}

export function isDirStat(st) {
  if (st == null) return false;
  if (Array.isArray(st)) return ((st[2] ?? 0) & 0o170000) === 0o040000;
  if (typeof st.isDirectory === 'function') return !!st.isDirectory();
  if (typeof st.isDir === 'boolean') return st.isDir;
  if (typeof st.mode === 'number') return (st.mode & 0o170000) === 0o040000;
  if (typeof st.type === 'string') return st.type === 'dir' || st.type === 'directory';
  return false;
}

export function isSymlinkStat(st) {
  if (st == null) return false;
  if (Array.isArray(st)) return ((st[2] ?? 0) & 0o170000) === 0o120000;
  if (typeof st.isSymbolicLink === 'function') return !!st.isSymbolicLink();
  if (typeof st.isSymlink === 'boolean') return st.isSymlink;
  if (typeof st.mode === 'number') return (st.mode & 0o170000) === 0o120000;
  return false;
}

/** .png/.jpg/.jpeg и имя не с точки — как isValidFile в Go. */
export function isValidFile(filePath) {
  const base = String(filePath).split('/').pop();
  if (!base || base.startsWith('.')) return false;
  const dot = base.lastIndexOf('.');
  if (dot < 0) return false;
  return SUPPORTED_EXT.includes(base.slice(dot).toLowerCase());
}

/** Файл строго внутри папки (защита от traversal) — isFileInsideDir. */
export function isFileInsideDir(filePath, dir) {
  const norm = (p) => {
    const parts = String(p).split('/');
    const out = [];
    for (const part of parts) {
      if (part === '' || part === '.') continue;
      if (part === '..') { out.pop(); continue; }
      out.push(part);
    }
    return '/' + out.join('/');
  };
  const f = norm(filePath);
  const d = norm(dir);
  return f === d || f.startsWith(d.endsWith('/') ? d : d + '/');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class Watcher {
  constructor(dir, onNewFile) {
    this.dir = dir;
    this.onNewFile = onNewFile;
    this.handled = new Set();
    this.pending = new Set();
    this.handle = null;
    this.stopped = false;
  }

  isHandled(p) { return this.handled.has(p); }
  markHandled(p) { this.handled.add(p); }

  /** Аналог tryStartProcessing: не берём файл дважды. */
  tryStartProcessing(p) {
    if (this.handled.has(p) || this.pending.has(p)) return false;
    this.pending.add(p);
    return true;
  }

  clearPending(p) { this.pending.delete(p); }

  /** Два замера размера с интервалом — isFileSizeStable. */
  async isFileSizeStable(filePath, intervalMs = STABLE_CHECK_MS) {
    let size1;
    try { size1 = statSize(await tjs.stat(filePath)); } catch { return false; }
    if (size1 == null) return false;
    await sleep(intervalMs);
    let size2;
    try { size2 = statSize(await tjs.stat(filePath)); } catch { return false; }
    return size2 != null && size2 > 0 && size2 === size1;
  }

  async processFile(filePath) {
    try {
      await sleep(DEBOUNCE_MS);
      if (this.stopped) return;
      const stable = await this.isFileSizeStable(filePath);
      if (!stable) { log('файл ещё не дописан, пропускаю:', filePath.split('/').pop()); return; }
      this.markHandled(filePath);
      log('принимаю:', filePath.split('/').pop());
      if (this.onNewFile) this.onNewFile(filePath);
    } finally {
      this.clearPending(filePath);
    }
  }

  /** Событие от tjs.watch: строка (имя) либо объект. */
  onEvent(a, b) {
    if (this.stopped) return;
    let name = null;
    if (typeof a === 'string') name = a;
    else if (a && typeof a === 'object') name = a.path || a.name || a.filename || a.file || null;
    if (!name) return;
    const filePath = name.startsWith('/') ? name : this.dir.replace(/\/$/, '') + '/' + name;
    if (!isValidFile(filePath)) return;
    if (!isFileInsideDir(filePath, this.dir)) return;
    if (!this.tryStartProcessing(filePath)) return;
    this.processFile(filePath);
    void b;
  }

  start() {
    this.stopped = false;
    this.handle = tjs.watch(this.dir, (a, b) => this.onEvent(a, b));
    log('слежу за папкой:', this.dir);
    return this.handle;
  }

  stop() {
    this.stopped = true;
    try {
      const h = this.handle;
      if (h && typeof h.close === 'function') h.close();
      else if (h && typeof h.stop === 'function') h.stop();
    } catch (e) { log('ошибка при остановке:', e.message); }
    this.handle = null;
    this.handled.clear();
    this.pending.clear();
  }
}

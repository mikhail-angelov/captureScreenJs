// Watcher — a port of server/watcher.go to the txiki.js runtime.
// Logic is preserved one-to-one: fsnotify -> tjs.watch, 500 ms debounce,
// size-stability check (200 ms), processed-file dedupe and the
// "file must live inside the watched folder" guard.
//
// Differences from the Go version:
//  - tjs.watch hands the callback either a file name (string) or an object —
//    both shapes are accepted here;
//  - there is no create/write op filter from the kernel, so those cases are
//    covered by the dedupe plus the extension/hidden-file check (isValidFile).

export const DEBOUNCE_MS = 500;       // WatcherDebounceDelay
export const STABLE_CHECK_MS = 200;   // StableCheckInterval
export const SUPPORTED_EXT = ['.png', '.jpg', '.jpeg'];

const log = (...a) => console.log('[watcher]', ...a);

/** File size in bytes or null. Tolerates the different tjs.stat shapes. */
export function statSize(st) {
  if (st == null) return null;
  if (typeof st === 'number') return st;
  if (Array.isArray(st)) return st[8] ?? st[7] ?? null;
  if (typeof st.size === 'number') return st.size;
  if (typeof st.st_size === 'number') return st.st_size;
  return null;
}

/** Modification time in ms, or 0. tjs.stat reports it as `mtim` (a string). */
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

/** .png/.jpg/.jpeg and a name that does not start with a dot — isValidFile in Go. */
export function isValidFile(filePath) {
  const base = String(filePath).split('/').pop();
  if (!base || base.startsWith('.')) return false;
  const dot = base.lastIndexOf('.');
  if (dot < 0) return false;
  return SUPPORTED_EXT.includes(base.slice(dot).toLowerCase());
}

/** The file is strictly inside the folder (traversal guard) — isFileInsideDir. */
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

  /** tryStartProcessing: never take the same file twice. */
  tryStartProcessing(p) {
    if (this.handled.has(p) || this.pending.has(p)) return false;
    this.pending.add(p);
    return true;
  }

  clearPending(p) { this.pending.delete(p); }

  /** Two size samples with a delay — isFileSizeStable. */
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
      if (!stable) { log('file is not fully written yet, skipping:', filePath.split('/').pop()); return; }
      this.markHandled(filePath);
      log('accepting:', filePath.split('/').pop());
      if (this.onNewFile) this.onNewFile(filePath);
    } finally {
      this.clearPending(filePath);
    }
  }

  /** Event from tjs.watch: a string (name) or an object. */
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
    log('watching folder:', this.dir);
    return this.handle;
  }

  stop() {
    this.stopped = true;
    try {
      const h = this.handle;
      if (h && typeof h.close === 'function') h.close();
      else if (h && typeof h.stop === 'function') h.stop();
    } catch (e) { log('error while stopping:', e.message); }
    this.handle = null;
    this.handled.clear();
    this.pending.clear();
  }
}

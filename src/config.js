// Configuration — a port of server/config.go.
// Watch folder: the CAPTURE_SCREEN_WATCH_FOLDER environment variable, otherwise
// ~/Documents. Validation: it exists, it is a directory, it is not a symlink.

import { isDirStat, isSymlinkStat } from './watcher.js';

export const DEFAULT_DIR = '~/Documents';
export const ENV_DIR = 'CAPTURE_SCREEN_WATCH_FOLDER';

export function expandTilde(p) {
  if (typeof p !== 'string' || p.length === 0) return p;
  if (p[0] !== '~') return p;
  const home = tjs.homeDir;
  return p.length === 1 ? home : home + p.slice(1);
}

export function joinPath(dir, name) {
  const d = String(dir).replace(/\/+$/, '');
  const n = String(name).replace(/^\/+/, '');
  return d + '/' + n;
}

export function baseName(p) {
  return String(p).split('/').filter(Boolean).pop() || '';
}

/** A bare file name: no separators, no traversal — safe to accept from the page. */
export function isSafeName(name) {
  if (typeof name !== 'string' || !name) return false;
  if (name.includes('/') || name.includes('\\')) return false;
  if (name === '.' || name === '..') return false;
  return true;
}

/** Validate and normalise the folder. Returns { ok, path, error }. */
export async function resolveWatchFolder(dir) {
  if (!dir || typeof dir !== 'string') return { ok: false, path: '', error: 'no folder given' };
  const expanded = expandTilde(dir);
  let abs = expanded;
  if (!abs.startsWith('/')) abs = joinPath(tjs.cwd, abs);

  let st;
  try {
    st = await tjs.lstat(abs);
  } catch (e) {
    return { ok: false, path: abs, error: `folder does not exist: ${abs}` };
  }
  if (isSymlinkStat(st)) return { ok: false, path: abs, error: `folder is a symlink, not supported: ${abs}` };
  if (!isDirStat(st)) return { ok: false, path: abs, error: `not a directory: ${abs}` };

  try { abs = tjs.realPath(abs); } catch { /* keep the path as given */ }
  return { ok: true, path: abs, error: null };
}

/** Default folder: the environment variable, otherwise ~/Documents. */
export function defaultWatchFolder() {
  const env = tjs.env[ENV_DIR];
  return env && String(env).trim() ? String(env).trim() : DEFAULT_DIR;
}

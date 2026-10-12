// Конфигурация — порт server/config.go.
// Папка наблюдения: переменная окружения CAPTURE_SCREEN_WATCH_FOLDER,
// иначе ~/Documents. Валидация: существует, это папка, не симлинк.

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

/** Имя файла без путей — то, что можно принимать от страницы. */
export function isSafeName(name) {
  if (typeof name !== 'string' || !name) return false;
  if (name.includes('/') || name.includes('\\')) return false;
  if (name === '.' || name === '..') return false;
  return true;
}

/** Проверка и нормализация папки. Возвращает { ok, path, error }. */
export async function resolveWatchFolder(dir) {
  if (!dir || typeof dir !== 'string') return { ok: false, path: '', error: 'папка не задана' };
  const expanded = expandTilde(dir);
  let abs = expanded;
  if (!abs.startsWith('/')) abs = joinPath(tjs.cwd, abs);

  let st;
  try {
    st = await tjs.lstat(abs);
  } catch (e) {
    return { ok: false, path: abs, error: `папка не существует: ${abs}` };
  }
  if (isSymlinkStat(st)) return { ok: false, path: abs, error: `папка — симлинк, не поддерживается: ${abs}` };
  if (!isDirStat(st)) return { ok: false, path: abs, error: `это не папка: ${abs}` };

  try { abs = tjs.realPath(abs); } catch { /* оставляем как есть */ }
  return { ok: true, path: abs, error: null };
}

/** Папка по умолчанию: env, иначе ~/Documents. */
export function defaultWatchFolder() {
  const env = tjs.env[ENV_DIR];
  return env && String(env).trim() ? String(env).trim() : DEFAULT_DIR;
}

// ShotMark — слой связи со «сервером».
//
// Два режима работы одной и той же страницы:
//   1) внутри tinyjs — window.tiny.api.call(...) : нативный бэкенд, связь по сокету;
//   2) в обычном браузере (отладка/Playwright) — HTTP-фолбэк на dev-сервер
//      tests/dev-server.mjs, который отдаёт те же ответы.
//
// Так редактор остаётся тестируемым в браузере (как в исходном проекте),
// а в приложении работает без портов и HTTP.

const HAS_TINY =
  typeof window !== 'undefined' &&
  !!(window.tiny && window.tiny.api && typeof window.tiny.api.call === 'function');

/** Правда, если страница работает внутри tinyjs. */
export const inApp = () => HAS_TINY;

/** Есть ли нативные диалоги (нужны для выбора папки и сохранения). */
export const hasDialogs = () => HAS_TINY && !!(window.tiny && window.tiny.dialog);

// ───────────────────────── HTTP-фолбэк (только для отладки и тестов) ─────────────────────────

async function httpCall(fn, params = {}) {
  const base = window.location.origin;
  switch (fn) {
    case 'getState': {
      const r = await fetch(base + '/api/state');
      return r.json();
    }
    case 'listShots': {
      const r = await fetch(base + '/api/state');
      return (await r.json()).shots || [];
    }
    case 'readShot': {
      const r = await fetch(base + '/api/shot?name=' + encodeURIComponent(params.name));
      if (!r.ok) throw new Error('не удалось прочитать снимок: ' + params.name);
      return r.json();
    }
    case 'setFolder': {
      const r = await fetch(base + '/api/folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: params.path }),
      });
      return r.json();
    }
    case 'savePng': {
      const r = await fetch(base + '/api/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: params.path, dataBase64: params.dataBase64 }),
      });
      return r.json();
    }
    case 'getLaunchAtLogin':
      return { value: 'unsupported' };
    case 'setLaunchAtLogin':
      return { value: 'unsupported' };
    case 'reveal':
    case 'openFolder':
    case 'quit':
      return { ok: true };
    default:
      throw new Error('в браузерном режиме метод недоступен: ' + fn);
  }
}

function httpOn() {
  // В браузерном режиме подписки нет: страница открывается по ?file=<имя>.
  return () => {};
}

// ───────────────────────── общий интерфейс ─────────────────────────

/** Вызов функции бэкенда. */
export async function call(fn, params = {}) {
  if (HAS_TINY) return window.tiny.api.call(fn, params);
  return httpCall(fn, params);
}

/** Подписка на событие от бэкенда (newShot, folderChanged, ready…). */
export function on(event, cb) {
  if (HAS_TINY) return window.tiny.api.on(event, cb);
  return httpOn(event, cb);
}

/** Значение из строки запроса (режим отладки: ?file=<имя>). */
export function getFileNameFromQuery() {
  const params = new URLSearchParams(window.location.search);
  return params.get('file');
}

/** base64 → blob-url, который понимает <img> и canvas. */
export function base64ToObjectUrl(dataBase64, type = 'image/png') {
  const bin = atob(dataBase64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type }));
}

function loadImageElement(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('не удалось загрузить картинку: ' + url));
    img.src = url;
  });
}

/**
 * Загрузить снимок в редактор.
 * В приложении картинку отдаёт бэкенд: сначала пробуем tiny.fileURL(path) —
 * файл читает сам вебвью (нужен "readAccess" в tinyjs.json, байты не идут по сокету);
 * если fileURL нет — берём байты в base64. В браузере — /file/<имя>.
 */
export async function loadScreenshot(name) {
  if (!name) return null;

  if (HAS_TINY) {
    const meta = await window.tiny.api.call('readShot', { name });

    if (typeof window.tiny.fileURL === 'function') {
      try {
        const imageUrl = window.tiny.fileURL(meta.path);
        const img = await loadImageElement(imageUrl);
        return { fileName: meta.name, imageUrl, img, width: img.naturalWidth, height: img.naturalHeight };
      } catch (e) {
        console.warn('fileURL не сработал, беру байты:', e.message);
      }
    }

    const res = await window.tiny.api.call('readShotBase64', { name });
    const imageUrl = base64ToObjectUrl(res.dataBase64);
    const img = await loadImageElement(imageUrl);
    return { fileName: res.name, imageUrl, img, width: img.naturalWidth, height: img.naturalHeight };
  }

  const imageUrl = window.location.origin + '/file/' + encodeURIComponent(name);
  const img = await loadImageElement(imageUrl);
  return { fileName: name, imageUrl, img, width: img.naturalWidth, height: img.naturalHeight };
}

// ShotMark — the page-to-backend layer.
//
// The very same page runs in two modes:
//   1) inside tinyjs — window.tiny.api.call(...): the native backend over a socket;
//   2) in a plain browser (debugging and Playwright) — an HTTP fallback against
//      tests/dev-server.mjs, which answers with the same shapes.
//
// This keeps the editor testable without launching the app, while in the app
// itself there is no port and no HTTP at all.

const HAS_TINY =
  typeof window !== 'undefined' &&
  !!(window.tiny && window.tiny.api && typeof window.tiny.api.call === 'function');

/** True when the page runs inside tinyjs. */
export const inApp = () => HAS_TINY;

/** True when native dialogs are available (folder picking, saving). */
export const hasDialogs = () => HAS_TINY && !!(window.tiny && window.tiny.dialog);

// ───────────────────────── HTTP fallback (debugging and tests only) ─────────────────────────

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
      if (!r.ok) throw new Error('cannot read screenshot: ' + params.name);
      const data = await r.json();
      return { name: data.name, path: data.path, bytes: data.bytes };
    }
    case 'readShotBase64': {
      const r = await fetch(base + '/api/shot?name=' + encodeURIComponent(params.name));
      if (!r.ok) throw new Error('cannot read screenshot: ' + params.name);
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
      throw new Error('method unavailable in the browser mode: ' + fn);
  }
}

function httpOn() {
  // No subscriptions in the browser mode: the page is opened with ?file=<name>.
  return () => {};
}

// ───────────────────────── shared interface ─────────────────────────

/** Call a backend function. */
export async function call(fn, params = {}) {
  if (HAS_TINY) return window.tiny.api.call(fn, params);
  return httpCall(fn, params);
}

/** Subscribe to a backend event (newShot, folderChanged, ready…). */
export function on(event, cb) {
  if (HAS_TINY) return window.tiny.api.on(event, cb);
  return httpOn(event, cb);
}

/** Value from the query string (debug mode: ?file=<name>). */
export function getFileNameFromQuery() {
  const params = new URLSearchParams(window.location.search);
  return params.get('file');
}

/** base64 -> object URL that <img> and canvas can use. */
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
    img.onerror = () => reject(new Error('cannot load the image: ' + url));
    img.src = url;
  });
}

/**
 * Load a screenshot into the editor.
 * In the app the backend answers with a path and the page loads the file itself
 * through tiny.fileURL(path) — the webview reads it directly ("readAccess" in
 * tinyjs.json), so no bytes travel over the socket. If fileURL is unavailable the
 * page falls back to base64 bytes. In a browser the dev server serves /file/<name>.
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
        console.warn('fileURL did not work, falling back to bytes:', e.message);
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

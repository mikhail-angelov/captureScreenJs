// Native Tiny.js API with an HTTP fallback for browser development and tests.

const HAS_TINY =
  typeof window !== 'undefined' &&
  !!(window.tiny && window.tiny.api && typeof window.tiny.api.call === 'function');

/** Whether the page is running inside Tiny.js. */
export const inApp = () => HAS_TINY;

/** Whether native folder and save dialogs are available. */
export const hasDialogs = () => HAS_TINY && !!(window.tiny && window.tiny.dialog);

// ───────────────────────── HTTP fallback for development and tests ─────────────────────────

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
      if (!r.ok) throw new Error('could not read screenshot: ' + params.name);
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
      throw new Error('method unavailable in browser mode: ' + fn);
  }
}

function httpOn() {
  // Browser mode has no event subscriptions; use ?file=<name>.
  return () => {};
}

// ───────────────────────── shared interface ─────────────────────────

/** Call a backend function. */
export async function call(fn, params = {}) {
  if (HAS_TINY) return window.tiny.api.call(fn, params);
  return httpCall(fn, params);
}

/** Subscribe to a backend event. */
export function on(event, cb) {
  if (HAS_TINY) return window.tiny.api.on(event, cb);
  return httpOn(event, cb);
}

/** Read the screenshot name from the query string. */
export function getFileNameFromQuery() {
  const params = new URLSearchParams(window.location.search);
  return params.get('file');
}

/** Convert base64 to a blob URL for images and canvas. */
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
    img.onerror = () => reject(new Error('could not load image: ' + url));
    img.src = url;
  });
}

/**
 * Load a screenshot into the editor.
 * In the native app, first try tiny.fileURL(path).
 * The WebView reads the file directly with readAccess enabled.
 * Fall back to base64, or /file/<name> in browser mode.
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
        console.warn('fileURL failed, loading bytes:', e.message);
      }
    }

    const res = await window.tiny.api.call('readShotBase64', { name });
    const imageUrl = base64ToObjectUrl(res.dataBase64);
    let img;
    try { img = await loadImageElement(imageUrl); } catch (error) {
      URL.revokeObjectURL(imageUrl);
      throw error;
    }
    return { fileName: res.name, imageUrl, img, width: img.naturalWidth, height: img.naturalHeight };
  }

  const imageUrl = window.location.origin + '/file/' + encodeURIComponent(name);
  const img = await loadImageElement(imageUrl);
  return { fileName: name, imageUrl, img, width: img.naturalWidth, height: img.naturalHeight };
}

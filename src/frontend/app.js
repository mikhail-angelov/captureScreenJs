// Connect the editor to the native backend or the browser development server.

import { call, on, inApp, hasDialogs, getFileNameFromQuery, loadScreenshot } from './api.js';
import { Editor } from './editor.js';

const $ = (id) => document.getElementById(id);
const DEV = !inApp();

let editor = null;
let loadRequest = 0;
let state = { folder: null, folderError: null, lastShot: null, launchAtLogin: 'unknown' };

document.addEventListener('DOMContentLoaded', async () => {
  editor = new Editor();
  window.editor = editor;

  wireShell();
  subscribe();
  await refreshState();
  await openInitial();
  if (!DEV) {
    const pending = await call('editorReady');
    if (pending.lastShot && pending.lastShot !== editor.getState().image?.fileName) {
      await openShot(pending.lastShot);
    }
    if (pending.requestFolder) await chooseFolder();
    if (pending.showHistory) await showHistory();
  }
});

// ───────────────────────── state ─────────────────────────

async function refreshState() {
  try {
    state = Object.assign(state, await call('getState'));
  } catch (e) {
    console.warn('could not load state:', e.message);
  }
  renderShell();
}

function renderShell() {
  const label = $('folder-label');
  if (label) {
    if (state.folderError) {
      label.textContent = '⚠ ' + state.folderError;
      label.classList.add('bad');
    } else {
      label.textContent = state.folder || 'no folder selected';
      label.classList.remove('bad');
    }
  }

  const chk = $('chk-login');
  if (chk) {
    const v = state.launchAtLogin;
    chk.checked = v === 'enabled';
    chk.disabled = v === 'unsupported' || v === 'unknown' || v === 'requires-approval';
    chk.title = v === 'requires-approval' ? 'Approval required in System Settings > Login Items' : '';
    const wrap = $('login-wrap');
    if (wrap) wrap.style.display = v === 'unsupported' ? 'none' : '';
  }

  if (DEV) {
    const bar = $('folder-bar');
    if (bar) bar.classList.add('dev');
  }
}

// ───────────────────────── open screenshot ─────────────────────────

async function openInitial() {
  // Prefer the query parameter, then the backend's latest screenshot.
  const fromQuery = getFileNameFromQuery();
  if (fromQuery) { await openShot(fromQuery); return; }

  if (state.lastShot) { await openShot(state.lastShot); return; }

  if (state.folderError) {
    showEmpty('Watch folder unavailable', state.folderError);
    return;
  }

  const newest = Array.isArray(state.shots) && state.shots.length ? state.shots[0].name : null;
  if (newest) { await openShot(newest); return; }

  showEmpty('Waiting for screenshots…', 'Take a screenshot with Cmd+Shift+3 or Cmd+Shift+4');
}

async function confirmDiscard() {
  if (!editor.hasUnsavedChanges()) return true;
  const message = 'You have unsaved changes. Discard them and continue?';
  return hasDialogs() ? window.tiny.dialog.confirm(message) : window.confirm(message);
}

async function openShot(name) {
  if (!name) return;
  if (name === editor.getState().image?.fileName) return;
  const request = ++loadRequest;
  if (!await confirmDiscard() || request !== loadRequest) return;
  try {
    const imageData = await loadScreenshot(name);
    if (!imageData) return;
    if (request !== loadRequest) {
      if (imageData.imageUrl.startsWith('blob:')) URL.revokeObjectURL(imageData.imageUrl);
      return;
    }
    await editor.loadImage(imageData);
    if (state.shots && !state.shots.some((s) => s.name === name)) {
      // Refresh the list after receiving a new screenshot event.
      call('listShots').then((shots) => { state.shots = shots; }).catch(() => {});
    }
  } catch (e) {
    if (request === loadRequest) showEmpty('Could not open screenshot', e.message);
  }
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function showEmpty(title, hint) {
  const el = $('empty-state');
  if (!el) return;
  el.style.display = '';
  el.innerHTML = `<h2>${esc(title)}</h2><p class="hint">${esc(hint)}</p>`;
  const frame = document.getElementById('image-frame');
  if (frame) frame.classList.remove('has-image');
}

// ───────────────────────── backend events ─────────────────────────

function subscribe() {
  on('newShot', async ({ name }) => {
    await openShot(name);
    await refreshState();
  });

  on('openShot', async ({ name }) => { await openShot(name); });

  on('newestShot', async () => {
    try {
      const shots = await call('listShots');
      state.shots = shots;
      if (shots && shots.length) await openShot(shots[0].name);
    } catch (e) { console.warn(e.message); }
  });

  on('folderChanged', ({ folder }) => {
    ++loadRequest;
    editor.clearImage();
    state.folder = folder;
    state.folderError = null;
    renderShell();
    call('listShots').then((shots) => {
      state.shots = shots;
      if (shots && shots.length) openShot(shots[0].name);
      else showEmpty('Folder selected', folder);
    }).catch(() => {});
  });

  on('folderInvalid', ({ folder, error }) => {
    state.folderError = error;
    renderShell();
    showEmpty('Watch folder unavailable', `${folder}: ${error}`);
  });

  on('requestFolder', () => { chooseFolder(); });
  on('requestHistory', () => { showHistory(); });
}

// ───────────────────────── application shell ─────────────────────────

function wireShell() {
  const choose = $('btn-choose-folder');
  if (choose) choose.addEventListener('click', () => chooseFolder());

  const reveal = $('btn-reveal-folder');
  if (reveal) reveal.addEventListener('click', () => call('reveal', {}).catch(() => {}));

  $('btn-history')?.addEventListener('click', () => showHistory());
  $('history-close')?.addEventListener('click', () => $('shot-history').close());

  const quit = $('btn-quit');
  if (quit) {
    if (DEV) quit.style.display = 'none';
    else quit.addEventListener('click', () => call('quit').catch(() => {}));
  }

  const chk = $('chk-login');
  if (chk) {
    chk.addEventListener('change', async () => {
      try {
        const res = await call('setLaunchAtLogin', { value: chk.checked });
        state.launchAtLogin = res.value;
        renderShell();
      } catch (e) {
        console.warn(e.message);
        chk.checked = !chk.checked;
      }
    });
  }
}

async function chooseFolder() {
  if (!await confirmDiscard()) return;
  let path = null;

  if (hasDialogs()) {
    path = await window.tiny.dialog.pickFolder();
  } else if (DEV) {
    path = window.prompt('Watch folder (development mode):', state.folder || '');
  }

  if (!path) return;

  try {
    const res = await call('setFolder', { path });
    if (DEV && res?.ok) {
      ++loadRequest;
      editor.clearImage();
      await refreshState();
      await openInitial();
    }
    if (res && res.ok === false) {
      state.folderError = res.error;
      renderShell();
      showEmpty('Invalid folder', res.error);
    }
  } catch (e) {
    showEmpty('Invalid folder', e.message);
  }
}

async function showHistory() {
  const dialog = $('shot-history');
  const list = $('shot-list');
  try {
    const shots = await call('listShots');
    list.replaceChildren();
    if (!shots.length) list.textContent = 'There are no screenshots in this folder yet.';
    for (const shot of shots) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = shot.name;
      button.addEventListener('click', async () => {
        dialog.close();
        await openShot(shot.name);
      });
      list.append(button);
    }
    if (!dialog.open) dialog.showModal();
  } catch (error) {
    console.warn('could not open history:', error.message);
  }
}

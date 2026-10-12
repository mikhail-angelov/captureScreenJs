// ShotMark App — точка входа и связывание с бэкендом.
//
// В приложении (tinyjs) состояние и картинки приходят от бэкенда через tiny.api,
// новые снимки — событием newShot. В браузере (отладка/тесты) используется
// HTTP-фолбэк и параметр ?file=<имя>.

import { call, on, inApp, hasDialogs, getFileNameFromQuery, loadScreenshot } from './api.js';
import { Editor } from './editor.js';

const $ = (id) => document.getElementById(id);
const DEV = !inApp();

let editor = null;
let state = { folder: null, folderError: null, lastShot: null, launchAtLogin: 'unknown' };

document.addEventListener('DOMContentLoaded', async () => {
  editor = new Editor();
  window.editor = editor;

  wireShell();
  await refreshState();
  subscribe();
  await openInitial();
});

// ───────────────────────── состояние ─────────────────────────

async function refreshState() {
  try {
    state = Object.assign(state, await call('getState'));
  } catch (e) {
    console.warn('не удалось получить состояние:', e.message);
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
      label.textContent = state.folder || 'папка не выбрана';
      label.classList.remove('bad');
    }
  }

  const chk = $('chk-login');
  if (chk) {
    const v = state.launchAtLogin;
    chk.checked = v === 'enabled';
    chk.disabled = v === 'unsupported' || v === 'unknown' || v === 'requires-approval';
    chk.title = v === 'requires-approval' ? 'Требуется подтверждение в «Объекты входа» (системные настройки)' : '';
    const wrap = $('login-wrap');
    if (wrap) wrap.style.display = v === 'unsupported' ? 'none' : '';
  }

  if (DEV) {
    const bar = $('folder-bar');
    if (bar) bar.classList.add('dev');
  }
}

// ───────────────────────── открытие снимка ─────────────────────────

async function openInitial() {
  // Приоритет: параметр в адресе (отладка/тесты) → последний снимок из бэкенда.
  const fromQuery = getFileNameFromQuery();
  if (fromQuery) { await openShot(fromQuery); return; }

  if (state.lastShot) { await openShot(state.lastShot); return; }

  const newest = Array.isArray(state.shots) && state.shots.length ? state.shots[0].name : null;
  if (newest) { await openShot(newest); return; }

  showEmpty('Ждём скриншоты…', 'Сделайте снимок: Cmd+Shift+3 или Cmd+Shift+4');
}

async function openShot(name) {
  if (!name) return;
  try {
    const imageData = await loadScreenshot(name);
    if (!imageData) return;
    await editor.loadImage(imageData);
    if (state.shots && !state.shots.some((s) => s.name === name)) {
      // Снимок пришёл от события — обновим список для следующих запусков.
      call('listShots').then((shots) => { state.shots = shots; }).catch(() => {});
    }
  } catch (e) {
    showEmpty('Не удалось открыть снимок', e.message);
  }
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function showEmpty(title, hint) {
  const el = $('empty-state');
  if (!el) return;
  el.style.display = '';
  el.innerHTML = `<h2>${esc(title)}</h2><p class="hint">${esc(hint)}</p>`;
  const frame = document.querySelector('.image-frame');
  if (frame) frame.classList.remove('has-image');
}

// ───────────────────────── события от бэкенда ─────────────────────────

function subscribe() {
  on('ready', (payload) => {
    state = Object.assign(state, payload || {});
    renderShell();
  });

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
    state.folder = folder;
    state.folderError = null;
    renderShell();
    call('listShots').then((shots) => {
      state.shots = shots;
      if (shots && shots.length) openShot(shots[0].name);
      else showEmpty('Папка выбрана', folder);
    }).catch(() => {});
  });

  on('folderInvalid', ({ folder, error }) => {
    state.folderError = error;
    renderShell();
    showEmpty('Папка наблюдения недоступна', `${folder}: ${error}`);
  });

  on('requestFolder', () => { chooseFolder(); });
}

// ───────────────────────── оболочка приложения ─────────────────────────

function wireShell() {
  const choose = $('btn-choose-folder');
  if (choose) choose.addEventListener('click', () => chooseFolder());

  const reveal = $('btn-reveal-folder');
  if (reveal) reveal.addEventListener('click', () => call('reveal', {}).catch(() => {}));

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
  let path = null;

  if (hasDialogs()) {
    path = await window.tiny.dialog.pickFolder();
  } else if (DEV) {
    path = window.prompt('Папка наблюдения (режим отладки):', state.folder || '');
  }

  if (!path) return;

  try {
    const res = await call('setFolder', { path });
    if (res && res.ok === false) {
      state.folderError = res.error;
      renderShell();
      showEmpty('Папка не подошла', res.error);
    }
  } catch (e) {
    showEmpty('Папка не подошла', e.message);
  }
}

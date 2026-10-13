// Tiny.js 0.51.0 hosts native tray commands without a main window or WebView.
import { CaptureDaemon } from './daemon.js';
import { editorBundle } from './processes.js';
import { isValidFile } from './watcher.js';

let daemon;
let initialization = Promise.resolve();

function setTray(app) {
  app.tray.set({ icon: 'sf:camera', tooltip: 'ShotMark', menu: [
    { id: 'editor', label: 'Open Editor' },
    { id: 'history', label: 'Screenshot History…' },
    { id: 'settings', label: 'Settings…' },
    { separator: true },
    { id: 'quit', label: 'Stop Watcher' },
  ] });
}

export function init(app) {
  daemon = new CaptureDaemon(editorBundle());
  initialization = (async () => {
    if (!await daemon.start()) { app.quit(); return; }
    await setTray(app);
  })().catch((error) => { console.error('[agent]', error.message); app.quit(); });
}

export async function onTray(id, app) {
  await initialization;
  if (id === 'quit') { await daemon.stop(); app.quit(); return; }
  if (['editor', 'history', 'settings'].includes(id)) {
    await daemon.launchEditor('shotmark-editor://' + (id === 'editor' ? 'editor' : id));
  }
}

export async function onOpenFiles(paths) {
  await initialization;
  for (const path of paths) {
    if (typeof path === 'string' && isValidFile(path)) await daemon.launchEditor(path);
  }
}

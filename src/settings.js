import { defaultWatchFolder, joinPath } from './config.js';

const decoder = new TextDecoder();
const encoder = new TextEncoder();
export const dataDir = () => tjs.env.SHOTMARK_DATA_DIR || joinPath(tjs.homeDir, 'Library/Application Support/com.mikhailangelov.shotmark');
export const settingsPath = () => joinPath(dataDir(), 'settings.json');
export const socketPath = () => joinPath(dataDir(), 'watcher.sock');

export async function readWatchFolder() {
  try {
    const settings = JSON.parse(decoder.decode(await tjs.readFile(settingsPath())));
    if (typeof settings.watchFolder === 'string' && settings.watchFolder.trim()) return settings.watchFolder;
  } catch { /* No usable preference yet. */ }
  return defaultWatchFolder();
}

export async function saveWatchFolder(watchFolder) {
  await tjs.makeDir(dataDir(), { recursive: true });
  const temp = settingsPath() + '.' + crypto.randomUUID();
  try {
    await tjs.writeFile(temp, encoder.encode(JSON.stringify({ watchFolder })));
    await tjs.rename(temp, settingsPath());
  } finally {
    await tjs.remove(temp).catch(() => {});
  }
}

export async function daemonRunning() {
  try {
    const connection = await tjs.connect('pipe', socketPath());
    const { readable } = await connection.opened;
    // Do not disconnect before the server has constructed its accepted
    // socket: txiki otherwise crashes in getpeername().
    const { value, done } = await readable.getReader().read();
    try { connection.close(); } catch { /* Peer has already closed. */ }
    return !done && value?.[0] === 1;
  } catch { return false; }
}

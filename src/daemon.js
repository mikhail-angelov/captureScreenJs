// Filesystem observation lives in the windowless tray backend, not the editor.
import { Watcher, isRegularFileStat } from './watcher.js';
import { resolveWatchFolder } from './config.js';
import { dataDir, socketPath, readWatchFolder, saveWatchFolder, daemonRunning } from './settings.js';

export class CaptureDaemon {
  constructor(bundlePath, launchEditor = async (path) => {
    const child = tjs.spawn(['/usr/bin/open', '-a', bundlePath,
      '--env', 'SHOTMARK_DATA_DIR=' + dataDir(), path],
    { stdin: 'ignore', stdout: 'ignore', stderr: 'inherit' });
    const status = await child.wait();
    if (status.exit_status !== 0) throw new Error('editor could not be launched: ' + status.exit_status);
  }) {
    this.launchEditor = launchEditor;
    this.folder = '';
    this.running = false;
    this.reload = Promise.resolve();
  }

  async start() {
    if (new TextEncoder().encode(socketPath()).length > 100) throw new Error('watcher socket path is too long');
    await tjs.makeDir(dataDir(), { recursive: true });
    await tjs.chmod(dataDir(), 0o700);
    try {
      let info;
      try {
        // Bind first: concurrent starts cannot unlink a new owner's socket.
        this.server = await tjs.listen('pipe', socketPath());
        info = await this.server.opened;
      } catch (error) {
        try { this.server?.close(); } catch {}
        if (await daemonRunning()) return false;
        await tjs.remove(socketPath()).catch(() => {});
        this.server = await tjs.listen('pipe', socketPath());
        info = await this.server.opened;
      }
      const { readable } = info;
      this.running = true;
      // Connections only prove that the watcher is already running.
      (async () => {
        const reader = readable.getReader();
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          // Let the peer finish connect() before closing: txiki calls
          // getpeername during connect and fails if we close immediately.
          const { readable: input, writable } = await value.opened;
          await writable.getWriter().write(new Uint8Array([1]));
          const inputReader = input.getReader();
          while (!(await inputReader.read()).done) {}
          try { value.close(); } catch { /* Already closed by the peer. */ }
        }
      })().catch((error) => { if (this.running) console.error('[daemon] socket:', error.message); });
      // Keep the tray available if the initial folder is missing; settings
      // can then fix it without restarting the agent.
      await this.updateFolder().catch((error) => console.error('[daemon]', error.message));
      // LaunchServices does not inherit the watcher's environment. Persist
      // the resolved folder before it launches the first editor.
      if (this.folder) await saveWatchFolder(this.folder);
      this.settingsWatcher = tjs.watch(dataDir(), (name) => {
        if (name !== 'settings.json') return;
        this.reload = this.reload.then(() => this.updateFolder()).catch((error) => console.error('[daemon]', error.message));
      });
      return true;
    } catch (error) {
      if (this.running) await this.stop();
      else if (await daemonRunning()) return false;
      throw error;
    }
  }

  async updateFolder() {
    if (!this.running) return;
    const result = await resolveWatchFolder(await readWatchFolder());
    if (!this.running) return;
    if (!result.ok) throw new Error(result.error);
    if (result.path === this.folder) return;
    const folder = result.path;
    const next = new Watcher(folder, async (path) => {
      if (!this.running || this.folder !== folder) return;
      if (!isRegularFileStat(await tjs.lstat(path))) return;
      if (!this.running || this.folder !== folder) return;
      await this.launchEditor(path);
    });
    next.start();
    this.watcher?.stop();
    this.watcher = next;
    this.folder = folder;
    console.log('[daemon] watching:', folder);
  }

  async stop() {
    if (!this.running) return;
    this.running = false;
    this.watcher?.stop();
    this.settingsWatcher?.close();
    this.server.close();
    await tjs.remove(socketPath()).catch(() => {});
  }
}

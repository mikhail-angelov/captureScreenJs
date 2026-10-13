// Backend checks run in the same txiki.js runtime as the bundled application.
// Files and settings are isolated in temporary directories.

import { Watcher, isValidFile, isFileInsideDir } from '../src/watcher.js';
import { resolveWatchFolder, isSafeName, joinPath, expandTilde } from '../src/config.js';
import { api, init, onOpenFiles, onOpenUrl } from '../src/main.js';
import { CaptureDaemon } from '../src/daemon.js';
import { bytesToBase64, base64ToBytes, toBytes } from '../src/base64.js';

let passed = 0;
let failed = 0;

function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓', name); }
  else { failed++; console.log('  ✗', name, extra === undefined ? '' : '→ ' + JSON.stringify(extra)); }
}

function eq(name, a, b) { check(name, a === b, { got: a, want: b }); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Create a temporary directory manually; this runtime's makeTempDir returns EINVAL. */
async function makeTempDir(prefix) {
  const path = joinPath(tjs.tmpDir, `${prefix}${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
  await tjs.makeDir(path, { recursive: true });
  return path;
}

// ───────────────────────── 1. filename and path filters ─────────────────────────

function testFilters() {
  console.log('\n1. extension and path filters');
  eq('a.png is accepted', isValidFile('a.png'), true);
  eq('uppercase PNG is accepted', isValidFile('A.PNG'), true);
  eq('JPEG is accepted', isValidFile('a.jpeg'), true);
  eq('hidden PNG is rejected', isValidFile('.hidden.png'), false);
  eq('text file is rejected', isValidFile('a.txt'), false);
  eq('extensionless file is rejected', isValidFile('noext'), false);

  eq('file inside folder', isFileInsideDir('/tmp/w/a.png', '/tmp/w'), true);
  eq('nested folder is inside', isFileInsideDir('/tmp/w/sub/a.png', '/tmp/w'), true);
  eq('path traversal is rejected', isFileInsideDir('/tmp/w/../secret.png', '/tmp/w'), false);
  eq('other folder is rejected', isFileInsideDir('/tmp/other/a.png', '/tmp/w'), false);

  eq('filename with slash is rejected', isSafeName('sub/a.png'), false);
  eq('Unicode filename is accepted', isSafeName('Screenshot café.png'), true);
  eq('tilde expands to home directory', expandTilde('~/Documents'), tjs.homeDir + '/Documents');
  eq('path join', joinPath('/tmp/w/', 'a.png'), '/tmp/w/a.png');
}

// ───────────────────────── 2. base64 ─────────────────────────

function testBase64() {
  console.log('\n2. base64 image transport');
  eq('known base64 vector', bytesToBase64(new TextEncoder().encode('hello')), 'aGVsbG8=');
  eq('vector f', bytesToBase64(new TextEncoder().encode('f')), 'Zg==');
  eq('vector fo', bytesToBase64(new TextEncoder().encode('fo')), 'Zm8=');
  eq('vector foo', bytesToBase64(new TextEncoder().encode('foo')), 'Zm9v');
  eq('vector foob', bytesToBase64(new TextEncoder().encode('foob')), 'Zm9vYg==');

  const src = new Uint8Array(1024);
  for (let i = 0; i < src.length; i++) src[i] = (i * 7) % 256;
  const round = base64ToBytes(bytesToBase64(src));
  let same = round.length === src.length;
  for (let i = 0; same && i < src.length; i++) if (round[i] !== src[i]) same = false;
  check('1024 bytes survive encoding and decoding', same, { len: round.length });

  eq('string input is accepted', bytesToBase64('foo'), 'Zm9v');
  eq('empty input length', toBytes(null).length, 0);
}

// ───────────────────────── 3. folder configuration ─────────────────────────

async function testConfig() {
  console.log('\n3. watch folder validation');
  const path = await makeTempDir('shotmark-test-');

  const ok = await resolveWatchFolder(path);
  check('existing folder is accepted', ok.ok, ok.error);
  eq('normalized path is a string', typeof ok.path, 'string');
  eq('path resolves to a value rather than a Promise', ok.path, await tjs.realPath(path));

  const missing = await resolveWatchFolder(path + '/missing-folder');
  check('missing folder is rejected', !missing.ok, missing.error);

  const file = path + '/file.png';
  await tjs.writeFile(file, new Uint8Array([1, 2, 3]));
  const notDir = await resolveWatchFolder(file);
  check('file is rejected as a folder', !notDir.ok, notDir.error);

  const link = path + '/link';
  let symlinkMade = true;
  try { await tjs.symlink(path, link); } catch { symlinkMade = false; }
  if (symlinkMade) {
    const sym = await resolveWatchFolder(link);
    check('symlink is rejected', !sym.ok, sym.error);
  } else {
    console.log('  … symlinks unavailable on this filesystem; check skipped');
  }

  return path;
}

// ───────────────────────── 4. watcher integration ─────────────────────────

async function testWatcher(base) {
  console.log('\n4. watcher events, deduplication, and filters');
  const dir = base + '/watch';
  await tjs.makeDir(dir, { recursive: true });

  const accepted = [];
  const watcher = new Watcher(dir, (p) => accepted.push(p));
  watcher.start();
  await sleep(300);

  // PNG extension with synthetic contents; the watcher does not decode images
  const png = joinPath(dir, 'Screenshot café 2026-10-12.png');
  await tjs.writeFile(png, new Uint8Array(2048).fill(7));
  await sleep(1500);
  check('PNG is accepted', accepted.length === 1, accepted);

  // Repeated writes to an accepted path must not reprocess it
  await tjs.writeFile(png, new Uint8Array(2048).fill(9));
  await sleep(1200);
  check('repeated write does not reprocess the file', accepted.length === 1, accepted);

  // Unrelated and hidden files
  await tjs.writeFile(joinPath(dir, 'notes.txt'), new Uint8Array([1]));
  await tjs.writeFile(joinPath(dir, '.hidden.png'), new Uint8Array([1]));
  await sleep(1200);
  check('text and hidden PNG files are ignored', accepted.length === 1, accepted);

  // Second supported file
  await tjs.writeFile(joinPath(dir, 'second.PNG'), new Uint8Array(4096).fill(3));
  await sleep(1500);
  check('second PNG is accepted', accepted.length === 2, accepted);
  check('only PNG files were accepted', accepted.every((p) => /\.png$/i.test(p)), accepted);

  watcher.stop();
  await sleep(200);
  console.log('  … watcher stopped');

  const retry = new Watcher(dir, (path) => accepted.push(path));
  let checks = 0;
  retry.isFileSizeStable = async (path) => {
    if (++checks === 1) {
      // The final write event arrives during the first size comparison.
      retry.onEvent(path);
      return false;
    }
    return true;
  };
  const staged = joinPath(dir, 'staged.png');
  retry.tryStartProcessing(staged);
  await retry.processFile(staged);
  eq('last write during processing is accepted', accepted.at(-1), staged);
  eq('unstable file is checked again after a pending event', checks, 2);

  const failing = new Watcher(dir, async () => { throw new Error('launch failed'); });
  failing.isFileSizeStable = async () => true;
  failing.tryStartProcessing(staged);
  await failing.processFile(staged).catch(() => {});
  eq('callback failure does not mark acceptance', failing.isHandled(staged), false);
  eq('callback failure allows a later event to retry', failing.tryStartProcessing(staged), true);
  failing.stop();
  retry.stop();
}

async function testApp(base) {
  console.log('\n5. independent daemon and editor');
  const dir = base + '/app';
  await tjs.makeDir(dir);
  const oldFolder = tjs.env.CAPTURE_SCREEN_WATCH_FOLDER;
  const oldData = tjs.env.SHOTMARK_DATA_DIR;
  tjs.env.CAPTURE_SCREEN_WATCH_FOLDER = dir;
  tjs.env.SHOTMARK_DATA_DIR = '/tmp/shotmark-settings-' + crypto.randomUUID();
  const launches = [], copied = [], pushed = [];
  let daemon = new CaptureDaemon('/unused.app', async (path) => launches.push(path));
  const app = {
    setHideOnClose(value) { eq('closing the editor does not hide its window', value, false); },
    show() {}, push(event, data) { pushed.push({ event, data }); }, quit() {},
    clipboard: { write: async (data) => copied.push(data) },
  };
  try {
    await tjs.makeDir(tjs.env.SHOTMARK_DATA_DIR);
    await tjs.writeFile(tjs.env.SHOTMARK_DATA_DIR + '/settings.json', new TextEncoder().encode('{"watchFolder":{}}'));
    const concurrent = new CaptureDaemon('/unused.app', async (path) => launches.push(path));
    const started = await Promise.all([daemon.start(), concurrent.start()]);
    eq('concurrent starts leave exactly one daemon', started.filter(Boolean).length, 1);
    if (!started[0]) daemon = concurrent;
    const duplicate = new CaptureDaemon('/unused.app', async () => {});
    eq('duplicate start does not create a second watcher', await duplicate.start(), false);
    const file = dir + '/first.png';
    await tjs.writeFile(file, new Uint8Array([1, 2, 3]));
    await sleep(1100);
    eq('new file launches the editor', launches.length, 1);
    onOpenFiles([file], app); // LaunchServices can deliver before init.
    init(app);
    const state = await api.getState({}, app);
    eq('invalid preference falls back to the environment folder', state.folder, await tjs.realPath(dir));
    eq('incoming screenshot is retained before page readiness', state.lastShot, 'first.png');
    onOpenUrl('shotmark-editor://history', app);
    const ready = await api.editorReady({}, app, { window: 'main' });
    eq('history request survives page startup', ready.showHistory, true);
    onOpenUrl('shotmark-editor://settings', app);
    eq('settings request reaches the running editor', pushed.at(-1)?.event, 'requestFolder');
    await onOpenFiles([file], app);
    eq('event contains only the filename', JSON.stringify(pushed.at(-1)?.data), '{"name":"first.png"}');
    await api.quit({}, app);
    await tjs.writeFile(dir + '/after-close.png', new Uint8Array([4, 5, 6]));
    await sleep(1100);
    eq('closing the editor leaves the daemon active', launches.length, 2);
    await tjs.symlink(file, dir + '/link.png');
    await tjs.makeDir(dir + '/directory.png');
    for (const name of ['link.png', 'directory.png', '../outside.png']) {
      let rejected = false;
      try { await api.readShot({ name }); } catch { rejected = true; }
      check('readShot rejects ' + name, rejected);
    }
    const shots = await api.listShots();
    check('list contains only regular files', !shots.some((s) => ['link.png', 'directory.png'].includes(s.name)));
    await api.copyImage({ dataBase64: 'aGVsbG8=' }, app);
    eq('clipboard accepts base64 without a temporary file', copied[0]?.image, 'aGVsbG8=');
    const invalid = await api.setFolder({ path: dir + '/missing' }, app);
    eq('invalid selection preserves the working folder', invalid.folder, state.folder);
    const other = base + '/other';
    await tjs.makeDir(other);
    const selected = await api.setFolder({ path: other }, app);
    check('editor saves the selected folder', selected.ok);
    await sleep(300);
    eq('daemon reacts to settings changes', daemon.folder, await tjs.realPath(other));
    await tjs.writeFile(other + '/new.png', new Uint8Array([7, 8, 9]));
    await sleep(1100);
    eq('new folder is watched without a WebView', launches.length, 3);
    const launchCount = launches.length;
    const pendingLaunch = daemon.watcher.onNewFile(other + '/new.png');
    // Force folder validation to resume into a different-folder branch.
    daemon.folder = '';
    const pendingReload = daemon.updateFolder();
    await daemon.stop();
    await Promise.all([pendingLaunch, pendingReload]);
    eq('file validation does not launch an editor after stop', launches.length, launchCount);
    eq('folder validation does not recreate a watcher after stop', daemon.watcher.handle, null);
  } finally {
    await daemon.stop();
    if (oldFolder === undefined) delete tjs.env.CAPTURE_SCREEN_WATCH_FOLDER;
    else tjs.env.CAPTURE_SCREEN_WATCH_FOLDER = oldFolder;
    if (oldData === undefined) delete tjs.env.SHOTMARK_DATA_DIR;
    else tjs.env.SHOTMARK_DATA_DIR = oldData;
  }
}

// ───────────────────────── run ─────────────────────────

console.log('ShotMark backend checks (txiki.js version ' + tjs.version + ')');
testFilters();
testBase64();

const base = await testConfig();
await testWatcher(base);
await testApp(base);

console.log(`\nResult: passed ${passed}, failed ${failed}`);
if (failed > 0) tjs.exit(1);

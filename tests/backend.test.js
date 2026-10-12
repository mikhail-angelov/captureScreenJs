// Backend checks under the txiki.js runtime (the same one tinyjs embeds):
//
//     npm run test:backend          # or: tjs tests/backend.test.js
//
// The tests are synthetic: files are created in a temporary folder and the
// application itself is never launched.

import { Watcher, isValidFile, isFileInsideDir } from '../src/watcher.js';
import { resolveWatchFolder, isSafeName, joinPath, expandTilde } from '../src/config.js';
import { bytesToBase64, base64ToBytes, toBytes } from '../src/base64.js';

let passed = 0;
let failed = 0;

function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓', name); }
  else { failed++; console.log('  ✗', name, extra === undefined ? '' : '→ ' + JSON.stringify(extra)); }
}

function eq(name, a, b) { check(name, a === b, { got: a, want: b }); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Temporary folder built by hand: tjs.makeTempDir fails with EINVAL in this runtime build. */
async function makeTempDir(prefix) {
  const path = joinPath(tjs.tmpDir, `${prefix}${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
  await tjs.makeDir(path, { recursive: true });
  return path;
}

// ───────────────────────── 1. name and path filters ─────────────────────────

function testFilters() {
  console.log('\n1. filters: extensions and "inside the folder"');
  eq('a.png accepted', isValidFile('a.png'), true);
  eq('A.PNG accepted (case)', isValidFile('A.PNG'), true);
  eq('a.jpeg accepted', isValidFile('a.jpeg'), true);
  eq('.hidden.png rejected', isValidFile('.hidden.png'), false);
  eq('a.txt rejected', isValidFile('a.txt'), false);
  eq('extension-less file rejected', isValidFile('noext'), false);

  eq('file inside the folder', isFileInsideDir('/tmp/w/a.png', '/tmp/w'), true);
  eq('nested file inside', isFileInsideDir('/tmp/w/sub/a.png', '/tmp/w'), true);
  eq('escaping upwards rejected', isFileInsideDir('/tmp/w/../secret.png', '/tmp/w'), false);
  eq('another folder rejected', isFileInsideDir('/tmp/other/a.png', '/tmp/w'), false);

  eq('name with a slash rejected', isSafeName('sub/a.png'), false);
  eq('plain name accepted', isSafeName('Screenshot 2026-10-12 at 07.40.00.png'), true);
  eq('~ expands to the home directory', expandTilde('~/Documents'), tjs.homeDir + '/Documents');
  eq('path joining', joinPath('/tmp/w/', 'a.png'), '/tmp/w/a.png');
}

// ───────────────────────── 2. base64 ─────────────────────────

function testBase64() {
  console.log('\n2. base64 (handing the image to the page)');
  eq('known vector', bytesToBase64(new TextEncoder().encode('hello')), 'aGVsbG8=');
  eq('vector "f"', bytesToBase64(new TextEncoder().encode('f')), 'Zg==');
  eq('vector "fo"', bytesToBase64(new TextEncoder().encode('fo')), 'Zm8=');
  eq('vector "foo"', bytesToBase64(new TextEncoder().encode('foo')), 'Zm9v');
  eq('vector "foob"', bytesToBase64(new TextEncoder().encode('foob')), 'Zm9vYg==');

  const src = new Uint8Array(1024);
  for (let i = 0; i < src.length; i++) src[i] = (i * 7) % 256;
  const round = base64ToBytes(bytesToBase64(src));
  let same = round.length === src.length;
  for (let i = 0; same && i < src.length; i++) if (round[i] !== src[i]) same = false;
  check('bytes survive encoding and decoding (1024)', same, { len: round.length });

  eq('a string is accepted too', bytesToBase64('foo'), 'Zm9v');
  eq('empty input length', toBytes(null).length, 0);
}

// ───────────────────────── 3. watch folder validation ─────────────────────────

async function testConfig() {
  console.log('\n3. watch folder validation');
  const path = await makeTempDir('shotmark-test-');

  const ok = await resolveWatchFolder(path);
  check('existing folder accepted', ok.ok, ok.error);

  const missing = await resolveWatchFolder(path + '/no-such-folder');
  check('missing folder rejected', !missing.ok, missing.error);

  const file = path + '/file.png';
  await tjs.writeFile(file, new Uint8Array([1, 2, 3]));
  const notDir = await resolveWatchFolder(file);
  check('a file instead of a folder rejected', !notDir.ok, notDir.error);

  const link = path + '/link';
  let symlinkMade = true;
  try { await tjs.symlink(path, link); } catch { symlinkMade = false; }
  if (symlinkMade) {
    const sym = await resolveWatchFolder(link);
    check('symlink rejected', !sym.ok, sym.error);
  } else {
    console.log('  … symlinks are unavailable on this filesystem, check skipped');
  }

  return path;
}

// ───────────────────────── 4. the watcher end to end ─────────────────────────

async function testWatcher(base) {
  console.log('\n4. watcher: events, dedupe, filters');
  const dir = base + '/watch';
  await tjs.makeDir(dir, { recursive: true });

  const accepted = [];
  const watcher = new Watcher(dir, (p) => accepted.push(p));
  watcher.start();
  await sleep(300);

  // A valid PNG (header plus filler — the watcher does not look at the contents.)
  const png = joinPath(dir, 'Screenshot 2026-10-12.png');
  await tjs.writeFile(png, new Uint8Array(2048).fill(7));
  await sleep(1500);
  check('valid PNG accepted', accepted.length === 1, accepted);

  // The same file written again must not be processed twice.
  await tjs.writeFile(png, new Uint8Array(2048).fill(9));
  await sleep(1200);
  check('a rewrite does not produce a second pass', accepted.length === 1, accepted);

  // A foreign file and a hidden file.
  await tjs.writeFile(joinPath(dir, 'notes.txt'), new Uint8Array([1]));
  await tjs.writeFile(joinPath(dir, '.hidden.png'), new Uint8Array([1]));
  await sleep(1200);
  check('txt and hidden PNG are not accepted', accepted.length === 1, accepted);

  // A second valid file.
  await tjs.writeFile(joinPath(dir, 'second.PNG'), new Uint8Array(4096).fill(3));
  await sleep(1500);
  check('the second valid file is accepted', accepted.length === 2, accepted);
  check('only PNG files were accepted', accepted.every((p) => /\.png$/i.test(p)), accepted);

  watcher.stop();
  await sleep(200);
  console.log('  … watcher stopped');
}

// ───────────────────────── run ─────────────────────────

console.log('ShotMark backend checks (txiki.js runtime version ' + tjs.version + ')');
testFilters();
testBase64();

const base = await testConfig();
await testWatcher(base);

console.log(`\nResult: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

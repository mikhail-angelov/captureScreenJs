// Проверки логики бэкенда под рантаймом txiki.js (тот же, что внутри tinyjs):
//
//     tjs tests/backend.test.js
//
// Тесты синтетические: файлы создаются во временной папке, приложение не запускается.

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

/** Временная папка вручную: tjs.makeTempDir в этом билде рантайма падает с EINVAL. */
async function makeTempDir(prefix) {
  const path = joinPath(tjs.tmpDir, `${prefix}${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
  await tjs.makeDir(path, { recursive: true });
  return path;
}

// ───────────────────────── 1. фильтры имён и путей ─────────────────────────

function testFilters() {
  console.log('\n1. фильтры: расширения и «внутри папки»');
  eq('a.png принят', isValidFile('a.png'), true);
  eq('A.PNG принят (регистр)', isValidFile('A.PNG'), true);
  eq('a.jpeg принят', isValidFile('a.jpeg'), true);
  eq('.скрытый.png отклонён', isValidFile('.скрытый.png'), false);
  eq('a.txt отклонён', isValidFile('a.txt'), false);
  eq('файл без расширения отклонён', isValidFile('noext'), false);

  eq('файл внутри папки', isFileInsideDir('/tmp/w/a.png', '/tmp/w'), true);
  eq('подпапка внутри', isFileInsideDir('/tmp/w/sub/a.png', '/tmp/w'), true);
  eq('выход наружу отклонён', isFileInsideDir('/tmp/w/../secret.png', '/tmp/w'), false);
  eq('другая папка отклонена', isFileInsideDir('/tmp/other/a.png', '/tmp/w'), false);

  eq('имя с косой чертой отклонено', isSafeName('sub/a.png'), false);
  eq('обычное имя принято', isSafeName('Снимок экрана.png'), true);
  eq('~ разворачивается в домашний каталог', expandTilde('~/Documents'), tjs.homeDir + '/Documents');
  eq('склейка пути', joinPath('/tmp/w/', 'a.png'), '/tmp/w/a.png');
}

// ───────────────────────── 2. base64 ─────────────────────────

function testBase64() {
  console.log('\n2. base64 (передача картинки странице)');
  eq('известный вектор', bytesToBase64(new TextEncoder().encode('hello')), 'aGVsbG8=');
  eq('вектор «f»', bytesToBase64(new TextEncoder().encode('f')), 'Zg==');
  eq('вектор «fo»', bytesToBase64(new TextEncoder().encode('fo')), 'Zm8=');
  eq('вектор «foo»', bytesToBase64(new TextEncoder().encode('foo')), 'Zm9v');
  eq('вектор «foob»', bytesToBase64(new TextEncoder().encode('foob')), 'Zm9vYg==');

  const src = new Uint8Array(1024);
  for (let i = 0; i < src.length; i++) src[i] = (i * 7) % 256;
  const round = base64ToBytes(bytesToBase64(src));
  let same = round.length === src.length;
  for (let i = 0; same && i < src.length; i++) if (round[i] !== src[i]) same = false;
  check('байты переживают кодирование и декодирование (1024)', same, { len: round.length });

  eq('строка тоже принимается', bytesToBase64('foo'), 'Zm9v');
  eq('размер пустого ввода', toBytes(null).length, 0);
}

// ───────────────────────── 3. конфигурация папки ─────────────────────────

async function testConfig() {
  console.log('\n3. проверка папки наблюдения');
  const path = await makeTempDir('shotmark-test-');

  const ok = await resolveWatchFolder(path);
  check('существующая папка принимается', ok.ok, ok.error);

  const missing = await resolveWatchFolder(path + '/нет-такой-папки');
  check('несуществующая папка отклонена', !missing.ok, missing.error);

  const file = path + '/файл.png';
  await tjs.writeFile(file, new Uint8Array([1, 2, 3]));
  const notDir = await resolveWatchFolder(file);
  check('файл вместо папки отклонён', !notDir.ok, notDir.error);

  const link = path + '/ссылка';
  let symlinkMade = true;
  try { await tjs.symlink(path, link); } catch { symlinkMade = false; }
  if (symlinkMade) {
    const sym = await resolveWatchFolder(link);
    check('симлинк отклонён', !sym.ok, sym.error);
  } else {
    console.log('  … симлинки в этой ФС недоступны, проверка пропущена');
  }

  return path;
}

// ───────────────────────── 4. watcher целиком ─────────────────────────

async function testWatcher(base) {
  console.log('\n4. watcher: событие, дедуп, фильтры');
  const dir = base + '/watch';
  await tjs.makeDir(dir, { recursive: true });

  const accepted = [];
  const watcher = new Watcher(dir, (p) => accepted.push(p));
  watcher.start();
  await sleep(300);

  // валидный PNG (заголовок + мусор — содержимое для watcher'а не важно)
  const png = joinPath(dir, 'Снимок экрана 2026-10-12.png');
  await tjs.writeFile(png, new Uint8Array(2048).fill(7));
  await sleep(1500);
  check('валидный PNG принят', accepted.length === 1, accepted);

  // повторная запись того же файла — обрабатываться не должен
  await tjs.writeFile(png, new Uint8Array(2048).fill(9));
  await sleep(1200);
  check('повторная запись не даёт второй обработки', accepted.length === 1, accepted);

  // посторонний файл и скрытый файл
  await tjs.writeFile(joinPath(dir, 'заметки.txt'), new Uint8Array([1]));
  await tjs.writeFile(joinPath(dir, '.скрытый.png'), new Uint8Array([1]));
  await sleep(1200);
  check('txt и скрытый PNG не принимаются', accepted.length === 1, accepted);

  // второй валидный файл
  await tjs.writeFile(joinPath(dir, 'второй.PNG'), new Uint8Array(4096).fill(3));
  await sleep(1500);
  check('второй валидный файл принят', accepted.length === 2, accepted);
  check('приняты именно PNG-файлы', accepted.every((p) => /\.png$/i.test(p)), accepted);

  watcher.stop();
  await sleep(200);
  console.log('  … watcher остановлен');
}

// ───────────────────────── запуск ─────────────────────────

console.log('Проверки бэкенда ShotMark (рантайм txiki.js, версия ' + tjs.version + ')');
testFilters();
testBase64();

const base = await testConfig();
await testWatcher(base);

console.log(`\nИтог: успешно ${passed}, провалено ${failed}`);
if (failed > 0) process.exit(1);

// Отладочный сервер: отдаёт фронтенд как обычную страницу и отвечает теми же
// данными, что нативный бэкенд. Нужен, чтобы редактор можно было гонять в
// браузере (руками и в Playwright) — в приложении HTTP нет вообще.
//
//     node tests/dev-server.mjs            # http://127.0.0.1:8090
//     SHOT_FOLDER=~/Documents node tests/dev-server.mjs
//
// Это только для отладки и тестов; в приложении используется src/main.js.

import { createServer } from 'node:http';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { readdirSync, statSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const HERE = fileURLToPath(new URL('..', import.meta.url));
const FRONTEND = join(HERE, 'src', 'frontend');
const PORT = Number(process.env.PORT || 8090);
const SHOT_FOLDER = (process.env.SHOT_FOLDER || join(HERE, 'tests')).replace(/^~/, homedir());

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const SUPPORTED = ['.png', '.jpg', '.jpeg'];

function listShots() {
  try {
    return readdirSync(SHOT_FOLDER)
      .filter((n) => !n.startsWith('.') && SUPPORTED.includes(extname(n).toLowerCase()))
      .map((n) => {
        const st = statSync(join(SHOT_FOLDER, n));
        return { name: n, size: st.size, mtime: st.mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);
  } catch {
    return [];
  }
}

const json = (res, code, body) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
};

const readBody = (req) =>
  new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch { resolve({}); } });
  });

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const path = decodeURIComponent(url.pathname);

  // ── данные, аналог tiny.api ──
  if (path === '/api/state') {
    const shots = listShots();
    return json(res, 200, {
      folder: SHOT_FOLDER,
      folderError: null,
      launchAtLogin: 'unsupported',
      lastShot: null,
      shots,
    });
  }

  if (path === '/api/shot') {
    const name = url.searchParams.get('name') || '';
    if (!name || name.includes('/')) return json(res, 400, { error: 'bad name' });
    try {
      const bytes = await readFile(join(SHOT_FOLDER, name));
      return json(res, 200, { name, path: join(SHOT_FOLDER, name), dataBase64: bytes.toString('base64'), bytes: bytes.length });
    } catch {
      return json(res, 404, { error: 'not found' });
    }
  }

  if (path === '/api/folder' && req.method === 'POST') {
    const body = await readBody(req);
    try {
      const st = statSync(String(body.path));
      if (!st.isDirectory()) return json(res, 200, { ok: false, error: 'не папка: ' + body.path });
      return json(res, 200, { ok: true, folder: body.path, error: null });
    } catch {
      return json(res, 200, { ok: false, error: 'папка не существует: ' + body.path });
    }
  }

  if (path === '/api/save' && req.method === 'POST') {
    const body = await readBody(req);
    const dest = String(body.path || join(homedir(), 'shotmark-dev-save.png'));
    try {
      await writeFile(dest, Buffer.from(String(body.dataBase64 || ''), 'base64'));
      return json(res, 200, { path: dest });
    } catch (e) {
      return json(res, 500, { error: e.message });
    }
  }

  // ── картинка из папки наблюдения ──
  if (path.startsWith('/file/')) {
    const name = path.slice('/file/'.length);
    if (name.includes('/')) return json(res, 400, { error: 'bad name' });
    try {
      const buf = await readFile(join(SHOT_FOLDER, name));
      res.writeHead(200, { 'Content-Type': MIME[extname(name).toLowerCase()] || 'application/octet-stream' });
      return res.end(buf);
    } catch {
      res.writeHead(404); return res.end('not found');
    }
  }

  // ── статика фронтенда ──
  const rel = path === '/' ? 'index.html' : normalize(path).replace(/^(\.\.[/\\])+/, '');
  try {
    const buf = await readFile(join(FRONTEND, rel));
    res.writeHead(200, { 'Content-Type': MIME[extname(rel).toLowerCase()] || 'application/octet-stream' });
    return res.end(buf);
  } catch {
    res.writeHead(404); return res.end('not found');
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`ShotMark dev-сервер: http://127.0.0.1:${PORT}/  (папка с картинками: ${SHOT_FOLDER})`);
});

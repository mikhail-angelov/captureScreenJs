// Development-only HTTP server for the editor and Playwright tests.
// PORT=8091 npm run dev-server; SHOT_FOLDER selects the screenshot directory.

import { createServer } from 'node:http';
import { readFile, lstat, realpath, writeFile } from 'node:fs/promises';
import { readdirSync, lstatSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { isSafeName } from '../src/config.js';
import { isValidFile } from '../src/watcher.js';

const HERE = fileURLToPath(new URL('..', import.meta.url));
const FRONTEND = join(HERE, 'src', 'frontend');
const PORT = Number(process.env.PORT || 8090);
let SHOT_FOLDER = (process.env.SHOT_FOLDER || join(HERE, 'tests')).replace(/^~/, homedir());

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
        const st = lstatSync(join(SHOT_FOLDER, n));
        return st.isFile() ? { name: n, size: st.size, mtime: st.mtimeMs } : null;
      })
      .filter(Boolean)
      .sort((a, b) => b.mtime - a.mtime);
  } catch {
    return [];
  }
}

async function screenshotPath(name) {
  if (!isSafeName(name) || !isValidFile(name)) throw new Error('bad name');
  const path = join(SHOT_FOLDER, name);
  if (!(await lstat(path)).isFile()) throw new Error('not a regular file');
  return path;
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

  // ── data endpoints corresponding to tiny.api ──
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
    if (!isSafeName(name) || !isValidFile(name)) return json(res, 400, { error: 'bad name' });
    try {
      const bytes = await readFile(await screenshotPath(name));
      return json(res, 200, { name, path: join(SHOT_FOLDER, name), dataBase64: bytes.toString('base64'), bytes: bytes.length });
    } catch {
      return json(res, 404, { error: 'not found' });
    }
  }

  if (path === '/api/folder' && req.method === 'POST') {
    const body = await readBody(req);
    try {
      const path = resolve(String(body.path).replace(/^~/, homedir()));
      const st = await lstat(path);
      if (!st.isDirectory()) return json(res, 200, { ok: false, error: 'not a directory: ' + body.path });
      SHOT_FOLDER = await realpath(path);
      return json(res, 200, { ok: true, folder: SHOT_FOLDER, error: null });
    } catch {
      return json(res, 200, { ok: false, error: 'folder does not exist: ' + body.path });
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

  // ── image from the watch folder ──
  if (path.startsWith('/file/')) {
    const name = path.slice('/file/'.length);
    if (!isSafeName(name) || !isValidFile(name)) return json(res, 400, { error: 'bad name' });
    try {
      const buf = await readFile(await screenshotPath(name));
      res.writeHead(200, { 'Content-Type': MIME[extname(name).toLowerCase()] || 'application/octet-stream' });
      return res.end(buf);
    } catch {
      res.writeHead(404); return res.end('not found');
    }
  }

  // ── frontend static assets ──
  const target = path === '/' ? join(FRONTEND, 'index.html') : resolve(FRONTEND, '.' + path);
  if (!target.startsWith(FRONTEND + '/')) return json(res, 400, { error: 'bad path' });
  try {
    const buf = await readFile(target);
    res.writeHead(200, { 'Content-Type': MIME[extname(target).toLowerCase()] || 'application/octet-stream' });
    return res.end(buf);
  } catch {
    res.writeHead(404); return res.end('not found');
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`ShotMark development server: http://127.0.0.1:${PORT}/  (screenshot folder: ${SHOT_FOLDER})`);
});

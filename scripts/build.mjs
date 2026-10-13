import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ensureTinyjs, run } from './tinyjs.mjs';

const sdk = await ensureTinyjs();
const editor = resolve('build/editor');
rmSync(editor, { recursive: true, force: true });
mkdirSync(editor, { recursive: true });
cpSync('src', editor + '/src', { recursive: true });
const config = JSON.parse(readFileSync('tinyjs.json', 'utf8'));
writeFileSync(editor + '/tinyjs.json', JSON.stringify({
  ...config,
  name: 'shotmark-editor', title: 'ShotMark Editor',
  id: config.id + '.editor', backend: 'src/main.js',
  mainWindow: true, activation: 'regular', urlScheme: 'shotmark-editor',
}, null, 2));
run(sdk + '/tinyjs', ['build'], { cwd: editor });
run(sdk + '/tinyjs', ['build']);

const bundle = 'dist/ShotMark.app';
const resources = bundle + '/Contents/Resources';
cpSync(editor + '/dist/ShotMark Editor.app', resources + '/ShotMark Editor.app', { recursive: true });
// The agent has no frontend. Only its separate editor contains page assets.
rmSync(resources + '/app/frontend', { recursive: true, force: true });
run('codesign', ['--force', '--deep', '--sign', '-', bundle]);
run('codesign', ['--verify', '--strict', '--deep', bundle]);
for (const path of ['dist/shotmark', 'dist/launcher', 'dist/frontend']) rmSync(path, { recursive: true, force: true });
console.log('Ready: dist/ShotMark.app — windowless tray agent with a separate editor.');

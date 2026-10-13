import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { run } from './tinyjs.mjs';

if (process.platform !== 'darwin') throw new Error('Packaging requires macOS');
const arch = { arm64: 'arm64', x64: 'x86_64' }[process.arch];
if (!arch) throw new Error('Unsupported architecture: ' + process.arch);
const { version } = JSON.parse(readFileSync('tinyjs.json', 'utf8'));
const name = `ShotMark-${version}-macos-${arch}.zip`;
const output = resolve('release');
mkdirSync(output, { recursive: true });
const archive = resolve(output, name);
rmSync(archive, { force: true });
// ditto preserves executable permissions, symlinks, and nested app resources.
run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', 'dist/ShotMark.app', archive]);
const hash = createHash('sha256').update(readFileSync(archive)).digest('hex');
writeFileSync(archive + '.sha256', `${hash}  ${name}\n`);
console.log(`Ready: release/${name} and its SHA256 checksum`);

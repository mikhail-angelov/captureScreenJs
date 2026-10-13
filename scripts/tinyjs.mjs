import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`);
}

export async function ensureTinyjs() {
  if (process.platform !== 'darwin') throw new Error('ShotMark currently supports macOS only');
  const version = JSON.parse(readFileSync('tinyjs.json', 'utf8')).minTinyjsVersion;
  const sdk = resolve('.vendor/tinyjs');
  if (existsSync(sdk + '/VERSION') && readFileSync(sdk + '/VERSION', 'utf8').trim() === 'v' + version) return sdk;
  const arch = { arm64: 'arm64', x64: 'x86_64' }[process.arch];
  if (!arch) throw new Error('Unsupported architecture: ' + process.arch);
  const name = `tinyjs-macos-${arch}.tar.gz`;
  const base = `https://github.com/tarwin/tinyjsapp/releases/download/v${version}/`;
  async function download(name) {
    const response = await fetch(base + name, { signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw new Error(`Download ${name}: HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }
  console.log(`Downloading Tiny.js ${version} (${arch})`);
  const [archive, checksums] = await Promise.all([download(name), download('checksums.txt')]);
  const expected = checksums.toString().split('\n').find((line) => line.trim().endsWith(name))?.split(/\s+/)[0];
  if (!expected || createHash('sha256').update(archive).digest('hex') !== expected) throw new Error('Tiny.js archive checksum mismatch');
  const temp = resolve('.vendor/download-' + process.pid);
  mkdirSync(temp, { recursive: true });
  try {
    writeFileSync(temp + '/sdk.tar.gz', archive);
    run('tar', ['-xzf', temp + '/sdk.tar.gz', '-C', temp]);
    rmSync(sdk, { recursive: true, force: true });
    renameSync(temp + '/tinyjs', sdk);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
  return sdk;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const sdk = await ensureTinyjs();
  const args = process.argv.slice(2);
  const tjs = args[0] === '--tjs';
  if (tjs) args.shift();
  run(sdk + (tjs ? '/bin/tjs' : '/tinyjs'), args);
}

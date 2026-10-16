import { readFile, mkdir, mkdtemp, copyFile, access, writeFile } from 'node:fs/promises';
import { resolve, dirname, join, sep, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const sourceRoot = join(root, 'skills', 'weekend-rush');
const { version } = JSON.parse(await readFile(join(sourceRoot, 'package.json'), 'utf8'));
if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version)) throw new Error('Invalid version');
const dist = join(root, 'dist');
const archive = join(dist, `weekend-rush-skill-v${version}.zip`);
const files = [
  'SKILL.md', 'package.json', 'package-lock.json', 'LICENSE', 'THIRD_PARTY_NOTICES.md',
  'agents/openai.yaml', 'references/mcp-setup.md', 'references/intent-to-itinerary.md',
  'references/data-contract.md', 'scripts/trip-utils.mjs', 'scripts/render-trip.mjs',
  'scripts/query-tools.mjs', 'scripts/mcp-gateway.mjs', 'scripts/live-service.mjs',
  'scripts/information-ports.mjs', 'assets/check-install.json',
];
for (const path of [archive]) {
  const exists = await access(path).then(() => true, () => false);
  if (exists) throw new Error(`Release output already exists; inspect it before rebuilding: ${path}`);
}
for (const relative of files) await access(join(sourceRoot, relative));
await mkdir(dist, { recursive: true });
const stage = join(await mkdtemp(join(dist, '.skill-staging-')), 'weekend-rush');
for (const relative of files) {
  const target = resolve(stage, relative);
  if (!target.startsWith(stage + sep)) throw new Error('Invalid release path');
  await mkdir(dirname(target), { recursive: true });
  await copyFile(join(sourceRoot, relative), target);
}
if (process.platform === 'win32') {
  const quote = value => `'${value.replaceAll("'", "''")}'`;
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    `Compress-Archive -LiteralPath ${quote(stage)} -DestinationPath ${quote(archive)} -CompressionLevel Optimal`],
  { windowsHide: true, stdio: 'pipe' });
} else {
  execFileSync('zip', ['-qr', archive, 'weekend-rush'], { cwd: dirname(stage), stdio: 'pipe' });
}
const sha256 = createHash('sha256').update(await readFile(archive)).digest('hex');
await writeFile(join(dist, 'SHA256SUMS.txt'), `${sha256}  ${basename(archive)}\n`, 'utf8');
console.log(JSON.stringify({ version, files: files.length, archive, sha256 }, null, 2));

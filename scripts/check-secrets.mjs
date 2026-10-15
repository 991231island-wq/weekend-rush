import { readFile, readdir } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const textExtensions = new Set(['.json', '.md', '.js', '.mjs', '.html', '.css', '.yaml', '.yml', '.toml', '.txt']);
const findings = [];
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if (textExtensions.has(extname(entry.name).toLowerCase())) {
      const content = await readFile(path, 'utf8');
      if (/AMAP_MAPS_API_KEY\s*[:=]\s*["']?[a-f0-9]{32}\b/i.test(content) || /[?&]key=[a-f0-9]{32}\b/i.test(content)) findings.push(path.slice(root.length));
    }
  }
}
await walk(root);
if (findings.length) {
  console.error(`Potential hard-coded map key in: ${findings.join(', ')}`);
  process.exitCode = 1;
} else console.log('No hard-coded 32-character map keys found.');

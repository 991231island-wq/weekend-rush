import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const envFile = resolve(process.cwd(), '.env');
try {
  const source = await readFile(envFile, 'utf8');
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || Object.hasOwn(process.env, match[1])) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, '');
    process.env[match[1]] = value;
  }
} catch (error) { if (error.code !== 'ENOENT') throw error; }

const { startLiveServer } = await import('./serve-live.mjs');
startLiveServer();

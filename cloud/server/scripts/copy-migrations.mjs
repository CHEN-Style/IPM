import { cpSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const src = path.join(root, 'src', 'infra', 'db', 'migrations');
const dest = path.join(root, 'dist', 'infra', 'db', 'migrations');

if (!existsSync(src)) {
  console.warn('[copy-migrations] No migrations source directory at', src);
  process.exit(0);
}

mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
console.log(`[copy-migrations] ${src} -> ${dest}`);

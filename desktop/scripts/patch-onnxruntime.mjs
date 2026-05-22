/**
 * patch-onnxruntime.mjs — Shim onnxruntime-node to re-export onnxruntime-web
 *
 * onnxruntime-node ships pre-compiled native .node binaries that link against
 * node.dll. Electron doesn't expose node.dll (it uses electron.exe), and
 * onnxruntime-node isn't built with node-gyp so electron-rebuild can't fix it.
 * The result is "A dynamic link library (DLL) initialization routine failed."
 *
 * Both packages share the same public API (InferenceSession, Tensor, env, etc.)
 * via onnxruntime-common. onnxruntime-web uses a WASM backend that works in
 * both browser and Node.js environments — perfect for Electron's main process.
 *
 * This script replaces onnxruntime-node's CJS entry point with a thin shim
 * that re-exports everything from onnxruntime-web. ppu-paddle-ocr's static
 * `import * as ort from "onnxruntime-node"` then transparently gets the
 * WASM-backed implementation.
 *
 * Run automatically via `postinstall` in package.json.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nodeModules = path.resolve(__dirname, '..', 'node_modules');

const ortNodeDir = path.join(nodeModules, 'onnxruntime-node');
const ortWebDir = path.join(nodeModules, 'onnxruntime-web');

if (!fs.existsSync(ortNodeDir)) {
  console.log('[patch-onnxruntime] onnxruntime-node not installed, skipping.');
  process.exit(0);
}
if (!fs.existsSync(ortWebDir)) {
  console.log('[patch-onnxruntime] onnxruntime-web not installed, skipping.');
  process.exit(0);
}

// --- Patch 1: CJS entry point (dist/index.js) ---
const shimCJS = `"use strict";
// PATCHED: re-export onnxruntime-web instead of loading native .node binary.
// See scripts/patch-onnxruntime.mjs for rationale.
const ortWeb = require("onnxruntime-web");
module.exports = ortWeb;
`;

const indexPath = path.join(ortNodeDir, 'dist', 'index.js');
const backupPath = indexPath + '.orig';

if (!fs.existsSync(backupPath) && fs.existsSync(indexPath)) {
  fs.copyFileSync(indexPath, backupPath);
}

fs.writeFileSync(indexPath, shimCJS, 'utf8');

// --- Patch 2: ESM entry point (dist/index.mjs) ---
// When ppu-paddle-ocr does `import * as ort from "onnxruntime-node"`, Node's
// ESM resolver checks the package.json "exports" field first. We add an ESM
// entry that properly re-exports named exports from onnxruntime-web so that
// `ort.InferenceSession`, `ort.Tensor`, `ort.env` etc. are directly available.
const shimESM = `// PATCHED: ESM re-export of onnxruntime-web.
// See scripts/patch-onnxruntime.mjs for rationale.
export { default, InferenceSession, Tensor, env, registerBackend, TRACE, TRACE_FUNC_BEGIN, TRACE_FUNC_END, TRACE_EVENT_BEGIN, TRACE_EVENT_END } from "onnxruntime-web";
`;

const esmPath = path.join(ortNodeDir, 'dist', 'index.mjs');
fs.writeFileSync(esmPath, shimESM, 'utf8');

// --- Patch 3: Update package.json to add ESM exports map ---
const pkgPath = path.join(ortNodeDir, 'package.json');
const pkgBackup = pkgPath + '.orig';
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

if (!fs.existsSync(pkgBackup)) {
  fs.copyFileSync(pkgPath, pkgBackup);
}

pkg.exports = {
  '.': {
    'import': './dist/index.mjs',
    'require': './dist/index.js',
    'default': './dist/index.js',
  },
};
pkg.type = undefined; // keep CJS for .js files

fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');

console.log('[patch-onnxruntime] onnxruntime-node shimmed → onnxruntime-web (CJS + ESM)');

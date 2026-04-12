import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_TIMEOUT_MS = 300_000;
const MAX_OUTPUT_BYTES = 1024 * 1024; // 1 MB per stream

const DANGEROUS_PATTERNS = [
  /rm\s+-rf\s+\//i,
  /sudo\s+rm/i,
  /shutdown/i,
  /mkfs/i,
  /diskutil\s+erase/i,
];

const log = (msg) => console.log(`[IPM][ScriptExecutor] ${msg}`);

/**
 * Resolve the Python binary path.
 * Prefers embedded runtime if present, falls back to system python.
 */
export function resolvePythonBin(sandboxRoot) {
  const embedded = path.join(sandboxRoot, 'runtime', 'python', 'bin', 'python3');
  if (fs.existsSync(embedded)) return embedded;

  return 'python3';
}

/**
 * Validate that a script path is within allowed boundaries.
 */
export function validateScriptPath(scriptPath, sandboxRoot) {
  const resolved = path.resolve(scriptPath);
  const sandboxAbs = path.resolve(sandboxRoot);
  if (!resolved.startsWith(sandboxAbs)) {
    throw new Error(`Script path "${scriptPath}" is outside the sandbox boundary`);
  }
  return resolved;
}

/**
 * Write inline code to a temp file in workspace/ and return its path.
 */
export function writeTempScript(sandboxRoot, code, ext = '.py') {
  const wsDir = path.join(sandboxRoot, 'workspace');
  fs.mkdirSync(wsDir, { recursive: true });
  const fileName = `temp_${randomUUID().slice(0, 8)}${ext}`;
  const filePath = path.join(wsDir, fileName);
  fs.writeFileSync(filePath, code, 'utf-8');
  return filePath;
}

/**
 * Scan script content for dangerous patterns.
 * Returns array of matched warning strings (empty = safe).
 */
export function scanForDangerousCommands(code) {
  const warnings = [];
  for (const pat of DANGEROUS_PATTERNS) {
    if (pat.test(code)) {
      warnings.push(`Potentially dangerous pattern detected: ${pat.source}`);
    }
  }
  return warnings;
}

/**
 * Execute a script file with safety constraints.
 *
 * @param {Object} opts
 * @param {string} opts.scriptPath     - absolute path to the script file
 * @param {string[]} [opts.args]       - CLI arguments
 * @param {string} opts.sandboxRoot    - sandbox root for cwd resolution
 * @param {number} [opts.timeout]      - timeout in ms (default 60s, max 300s)
 * @param {Object} [opts.extraEnv]     - extra env vars to pass
 * @returns {Promise<{exitCode: number|null, stdout: string, stderr: string, durationMs: number, truncated: boolean, killed: boolean}>}
 */
export function executeScript({ scriptPath, args = [], sandboxRoot, timeout, extraEnv = {} }) {
  const timeoutMs = Math.min(Math.max(Number(timeout) || DEFAULT_TIMEOUT_MS, 1000), MAX_TIMEOUT_MS);
  const cwd = path.join(sandboxRoot, 'workspace');
  fs.mkdirSync(cwd, { recursive: true });

  const pythonBin = resolvePythonBin(sandboxRoot);

  const env = {
    PATH: process.env.PATH || '',
    PYTHONPATH: process.env.PYTHONPATH || '',
    PYTHONIOENCODING: 'utf-8',
    HOME: process.env.HOME || '',
    TMPDIR: path.join(sandboxRoot, 'workspace'),
    ...extraEnv,
  };

  return new Promise((resolve) => {
    const startTime = Date.now();
    let stdoutBuf = '';
    let stderrBuf = '';
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let killed = false;

    const child = spawn(pythonBin, [scriptPath, ...args], {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      if (stdoutTruncated) return;
      const str = chunk.toString('utf-8');
      if (stdoutBuf.length + str.length > MAX_OUTPUT_BYTES) {
        stdoutBuf += str.slice(0, MAX_OUTPUT_BYTES - stdoutBuf.length);
        stdoutTruncated = true;
      } else {
        stdoutBuf += str;
      }
    });

    child.stderr.on('data', (chunk) => {
      if (stderrTruncated) return;
      const str = chunk.toString('utf-8');
      if (stderrBuf.length + str.length > MAX_OUTPUT_BYTES) {
        stderrBuf += str.slice(0, MAX_OUTPUT_BYTES - stderrBuf.length);
        stderrTruncated = true;
      } else {
        stderrBuf += str;
      }
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      const durationMs = Date.now() - startTime;
      const result = {
        exitCode: code,
        stdout: stdoutBuf,
        stderr: stderrBuf,
        durationMs,
        truncated: stdoutTruncated || stderrTruncated,
        killed,
      };

      appendExecLog(sandboxRoot, scriptPath, result);
      resolve(result);
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      const durationMs = Date.now() - startTime;
      const result = {
        exitCode: null,
        stdout: stdoutBuf,
        stderr: `Process error: ${err.message}`,
        durationMs,
        truncated: false,
        killed: false,
      };
      appendExecLog(sandboxRoot, scriptPath, result);
      resolve(result);
    });
  });
}

/**
 * Clean up temp files in workspace/.
 */
export function cleanWorkspace(sandboxRoot) {
  const wsDir = path.join(sandboxRoot, 'workspace');
  if (!fs.existsSync(wsDir)) return 0;
  const files = fs.readdirSync(wsDir);
  let removed = 0;
  for (const f of files) {
    if (f.startsWith('temp_')) {
      try {
        fs.unlinkSync(path.join(wsDir, f));
        removed++;
      } catch { /* ignore */ }
    }
  }
  return removed;
}

function appendExecLog(sandboxRoot, scriptPath, result) {
  try {
    const logPath = path.join(sandboxRoot, 'exec.log');
    const entry = JSON.stringify({
      ts: new Date().toISOString(),
      script: path.basename(scriptPath),
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      killed: result.killed,
      truncated: result.truncated,
      stderrPreview: (result.stderr || '').slice(0, 200),
    }) + '\n';
    fs.appendFileSync(logPath, entry, 'utf-8');
  } catch (e) {
    log(`Failed to write exec.log: ${e.message}`);
  }
}

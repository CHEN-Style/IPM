// desktop/Agent/pi-runtime/tools/envTools.js
//
// U3: environment-probing customTools.
//
// Exposes a single tool — `check_environment` — that lets the model
// quickly verify which interpreters / package managers / specific
// packages are available in the *current* user environment WITHOUT
// invoking the bash tool (which would trip the install guard for any
// follow-up `pip install` decision the model wants to make).
//
// Why a separate tool instead of letting the model just `bash --version`?
//
// 1. Recursion: if the model used the `bash` tool to probe `pip --version`
//    and then `pip install`, both would go through pi's bash tool and
//    our beforeToolCall guard. The guard wouldn't intercept `pip
//    --version` (correctly), but the streamed bash output, terminal
//    flicker, and confirm-dialog UX all assume "bash means doing
//    something". A dedicated probe tool is faster and quieter.
//
// 2. Determinism: `execSync` with a short timeout and a stable JSON
//    payload means the model gets a structured result it can
//    machine-read, instead of having to parse arbitrary stdout for each
//    interpreter's `--version` quirks.
//
// 3. Encouragement: with a tool whose description literally says "use
//    me before pip install / npm install", the prompt + tool registry
//    nudges the model into the "check, then install" pattern, which
//    cuts the rate of redundant install attempts.

import { Type } from 'typebox';
import { execSync } from 'node:child_process';
import { defineTool } from '@earendil-works/pi-coding-agent';

// ---- low-level probes ----------------------------------------------------

/**
 * Run a short command synchronously and return its stdout. Catches *all*
 * errors and returns `null` on failure. We intentionally swallow stderr
 * for the model-facing payload — the version probes are noisy on missing
 * binaries (a missing binary emits a "command not found" stderr line),
 * and the structured `available: false` flag is the signal the model
 * actually needs.
 *
 * `timeout` is hardcoded short on purpose: this is a probe, not a heavy
 * subprocess. If a probe hangs we'd rather report "unknown" than block
 * the agent turn for seconds.
 *
 * @param {string} cmd
 * @returns {string | null}
 */
function runCapture(cmd) {
  try {
    const out = execSync(cmd, {
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 4_000,
      shell: true, // we pass plain `binary --version` style strings
      encoding: 'utf-8',
    });
    return String(out || '').trim();
  } catch {
    return null;
  }
}

/**
 * Probe a CLI binary by running `<bin> <versionArg>` and returning
 * `{ available, version, raw }`. `available` is true iff the command
 * exited 0 AND produced non-empty stdout — this rules out the case
 * where a missing binary still spawns a shell with empty output.
 *
 * @param {string} bin
 * @param {string} [versionArg='--version']
 * @returns {{ available: boolean, version: string | null, raw: string | null }}
 */
function probeBinary(bin, versionArg = '--version') {
  const out = runCapture(`${bin} ${versionArg}`);
  if (!out) return { available: false, version: null, raw: null };
  // Extract the first dotted version string from the output so the
  // model gets a clean field instead of e.g. "Python 3.12.4". Falls
  // back to the trimmed first line if no pattern matches.
  const versionRx = /(\d+\.\d+(?:\.\d+)?(?:[.\-+][\w\d]+)*)/;
  const match = out.match(versionRx);
  const firstLine = out.split(/\r?\n/)[0]?.trim() || null;
  return {
    available: true,
    version: match ? match[1] : firstLine,
    raw: firstLine,
  };
}

/**
 * Probe a Python package via `python3 -c "import x; print(x.__version__)"`.
 * Tries `python3` first, falls back to `python` (macOS ships `python3`;
 * some environments only expose `python`).
 *
 * @param {string} pkg
 * @returns {{ installed: boolean, version: string | null }}
 */
function probePythonPackage(pkg) {
  // Validate the package name so the shell substitution can't be
  // exploited. PyPI names are [A-Za-z0-9._-]; reject anything else.
  if (!/^[A-Za-z0-9._-]+$/.test(pkg)) {
    return { installed: false, version: null };
  }
  const code = `import importlib,sys
try:
  m=importlib.import_module('${pkg}')
  print(getattr(m,'__version__','?'))
except Exception:
  sys.exit(1)
`;
  // Pass via -c with the code flattened onto one line. We wrap in double
  // quotes (accepted by every POSIX shell) and escape any embedded
  // double quotes. (The code above has none, so this is a no-op today.)
  const escaped = code.replace(/"/g, '\\"').replace(/\r?\n/g, '; ');
  for (const bin of ['python3', 'python']) {
    const out = runCapture(`${bin} -c "${escaped}"`);
    if (out !== null) return { installed: true, version: out || null };
  }
  return { installed: false, version: null };
}

/**
 * Probe a Node.js package by checking `node --print "require.resolve(...)"`.
 * Walks up from the agent's cwd; npm/pnpm/yarn workspaces all share the
 * `node_modules` discovery rules so a successful resolve is the
 * authoritative answer.
 *
 * @param {string} pkg
 * @returns {{ installed: boolean, version: string | null }}
 */
function probeNodePackage(pkg) {
  if (!/^(?:@[A-Za-z0-9._\-]+\/)?[A-Za-z0-9._\-]+$/.test(pkg)) {
    return { installed: false, version: null };
  }
  // Resolve relative to the *agent's* cwd so we check the workspace's
  // own node_modules, not pi-runtime's. `process.cwd()` reflects the
  // cwd the IPC layer set on the AgentSession.
  const cwd = process.cwd();
  const code = `try{const p=require.resolve('${pkg}/package.json',{paths:[${JSON.stringify(cwd)}]});const v=require(p).version;process.stdout.write(v||'');}catch(_){process.exit(1)}`;
  // Keep the snippet on one line so shell quoting stays simple.
  const out = runCapture(`node -e "${code.replace(/"/g, '\\"')}"`);
  if (out === null) return { installed: false, version: null };
  return { installed: true, version: out || null };
}

// ---- tool definition ------------------------------------------------------

/**
 * Build the env-probing customTools array.
 *
 * @returns {Array<object>} pi `ToolDefinition[]` ready to merge into customTools.
 */
export function buildEnvTools() {
  const tool = defineTool({
    name: 'check_environment',
    label: '检查环境与依赖',
    description:
      '探测当前环境中常用解释器（python / node）、包管理器（pip / npm / pnpm / yarn）以及可选 Python / Node 包是否已安装。在调用 pip install / npm install 之前先用本工具确认依赖状态，避免重复安装与不必要的用户确认弹窗。',
    promptSnippet:
      'check_environment: probe whether python/node/pip/npm/bash and a list of named packages are available before issuing install commands.',
    promptGuidelines: [
      '在执行 `pip install ...` / `npm install ...` 之前，先用 check_environment 确认依赖是否已就绪——若 packages 字段返回 `installed: true`，无需再次安装。',
      'check_environment 仅做只读探测，永远不会修改用户环境，可安全地多次调用。',
    ],
    parameters: Type.Object({
      packages: Type.Optional(
        Type.Array(
          Type.Object({
            manager: Type.Union([Type.Literal('pip'), Type.Literal('npm')], {
              description: '该包属于哪个生态：pip 表示 Python 包，npm 表示 Node 包。',
            }),
            name: Type.String({
              minLength: 1,
              description: '包名（pip: 顶层 import 名；npm: package.json 中的 name）。',
            }),
          }),
          {
            description: '可选——按需检查的具体包列表。留空时只返回解释器/包管理器是否可用。',
          },
        ),
      ),
    }),
    async execute(_toolCallId, params /* , signal */) {
      const requested = Array.isArray(params?.packages) ? params.packages : [];

      const result = {
        platform: process.platform,
        cwd: process.cwd(),
        interpreters: {
          python: probeBinary('python3', '--version').available
            ? probeBinary('python3', '--version')
            : probeBinary('python', '--version'),
          node: probeBinary('node', '--version'),
        },
        managers: {
          pip: probeBinary('pip3', '--version').available
            ? probeBinary('pip3', '--version')
            : probeBinary('pip', '--version'),
          npm: probeBinary('npm', '--version'),
          pnpm: probeBinary('pnpm', '--version'),
          yarn: probeBinary('yarn', '--version'),
          bash: probeBinary('bash', '--version'),
        },
        packages: {},
      };

      for (const entry of requested) {
        if (!entry || typeof entry !== 'object') continue;
        const manager = String(entry.manager || '').toLowerCase();
        const name = String(entry.name || '').trim();
        if (!name) continue;
        const key = `${manager}:${name}`;
        if (manager === 'pip') {
          result.packages[key] = probePythonPackage(name);
        } else if (manager === 'npm') {
          result.packages[key] = probeNodePackage(name);
        } else {
          result.packages[key] = {
            installed: false,
            version: null,
            error: `unknown manager: ${manager}`,
          };
        }
      }

      const text = JSON.stringify(result, null, 2);
      return {
        content: [{ type: 'text', text }],
        details: result,
      };
    },
  });

  return [tool];
}

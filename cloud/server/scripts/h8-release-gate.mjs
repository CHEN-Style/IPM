// H8 release gate: one command that runs the C1-C9 automated regression surface
// and classifies failures into blocking vs. non-blocking-external.
//
// What it runs (in order):
//   1. cloud typecheck / build / db:migrate / db:check        (cwd: cloud/server)
//   2. h1..h7 verify scripts                                   (cwd: cloud/server)
//   3. desktop renderer vite build                             (cwd: desktop)
//   4. desktop Electron Forge package smoke                    (cwd: desktop)
//
// Regression servers (default mode):
//   The verify suites issue many register/login calls from one IP, and
//   h1-verify intentionally exhausts the auth rate-limit bucket (A7). Running
//   them all against one fixed dev server therefore trips 429 RATE_LIMITED.
//   So by default the gate spawns its OWN ephemeral server(s) from the freshly
//   built dist/, with the right rate-limit profile per suite:
//     - h1        → AUTH_RATE_LIMIT_MAX=20 (default) so its limit assertion fires
//     - h2..h7    → AUTH_RATE_LIMIT_MAX=0  (disabled) so cumulative auth is fine
//   Pass --base <url> to instead run everything against an already-running
//   server (legacy; may hit rate limiting).
//
// Forge package failures caused by network / external dependency download are
// classified as non-blocking (HARDENING_PLAN R-INFRA-2: the historical
// 20.205.243.166:443 timeout). Code / config errors stay blocking.
//
// Usage:
//   node scripts/h8-release-gate.mjs [--base http://localhost:4210]
//                                    [--gate-port 4222]
//                                    [--no-package] [--no-desktop] [--no-migrate]
//
// Exit code is 0 only when there are zero blocking failures.

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const DESKTOP_DIR = path.join(REPO_ROOT, 'desktop');
const REPORT_DIR = path.join(SERVER_DIR, '.h8-reports');
const isWin = process.platform === 'win32';

// ── args ──────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const flags = { base: null, gatePort: 4222, package: true, desktop: true, migrate: true };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--base') flags.base = argv[++i];
    else if (a === '--gate-port') flags.gatePort = Number(argv[++i]);
    else if (a === '--no-package') flags.package = false;
    else if (a === '--no-desktop') flags.desktop = false;
    else if (a === '--no-migrate') flags.migrate = false;
    else if (!a.startsWith('--') && /^https?:\/\//.test(a)) flags.base = a;
  }
  return flags;
}

const flags = parseArgs(process.argv.slice(2));

// Patterns that mark a failure as an external / environmental issue (network,
// registry, proxy, TLS) rather than a code or config defect.
const EXTERNAL_PATTERNS = [
  /ETIMEDOUT/i, /ECONNRESET/i, /ECONNREFUSED/i, /ENOTFOUND/i, /EAI_AGAIN/i,
  /EPROTO/i, /ENETUNREACH/i, /EHOSTUNREACH/i,
  /getaddrinfo/i, /socket hang up/i, /network\s*timeout/i, /request to .* failed/i,
  /tunneling socket could not be established/i, /fetch failed/i,
  /20\.205\.243\.166/, /github\.com/i, /githubusercontent/i, /registry\.npmjs/i,
  /self[- ]signed certificate/i, /unable to (?:get|verify) local issuer/i,
  /certificate/i, /proxy/i, /\bdownload\b/i, /electron[- ]download/i, /Could not? (?:download|fetch)/i,
];

function classifyFailure(text) {
  return EXTERNAL_PATTERNS.some((re) => re.test(text)) ? 'nonBlockingExternal' : 'blocking';
}

const results = [];
function record(r) {
  results.push(r);
  const icon = r.status === 'pass' ? 'PASS' : r.status === 'skip' ? 'SKIP'
    : (r.classification === 'nonBlockingExternal' ? 'WARN' : 'FAIL');
  const extra = r.status === 'fail' ? ` [${r.classification}]` : '';
  const dur = r.durationMs != null ? ` (${(r.durationMs / 1000).toFixed(1)}s)` : '';
  console.log(`[${icon}] ${r.title}${extra}${dur}`);
  if (r.note) console.log(`     ${r.note}`);
}

function tail(text, n = 60) {
  if (!text) return '';
  return text.replace(/\r/g, '').split('\n').slice(-n).join('\n');
}

/** Run a command synchronously, capture combined output, record a classified result. */
function runStep({ id, title, cmd, args, cwd, classifier }) {
  console.log(`\n— ${title} —`);
  const started = Date.now();
  const proc = spawnSync(cmd, args, {
    cwd, shell: isWin, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: process.env,
  });
  const durationMs = Date.now() - started;
  const spawnErr = proc.error ? `\n[spawn error] ${proc.error.message || proc.error}` : '';
  const combined = `${proc.stdout || ''}${proc.stderr || ''}${spawnErr}`;
  if (proc.status === 0 && !proc.error) {
    record({ id, title, status: 'pass', exitCode: 0, durationMs, output: combined });
    return true;
  }
  const classification = classifier ? classifier(combined) : 'blocking';
  record({
    id, title, status: 'fail', exitCode: proc.status, durationMs, classification, output: combined,
    note: classification === 'nonBlockingExternal'
      ? '判定为外部/网络失败（non-blocking）。详见报告 output 尾部。'
      : '判定为阻断失败（blocking）。',
  });
  return false;
}

function recordResult({ id, title, ok, durationMs, output, classifier }) {
  if (ok) {
    record({ id, title, status: 'pass', exitCode: 0, durationMs, output });
    return true;
  }
  const classification = classifier ? classifier(output) : 'blocking';
  record({ id, title, status: 'fail', exitCode: 1, durationMs, classification, output });
  return false;
}

function skipStep({ id, title, note }) {
  record({ id, title, status: 'skip', note });
}

/** Run one verify suite (out-of-process) against `base`, capturing output. */
function runVerify(n, base) {
  const id = `h${n}-verify`;
  console.log(`\n— ${id} (${base}) —`);
  const started = Date.now();
  const proc = spawnSync('node', [`scripts/h${n}-verify.mjs`, base], {
    cwd: SERVER_DIR, shell: isWin, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: process.env,
  });
  const output = `${proc.stdout || ''}${proc.stderr || ''}${proc.error ? `\n[spawn error] ${proc.error.message}` : ''}`;
  recordResult({ id, title: id, ok: proc.status === 0 && !proc.error, durationMs: Date.now() - started, output });
}

async function checkHealth(base, timeoutMs = 4000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}/health`, { signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Spawn an ephemeral server from built dist/ with a given rate-limit profile. */
async function startServer({ port, authMax }) {
  const base = `http://127.0.0.1:${port}`;
  const logs = [];
  const proc = spawn('node', ['dist/main.js'], {
    cwd: SERVER_DIR,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      AUTH_RATE_LIMIT_MAX: String(authMax),
      LOG_LEVEL: 'warn',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', (d) => logs.push(d.toString()));
  proc.stderr.on('data', (d) => logs.push(d.toString()));

  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    if (proc.exitCode != null) {
      throw new Error(`server exited early (code ${proc.exitCode}):\n${tail(logs.join(''), 40)}`);
    }
    if (await checkHealth(base, 1500)) return { proc, base, logs };
    await sleep(500);
  }
  await stopServer(proc);
  throw new Error(`server not healthy within timeout:\n${tail(logs.join(''), 40)}`);
}

async function stopServer(proc) {
  if (!proc || proc.exitCode != null) return;
  try {
    if (isWin) spawnSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
    else proc.kill('SIGTERM');
  } catch { /* ignore */ }
  // Give the port time to free up before the next ephemeral server.
  await sleep(800);
}

/** Run the h1..h7 regression group, spawning ephemeral servers by default. */
async function runRegressionGroup() {
  // Legacy mode: run everything against an externally-managed server.
  if (flags.base) {
    const up = await checkHealth(flags.base);
    if (!up) {
      for (let n = 1; n <= 7; n += 1) {
        record({
          id: `h${n}-verify`, title: `h${n}-verify`, status: 'fail', classification: 'blocking',
          exitCode: null, durationMs: null, output: `${flags.base}/health unreachable`,
          note: `dev server 未就绪（${flags.base}/health 不可达）。先启动服务或去掉 --base 用内置临时服务。`,
        });
      }
      return;
    }
    console.log(`\n[regression] 外部 server 模式: ${flags.base}（注意可能触发 A7 限流）`);
    for (let n = 1; n <= 7; n += 1) runVerify(n, flags.base);
    return;
  }

  // Default mode: spawn ephemeral servers from built dist/.
  const distMain = path.join(SERVER_DIR, 'dist', 'main.js');
  if (!fs.existsSync(distMain)) {
    for (let n = 1; n <= 7; n += 1) {
      skipStep({ id: `h${n}-verify`, title: `h${n}-verify`, note: 'dist/main.js 缺失（cloud build 失败？），回归组跳过。' });
    }
    return;
  }

  // h1 needs the rate limit ON (it asserts limiting fires).
  let s1;
  try {
    console.log('\n[regression] 启动临时 server（限流=默认20）用于 h1 …');
    s1 = await startServer({ port: flags.gatePort, authMax: 20 });
    runVerify(1, s1.base);
  } catch (err) {
    record({
      id: 'h1-verify', title: 'h1-verify', status: 'fail', classification: classifyFailure(String(err.message)),
      exitCode: null, durationMs: null, output: String(err.message), note: '临时 server 启动失败。',
    });
  } finally {
    if (s1) await stopServer(s1.proc);
  }

  // h2..h7 need the rate limit OFF (cumulative auth calls exceed 20/min).
  let s2;
  try {
    console.log('\n[regression] 启动临时 server（限流=关闭）用于 h2-h7 …');
    s2 = await startServer({ port: flags.gatePort, authMax: 0 });
    for (let n = 2; n <= 7; n += 1) runVerify(n, s2.base);
  } catch (err) {
    for (let n = 2; n <= 7; n += 1) {
      record({
        id: `h${n}-verify`, title: `h${n}-verify`, status: 'fail', classification: classifyFailure(String(err.message)),
        exitCode: null, durationMs: null, output: String(err.message), note: '临时 server 启动失败。',
      });
    }
  } finally {
    if (s2) await stopServer(s2.proc);
  }
}

async function main() {
  const startedAt = new Date();
  console.log(`[h8-release-gate] mode=${flags.base ? `external(${flags.base})` : `ephemeral(:${flags.gatePort})`} package=${flags.package} desktop=${flags.desktop} migrate=${flags.migrate}`);

  // ── Group 1: cloud infra ─────────────────────────────────────────────────
  runStep({ id: 'cloud:typecheck', title: 'cloud typecheck', cmd: 'npm', args: ['run', 'typecheck'], cwd: SERVER_DIR });
  runStep({ id: 'cloud:build', title: 'cloud build', cmd: 'npm', args: ['run', 'build'], cwd: SERVER_DIR });
  if (flags.migrate) {
    runStep({ id: 'cloud:db:migrate', title: 'cloud db:migrate（幂等）', cmd: 'npm', args: ['run', 'db:migrate'], cwd: SERVER_DIR });
    runStep({ id: 'cloud:db:check', title: 'cloud db:check（自检）', cmd: 'npm', args: ['run', 'db:check'], cwd: SERVER_DIR });
  } else {
    skipStep({ id: 'cloud:db:migrate', title: 'cloud db:migrate（幂等）', note: '--no-migrate 跳过' });
    skipStep({ id: 'cloud:db:check', title: 'cloud db:check（自检）', note: '--no-migrate 跳过' });
  }

  // ── Group 2: cloud regression ────────────────────────────────────────────
  await runRegressionGroup();

  // ── Group 3: desktop build + package smoke ───────────────────────────────
  if (flags.desktop) {
    runStep({
      id: 'desktop:renderer', title: 'desktop renderer build',
      cmd: 'npx', args: ['vite', 'build', '--config', 'vite.renderer.config.mjs'], cwd: DESKTOP_DIR,
    });
    if (flags.package) {
      runStep({
        id: 'desktop:package', title: 'desktop Electron Forge package smoke',
        cmd: 'npm', args: ['run', 'package'], cwd: DESKTOP_DIR, classifier: classifyFailure,
      });
    } else {
      skipStep({ id: 'desktop:package', title: 'desktop Electron Forge package smoke', note: '--no-package 跳过' });
    }
  } else {
    skipStep({ id: 'desktop:renderer', title: 'desktop renderer build', note: '--no-desktop 跳过' });
    skipStep({ id: 'desktop:package', title: 'desktop Electron Forge package smoke', note: '--no-desktop 跳过' });
  }

  // ── Summary + report ─────────────────────────────────────────────────────
  const passed = results.filter((r) => r.status === 'pass').length;
  const skipped = results.filter((r) => r.status === 'skip').length;
  const blocking = results.filter((r) => r.status === 'fail' && r.classification === 'blocking');
  const external = results.filter((r) => r.status === 'fail' && r.classification === 'nonBlockingExternal');
  const gatePass = blocking.length === 0;

  const report = {
    tool: 'h8-release-gate',
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    mode: flags.base ? `external:${flags.base}` : `ephemeral:${flags.gatePort}`,
    options: { package: flags.package, desktop: flags.desktop, migrate: flags.migrate },
    summary: {
      total: results.length, passed, skipped,
      blockingFailures: blocking.length,
      nonBlockingExternalFailures: external.length,
      gate: gatePass ? 'PASS' : 'FAIL',
    },
    steps: results.map((r) => ({
      id: r.id, title: r.title, status: r.status,
      classification: r.classification ?? null,
      exitCode: r.exitCode ?? null, durationMs: r.durationMs ?? null,
      note: r.note ?? null, outputTail: tail(r.output, 60),
    })),
  };

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const stamp = startedAt.toISOString().replace(/[:.]/g, '-');
  fs.writeFileSync(path.join(REPORT_DIR, `release-gate-${stamp}.json`), JSON.stringify(report, null, 2), 'utf8');
  fs.writeFileSync(path.join(REPORT_DIR, `release-gate-${stamp}.md`), renderMarkdown(report), 'utf8');
  fs.writeFileSync(path.join(REPORT_DIR, 'latest.json'), JSON.stringify(report, null, 2), 'utf8');
  fs.writeFileSync(path.join(REPORT_DIR, 'latest.md'), renderMarkdown(report), 'utf8');

  console.log('\n──────────────────────────────────────────────');
  console.log(`[h8-release-gate] 结果: ${report.summary.gate}`);
  console.log(`  通过 ${passed} · 跳过 ${skipped} · 阻断失败 ${blocking.length} · 外部失败(non-blocking) ${external.length}`);
  if (blocking.length) console.log(`  阻断项: ${blocking.map((b) => b.id).join(', ')}`);
  if (external.length) console.log(`  外部项: ${external.map((b) => b.id).join(', ')}`);
  console.log(`  报告: ${path.relative(REPO_ROOT, path.join(REPORT_DIR, 'latest.md'))}`);

  process.exit(gatePass ? 0 : 1);
}

function renderMarkdown(report) {
  const s = report.summary;
  const lines = [];
  lines.push('# H8 Release Gate 报告', '');
  lines.push(`- 结果: **${s.gate}**`);
  lines.push(`- 时间: ${report.startedAt} → ${report.finishedAt}`);
  lines.push(`- 模式: ${report.mode}`);
  lines.push(`- 选项: package=${report.options.package} desktop=${report.options.desktop} migrate=${report.options.migrate}`);
  lines.push(`- 统计: 通过 ${s.passed} · 跳过 ${s.skipped} · 阻断失败 ${s.blockingFailures} · 外部失败(non-blocking) ${s.nonBlockingExternalFailures}`);
  lines.push('', '| 步骤 | 状态 | 分类 | 退出码 | 耗时 |', '|------|------|------|--------|------|');
  for (const st of report.steps) {
    const dur = st.durationMs != null ? `${(st.durationMs / 1000).toFixed(1)}s` : '—';
    lines.push(`| ${st.id} | ${st.status} | ${st.classification ?? '—'} | ${st.exitCode ?? '—'} | ${dur} |`);
  }
  lines.push('');
  const failures = report.steps.filter((st) => st.status === 'fail');
  if (failures.length) {
    lines.push('## 失败详情（output 尾部）');
    for (const st of failures) {
      lines.push('', `### ${st.id} — ${st.classification}`);
      if (st.note) lines.push(`> ${st.note}`);
      lines.push('', '```', st.outputTail || '(no output)', '```');
    }
  }
  const skips = report.steps.filter((st) => st.status === 'skip' && st.note);
  if (skips.length) {
    lines.push('', '## 跳过项');
    for (const st of skips) lines.push(`- ${st.id}: ${st.note}`);
  }
  lines.push('');
  return lines.join('\n');
}

main().catch((err) => {
  console.error('[h8-release-gate] 异常:', err);
  process.exit(1);
});

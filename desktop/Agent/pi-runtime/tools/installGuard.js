// desktop/Agent/pi-runtime/tools/installGuard.js
//
// U3: detectInstallCommand — classifies a bash command string into one of
//
//   null                       → not an install command, let pi run it
//   { kind: 'install', ... }   → pip/npm/pnpm/yarn/poetry install detected,
//                                renderer must confirm before pi proceeds
//   { kind: 'block', reason }  → system-level installer (sudo / apt / brew /
//                                choco / dnf / yum / winget / scoop) —
//                                IPM never runs these for the user; we tell
//                                the model to surface the command and ask
//                                the user to run it manually with the right
//                                privileges
//
// Design notes
// ============
//
// * The parser is intentionally lightweight. It splits on `&&`, `||` and
//   `;` at the top level (string/backtick aware enough to not bleed into
//   `python -c "&& foo"`) and inspects each segment with a small set of
//   regexes. Any segment that matches an install pattern triggers the
//   confirm flow for the whole compound command — we do NOT try to extract
//   "just the install bit" because the user agreed to the segment they
//   saw, not a rewritten version.
//
// * We deliberately err toward confirming. A false positive (asking the
//   user about a non-install) is a 200ms speed bump; a false negative (a
//   silent `pip install` slipping through) defeats the whole point. The
//   regex bank below covers all common Python/Node managers plus a few
//   common synonyms (`pip3`, `python -m pip`, `npm i`, `pnpm i`, `npx pnpm
//   add`, `yarn`, `poetry add`).
//
// * The "block" list covers package managers that operate on the user's
//   *system* — they need sudo, alter shared state outside the workspace,
//   and the surface area for going wrong is huge. We never let the agent
//   drive them; instead the model receives a reason explaining that the
//   user should run the command manually in a terminal with appropriate
//   permissions.
//
// * No imports from pi or the Electron main bundle — this module is
//   loaded both from `bootstrap.js` (ESM Node) and (potentially) from
//   `knowclaw.js` (Vite-bundled CJS) via the dynamic-import lazy load
//   trick. Keeping it dependency-free guarantees both call sites can
//   require/import it without further tooling.

// ---- pattern tables -------------------------------------------------------

const INSTALL_MATCHERS = [
  {
    manager: 'pip',
    // `pip install`, `pip3 install`, `python -m pip install`,
    // `python3 -m pip install`, optionally with --user / -U / etc.
    rx: /\b(?:pip3?|python3?\s+-m\s+pip)\s+install\b/i,
  },
  {
    manager: 'poetry',
    rx: /\bpoetry\s+(?:add|install)\b/i,
  },
  {
    manager: 'pipx',
    rx: /\bpipx\s+install\b/i,
  },
  {
    manager: 'conda',
    // `conda install`, `mamba install`, `micromamba install`. These
    // mutate a conda env; rare in IPM workflows but worth gating.
    rx: /\b(?:conda|mamba|micromamba)\s+install\b/i,
  },
  {
    manager: 'npm',
    // npm install / npm i / npm add (npm 7+ alias). Excludes `npm
    // install-test` etc. by requiring whitespace/end after the verb.
    rx: /\bnpm\s+(?:install|i|add)(?:\s|$)/i,
  },
  {
    manager: 'pnpm',
    rx: /\bpnpm\s+(?:install|i|add)(?:\s|$)/i,
  },
  {
    manager: 'pnpm',
    // `npx --yes pnpm install ...` — what U2a's web-artifacts scripts use.
    rx: /\bnpx\s+(?:--yes\s+|-y\s+)?pnpm\s+(?:install|i|add)(?:\s|$)/i,
  },
  {
    manager: 'yarn',
    rx: /\byarn\s+(?:add|install)(?:\s|$)/i,
  },
  {
    manager: 'bun',
    rx: /\bbun\s+(?:add|install|i)(?:\s|$)/i,
  },
];

const BLOCK_MATCHERS = [
  {
    rx: /\bsudo\b/i,
    label: 'sudo',
    advice: '该命令需要管理员权限，请由用户在终端中以 sudo 手动执行。',
  },
  {
    rx: /\bapt(?:-get)?\s+install\b/i,
    label: 'apt',
    advice: 'APT 系统级安装请在终端运行：sudo apt install <packages>',
  },
  {
    rx: /\bdnf\s+install\b/i,
    label: 'dnf',
    advice: 'DNF 系统级安装请在终端运行：sudo dnf install <packages>',
  },
  {
    rx: /\byum\s+install\b/i,
    label: 'yum',
    advice: 'YUM 系统级安装请在终端运行：sudo yum install <packages>',
  },
  {
    rx: /\bpacman\s+-S\b/i,
    label: 'pacman',
    advice: 'pacman 系统级安装请在终端运行：sudo pacman -S <packages>',
  },
  {
    rx: /\bbrew\s+(?:install|reinstall|upgrade)\b/i,
    label: 'brew',
    advice: 'Homebrew 系统级安装请在终端运行：brew install <packages>',
  },
  {
    rx: /\bchoco\s+install\b/i,
    label: 'choco',
    advice: 'Chocolatey 系统级安装请在终端运行：choco install <packages>（需管理员 PowerShell）',
  },
  {
    rx: /\bwinget\s+install\b/i,
    label: 'winget',
    advice: 'winget 系统级安装请在终端运行：winget install <packages>',
  },
  {
    rx: /\bscoop\s+install\b/i,
    label: 'scoop',
    advice: 'Scoop 安装请在终端运行：scoop install <packages>',
  },
];

// ---- segment splitter -----------------------------------------------------

/**
 * Strip the contents of all quoted regions (single, double, backtick)
 * inside a string, replacing each pair with empty quotes. This is the
 * key defense against false positives like `python -c "apt install in
 * a string"` — once the inner text is gone, our install/block regexes
 * can no longer match arbitrary user-string content.
 *
 * The outer quote characters are preserved so token boundaries are
 * unchanged (a missing space between binary and arg would still parse
 * as a single token). Backslash-escapes are honoured.
 *
 * @param {string} input
 * @returns {string}
 */
function stripQuotedRegions(input) {
  let out = '';
  let quote = null;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    const prev = input[i - 1];
    if (quote) {
      if (c === quote && prev !== '\\') {
        out += quote; // close
        quote = null;
      }
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      out += c; // open
      continue;
    }
    out += c;
  }
  return out;
}

/**
 * Split a shell command on top-level `&&`, `||`, `;`. Quoted regions and
 * backticks are treated as opaque so e.g. `python -c "a && b"` stays a
 * single segment. Not a full bash parser — sufficient for the cases we
 * actually see from the model (mostly `cmd && cmd && cmd`).
 *
 * @param {string} command
 * @returns {string[]}
 */
function splitTopLevel(command) {
  const out = [];
  let cur = '';
  let quote = null; // '"' | "'" | '`' | null
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    const prev = command[i - 1];
    if (quote) {
      cur += c;
      if (c === quote && prev !== '\\') quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      cur += c;
      continue;
    }
    if ((c === '&' && command[i + 1] === '&') || (c === '|' && command[i + 1] === '|')) {
      out.push(cur);
      cur = '';
      i++;
      continue;
    }
    if (c === ';') {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  if (cur.trim()) out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

// ---- per-segment classifier ----------------------------------------------

/**
 * Try to extract a best-effort list of package names from an install
 * segment. This is purely informational — the renderer uses it to render
 * a friendly list in the confirm dialog. We always fall back to "see full
 * command" if extraction is ambiguous (e.g. `-r requirements.txt`,
 * `--editable .`).
 *
 * @param {string} segment
 * @param {string} manager
 * @returns {string[]}
 */
function extractPackages(segment, manager) {
  // Strip the manager+verb prefix. We rebuild the prefix per-manager so
  // the same extractor doesn't need to know about every flag variant.
  let rest = segment;
  switch (manager) {
    case 'pip':
      rest = rest.replace(/^.*?\b(?:pip3?|python3?\s+-m\s+pip)\s+install\b/i, '');
      break;
    case 'pipx':
      rest = rest.replace(/^.*?\bpipx\s+install\b/i, '');
      break;
    case 'poetry':
      rest = rest.replace(/^.*?\bpoetry\s+(?:add|install)\b/i, '');
      break;
    case 'conda':
      rest = rest.replace(/^.*?\b(?:conda|mamba|micromamba)\s+install\b/i, '');
      break;
    case 'npm':
      rest = rest.replace(/^.*?\bnpm\s+(?:install|i|add)\b/i, '');
      break;
    case 'pnpm':
      rest = rest.replace(/^.*?(?:npx\s+(?:--yes\s+|-y\s+)?)?pnpm\s+(?:install|i|add)\b/i, '');
      break;
    case 'yarn':
      rest = rest.replace(/^.*?\byarn\s+(?:add|install)\b/i, '');
      break;
    case 'bun':
      rest = rest.replace(/^.*?\bbun\s+(?:add|install|i)\b/i, '');
      break;
    default:
      return [];
  }
  // Split on whitespace, drop flags & version specifiers, return up to 8
  // names so the dialog stays readable even on `pip install a b c d ...`.
  const tokens = rest
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
  const names = [];
  for (const t of tokens) {
    if (t.startsWith('-')) continue;          // skip --user / -U / -r etc.
    if (t.startsWith('@') && !t.includes('/')) continue; // bare `@latest` etc
    // file/URL targets — show as-is, capped
    if (t === '.' || t === './' || t.endsWith('.tar.gz') || t.endsWith('.whl')) {
      names.push(t);
      continue;
    }
    names.push(t);
    if (names.length >= 8) break;
  }
  return names;
}

/**
 * Match a single segment against the install table.
 * @param {string} segment
 * @returns {{ manager: string, packages: string[] } | null}
 */
function matchInstall(segment) {
  const probe = stripQuotedRegions(segment);
  for (const m of INSTALL_MATCHERS) {
    if (m.rx.test(probe)) {
      return { manager: m.manager, packages: extractPackages(segment, m.manager) };
    }
  }
  return null;
}

/**
 * Match a single segment against the block table.
 * @param {string} segment
 * @returns {{ label: string, advice: string } | null}
 */
function matchBlock(segment) {
  const probe = stripQuotedRegions(segment);
  for (const b of BLOCK_MATCHERS) {
    if (b.rx.test(probe)) {
      return { label: b.label, advice: b.advice };
    }
  }
  return null;
}

// ---- public API ----------------------------------------------------------

/**
 * Classify a bash command for the U3 install guard.
 *
 * @param {string} command
 * @returns {null
 *   | { kind: 'install', manager: string, packages: string[], segment: string }
 *   | { kind: 'block', reason: string, label: string }}
 */
export function detectInstallCommand(command) {
  if (typeof command !== 'string') return null;
  const trimmed = command.trim();
  if (!trimmed) return null;

  const segments = splitTopLevel(trimmed);
  if (segments.length === 0) return null;

  // First pass: any blocked segment shortcircuits the whole command.
  // Rationale: chained commands `pip install a && sudo apt install b`
  // should still block — we don't want to silently run the safe half
  // and then leave the agent confused why the second half "didn't take
  // effect".
  for (const seg of segments) {
    const blocked = matchBlock(seg);
    if (blocked) {
      return {
        kind: 'block',
        label: blocked.label,
        reason:
          `KnowClaw 不允许直接执行系统级安装命令（检测到 \`${blocked.label}\`）。\n` +
          `${blocked.advice}\n\n` +
          `请把这条命令交给用户去运行；安装完成后告知用户已就绪，再继续后续步骤。\n` +
          `原始命令：${trimmed}`,
      };
    }
  }

  // Second pass: confirm-class install commands.
  for (const seg of segments) {
    const match = matchInstall(seg);
    if (match) {
      return {
        kind: 'install',
        manager: match.manager,
        packages: match.packages,
        segment: seg,
      };
    }
  }
  return null;
}

// Exposed for unit tests / debugging only.
export const _internal = {
  splitTopLevel,
  matchInstall,
  matchBlock,
  extractPackages,
  stripQuotedRegions,
};

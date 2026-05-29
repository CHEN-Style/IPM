// desktop/src/main/ipc/skills.js
//
// SK0 — Skill 管理 IPC 层。
//
// 这套通道把"扫描 / 列举 / 启用禁用 / 导入 / 删除 / 外部源扫描"五件事统一暴露给
// renderer，状态持久化到 state.json 的 `knowclaw.skills` 字段下（与
// pinnedWorkspaces / subAgentEnabled 同层级）。
//
// 设计要点：
//   - 不维护持久化的 ResourceLoader 实例。`listSkills` 直接调用 pi SDK 的
//     `loadSkillsFromDir()` 扫描磁盘，因此磁盘上的任何变更都会立刻被下一次
//     `listSkills` 看到。
//   - 启用 / 禁用通过把 skill name 写入 `state.knowclaw.skills.disabled`
//     来实现，**不**触发 session 中途的 prompt 注入变化。renderer 在 toggle
//     之后调用 `knowclaw:newSession` 才能让新一轮对话看到变化（与
//     subAgentEnabled 开关同模式）。
//   - `importSkill` 把外部目录复制到 `KNOWCLAW_USER_SKILLS_ROOT` 下，并在
//     `importedSources` 中记录原始来源（用于 UI 显示"导入自 .claude/skills"）。
//
// 不在本模块里做的事：
//   - 不触发 `resourceLoader.reload()`（bootstrap.js 的 loader 是
//     per-session 局部变量，外部拿不到引用）。
//   - 不向当前活跃 session 注入或撤销 skill —— 那需要重建 session。
//   - 不解析 frontmatter 之外的 SKILL.md 内容（详情查看 UI 用
//     `getSkillContent` 拉全文自己渲染）。

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { dialog } from 'electron';

// `@earendil-works/pi-coding-agent` is ESM-only (its package.json exports
// map only declares an `"import"` condition). Vite compiles the Electron
// main process bundle to CJS, so a top-level `import { … } from '…'`
// would be transpiled to `require()` — which the CJS resolver rejects
// with ERR_PACKAGE_PATH_NOT_EXPORTED. We therefore lazy-load the two
// functions we need via dynamic `import()`, matching the same trick
// `knowclaw.js` uses to load `pi-runtime/index.js`.
let _piSdk = null;
async function getPiSdk() {
  if (_piSdk) return _piSdk;
  _piSdk = await import('@earendil-works/pi-coding-agent');
  return _piSdk;
}

const TAG = '[skills-ipc]';

/**
 * Normalise a filesystem path for case-insensitive comparison on Windows.
 * `loadSkillsFromDir` returns absolute paths via Node's `fs.realpath` /
 * `path.resolve` chain so we don't need to do anything fancy beyond
 * lower-casing on win32.
 */
function pathKey(p) {
  if (!p || typeof p !== 'string') return '';
  try {
    const resolved = path.resolve(p);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  } catch {
    return '';
  }
}

/**
 * Read `state.knowclaw.skills` from disk. Always returns a fully-shaped
 * object so callers don't have to defend against missing fields.
 */
function readSkillsState(readState) {
  if (typeof readState !== 'function') {
    return { disabled: [], importedSources: {} };
  }
  try {
    const state = readState() || {};
    const kc = state.knowclaw && typeof state.knowclaw === 'object' ? state.knowclaw : {};
    const sk = kc.skills && typeof kc.skills === 'object' ? kc.skills : {};
    const disabled = Array.isArray(sk.disabled)
      ? sk.disabled.filter((x) => typeof x === 'string')
      : [];
    const importedSources = sk.importedSources && typeof sk.importedSources === 'object'
      ? sk.importedSources
      : {};
    return { disabled, importedSources };
  } catch {
    return { disabled: [], importedSources: {} };
  }
}

/**
 * Mutate `state.knowclaw.skills` via a patcher function. The patcher
 * receives the current `{ disabled, importedSources }` and must return
 * the new shape (or any subset of fields to merge).
 */
function patchSkillsState(readState, writeState, patcher) {
  if (typeof readState !== 'function' || typeof writeState !== 'function') {
    return null;
  }
  try {
    const state = readState() || {};
    const kc = state.knowclaw && typeof state.knowclaw === 'object' ? { ...state.knowclaw } : {};
    const current = readSkillsState(readState);
    const next = patcher({
      disabled: [...current.disabled],
      importedSources: { ...current.importedSources },
    }) || {};
    kc.skills = {
      disabled: Array.isArray(next.disabled) ? next.disabled : current.disabled,
      importedSources: next.importedSources && typeof next.importedSources === 'object'
        ? next.importedSources
        : current.importedSources,
    };
    state.knowclaw = kc;
    writeState(state);
    return kc.skills;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`${TAG} patchSkillsState failed:`, err?.message || err);
    return null;
  }
}

/**
 * Resolve the built-in skills directory. Set by `bootstrap.js` via
 * `process.env.KNOWCLAW_SKILLS_DIR`. Returns null if missing (e.g. the
 * pi runtime was never bootstrapped in this process — defensive).
 */
function getBuiltinSkillsDir() {
  const v = process.env.KNOWCLAW_SKILLS_DIR;
  return v && typeof v === 'string' && v.trim() ? v.trim() : null;
}

/**
 * Resolve the user-authored skills directory. Set by `main.js` from
 * `app.getPath('userData')`.
 */
function getUserSkillsRoot() {
  const v = process.env.KNOWCLAW_USER_SKILLS_ROOT;
  return v && typeof v === 'string' && v.trim() ? v.trim() : null;
}

/**
 * SK4: derive the workspace-level skill directory from a renderer-
 * supplied cwd. Returns null when:
 *   - cwd is missing / not a string / empty (global mode, no workspace)
 *   - cwd cannot be resolved
 *
 * Existence of the `.knowclaw/skills/` directory is NOT checked here —
 * callers (scanSkillDir, isSafeSkillPath) handle the missing-dir case
 * naturally. Keeping this helper existence-agnostic means we can also
 * pass the path into `isSafeSkillPath` to validate not-yet-created
 * destinations (e.g. for future SK4+ workspace import flows).
 */
function resolveWorkspaceSkillDir(cwd) {
  if (!cwd || typeof cwd !== 'string') return null;
  const trimmed = cwd.trim();
  if (!trimmed) return null;
  try {
    return path.join(path.resolve(trimmed), '.knowclaw', 'skills');
  } catch {
    return null;
  }
}

/**
 * Classify which "bucket" a given skill belongs to based on where it
 * lives on disk and whether we have an import record for it.
 *
 * Order matters: a builtin skill could in theory share a name with an
 * imported one (the SDK's loader gives the first-discovered one to us
 * so the collision would be detected as a diagnostic, but the entry
 * returned IS the winner). We classify based on `filePath` first.
 *
 * SK4: workspace skills live under `<cwd>/.knowclaw/skills/`. We probe
 * that root BEFORE the `imported` / `user` checks so a skill physically
 * placed in the workspace tree is always reported as `workspace`,
 * regardless of whether a same-named entry exists in `importedSources`
 * (importedSources only records the user-root provenance).
 */
function classifySkillSource(
  { filePath, name },
  { builtinDir, userSkillsRoot, workspaceSkillRoot, importedSources },
) {
  const filePathKey = pathKey(filePath);
  const builtinKey = pathKey(builtinDir);
  const userKey = pathKey(userSkillsRoot);
  const wsKey = pathKey(workspaceSkillRoot);

  if (builtinKey && filePathKey.startsWith(builtinKey + path.sep.toLowerCase())) {
    return 'builtin';
  }
  // Some platforms / pi versions might emit POSIX separators even on
  // win32; check that boundary too just in case.
  if (builtinKey && filePathKey.startsWith(builtinKey + '/')) return 'builtin';

  if (wsKey && filePathKey.startsWith(wsKey + path.sep.toLowerCase())) return 'workspace';
  if (wsKey && filePathKey.startsWith(wsKey + '/')) return 'workspace';

  if (importedSources && Object.prototype.hasOwnProperty.call(importedSources, name)) {
    return 'imported';
  }

  if (userKey && filePathKey.startsWith(userKey + path.sep.toLowerCase())) return 'user';
  if (userKey && filePathKey.startsWith(userKey + '/')) return 'user';

  return 'user';
}

/**
 * Scan a single directory for skills. Returns
 * `{ skills: Skill[], diagnostics: ResourceDiagnostic[] }` or null when
 * the directory doesn't exist (callers can short-circuit).
 */
async function scanSkillDir(dir, sourceTag) {
  if (!dir) return null;
  try {
    if (!fs.existsSync(dir)) return null;
  } catch {
    return null;
  }
  try {
    const { loadSkillsFromDir } = await getPiSdk();
    return loadSkillsFromDir({ dir, source: sourceTag });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`${TAG} loadSkillsFromDir failed for ${dir}:`, err?.message || err);
    return { skills: [], diagnostics: [{ message: String(err?.message || err) }] };
  }
}

/**
 * Project an SDK `Skill` into the renderer-facing `SkillInfo` shape.
 * Adds `source` / `enabled` / `importedFrom` / `importedAt` fields.
 */
function toSkillInfo(skill, ctx) {
  const source = classifySkillSource(skill, ctx);
  const importedRecord = ctx.importedSources?.[skill.name] || null;
  return {
    name: skill.name,
    description: skill.description,
    filePath: skill.filePath,
    baseDir: skill.baseDir,
    source,
    enabled: !ctx.disabledSet.has(skill.name),
    disableModelInvocation: Boolean(skill.disableModelInvocation),
    importedFrom: importedRecord?.from || null,
    importedAt: importedRecord?.importedAt || null,
  };
}

/**
 * Validate that `filePath` lives inside one of the trusted skill roots
 * (builtin / user / a candidate external source). Returns true if safe
 * to read. Prevents directory-traversal attacks via crafted IPC payloads.
 */
function isSafeSkillPath(filePath, extraRoots = []) {
  if (!filePath || typeof filePath !== 'string') return false;
  const targetKey = pathKey(filePath);
  if (!targetKey) return false;
  const roots = [getBuiltinSkillsDir(), getUserSkillsRoot(), ...extraRoots]
    .filter(Boolean);
  for (const root of roots) {
    const rootKey = pathKey(root);
    if (!rootKey) continue;
    if (targetKey === rootKey) return true;
    if (targetKey.startsWith(rootKey + path.sep.toLowerCase())) return true;
    if (targetKey.startsWith(rootKey + '/')) return true;
  }
  return false;
}

/**
 * Validate a candidate skill name. Mirrors pi SDK's rules: lowercase
 * a-z / 0-9 / hyphen, <= 64 chars, must match the directory basename.
 */
function isValidSkillName(name) {
  return typeof name === 'string'
    && /^[a-z0-9][a-z0-9-]{0,63}$/.test(name);
}

/**
 * Enumerate external-tool skill root candidates. Each entry has
 * `{ provider, path }`; non-existent paths are caller-filtered later.
 */
function getExternalSkillRoots() {
  const home = os.homedir();
  if (!home) return [];
  return [
    { provider: 'claude', path: path.join(home, '.claude', 'skills') },
    { provider: 'cursor', path: path.join(home, '.cursor', 'skills-cursor') },
    { provider: 'cursor', path: path.join(home, '.cursor', 'skills') },
  ];
}

// ============================================================================
// IPC registration
// ============================================================================

export function registerSkillsIpc({ ipcMain, readState, writeState }) {
  if (!ipcMain) throw new Error('registerSkillsIpc: ipcMain is required');
  if (typeof readState !== 'function') {
    throw new Error('registerSkillsIpc: readState is required');
  }
  if (typeof writeState !== 'function') {
    // writeState is required for toggle/import/delete to persist anything.
    // Without it those handlers become no-ops, but list/getContent/scan
    // still work — we degrade gracefully rather than throwing.
    // eslint-disable-next-line no-console
    console.warn(`${TAG} writeState missing — skill state changes will not persist`);
  }

  // --------------------------------------------------------------------------
  // knowclaw:listSkills
  //
  // Returns every skill currently visible to the runtime, plus its
  // bucket (builtin / user / imported) and enabled state. UI uses this
  // as the source of truth for the manager panel.
  // --------------------------------------------------------------------------
  ipcMain.handle('knowclaw:listSkills', async (_evt, payload) => {
    try {
      const builtinDir = getBuiltinSkillsDir();
      const userSkillsRoot = getUserSkillsRoot();
      // SK4: when the renderer passes the active workspace cwd, scan its
      // `.knowclaw/skills/` directory as a third source. Global mode
      // (no cwd) leaves `workspaceSkillRoot` null and the scan returns
      // an empty result — same as if the directory just doesn't exist.
      const workspaceSkillRoot = resolveWorkspaceSkillDir(payload?.cwd);
      const { disabled, importedSources } = readSkillsState(readState);
      const disabledSet = new Set(disabled);

      const builtinResult = await scanSkillDir(builtinDir, 'builtin') || { skills: [], diagnostics: [] };
      const workspaceResult = await scanSkillDir(workspaceSkillRoot, 'workspace')
        || { skills: [], diagnostics: [] };
      const userResult = await scanSkillDir(userSkillsRoot, 'user') || { skills: [], diagnostics: [] };

      // Dedupe by name. Priority (first wins): builtin > workspace > user.
      // Rationale: builtins are shipped guarantees; workspace skills are
      // explicit project-scoped overrides that should take precedence
      // over a same-named global user skill (mirrors how dotfiles work
      // in most tools). pi SDK's `loadSkills` already does first-wins
      // when fed multiple paths, but we scan separately to label sources
      // so we have to apply the policy ourselves.
      const seen = new Set();
      const merged = [];
      for (const s of [...builtinResult.skills, ...workspaceResult.skills, ...userResult.skills]) {
        if (!s || seen.has(s.name)) continue;
        seen.add(s.name);
        merged.push(s);
      }

      const ctx = {
        builtinDir,
        userSkillsRoot,
        workspaceSkillRoot,
        importedSources,
        disabledSet,
      };
      const skills = merged.map((s) => toSkillInfo(s, ctx));
      const diagnostics = [
        ...builtinResult.diagnostics.map((d) => ({ source: 'builtin', ...d })),
        ...workspaceResult.diagnostics.map((d) => ({ source: 'workspace', ...d })),
        ...userResult.diagnostics.map((d) => ({ source: 'user', ...d })),
      ];

      return {
        ok: true,
        skills,
        diagnostics,
        roots: { builtin: builtinDir, user: userSkillsRoot, workspace: workspaceSkillRoot },
      };
    } catch (err) {
      return { ok: false, error: String(err?.message || err), skills: [], diagnostics: [] };
    }
  });

  // --------------------------------------------------------------------------
  // knowclaw:getSkillContent
  //
  // Reads SKILL.md raw + parses frontmatter for the detail modal.
  // Refuses to read anything outside the trusted skill roots.
  // --------------------------------------------------------------------------
  ipcMain.handle('knowclaw:getSkillContent', async (_evt, payload) => {
    const filePath = typeof payload?.filePath === 'string' ? payload.filePath : '';
    if (!filePath) return { ok: false, error: 'filePath is required' };

    // SK4: workspace skills live outside builtin/user roots, so the
    // safety check needs the active workspace's `.knowclaw/skills/`
    // path mixed into the trusted root set.
    const wsRoot = resolveWorkspaceSkillDir(payload?.cwd);
    if (!isSafeSkillPath(filePath, wsRoot ? [wsRoot] : [])) {
      return { ok: false, error: 'filePath is not within a trusted skill root' };
    }

    try {
      if (!fs.existsSync(filePath)) {
        return { ok: false, error: 'file does not exist' };
      }
      const content = fs.readFileSync(filePath, 'utf-8');
      let frontmatter = {};
      let body = content;
      try {
        const { parseFrontmatter } = await getPiSdk();
        const parsed = parseFrontmatter(content);
        frontmatter = parsed.frontmatter || {};
        body = parsed.body || '';
      } catch (err) {
        // Frontmatter parse failure is non-fatal — we still want to
        // show the raw file to the user.
        // eslint-disable-next-line no-console
        console.warn(`${TAG} parseFrontmatter failed:`, err?.message || err);
      }
      return { ok: true, content, body, frontmatter };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });

  // --------------------------------------------------------------------------
  // knowclaw:importSkill
  //
  // Copy an external skill directory into `KNOWCLAW_USER_SKILLS_ROOT`
  // and record the original source. Refuses to overwrite an existing
  // skill — UI must call deleteSkill first if the user picks "overwrite".
  // --------------------------------------------------------------------------
  ipcMain.handle('knowclaw:importSkill', async (_evt, payload) => {
    const srcDir = typeof payload?.srcDir === 'string' ? payload.srcDir : '';
    const overwrite = Boolean(payload?.overwrite);
    // SK2: optional rename. When the user picks "rename" in the conflict
    // UI, the renderer re-invokes this IPC with `newName`. We then
    // (1) use newName as the destination dir name and (2) rewrite the
    // copied SKILL.md frontmatter `name:` field so pi SDK sees the
    // new identity when it loads the skill.
    const newNameRaw = typeof payload?.newName === 'string' ? payload.newName.trim() : '';
    if (!srcDir) return { ok: false, error: 'srcDir is required' };

    const userSkillsRoot = getUserSkillsRoot();
    if (!userSkillsRoot) {
      return { ok: false, error: 'KNOWCLAW_USER_SKILLS_ROOT is not configured' };
    }

    try {
      if (!fs.existsSync(srcDir) || !fs.statSync(srcDir).isDirectory()) {
        return { ok: false, error: 'srcDir is not a directory' };
      }
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }

    const skillMd = path.join(srcDir, 'SKILL.md');
    if (!fs.existsSync(skillMd)) {
      return { ok: false, error: 'SKILL.md not found in srcDir' };
    }

    // Parse + validate frontmatter. We need the `name` to compute the
    // destination directory, and `description` to honour pi SDK's
    // hard requirement (skills missing description are silently dropped
    // at load time).
    let frontmatter;
    try {
      const { parseFrontmatter } = await getPiSdk();
      const raw = fs.readFileSync(skillMd, 'utf-8');
      frontmatter = parseFrontmatter(raw).frontmatter || {};
    } catch (err) {
      return { ok: false, error: `failed to parse SKILL.md: ${err?.message || err}` };
    }

    // pi SDK falls back to the parent dir name when `name` is missing,
    // so we do the same here for the import path computation.
    const fallbackName = path.basename(srcDir);
    const candidateName = typeof frontmatter.name === 'string' && frontmatter.name.trim()
      ? frontmatter.name.trim()
      : fallbackName;

    if (!isValidSkillName(candidateName)) {
      return {
        ok: false,
        error: `invalid skill name "${candidateName}" — must be lowercase a-z / 0-9 / hyphen, <= 64 chars`,
      };
    }

    // Decide the FINAL name we'll install under. When the renderer
    // passes `newName`, it takes precedence — provided it's valid and
    // distinct from the parsed candidate. We deliberately allow
    // `newName === candidateName` (treated as no-op rename) for UX
    // simplicity: the UI can blindly send whatever's in its text box.
    let finalName = candidateName;
    let renamed = false;
    if (newNameRaw) {
      if (!isValidSkillName(newNameRaw)) {
        return {
          ok: false,
          error: `invalid newName "${newNameRaw}" — must be lowercase a-z / 0-9 / hyphen, <= 64 chars`,
        };
      }
      if (newNameRaw !== candidateName) {
        finalName = newNameRaw;
        renamed = true;
      }
    }

    const description = typeof frontmatter.description === 'string'
      ? frontmatter.description.trim()
      : '';
    if (!description) {
      return { ok: false, error: 'SKILL.md frontmatter is missing required field: description' };
    }

    const destDir = path.join(userSkillsRoot, finalName);

    // Defensive: refuse to import a skill that already lives in the
    // builtin directory (we can't overwrite builtins anyway).
    const builtinDir = getBuiltinSkillsDir();
    if (builtinDir) {
      const builtinCandidate = path.join(builtinDir, finalName);
      if (fs.existsSync(builtinCandidate)) {
        return {
          ok: false,
          conflict: 'builtin',
          error: `a built-in skill named "${finalName}" already exists; pick a different name or contact KnowClaw to update the builtin`,
        };
      }
    }

    // Conflict path: existing user / imported skill with the same name.
    if (fs.existsSync(destDir)) {
      if (!overwrite) {
        const { importedSources } = readSkillsState(readState);
        return {
          ok: false,
          conflict: 'exists',
          existingSource: importedSources?.[finalName] ? 'imported' : 'user',
          conflictName: finalName,
          // Echo the original parsed name back so the UI can pre-fill
          // the rename input with the unmodified name.
          parsedName: candidateName,
          error: `a skill named "${finalName}" already exists in the user directory`,
        };
      }
      try {
        fs.rmSync(destDir, { recursive: true, force: true });
      } catch (err) {
        return { ok: false, error: `failed to remove existing skill: ${err?.message || err}` };
      }
    }

    try {
      fs.cpSync(srcDir, destDir, { recursive: true });
    } catch (err) {
      return { ok: false, error: `copy failed: ${err?.message || err}` };
    }

    // SK2: when the user renamed the skill, rewrite SKILL.md so pi SDK
    // loads the skill under the chosen name. We only patch the `name:`
    // line in the frontmatter block to minimize risk of corrupting
    // weird-but-valid YAML in the description. If the parse fails or
    // there's no `name:` line we synthesize one immediately after the
    // opening `---`.
    if (renamed) {
      const destSkillMd = path.join(destDir, 'SKILL.md');
      try {
        const original = fs.readFileSync(destSkillMd, 'utf-8');
        let patched;
        const nameLineRe = /^(name:\s*).+$/m;
        if (nameLineRe.test(original)) {
          patched = original.replace(nameLineRe, `$1${finalName}`);
        } else if (original.startsWith('---')) {
          // Insert a name line after the first `---` (top frontmatter
          // delimiter). The closing `---` is left untouched.
          patched = original.replace(/^---\s*\n/, `---\nname: ${finalName}\n`);
        } else {
          // Skill file with no frontmatter — wrap one in. pi SDK requires
          // both name and description; description must already exist for
          // us to have reached this point, so we recreate a minimal block.
          patched = `---\nname: ${finalName}\ndescription: ${description}\n---\n\n${original}`;
        }
        fs.writeFileSync(destSkillMd, patched, 'utf-8');
      } catch (err) {
        // Best-effort cleanup: leave the copied dir on disk so the user
        // can recover manually, but surface a clear error.
        return {
          ok: false,
          error: `copy succeeded but failed to rewrite SKILL.md name: ${err?.message || err}`,
        };
      }
    }

    // Record import provenance + lift any prior disabled-flag for this
    // name (re-importing a skill should make it active by default).
    patchSkillsState(readState, writeState, (current) => ({
      disabled: current.disabled.filter((n) => n !== finalName),
      importedSources: {
        ...current.importedSources,
        [finalName]: {
          from: srcDir,
          importedAt: new Date().toISOString(),
          ...(renamed ? { originalName: candidateName } : {}),
        },
      },
    }));

    return {
      ok: true,
      renamed,
      skill: {
        name: finalName,
        description,
        baseDir: destDir,
        filePath: path.join(destDir, 'SKILL.md'),
        source: 'imported',
        enabled: true,
      },
    };
  });

  // --------------------------------------------------------------------------
  // knowclaw:deleteSkill
  //
  // Remove a user / imported skill from disk. Refuses to touch builtin
  // skills.
  // --------------------------------------------------------------------------
  ipcMain.handle('knowclaw:deleteSkill', async (_evt, payload) => {
    const name = typeof payload?.name === 'string' ? payload.name.trim() : '';
    if (!name) return { ok: false, error: 'name is required' };
    if (!isValidSkillName(name)) return { ok: false, error: 'invalid skill name' };

    // SK4: deletion can target either the global user root OR the
    // active workspace's `.knowclaw/skills/`. Workspace candidate wins
    // when both copies happen to exist (matches listSkills priority),
    // unless the renderer pins the scope via `payload.scope`.
    const userSkillsRoot = getUserSkillsRoot();
    const wsRoot = resolveWorkspaceSkillDir(payload?.cwd);
    const explicitScope = typeof payload?.scope === 'string' ? payload.scope : '';

    const wsCandidate = wsRoot ? path.join(wsRoot, name) : null;
    const userCandidate = userSkillsRoot ? path.join(userSkillsRoot, name) : null;

    let targetDir = null;
    let targetScope = null;
    if (explicitScope === 'workspace' && wsCandidate) {
      targetDir = wsCandidate;
      targetScope = 'workspace';
    } else if (explicitScope === 'user' && userCandidate) {
      targetDir = userCandidate;
      targetScope = 'user';
    } else if (wsCandidate && fs.existsSync(wsCandidate)) {
      targetDir = wsCandidate;
      targetScope = 'workspace';
    } else if (userCandidate) {
      targetDir = userCandidate;
      targetScope = 'user';
    }

    if (!targetDir) {
      return { ok: false, error: 'no skill root configured (user / workspace both missing)' };
    }

    // Sanity: refuse paths that escaped the trusted roots somehow.
    if (!isSafeSkillPath(targetDir, wsRoot ? [wsRoot] : [])) {
      return { ok: false, error: 'target path is outside the trusted skill roots' };
    }

    // Also refuse if this name is currently provided by builtin
    // (the directory might exist in both but builtin wins — we'd be
    // deleting a "shadow" user copy, which is weird UX).
    const builtinDir = getBuiltinSkillsDir();
    if (builtinDir && fs.existsSync(path.join(builtinDir, name))) {
      return {
        ok: false,
        error: `"${name}" is a built-in skill and cannot be deleted`,
      };
    }

    // State cleanup: workspace skills never enter `importedSources`, so
    // we only drop the import record when deleting the user-root copy.
    // Disabled flag is always cleared so a future re-creation of the
    // same name starts enabled.
    const cleanupState = (alsoDropImported) => {
      patchSkillsState(readState, writeState, (current) => {
        const importedSources = { ...current.importedSources };
        if (alsoDropImported) delete importedSources[name];
        return {
          disabled: current.disabled.filter((n) => n !== name),
          importedSources,
        };
      });
    };

    if (!fs.existsSync(targetDir)) {
      cleanupState(targetScope === 'user');
      return { ok: true, alreadyMissing: true, scope: targetScope };
    }

    try {
      fs.rmSync(targetDir, { recursive: true, force: true });
    } catch (err) {
      return { ok: false, error: `failed to delete skill: ${err?.message || err}` };
    }

    cleanupState(targetScope === 'user');

    return { ok: true, scope: targetScope };
  });

  // --------------------------------------------------------------------------
  // knowclaw:toggleSkill
  //
  // Flip the `enabled` flag for a given skill. Backed by adding /
  // removing the name from `state.knowclaw.skills.disabled`. Does NOT
  // affect the currently active session — only future ones.
  // --------------------------------------------------------------------------
  ipcMain.handle('knowclaw:toggleSkill', async (_evt, payload) => {
    const name = typeof payload?.name === 'string' ? payload.name.trim() : '';
    const enabled = Boolean(payload?.enabled);
    if (!name) return { ok: false, error: 'name is required' };
    if (!isValidSkillName(name)) return { ok: false, error: 'invalid skill name' };

    const result = patchSkillsState(readState, writeState, (current) => {
      const set = new Set(current.disabled);
      if (enabled) set.delete(name);
      else set.add(name);
      return {
        disabled: [...set],
        importedSources: current.importedSources,
      };
    });

    if (!result && typeof writeState !== 'function') {
      return { ok: false, error: 'state persistence is not configured' };
    }

    return { ok: true, name, enabled, requiresNewSession: true };
  });

  // --------------------------------------------------------------------------
  // knowclaw:reloadSkills
  //
  // Re-scan all skill directories and return the fresh count. We don't
  // hold a long-lived ResourceLoader so "reload" is really just "re-list
  // and tell the renderer how many skills are visible now". The actual
  // prompt-injection refresh happens on the next session creation.
  // --------------------------------------------------------------------------
  ipcMain.handle('knowclaw:reloadSkills', async () => {
    try {
      const builtinDir = getBuiltinSkillsDir();
      const userSkillsRoot = getUserSkillsRoot();
      const builtinResult = await scanSkillDir(builtinDir, 'builtin') || { skills: [], diagnostics: [] };
      const userResult = await scanSkillDir(userSkillsRoot, 'user') || { skills: [], diagnostics: [] };
      const seen = new Set();
      let count = 0;
      for (const s of [...builtinResult.skills, ...userResult.skills]) {
        if (!s || seen.has(s.name)) continue;
        seen.add(s.name);
        count += 1;
      }
      return {
        ok: true,
        count,
        requiresNewSession: true,
      };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });

  // --------------------------------------------------------------------------
  // knowclaw:scanExternalSkills
  //
  // Look in well-known Claude Code / Cursor skill root paths and report
  // anything we find. Used by the import dialog's "From external tool"
  // tab to populate a multi-select list. Non-existent roots are
  // silently skipped.
  // --------------------------------------------------------------------------
  ipcMain.handle('knowclaw:scanExternalSkills', async () => {
    try {
      const roots = getExternalSkillRoots();
      const { importedSources } = readSkillsState(readState);
      const importedFromKey = new Map();
      for (const [name, record] of Object.entries(importedSources || {})) {
        if (record?.from && typeof record.from === 'string') {
          importedFromKey.set(pathKey(record.from), name);
        }
      }

      const sources = [];
      for (const root of roots) {
        if (!fs.existsSync(root.path)) continue;
        const result = await scanSkillDir(root.path, root.provider) || { skills: [], diagnostics: [] };
        const skills = result.skills.map((s) => ({
          name: s.name,
          description: s.description,
          filePath: s.filePath,
          baseDir: s.baseDir,
          disableModelInvocation: Boolean(s.disableModelInvocation),
          alreadyImported: importedFromKey.has(pathKey(s.baseDir)),
        }));
        sources.push({
          provider: root.provider,
          path: root.path,
          skills,
          diagnostics: result.diagnostics,
        });
      }
      return { ok: true, sources };
    } catch (err) {
      return { ok: false, error: String(err?.message || err), sources: [] };
    }
  });

  // --------------------------------------------------------------------------
  // knowclaw:chooseSkillDir
  //
  // SK2: open a native directory picker, validate that the chosen
  // folder contains a SKILL.md, then return a lightweight preview
  // (parsed name + description + shallow file listing) so the import
  // dialog can render a confirmation card without a follow-up IPC.
  //
  // We deliberately keep this distinct from `knowclaw:chooseDirectory`
  // (which is workspace-specific and side-effecting). This one is
  // strictly readonly — the renderer is responsible for the actual
  // import call.
  // --------------------------------------------------------------------------
  ipcMain.handle('knowclaw:chooseSkillDir', async () => {
    try {
      const result = await dialog.showOpenDialog({
        properties: ['openDirectory'],
        title: '选择包含 SKILL.md 的技能目录',
      });
      if (result.canceled || !Array.isArray(result.filePaths) || !result.filePaths[0]) {
        return { ok: false, canceled: true };
      }
      const dir = result.filePaths[0];

      try {
        if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
          return { ok: false, error: '所选路径不是有效的目录' };
        }
      } catch (err) {
        return { ok: false, error: String(err?.message || err) };
      }

      const skillMd = path.join(dir, 'SKILL.md');
      if (!fs.existsSync(skillMd)) {
        return {
          ok: false,
          error: '所选目录不包含 SKILL.md 文件。请选择一个符合 Agent Skills 规范的技能目录。',
        };
      }

      let frontmatter = {};
      try {
        const { parseFrontmatter } = await getPiSdk();
        const raw = fs.readFileSync(skillMd, 'utf-8');
        frontmatter = parseFrontmatter(raw).frontmatter || {};
      } catch (err) {
        return { ok: false, error: `SKILL.md 解析失败: ${err?.message || err}` };
      }

      const fallbackName = path.basename(dir);
      const name = typeof frontmatter.name === 'string' && frontmatter.name.trim()
        ? frontmatter.name.trim()
        : fallbackName;
      const description = typeof frontmatter.description === 'string'
        ? frontmatter.description.trim()
        : '';
      const disableModelInvocation = Boolean(frontmatter['disable-model-invocation']);

      // Shallow listing for the preview card. Hidden files (dot-files)
      // are filtered to keep the preview compact; subdirectory contents
      // are NOT recursively listed for the same reason.
      let files = [];
      try {
        files = fs.readdirSync(dir, { withFileTypes: true })
          .filter((e) => !e.name.startsWith('.'))
          .map((e) => ({ name: e.name, isDir: e.isDirectory() }));
      } catch (err) {
        // Non-fatal — we can still import without the preview listing.
        // eslint-disable-next-line no-console
        console.warn(`${TAG} readdir failed for ${dir}:`, err?.message || err);
      }

      // Surface name-validity status so the UI can warn the user before
      // they hit "import" (the actual importSkill call will still
      // re-validate). When the name is invalid we still return ok=true
      // so the user sees the preview + can rename via the conflict UI.
      const nameValid = isValidSkillName(name);

      return {
        ok: true,
        dir,
        name,
        nameValid,
        description,
        disableModelInvocation,
        files,
        hasDescription: Boolean(description),
      };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });

  // eslint-disable-next-line no-console
  console.log(`${TAG} registered 8 IPC channels (builtin=${getBuiltinSkillsDir() || '(unset)'}, user=${getUserSkillsRoot() || '(unset)'})`);
}

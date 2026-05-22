/**
 * pathRemapper.js — W3 路径联动统一入口
 *
 * 当用户对工作区内的文件/文件夹做 rename / move / delete 时，或对工作区本身做
 * rename 时，应用中多处存储（SQLite + JSON）持有相对路径或项目名引用。
 * 历史实现仅同步了 structure.json，其他位置全部失配。本模块提供三个统一 API：
 *
 *   - remapInternalPath(projectDir, projectName, fromRel, toRel, { isDir })
 *       文件夹/文件 rename / move 后调用
 *
 *   - cleanupDeletedPath(projectDir, projectName, deletedRel, { isDir })
 *       文件夹/文件 delete 后调用
 *
 *   - renameWorkspace({ oldName, newName, domain, ... })
 *       项目/案件 rename 全链路（W3b）
 *
 * 设计原则：
 *   1. 主操作（磁盘 fs.rename / trashOrRm）由调用方完成；本模块只做联动。
 *   2. SQLite 内多表 UPDATE 用 db.transaction 包裹保证原子；跨 DB（项目 db /
 *      study db / supervisor.db）无法跨连接事务，采用 best-effort，并把失败
 *      项记到日志数组返回给调用方。
 *   3. JSON 文件用 .tmp + rename 原子写。
 *   4. 不抛错（除非传参非法），所有失败收敛进返回值的 errors 数组，由 IPC
 *      handler 决定是否提示前端。
 *   5. 历史快照（events / activity_log）按 W3 决策**不动**，保留当时真实路径。
 */

import fs from 'node:fs';
import path from 'node:path';

import { getProjectDb } from '../db/index.js';

// ---------------------------------------------------------------------------
//  工具：路径归一化、前缀匹配
// ---------------------------------------------------------------------------

const POSIX = (s) => String(s || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');

function isUnderPrefix(p, prefix) {
  if (!prefix) return false;
  if (!p) return false;
  return p === prefix || p.startsWith(prefix + '/');
}

function rewritePrefix(p, from, to) {
  if (p === from) return to;
  if (p.startsWith(from + '/')) return to + p.slice(from.length);
  return p;
}

// ---------------------------------------------------------------------------
//  JSON 文件原子读写
// ---------------------------------------------------------------------------

function safeReadJson(p) {
  try {
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    return null;
  }
}

function atomicWriteJson(p, doc) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(doc, null, 2), 'utf-8');
  fs.renameSync(tmp, p);
}

// ---------------------------------------------------------------------------
//  各存储的局部 remap helper
// ---------------------------------------------------------------------------

/**
 * 重写 classify-rules.json 内 rules[].targetFolder 的前缀/精确匹配。
 * 不删除任何规则；若 isDir 模式，子路径规则一并跟随。
 */
function remapClassifyRulesFile(projectDir, fromRel, toRel, { isDir }) {
  const p = path.join(projectDir, 'meta', 'classify-rules.json');
  const doc = safeReadJson(p);
  if (!doc || !Array.isArray(doc.rules)) return { updated: 0 };

  let updated = 0;
  for (const rule of doc.rules) {
    const cur = POSIX(rule.targetFolder || '');
    if (!cur) continue;
    let next = cur;
    if (isDir) {
      next = rewritePrefix(cur, fromRel, toRel);
    } else if (cur === fromRel) {
      next = toRel;
    }
    if (next !== cur) {
      rule.targetFolder = next;
      rule.updatedAt = new Date().toISOString();
      updated += 1;
    }
  }
  if (updated > 0) {
    doc.updatedAt = new Date().toISOString();
    atomicWriteJson(p, doc);
  }
  return { updated };
}

/**
 * 失效（不删除）指向已删路径的硬规则：enabled=false + disabledReason='target_deleted'。
 */
function disableClassifyRulesUnderPath(projectDir, deletedRel, { isDir }) {
  const p = path.join(projectDir, 'meta', 'classify-rules.json');
  const doc = safeReadJson(p);
  if (!doc || !Array.isArray(doc.rules)) return { disabled: 0 };

  let disabled = 0;
  for (const rule of doc.rules) {
    const cur = POSIX(rule.targetFolder || '');
    if (!cur) continue;
    const hit = isDir ? isUnderPrefix(cur, deletedRel) : cur === deletedRel;
    if (!hit) continue;
    if (rule.enabled !== false) {
      rule.enabled = false;
      rule.disabledReason = 'target_deleted';
      rule.updatedAt = new Date().toISOString();
      disabled += 1;
    }
  }
  if (disabled > 0) {
    doc.updatedAt = new Date().toISOString();
    atomicWriteJson(p, doc);
  }
  return { disabled };
}

/**
 * 重写 preferences.json 内 preferences[].tendency.folder。
 * conditions.sourceIncludes/Excludes 是用户输入关键词，不强制 remap（无法可靠
 * 判定是否为路径），按当前阶段策略不动。
 */
function remapPreferencesFile(projectDir, fromRel, toRel, { isDir }) {
  const p = path.join(projectDir, 'meta', 'preferences.json');
  const doc = safeReadJson(p);
  if (!doc || !Array.isArray(doc.preferences)) return { updated: 0 };

  let updated = 0;
  for (const pref of doc.preferences) {
    const cur = POSIX(pref.tendency?.folder || '');
    if (!cur) continue;
    let next = cur;
    if (isDir) {
      next = rewritePrefix(cur, fromRel, toRel);
    } else if (cur === fromRel) {
      next = toRel;
    }
    if (next !== cur) {
      pref.tendency = { ...(pref.tendency || {}), folder: next };
      pref.updatedAt = new Date().toISOString();
      updated += 1;
    }
  }
  if (updated > 0) {
    atomicWriteJson(p, doc);
  }
  return { updated };
}

function disablePreferencesUnderPath(projectDir, deletedRel, { isDir }) {
  const p = path.join(projectDir, 'meta', 'preferences.json');
  const doc = safeReadJson(p);
  if (!doc || !Array.isArray(doc.preferences)) return { disabled: 0 };

  let disabled = 0;
  for (const pref of doc.preferences) {
    const cur = POSIX(pref.tendency?.folder || '');
    if (!cur) continue;
    const hit = isDir ? isUnderPrefix(cur, deletedRel) : cur === deletedRel;
    if (!hit) continue;
    if (pref.enabled !== false) {
      pref.enabled = false;
      pref.disabledReason = 'target_deleted';
      pref.updatedAt = new Date().toISOString();
      disabled += 1;
    }
  }
  if (disabled > 0) {
    atomicWriteJson(p, doc);
  }
  return { disabled };
}

/**
 * 重写 snippets-meta/*.json record 内 items[].content.relPath 与 linkedTo.relPath。
 */
function remapSnippetsRecordFile(recordPath, fromRel, toRel, { isDir }) {
  const doc = safeReadJson(recordPath);
  if (!doc || !Array.isArray(doc.items)) return { updated: 0 };

  let updated = 0;
  for (const it of doc.items) {
    if (it?.content?.relPath) {
      const cur = POSIX(it.content.relPath);
      let next = cur;
      if (isDir) next = rewritePrefix(cur, fromRel, toRel);
      else if (cur === fromRel) next = toRel;
      if (next !== cur) {
        it.content.relPath = next;
        updated += 1;
      }
    }
    if (it?.linkedTo?.relPath) {
      const cur = POSIX(it.linkedTo.relPath);
      let next = cur;
      if (isDir) next = rewritePrefix(cur, fromRel, toRel);
      else if (cur === fromRel) next = toRel;
      if (next !== cur) {
        it.linkedTo.relPath = next;
        updated += 1;
      }
    }
  }

  if (updated > 0) {
    doc.updatedAt = new Date().toISOString();
    atomicWriteJson(recordPath, doc);
  }
  return { updated };
}

// ---------------------------------------------------------------------------
//  项目级 SQLite 联动
// ---------------------------------------------------------------------------

/**
 * 一次性在项目 project.db 中重写所有相关字段。
 * 用 db.transaction 包裹保证多表原子。
 */
function remapProjectDb(projectDir, fromRel, toRel, { isDir }) {
  let suggestionsAffected = 0;
  let suggestionsSkippedConflict = 0;
  let sourceRecordsAffected = 0;
  let knowledgeItemsAffected = 0;
  let knowledgeLinksAffected = 0;
  let knowledgeJsonAffected = 0;

  let db;
  try {
    db = getProjectDb(projectDir);
  } catch (e) {
    return {
      ok: false,
      error: `open project.db failed: ${e?.message || String(e)}`,
    };
  }

  const fromPrefixMatch = `${fromRel}/`;

  const trx = db.transaction(() => {
    // suggestions: 4 个路径字段 + trace JSON
    // source_rel_path 是 UNIQUE，前缀替换可能冲突。冲突时跳过该行并计数。
    if (isDir) {
      // 1) source_rel_path 前缀
      const candidateRows = db
        .prepare(
          `SELECT source_rel_path FROM suggestions
           WHERE source_rel_path = ? OR source_rel_path LIKE ?`,
        )
        .all(fromRel, `${fromPrefixMatch}%`);

      for (const r of candidateRows) {
        const cur = r.source_rel_path;
        const next = rewritePrefix(cur, fromRel, toRel);
        if (next === cur) continue;
        // 冲突检测
        const exists = db
          .prepare('SELECT 1 FROM suggestions WHERE source_rel_path = ?')
          .get(next);
        if (exists) {
          suggestionsSkippedConflict += 1;
          continue;
        }
        const info = db
          .prepare(
            'UPDATE suggestions SET source_rel_path = ?, updated_at = ? WHERE source_rel_path = ?',
          )
          .run(next, new Date().toISOString(), cur);
        if (info.changes) suggestionsAffected += 1;
      }

      // 2) suggested_folder 前缀
      const sf = db
        .prepare(
          `UPDATE suggestions
             SET suggested_folder = CASE
               WHEN suggested_folder = ? THEN ?
               ELSE ? || substr(suggested_folder, length(?) + 1)
             END,
             updated_at = ?
           WHERE suggested_folder = ? OR suggested_folder LIKE ?`,
        )
        .run(fromRel, toRel, toRel, fromRel, new Date().toISOString(), fromRel, `${fromPrefixMatch}%`);
      suggestionsAffected += sf.changes;

      // 3) moved_to_rel_path
      const mv = db
        .prepare(
          `UPDATE suggestions
             SET moved_to_rel_path = CASE
               WHEN moved_to_rel_path = ? THEN ?
               ELSE ? || substr(moved_to_rel_path, length(?) + 1)
             END,
             updated_at = ?
           WHERE moved_to_rel_path = ? OR moved_to_rel_path LIKE ?`,
        )
        .run(fromRel, toRel, toRel, fromRel, new Date().toISOString(), fromRel, `${fromPrefixMatch}%`);
      suggestionsAffected += mv.changes;

      // 4) target_rel_path
      const tr = db
        .prepare(
          `UPDATE suggestions
             SET target_rel_path = CASE
               WHEN target_rel_path = ? THEN ?
               ELSE ? || substr(target_rel_path, length(?) + 1)
             END,
             updated_at = ?
           WHERE target_rel_path = ? OR target_rel_path LIKE ?`,
        )
        .run(fromRel, toRel, toRel, fromRel, new Date().toISOString(), fromRel, `${fromPrefixMatch}%`);
      suggestionsAffected += tr.changes;
    } else {
      // 单文件：精确匹配
      const cur = fromRel;
      const next = toRel;

      const exists = db
        .prepare('SELECT 1 FROM suggestions WHERE source_rel_path = ?')
        .get(next);
      if (!exists) {
        const info = db
          .prepare(
            'UPDATE suggestions SET source_rel_path = ?, updated_at = ? WHERE source_rel_path = ?',
          )
          .run(next, new Date().toISOString(), cur);
        if (info.changes) suggestionsAffected += 1;
      } else {
        const hadOld = db.prepare('SELECT 1 FROM suggestions WHERE source_rel_path = ?').get(cur);
        if (hadOld) suggestionsSkippedConflict += 1;
      }

      // 其他 3 字段精确替换
      for (const col of ['suggested_folder', 'moved_to_rel_path', 'target_rel_path']) {
        const info = db
          .prepare(
            `UPDATE suggestions SET ${col} = ?, updated_at = ? WHERE ${col} = ?`,
          )
          .run(next, new Date().toISOString(), cur);
        if (info.changes) suggestionsAffected += info.changes;
      }
    }

    // source_records: source_rel_path 是 UNIQUE
    if (isDir) {
      const candidateRows = db
        .prepare(
          `SELECT source_rel_path FROM source_records
           WHERE source_rel_path = ? OR source_rel_path LIKE ?`,
        )
        .all(fromRel, `${fromPrefixMatch}%`);
      for (const r of candidateRows) {
        const cur = r.source_rel_path;
        const next = rewritePrefix(cur, fromRel, toRel);
        if (next === cur) continue;
        const exists = db
          .prepare('SELECT 1 FROM source_records WHERE source_rel_path = ?')
          .get(next);
        if (exists) continue; // 冲突跳过
        const info = db
          .prepare(
            'UPDATE source_records SET source_rel_path = ? WHERE source_rel_path = ?',
          )
          .run(next, cur);
        if (info.changes) sourceRecordsAffected += 1;
      }
    } else {
      const exists = db
        .prepare('SELECT 1 FROM source_records WHERE source_rel_path = ?')
        .get(toRel);
      if (!exists) {
        const info = db
          .prepare('UPDATE source_records SET source_rel_path = ? WHERE source_rel_path = ?')
          .run(toRel, fromRel);
        if (info.changes) sourceRecordsAffected += info.changes;
      }
    }

    // knowledge_items.content_path
    if (isDir) {
      const info = db
        .prepare(
          `UPDATE knowledge_items
             SET content_path = CASE
               WHEN content_path = ? THEN ?
               ELSE ? || substr(content_path, length(?) + 1)
             END,
             updated_at = ?
           WHERE content_path = ? OR content_path LIKE ?`,
        )
        .run(fromRel, toRel, toRel, fromRel, new Date().toISOString(), fromRel, `${fromPrefixMatch}%`);
      knowledgeItemsAffected += info.changes;
    } else {
      const info = db
        .prepare(
          'UPDATE knowledge_items SET content_path = ?, updated_at = ? WHERE content_path = ?',
        )
        .run(toRel, new Date().toISOString(), fromRel);
      knowledgeItemsAffected += info.changes;
    }

    // knowledge_items.content_json — 处理 webclip 的 images[] 中相对路径
    const jsonRows = db
      .prepare(
        `SELECT id, content_json FROM knowledge_items WHERE content_json IS NOT NULL AND content_json != ''`,
      )
      .all();
    for (const r of jsonRows) {
      let parsed;
      try {
        parsed = JSON.parse(r.content_json);
      } catch {
        continue;
      }
      if (!parsed || !Array.isArray(parsed.images)) continue;
      let changed = false;
      parsed.images = parsed.images.map((img) => {
        if (!img || typeof img !== 'object') return img;
        const cur = POSIX(img.relPath || img.path || '');
        if (!cur) return img;
        let next = cur;
        if (isDir) next = rewritePrefix(cur, fromRel, toRel);
        else if (cur === fromRel) next = toRel;
        if (next === cur) return img;
        changed = true;
        if (img.relPath != null) return { ...img, relPath: next };
        return { ...img, path: next };
      });
      if (changed) {
        db.prepare(
          'UPDATE knowledge_items SET content_json = ?, updated_at = ? WHERE id = ?',
        ).run(JSON.stringify(parsed), new Date().toISOString(), r.id);
        knowledgeJsonAffected += 1;
      }
    }

    // knowledge_links.target_path
    if (isDir) {
      const info = db
        .prepare(
          `UPDATE knowledge_links
             SET target_path = CASE
               WHEN target_path = ? THEN ?
               ELSE ? || substr(target_path, length(?) + 1)
             END
           WHERE target_path = ? OR target_path LIKE ?`,
        )
        .run(fromRel, toRel, toRel, fromRel, fromRel, `${fromPrefixMatch}%`);
      knowledgeLinksAffected += info.changes;
    } else {
      const info = db
        .prepare('UPDATE knowledge_links SET target_path = ? WHERE target_path = ?')
        .run(toRel, fromRel);
      knowledgeLinksAffected += info.changes;
    }
  });

  try {
    trx();
    return {
      ok: true,
      suggestionsAffected,
      suggestionsSkippedConflict,
      sourceRecordsAffected,
      knowledgeItemsAffected,
      knowledgeLinksAffected,
      knowledgeJsonAffected,
    };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

/**
 * 清理项目 project.db 中指向已删路径的字段。
 * suggestions：source_rel_path 在删除树下 + pending → 'source_deleted'
 *              suggested_folder 在删除树下 + 非完结态 → 'target_deleted'
 * source_records：源在删除树下 → DELETE 行
 * knowledge_items：content_path 在删除树下 → archived = 1
 * knowledge_links：target_path 在删除树下 → DELETE 行
 */
function cleanupProjectDb(projectDir, deletedRel, { isDir }) {
  let db;
  try {
    db = getProjectDb(projectDir);
  } catch (e) {
    return { ok: false, error: `open project.db failed: ${e?.message || String(e)}` };
  }

  const result = {
    ok: true,
    suggestionsSourceDeleted: 0,
    suggestionsTargetDeleted: 0,
    sourceRecordsDeleted: 0,
    knowledgeItemsArchived: 0,
    knowledgeLinksDeleted: 0,
  };

  const deletedPrefix = `${deletedRel}/`;
  const now = new Date().toISOString();

  const trx = db.transaction(() => {
    // suggestions.source_rel_path 在删除树下：pending → 'source_deleted'
    if (isDir) {
      const info = db
        .prepare(
          `UPDATE suggestions SET status = 'source_deleted', updated_at = ?
             WHERE status = 'pending'
               AND (source_rel_path = ? OR source_rel_path LIKE ?)`,
        )
        .run(now, deletedRel, `${deletedPrefix}%`);
      result.suggestionsSourceDeleted += info.changes;
    } else {
      const info = db
        .prepare(
          `UPDATE suggestions SET status = 'source_deleted', updated_at = ?
             WHERE status = 'pending' AND source_rel_path = ?`,
        )
        .run(now, deletedRel);
      result.suggestionsSourceDeleted += info.changes;
    }

    // suggestions.suggested_folder 在删除树下：非完结态 → 'target_deleted'
    if (isDir) {
      const info = db
        .prepare(
          `UPDATE suggestions SET status = 'target_deleted', updated_at = ?
             WHERE status NOT IN ('accepted', 'rejected', 'source_deleted')
               AND (suggested_folder = ? OR suggested_folder LIKE ?)`,
        )
        .run(now, deletedRel, `${deletedPrefix}%`);
      result.suggestionsTargetDeleted += info.changes;
    }

    // source_records
    if (isDir) {
      const info = db
        .prepare(
          `DELETE FROM source_records
             WHERE source_rel_path = ? OR source_rel_path LIKE ?`,
        )
        .run(deletedRel, `${deletedPrefix}%`);
      result.sourceRecordsDeleted += info.changes;
    } else {
      const info = db
        .prepare('DELETE FROM source_records WHERE source_rel_path = ?')
        .run(deletedRel);
      result.sourceRecordsDeleted += info.changes;
    }

    // knowledge_items：软清理（archived = 1）
    if (isDir) {
      const info = db
        .prepare(
          `UPDATE knowledge_items
             SET archived = 1, archived_at = ?, updated_at = ?
             WHERE archived = 0
               AND content_path != ''
               AND (content_path = ? OR content_path LIKE ?)`,
        )
        .run(now, now, deletedRel, `${deletedPrefix}%`);
      result.knowledgeItemsArchived += info.changes;
    } else {
      const info = db
        .prepare(
          `UPDATE knowledge_items
             SET archived = 1, archived_at = ?, updated_at = ?
             WHERE archived = 0 AND content_path = ?`,
        )
        .run(now, now, deletedRel);
      result.knowledgeItemsArchived += info.changes;
    }

    // knowledge_links：硬删除
    if (isDir) {
      const info = db
        .prepare(
          `DELETE FROM knowledge_links
             WHERE target_path = ? OR target_path LIKE ?`,
        )
        .run(deletedRel, `${deletedPrefix}%`);
      result.knowledgeLinksDeleted += info.changes;
    } else {
      const info = db
        .prepare('DELETE FROM knowledge_links WHERE target_path = ?')
        .run(deletedRel);
      result.knowledgeLinksDeleted += info.changes;
    }
  });

  try {
    trx();
    return result;
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

// ---------------------------------------------------------------------------
//  对外 API：remapInternalPath
// ---------------------------------------------------------------------------

/**
 * 文件夹/文件 rename / move 后调用。
 * 注意：调用方应已在 structure.json 上做完 remapStructureDocRelPaths + syncStructureJson。
 *
 * @param {string} projectDir
 * @param {string} projectName
 * @param {string} fromRel   POSIX 相对路径（项目根）
 * @param {string} toRel     POSIX 相对路径（项目根）
 * @param {object} opts
 * @param {boolean} opts.isDir   是否为目录（前缀替换 vs 精确替换）
 * @param {string}  [opts.clipboardRecordPath]
 * @param {string}  [opts.screenshotRecordPath]
 * @returns {{ok:boolean, summary:object, errors:string[]}}
 */
export function remapInternalPath(projectDir, projectName, fromRel, toRel, opts = {}) {
  const from = POSIX(fromRel);
  const to = POSIX(toRel);
  const isDir = Boolean(opts.isDir);
  const errors = [];
  const summary = {};

  if (!from || !to || from === to) {
    return { ok: true, summary, errors };
  }

  // 1. classify-rules.json
  try {
    const r = remapClassifyRulesFile(projectDir, from, to, { isDir });
    summary.classifyRulesUpdated = r.updated;
  } catch (e) {
    errors.push(`classify-rules: ${e?.message || String(e)}`);
  }

  // 2. preferences.json
  try {
    const r = remapPreferencesFile(projectDir, from, to, { isDir });
    summary.preferencesUpdated = r.updated;
  } catch (e) {
    errors.push(`preferences: ${e?.message || String(e)}`);
  }

  // 3. snippets-meta/*.json record（路径由调用方注入）
  if (opts.clipboardRecordPath) {
    try {
      const r = remapSnippetsRecordFile(opts.clipboardRecordPath, from, to, { isDir });
      summary.clipboardRecordUpdated = r.updated;
    } catch (e) {
      errors.push(`clipboard-record: ${e?.message || String(e)}`);
    }
  }
  if (opts.screenshotRecordPath) {
    try {
      const r = remapSnippetsRecordFile(opts.screenshotRecordPath, from, to, { isDir });
      summary.screenshotRecordUpdated = r.updated;
    } catch (e) {
      errors.push(`screenshot-record: ${e?.message || String(e)}`);
    }
  }

  // 4. project.db 多表
  try {
    const r = remapProjectDb(projectDir, from, to, { isDir });
    if (r.ok) {
      Object.assign(summary, r);
    } else {
      errors.push(`project.db: ${r.error}`);
    }
  } catch (e) {
    errors.push(`project.db: ${e?.message || String(e)}`);
  }

  return { ok: errors.length === 0, summary, errors };
}

// ---------------------------------------------------------------------------
//  对外 API：cleanupDeletedPath
// ---------------------------------------------------------------------------

/**
 * 文件夹/文件 delete 后调用，清理指向已删路径的所有引用。
 *
 * 策略（W3 决策）：
 *   - knowledge_items: archived = 1（软清理，不丢历史）
 *   - knowledge_links: DELETE（链接无独立价值）
 *   - suggestions: 标记 source_deleted / target_deleted
 *   - source_records: DELETE
 *   - classify-rules / preferences: enabled=false + disabledReason='target_deleted'
 *
 * @param {string} projectDir
 * @param {string} projectName
 * @param {string} deletedRel
 * @param {object} opts
 * @param {boolean} opts.isDir
 * @returns {{ok:boolean, summary:object, errors:string[]}}
 */
export function cleanupDeletedPath(projectDir, projectName, deletedRel, opts = {}) {
  const rel = POSIX(deletedRel);
  const isDir = Boolean(opts.isDir);
  const errors = [];
  const summary = {};

  if (!rel) return { ok: true, summary, errors };

  // 1. classify-rules.json
  try {
    const r = disableClassifyRulesUnderPath(projectDir, rel, { isDir });
    summary.classifyRulesDisabled = r.disabled;
  } catch (e) {
    errors.push(`classify-rules: ${e?.message || String(e)}`);
  }

  // 2. preferences.json
  try {
    const r = disablePreferencesUnderPath(projectDir, rel, { isDir });
    summary.preferencesDisabled = r.disabled;
  } catch (e) {
    errors.push(`preferences: ${e?.message || String(e)}`);
  }

  // 3. project.db
  try {
    const r = cleanupProjectDb(projectDir, rel, { isDir });
    if (r.ok) {
      Object.assign(summary, r);
    } else {
      errors.push(`project.db: ${r.error}`);
    }
  } catch (e) {
    errors.push(`project.db: ${e?.message || String(e)}`);
  }

  return { ok: errors.length === 0, summary, errors };
}

// ---------------------------------------------------------------------------
//  对外 API：renameWorkspace（W3b）
// ---------------------------------------------------------------------------

/**
 * 工作区（项目/案件）整体重命名。需在调用前已校验：
 *   - newName 已 sanitize 且非空
 *   - newName !== oldName
 *   - 目标目录不存在
 *   - 学习域不允许重命名（调用方需拦截）
 *
 * 流程：
 *   1. fs.renameSync(oldDir, newDir) — 主操作；失败抛错，调用方决定如何回退
 *   2. 项目内 JSON projectName 字段替换（best-effort）
 *   3. study 库 board_items.source_project 跨库 UPDATE
 *   4. supervisor.db notifications / preference_candidates / preference_analysis_log
 *   5. state.json 全量迁移（current 指针 + statuses keys + pinned/hidden 绝对路径）
 *
 * @param {object} ctx 注入的依赖与上下文
 * @param {string} ctx.oldName
 * @param {string} ctx.newName
 * @param {'projects'|'cases'} ctx.domain
 * @param {string} ctx.oldDir   旧绝对路径
 * @param {string} ctx.newDir   新绝对路径
 * @param {object} ctx.readState
 * @param {object} ctx.writeState
 * @param {Function} ctx.getStudyDb  必须返回 { db, projectDir }
 * @param {Function} ctx.getSupervisorDb
 * @returns {{ok:boolean, summary:object, errors:string[]}}
 */
export function renameWorkspace(ctx) {
  const { oldName, newName, domain, oldDir, newDir } = ctx;
  const errors = [];
  const summary = {};

  if (!oldName || !newName || oldName === newName) {
    return { ok: false, summary, errors: ['invalid names'] };
  }
  if (!oldDir || !newDir) {
    return { ok: false, summary, errors: ['invalid dirs'] };
  }
  if (!fs.existsSync(oldDir)) {
    return { ok: false, summary, errors: [`oldDir not found: ${oldDir}`] };
  }
  if (fs.existsSync(newDir)) {
    return { ok: false, summary, errors: [`newDir already exists: ${newDir}`] };
  }

  // ── 主操作：磁盘 rename ──
  // 关闭当前项目 DB 连接，避免 Windows 文件锁
  try {
    if (typeof ctx.closeProjectDb === 'function') {
      try { ctx.closeProjectDb(oldDir); } catch { /* ignore */ }
    }
  } catch { /* ignore */ }

  try {
    fs.renameSync(oldDir, newDir);
    summary.diskRenamed = true;
  } catch (e) {
    return {
      ok: false,
      summary,
      errors: [`disk rename failed: ${e?.message || String(e)}`],
    };
  }

  // ── 项目内 JSON projectName 字段替换（best-effort）──
  const projectJsons = [
    path.join(newDir, 'meta', 'structure.json'),
    path.join(newDir, 'snippets', 'snippets-meta', 'clipboard-record.json'),
    path.join(newDir, 'snippets', 'snippets-meta', 'screenshots-record.json'),
  ];
  let jsonProjectNameUpdated = 0;
  for (const p of projectJsons) {
    try {
      const doc = safeReadJson(p);
      if (doc && typeof doc === 'object' && doc.projectName === oldName) {
        doc.projectName = newName;
        doc.updatedAt = new Date().toISOString();
        atomicWriteJson(p, doc);
        jsonProjectNameUpdated += 1;
      }
    } catch (e) {
      errors.push(`json ${path.basename(p)}: ${e?.message || String(e)}`);
    }
  }
  summary.jsonProjectNameUpdated = jsonProjectNameUpdated;

  // ── study 库：board_items.source_project ──
  try {
    if (typeof ctx.getStudyDb === 'function') {
      const studyResult = ctx.getStudyDb();
      const studyDb = studyResult?.db;
      if (studyDb) {
        const info = studyDb
          .prepare(
            `UPDATE board_items
               SET source_project = ?
             WHERE source_project = ? AND source_domain = ?`,
          )
          .run(newName, oldName, domain);
        summary.boardItemsUpdated = info.changes;
      }
    }
  } catch (e) {
    errors.push(`study board_items: ${e?.message || String(e)}`);
  }

  // ── supervisor.db ──
  try {
    if (typeof ctx.getSupervisorDb === 'function') {
      const svdb = ctx.getSupervisorDb();
      if (svdb) {
        const supervisorTrx = svdb.transaction(() => {
          const n1 = svdb
            .prepare('UPDATE notifications SET project_name = ? WHERE project_name = ?')
            .run(newName, oldName);
          summary.supervisorNotifications = n1.changes;

          const n2 = svdb
            .prepare(
              `UPDATE preference_candidates
                 SET project_name = ?, project_dir = ?
               WHERE project_name = ? AND domain = ?`,
            )
            .run(newName, newDir, oldName, domain);
          summary.supervisorPrefCandidates = n2.changes;

          // preference_analysis_log: PK 是 project_name，SQLite 允许 UPDATE PK
          // 但若新 PK 已存在则冲突，需先 DELETE 新行（保留旧的）
          const existsNew = svdb
            .prepare('SELECT 1 FROM preference_analysis_log WHERE project_name = ?')
            .get(newName);
          if (existsNew) {
            svdb
              .prepare('DELETE FROM preference_analysis_log WHERE project_name = ?')
              .run(newName);
          }
          const n3 = svdb
            .prepare('UPDATE preference_analysis_log SET project_name = ? WHERE project_name = ?')
            .run(newName, oldName);
          summary.supervisorPrefLog = n3.changes;
        });
        supervisorTrx();
      }
    }
  } catch (e) {
    errors.push(`supervisor.db: ${e?.message || String(e)}`);
  }

  // ── state.json 迁移 ──
  try {
    const state = ctx.readState ? ctx.readState() : {};
    let stateChanged = false;

    if (domain === 'projects') {
      if (state.currentProject === oldName) {
        state.currentProject = newName;
        stateChanged = true;
      }
      if (state.projectStatuses && typeof state.projectStatuses === 'object'
        && Object.prototype.hasOwnProperty.call(state.projectStatuses, oldName)) {
        state.projectStatuses[newName] = state.projectStatuses[oldName];
        delete state.projectStatuses[oldName];
        stateChanged = true;
      }
    } else if (domain === 'cases') {
      if (state.currentCase === oldName) {
        state.currentCase = newName;
        stateChanged = true;
      }
      if (state.caseStatuses && typeof state.caseStatuses === 'object'
        && Object.prototype.hasOwnProperty.call(state.caseStatuses, oldName)) {
        state.caseStatuses[newName] = state.caseStatuses[oldName];
        delete state.caseStatuses[oldName];
        stateChanged = true;
      }
    }

    // localFolders[]: 绝对路径，若以 oldDir 为前缀则替换
    if (Array.isArray(state.localFolders)) {
      const next = state.localFolders.map((p) => {
        if (typeof p !== 'string') return p;
        if (p === oldDir) return newDir;
        if (p.startsWith(oldDir + path.sep)) return newDir + p.slice(oldDir.length);
        return p;
      });
      if (JSON.stringify(next) !== JSON.stringify(state.localFolders)) {
        state.localFolders = next;
        stateChanged = true;
      }
    }

    // knowclaw.pinnedWorkspaces / hiddenWorkspaces
    if (state.knowclaw && typeof state.knowclaw === 'object') {
      for (const key of ['pinnedWorkspaces', 'hiddenWorkspaces']) {
        if (!Array.isArray(state.knowclaw[key])) continue;
        const next = state.knowclaw[key].map((p) => {
          if (typeof p !== 'string') return p;
          if (p === oldDir) return newDir;
          if (p.startsWith(oldDir + path.sep)) return newDir + p.slice(oldDir.length);
          return p;
        });
        if (JSON.stringify(next) !== JSON.stringify(state.knowclaw[key])) {
          state.knowclaw[key] = next;
          stateChanged = true;
        }
      }
    }

    if (stateChanged && ctx.writeState) {
      ctx.writeState(state);
      summary.stateMigrated = true;
    } else {
      summary.stateMigrated = false;
    }
  } catch (e) {
    errors.push(`state.json: ${e?.message || String(e)}`);
  }

  return { ok: errors.length === 0, summary, errors };
}

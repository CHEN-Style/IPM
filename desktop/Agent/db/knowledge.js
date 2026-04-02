export function createItem(db, item) {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO knowledge_items (id, type, title, content_text, content_json, content_path, summary, tags, importance, source_kind, source_url, pinned, archived, created_at, updated_at)
    VALUES (@id, @type, @title, @content_text, @content_json, @content_path, @summary, @tags, @importance, @source_kind, @source_url, @pinned, @archived, @created_at, @updated_at)
  `);
  const row = {
    id: item.id,
    type: item.type || 'snippet',
    title: item.title || '',
    content_text: item.content_text || '',
    content_json: item.content_json || null,
    content_path: item.content_path || '',
    summary: item.summary || '',
    tags: JSON.stringify(Array.isArray(item.tags) ? item.tags : []),
    importance: item.importance || null,
    source_kind: item.source_kind || 'manual',
    source_url: item.source_url || null,
    pinned: item.pinned ? 1 : 0,
    archived: item.archived ? 1 : 0,
    created_at: item.created_at || now,
    updated_at: item.updated_at || now,
  };
  stmt.run(row);
  return { ...row, tags: JSON.parse(row.tags) };
}

function parseRow(row) {
  if (!row) return null;
  return {
    ...row,
    tags: safeParseTags(row.tags),
    pinned: Boolean(row.pinned),
    archived: Boolean(row.archived),
  };
}

function safeParseTags(raw) {
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

export function getItem(db, id) {
  const row = db.prepare('SELECT * FROM knowledge_items WHERE id = ?').get(id);
  if (!row) return null;
  const item = parseRow(row);
  item.links = db.prepare('SELECT * FROM knowledge_links WHERE item_id = ? ORDER BY created_at DESC').all(id);
  return item;
}

export function listItems(db, filters = {}) {
  const conditions = [];
  const params = {};

  if (filters.type) {
    conditions.push('type = @type');
    params.type = filters.type;
  }
  if (filters.importance) {
    conditions.push('importance = @importance');
    params.importance = filters.importance;
  }
  if (typeof filters.pinned === 'number' || typeof filters.pinned === 'boolean') {
    conditions.push('pinned = @pinned');
    params.pinned = filters.pinned ? 1 : 0;
  }
  if (typeof filters.archived === 'number' || typeof filters.archived === 'boolean') {
    conditions.push('archived = @archived');
    params.archived = filters.archived ? 1 : 0;
  }
  if (filters.search) {
    conditions.push("(content_text LIKE @search OR title LIKE @search OR tags LIKE @search)");
    params.search = `%${filters.search}%`;
  }
  if (filters.tags && typeof filters.tags === 'string') {
    conditions.push("tags LIKE @tagFilter");
    params.tagFilter = `%${filters.tags}%`;
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = Number(filters.limit) || 200;
  const offset = Number(filters.offset) || 0;

  const sql = `SELECT * FROM knowledge_items ${where} ORDER BY pinned DESC, created_at DESC LIMIT @limit OFFSET @offset`;
  const rows = db.prepare(sql).all({ ...params, limit, offset });
  const items = rows.map(parseRow);

  if (items.length > 0) {
    const ids = items.map((i) => i.id);
    const placeholders = ids.map(() => '?').join(',');
    const allLinks = db.prepare(`SELECT * FROM knowledge_links WHERE item_id IN (${placeholders}) ORDER BY created_at DESC`).all(...ids);
    const linkMap = {};
    for (const link of allLinks) {
      if (!linkMap[link.item_id]) linkMap[link.item_id] = [];
      linkMap[link.item_id].push(link);
    }
    for (const item of items) {
      item.links = linkMap[item.id] || [];
    }
  }

  return items;
}

export function updateItem(db, id, patch) {
  const allowed = ['type', 'title', 'content_text', 'content_json', 'content_path', 'summary', 'importance', 'source_kind', 'source_url', 'pinned', 'archived'];
  const sets = [];
  const params = { id };

  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) {
      let val = patch[key];
      if (key === 'pinned' || key === 'archived') val = val ? 1 : 0;
      sets.push(`${key} = @${key}`);
      params[key] = val;
    }
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'tags')) {
    sets.push('tags = @tags');
    params.tags = JSON.stringify(Array.isArray(patch.tags) ? patch.tags : []);
  }

  if (sets.length === 0) return getItem(db, id);

  sets.push('updated_at = @updated_at');
  params.updated_at = new Date().toISOString();

  db.prepare(`UPDATE knowledge_items SET ${sets.join(', ')} WHERE id = @id`).run(params);
  return getItem(db, id);
}

export function deleteItem(db, id) {
  const row = db.prepare('SELECT content_path FROM knowledge_items WHERE id = ?').get(id);
  db.prepare('DELETE FROM knowledge_items WHERE id = ?').run(id);
  return row ? row.content_path : null;
}

export function addLink(db, itemId, targetPath, targetKind) {
  const now = new Date().toISOString();
  const existing = db.prepare('SELECT id FROM knowledge_links WHERE item_id = ? AND target_path = ?').get(itemId, targetPath);
  if (existing) return existing;
  const info = db.prepare(
    'INSERT INTO knowledge_links (item_id, target_path, target_kind, created_at) VALUES (?, ?, ?, ?)'
  ).run(itemId, targetPath, targetKind || 'file', now);
  return { id: info.lastInsertRowid, item_id: itemId, target_path: targetPath, target_kind: targetKind || 'file', created_at: now };
}

export function removeLink(db, linkId) {
  db.prepare('DELETE FROM knowledge_links WHERE id = ?').run(linkId);
}

export function removeLinkByItemAndPath(db, itemId, targetPath) {
  db.prepare('DELETE FROM knowledge_links WHERE item_id = ? AND target_path = ?').run(itemId, targetPath);
}

export function getItemLinks(db, itemId) {
  return db.prepare('SELECT * FROM knowledge_links WHERE item_id = ? ORDER BY created_at DESC').all(itemId);
}

export function getLinkedItems(db, targetPath) {
  const links = db.prepare('SELECT * FROM knowledge_links WHERE target_path = ?').all(targetPath);
  if (!links.length) return [];
  const ids = links.map((l) => l.item_id);
  const placeholders = ids.map(() => '?').join(',');
  const rows = db.prepare(`SELECT * FROM knowledge_items WHERE id IN (${placeholders})`).all(...ids);
  return rows.map(parseRow);
}

export function countItems(db, filters = {}) {
  const conditions = [];
  const params = {};
  if (filters.type) {
    conditions.push('type = @type');
    params.type = filters.type;
  }
  if (typeof filters.archived === 'number' || typeof filters.archived === 'boolean') {
    conditions.push('archived = @archived');
    params.archived = filters.archived ? 1 : 0;
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const row = db.prepare(`SELECT COUNT(*) as cnt FROM knowledge_items ${where}`).get(params);
  return row?.cnt || 0;
}

export function countLinkedItems(db) {
  const row = db.prepare('SELECT COUNT(DISTINCT item_id) as cnt FROM knowledge_links').get();
  return row?.cnt || 0;
}

export function listBoards(db) {
  return db.prepare('SELECT * FROM boards ORDER BY is_main DESC, created_at DESC').all();
}

export function getBoard(db, id) {
  return db.prepare('SELECT * FROM boards WHERE id = ?').get(id);
}

export function createBoard(db, { id, name }) {
  const now = new Date().toISOString();
  const count = db.prepare('SELECT COUNT(*) as cnt FROM boards').get()?.cnt || 0;
  const isMain = count === 0 ? 1 : 0;
  db.prepare('INSERT INTO boards (id, name, is_main, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(id, name, isMain, now, now);
  return getBoard(db, id);
}

export function renameBoard(db, id, name) {
  const now = new Date().toISOString();
  db.prepare('UPDATE boards SET name = ?, updated_at = ? WHERE id = ?').run(name, now, id);
  return getBoard(db, id);
}

export function deleteBoard(db, id) {
  const board = getBoard(db, id);
  if (!board) throw new Error('看板不存在');
  if (board.is_main) throw new Error('不能删除主看板');
  db.prepare('DELETE FROM boards WHERE id = ?').run(id);
  return true;
}

export function setMainBoard(db, id) {
  const now = new Date().toISOString();
  db.prepare('UPDATE boards SET is_main = 0, updated_at = ? WHERE is_main = 1').run(now);
  db.prepare('UPDATE boards SET is_main = 1, updated_at = ? WHERE id = ?').run(now, id);
  return getBoard(db, id);
}

export function getBoardItems(db, boardId) {
  return db.prepare('SELECT * FROM board_items WHERE board_id = ? ORDER BY z_index ASC').all(boardId);
}

export function addBoardItem(db, { id, boardId, knowledgeId, sourceProject, sourceDomain, x, y, rotation, width, height }) {
  const now = new Date().toISOString();
  const maxZ = db.prepare('SELECT MAX(z_index) as mz FROM board_items WHERE board_id = ?').get(boardId)?.mz || 0;
  db.prepare(
    `INSERT INTO board_items (id, board_id, knowledge_id, source_project, source_domain, x, y, rotation, width, height, z_index, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, boardId, knowledgeId, sourceProject || '', sourceDomain || 'projects', x ?? 100, y ?? 100, rotation ?? 0, width ?? 240, height ?? null, maxZ + 1, now);
  return db.prepare('SELECT * FROM board_items WHERE id = ?').get(id);
}

export function removeBoardItem(db, id) {
  db.prepare('DELETE FROM board_connections WHERE from_item_id = ? OR to_item_id = ?').run(id, id);
  db.prepare('DELETE FROM board_items WHERE id = ?').run(id);
}

export function updateBoardLayout(db, boardId, items) {
  const stmt = db.prepare('UPDATE board_items SET x = ?, y = ?, rotation = ?, width = ?, height = ?, z_index = ?, group_id = ? WHERE id = ? AND board_id = ?');
  const update = db.transaction((entries) => {
    for (const it of entries) {
      stmt.run(it.x, it.y, it.rotation ?? 0, it.width ?? 240, it.height ?? null, it.zIndex ?? 0, it.groupId ?? null, it.id, boardId);
    }
  });
  update(items);
}

export function countBoardItems(db, boardId) {
  return db.prepare('SELECT COUNT(*) as cnt FROM board_items WHERE board_id = ?').get(boardId)?.cnt || 0;
}

// --- Locking ---

export function lockItem(db, id) {
  db.prepare('UPDATE board_items SET locked = 1 WHERE id = ?').run(id);
}

export function unlockItem(db, id) {
  db.prepare('UPDATE board_items SET locked = 0 WHERE id = ?').run(id);
}

// --- Connections ---

export function listConnections(db, boardId) {
  return db.prepare('SELECT * FROM board_connections WHERE board_id = ? ORDER BY created_at ASC').all(boardId);
}

export function addConnection(db, { id, boardId, fromItemId, toItemId, color }) {
  const now = new Date().toISOString();
  db.prepare('INSERT INTO board_connections (id, board_id, from_item_id, to_item_id, color, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, boardId, fromItemId, toItemId, color || '#e8a0a0', now);
  return db.prepare('SELECT * FROM board_connections WHERE id = ?').get(id);
}

export function removeConnection(db, id) {
  db.prepare('DELETE FROM board_connections WHERE id = ?').run(id);
}

// --- Groups ---

export function listGroups(db, boardId) {
  return db.prepare('SELECT * FROM board_groups WHERE board_id = ? ORDER BY z_index ASC').all(boardId);
}

export function createGroup(db, { id, boardId, name, x, y, width, height, color }) {
  const now = new Date().toISOString();
  db.prepare('INSERT INTO board_groups (id, board_id, name, x, y, width, height, color, z_index, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)').run(id, boardId, name || '', x ?? 0, y ?? 0, width ?? 400, height ?? 300, color || 'rgba(74,158,142,0.08)', now);
  return db.prepare('SELECT * FROM board_groups WHERE id = ?').get(id);
}

export function updateGroup(db, id, patch) {
  const fields = [];
  const vals = [];
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) { fields.push(`${k} = ?`); vals.push(v); }
  }
  if (fields.length === 0) return;
  vals.push(id);
  db.prepare(`UPDATE board_groups SET ${fields.join(', ')} WHERE id = ?`).run(...vals);
  return db.prepare('SELECT * FROM board_groups WHERE id = ?').get(id);
}

export function deleteGroup(db, id) {
  const group = db.prepare('SELECT * FROM board_groups WHERE id = ?').get(id);
  if (group) {
    db.prepare('UPDATE board_items SET x = x + ?, y = y + ?, group_id = NULL WHERE group_id = ?').run(group.x, group.y, id);
  }
  db.prepare('DELETE FROM board_connections WHERE from_item_id = ? OR to_item_id = ?').run(id, id);
  db.prepare('DELETE FROM board_groups WHERE id = ?').run(id);
}

export function lockGroup(db, id) {
  db.prepare('UPDATE board_groups SET locked = 1 WHERE id = ?').run(id);
}

export function unlockGroup(db, id) {
  db.prepare('UPDATE board_groups SET locked = 0 WHERE id = ?').run(id);
}

// --- Board <-> Group conversion ---

export function copyBoardToGroup(db, { sourceBoardId, targetBoardId, groupName, groupX, groupY }) {
  const items = getBoardItems(db, sourceBoardId);
  const conns = listConnections(db, sourceBoardId);
  const now = new Date().toISOString();

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const it of items) {
    minX = Math.min(minX, it.x);
    minY = Math.min(minY, it.y);
    maxX = Math.max(maxX, it.x + (it.width || 240));
    maxY = Math.max(maxY, it.y + 150);
  }
  if (items.length === 0) { minX = 0; minY = 0; maxX = 400; maxY = 300; }

  const groupW = maxX - minX + 60;
  const groupH = maxY - minY + 80;

  const groupId = `grp-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  db.prepare('INSERT INTO board_groups (id, board_id, name, x, y, width, height, color, z_index, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)')
    .run(groupId, targetBoardId, groupName || '', groupX ?? 100, groupY ?? 100, groupW, groupH, 'rgba(74,158,142,0.08)', now);

  const idMap = {};
  for (const it of items) {
    const newId = `bi-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    idMap[it.id] = newId;
    const relX = it.x - minX + 20;
    const relY = it.y - minY + 40;
    db.prepare(
      `INSERT INTO board_items (id, board_id, knowledge_id, source_project, source_domain, x, y, rotation, width, height, z_index, created_at, locked, group_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`
    ).run(newId, targetBoardId, it.knowledge_id, it.source_project, it.source_domain, relX, relY, it.rotation, it.width, it.height, it.z_index, now, groupId);
  }

  for (const c of conns) {
    const newFrom = idMap[c.from_item_id];
    const newTo = idMap[c.to_item_id];
    if (newFrom && newTo) {
      const newConnId = `bc-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      db.prepare('INSERT INTO board_connections (id, board_id, from_item_id, to_item_id, color, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(newConnId, targetBoardId, newFrom, newTo, c.color || '#e8a0a0', now);
    }
  }

  return { groupId, itemCount: items.length };
}

export function copyGroupToBoard(db, { groupId, sourceBoardId, newBoardName }) {
  const group = db.prepare('SELECT * FROM board_groups WHERE id = ?').get(groupId);
  if (!group) throw new Error('分组不存在');

  const items = db.prepare('SELECT * FROM board_items WHERE board_id = ? AND group_id = ?').all(sourceBoardId, groupId);
  const now = new Date().toISOString();

  const boardId = `board-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  db.prepare('INSERT INTO boards (id, name, is_main, created_at, updated_at) VALUES (?, ?, 0, ?, ?)').run(boardId, newBoardName || group.name || '新看板', now, now);

  const idMap = {};
  for (const it of items) {
    const newId = `bi-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    idMap[it.id] = newId;
    db.prepare(
      `INSERT INTO board_items (id, board_id, knowledge_id, source_project, source_domain, x, y, rotation, width, height, z_index, created_at, locked, group_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL)`
    ).run(newId, boardId, it.knowledge_id, it.source_project, it.source_domain, it.x, it.y, it.rotation, it.width, it.height, it.z_index, now);
  }

  const allConns = listConnections(db, sourceBoardId);
  const itemIdSet = new Set(items.map((i) => i.id));
  for (const c of allConns) {
    if (itemIdSet.has(c.from_item_id) && itemIdSet.has(c.to_item_id)) {
      const newFrom = idMap[c.from_item_id];
      const newTo = idMap[c.to_item_id];
      if (newFrom && newTo) {
        const newConnId = `bc-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
        db.prepare('INSERT INTO board_connections (id, board_id, from_item_id, to_item_id, color, created_at) VALUES (?, ?, ?, ?, ?, ?)')
          .run(newConnId, boardId, newFrom, newTo, c.color || '#e8a0a0', now);
      }
    }
  }

  return { boardId, itemCount: items.length };
}

// --- Board style ---

export function updateBoardStyle(db, id, { bgStyle, bgColor }) {
  const now = new Date().toISOString();
  db.prepare('UPDATE boards SET bg_style = ?, bg_color = ?, updated_at = ? WHERE id = ?').run(bgStyle || 'grid', bgColor || '', now, id);
  return getBoard(db, id);
}

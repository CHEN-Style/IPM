import fs from 'node:fs';
import path from 'node:path';
import {
  readPreferences,
  addPreference,
  updatePreference,
  deletePreference,
} from '../../../Agent/storage/preferences.js';
import { createChatModel } from '../../../Agent/services/llm.js';

function listProjectFolders(projectDir) {
  const SYSTEM_DIRS = new Set(['meta', 'temp', 'snippets']);
  try {
    const entries = fs.readdirSync(projectDir, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() && !SYSTEM_DIRS.has(e.name))
      .map((e) => e.name);
  } catch {
    return [];
  }
}

const NL_PARSE_PROMPT = `你是一个文件分类偏好解析器。用户会用自然语言描述一条分类偏好，你需要将其解析为结构化 JSON。

项目中可用的文件夹列表：
{FOLDERS}

请将用户输入解析为以下 JSON 格式（不要输出其他内容，只输出 JSON）：
{
  "pattern": "用户原始描述的自然语言（可以适当润色使其更清晰）",
  "conditions": {
    "nameIncludes": ["文件名包含的关键词"],
    "nameExcludes": ["文件名排除的关键词"],
    "exts": ["匹配的扩展名，不含点号"],
    "sourceIncludes": ["来源路径包含的关键词"],
    "sourceExcludes": ["来源路径排除的关键词"]
  },
  "tendency": {
    "folder": "目标文件夹（必须是上面列表中的一个）",
    "strength": 0.7
  }
}

strength 取值规则：
- 用户语气非常确定（"一定""肯定""绝对"）→ 0.9
- 用户语气较确定（"通常""一般""大多数"）→ 0.7
- 用户语气不太确定（"可能""也许""有时候"）→ 0.5

conditions 中只填用户明确提到的条件，没提到的留空数组 []。
folder 必须从项目文件夹列表中选择最匹配的一个。如果用户描述的文件夹不在列表中，选择最接近的。`;

export function registerPreferencesIpc({ ipcMain, getWorkspaceDirOrThrow }) {
  if (!ipcMain) throw new Error('registerPreferencesIpc: ipcMain is required');

  ipcMain.handle('preferences/list', async (_evt, payload) => {
    const { projectDir } = getWorkspaceDirOrThrow(payload?.projectName, payload?.domain);
    const preferences = readPreferences(projectDir);
    return { ok: true, preferences };
  });

  ipcMain.handle('preferences/add', async (_evt, payload) => {
    const { projectDir } = getWorkspaceDirOrThrow(payload?.projectName, payload?.domain);
    const pref = payload?.pref;
    if (!pref) throw new Error('pref 不能为空');
    const entry = addPreference(projectDir, pref);
    return { ok: true, preference: entry };
  });

  ipcMain.handle('preferences/update', async (_evt, payload) => {
    const { projectDir } = getWorkspaceDirOrThrow(payload?.projectName, payload?.domain);
    const prefId = payload?.prefId;
    const patch = payload?.patch;
    if (!prefId) throw new Error('prefId 不能为空');
    const updated = updatePreference(projectDir, prefId, patch || {});
    if (!updated) throw new Error('未找到对应偏好');
    return { ok: true, preference: updated };
  });

  ipcMain.handle('preferences/delete', async (_evt, payload) => {
    const { projectDir } = getWorkspaceDirOrThrow(payload?.projectName, payload?.domain);
    const prefId = payload?.prefId;
    if (!prefId) throw new Error('prefId 不能为空');
    const ok = deletePreference(projectDir, prefId);
    if (!ok) throw new Error('未找到对应偏好');
    return { ok: true };
  });

  ipcMain.handle('preferences/parseNaturalLanguage', async (_evt, payload) => {
    const text = payload?.text?.trim();
    if (!text) throw new Error('text 不能为空');
    const { projectDir } = getWorkspaceDirOrThrow(payload?.projectName, payload?.domain);

    const folders = listProjectFolders(projectDir);
    if (folders.length === 0) {
      throw new Error('当前项目没有可用文件夹，请先创建文件夹');
    }

    const prompt = NL_PARSE_PROMPT.replace('{FOLDERS}', folders.join(', '));
    const llm = createChatModel();
    const response = await llm.invoke([
      { role: 'system', content: prompt },
      { role: 'user', content: text },
    ]);

    const raw = (response.content || '').trim();
    let parsed;
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('LLM 未返回有效 JSON');
      parsed = JSON.parse(jsonMatch[0]);
    } catch (e) {
      throw new Error(`解析 LLM 返回结果失败: ${e.message}\n原始输出: ${raw.slice(0, 500)}`);
    }

    if (!parsed.tendency?.folder || !folders.includes(parsed.tendency.folder)) {
      const suggested = parsed.tendency?.folder || '(无)';
      throw new Error(`LLM 建议的文件夹 "${suggested}" 不在项目文件夹列表中`);
    }

    return {
      ok: true,
      result: {
        pattern: parsed.pattern || text,
        conditions: {
          nameIncludes: parsed.conditions?.nameIncludes || [],
          nameExcludes: parsed.conditions?.nameExcludes || [],
          exts: parsed.conditions?.exts || [],
          sourceIncludes: parsed.conditions?.sourceIncludes || [],
          sourceExcludes: parsed.conditions?.sourceExcludes || [],
        },
        tendency: {
          folder: parsed.tendency.folder,
          strength: Math.max(0.1, Math.min(1, parsed.tendency?.strength ?? 0.7)),
        },
      },
    };
  });
}

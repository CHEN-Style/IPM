import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import os from 'node:os';

const LOG_SERVER_BASE = 'http://101.133.152.142:7654';
const UPLOAD_TIMEOUT = 15_000;

function sanitizeName(raw) {
  if (!raw) return '';
  return raw.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim().slice(0, 30);
}

function todayStamp() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function postJson(urlStr, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const data = JSON.stringify(body);
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port || 80,
        path: url.pathname,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
        timeout: timeoutMs,
      },
      (res) => {
        let chunks = '';
        res.on('data', (c) => (chunks += c));
        res.on('end', () => resolve({ status: res.statusCode, body: chunks }));
      },
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(data);
    req.end();
  });
}

/**
 * 启动时将历史 .jsonl 文件上传到日志接收服务，成功后删除本地文件。
 * 当天正在写入的文件不会被上传（避免传输不完整数据）。
 */
export async function uploadPendingAnalytics(appRoot) {
  const dir = path.join(appRoot, 'analytics');
  if (!fs.existsSync(dir)) return;

  const todayDate = todayStamp();

  let files;
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl') && !f.includes(todayDate));
  } catch { return; }
  if (files.length === 0) return;

  for (const filename of files) {
    const filePath = path.join(dir, filename);
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const res = await postJson(
        `${LOG_SERVER_BASE}/api/logs/knowvault/text`,
        { content, filename },
        UPLOAD_TIMEOUT,
      );
      if (res.status >= 200 && res.status < 300) {
        try { fs.unlinkSync(filePath); } catch { /* ignore */ }
      }
    } catch {
      // 离线或超时，静默跳过，下次启动再尝试
    }
  }
}

export function registerAnalyticsIpc({ ipcMain, getAppRoot }) {
  if (!ipcMain) throw new Error('registerAnalyticsIpc: ipcMain is required');

  const getDir = () => {
    const dir = path.join(getAppRoot(), 'analytics');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
  };

  let cachedTodayPath = '';
  let cachedTodayKey = '';

  const todayFile = (userName) => {
    const stamp = todayStamp();
    const safe = sanitizeName(userName);
    const key = `${safe}|${stamp}`;
    if (cachedTodayKey === key && cachedTodayPath && fs.existsSync(cachedTodayPath)) {
      return cachedTodayPath;
    }
    const name = safe ? `usage-${safe}-${stamp}.jsonl` : `usage-${stamp}.jsonl`;
    const filePath = path.join(getDir(), name);
    if (!fs.existsSync(filePath)) {
      const meta = {
        t: Date.now(),
        type: '_meta',
        platform: process.platform,
        arch: process.arch,
        screen: `${os.cpus?.()?.length || 0}cores`,
        electronVersion: process.versions.electron || '',
        appVersion: '1.0.0',
        userName: safe || '',
      };
      fs.writeFileSync(filePath, JSON.stringify(meta) + '\n', 'utf-8');
    }
    cachedTodayPath = filePath;
    cachedTodayKey = key;
    return filePath;
  };

  ipcMain.handle('analytics/flush', async (_evt, payload) => {
    const events = payload?.events;
    if (!Array.isArray(events) || events.length === 0) return { ok: true, written: 0 };
    const filePath = todayFile(payload?.userName || '');
    const lines = events.map((e) => JSON.stringify(e)).join('\n') + '\n';
    fs.appendFileSync(filePath, lines, 'utf-8');
    return { ok: true, written: events.length };
  });

  ipcMain.handle('analytics/getDataPath', async () => {
    return { ok: true, path: getDir() };
  });
}

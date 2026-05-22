/**
 * ocr.js — IPC entry point for the F3 内置 OCR 服务。
 *
 * 三个通道：
 *   ocr/recognize        — 给定图片绝对路径，识别后返回 {text, lines, confidence}
 *   ocr/recognizeBuffer  — 直接传 PNG/JPEG 二进制（来自剪贴板等场景）
 *   ocr/status           — 查询服务状态（是否已加载、当前语言、模型目录）
 *
 * 实际推理逻辑统一委托给 Agent/services/ocrService.js（单例 + 串行化）。
 * 这里只做参数校验、错误归一化，以及把 IPC 调用搬到 service 上去。
 */

import fs from 'node:fs';
// ocrService 模块本身只 import fs/path，安全静态导入。
// onnxruntime-node + ppu-paddle-ocr 仍在 recognize() 内首次调用时才加载。
import * as ocrService from '../../../Agent/services/ocrService.js';

export function registerOcrIpc({ ipcMain }) {
  if (!ipcMain) throw new Error('registerOcrIpc: ipcMain is required');

  const normalizeLang = (v) => (v === 'en' ? 'en' : 'ch');

  ipcMain.handle('ocr/recognize', async (_evt, payload) => {
    const imagePath = String(payload?.imagePath || '');
    if (!imagePath) throw new Error('imagePath 不能为空');
    if (!fs.existsSync(imagePath)) throw new Error(`图片文件不存在: ${imagePath}`);
    const lang = normalizeLang(payload?.lang);
    try {
      const result = await ocrService.recognize(imagePath, { lang });
      return { ok: true, result };
    } catch (err) {
      console.warn('[ocr/recognize] failed:', err?.message || err);
      return { ok: false, error: String(err?.message || err) };
    }
  });

  ipcMain.handle('ocr/recognizeBuffer', async (_evt, payload) => {
    const buffer = payload?.buffer;
    if (!buffer) throw new Error('buffer 不能为空');
    const lang = normalizeLang(payload?.lang);
    try {
      const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
      const result = await ocrService.recognize(buf, { lang });
      return { ok: true, result };
    } catch (err) {
      console.warn('[ocr/recognizeBuffer] failed:', err?.message || err);
      return { ok: false, error: String(err?.message || err) };
    }
  });

  ipcMain.handle('ocr/status', async () => {
    try {
      const status = await ocrService.getStatus();
      return { ok: true, ...status };
    } catch (err) {
      return { ok: false, error: String(err?.message || err), loaded: false };
    }
  });
}

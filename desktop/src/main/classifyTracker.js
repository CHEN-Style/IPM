import { BrowserWindow } from 'electron';

const STAGE = { QUEUED: 'queued', CLASSIFYING: 'classifying', CLASSIFIED: 'classified', FAILED: 'failed' };
const AUTO_CLEAR_MS = 30_000;
const IPC_CHANNEL = 'classify:status-changed';

export class ClassifyTracker {
  #items = new Map();
  #clearTimers = new Map();

  #key(projectName, sourceRelPath) {
    return `${projectName}::${sourceRelPath}`;
  }

  #broadcast(projectName) {
    const snapshot = this.getSnapshot(projectName);
    try {
      for (const w of BrowserWindow.getAllWindows()) {
        if (!w.isDestroyed()) {
          w.webContents.send(IPC_CHANNEL, { projectName, ...snapshot });
        }
      }
    } catch {
      // windows may be closing
    }
  }

  #scheduleClear(key) {
    if (this.#clearTimers.has(key)) clearTimeout(this.#clearTimers.get(key));
    this.#clearTimers.set(
      key,
      setTimeout(() => {
        const item = this.#items.get(key);
        if (item && (item.stage === STAGE.CLASSIFIED || item.stage === STAGE.FAILED)) {
          const pn = item.projectName;
          this.#items.delete(key);
          this.#clearTimers.delete(key);
          this.#broadcast(pn);
        }
      }, AUTO_CLEAR_MS),
    );
  }

  trackQueued(projectName, sourceRelPath, fileName) {
    const key = this.#key(projectName, sourceRelPath);
    this.#items.set(key, {
      projectName,
      sourceRelPath,
      fileName,
      stage: STAGE.QUEUED,
      queuedAt: Date.now(),
    });
    this.#broadcast(projectName);
  }

  trackClassifying(projectName, sourceRelPath) {
    const key = this.#key(projectName, sourceRelPath);
    const prev = this.#items.get(key);
    if (prev) {
      prev.stage = STAGE.CLASSIFYING;
      prev.classifyingAt = Date.now();
    } else {
      this.#items.set(key, {
        projectName,
        sourceRelPath,
        fileName: sourceRelPath.split('/').pop() || '',
        stage: STAGE.CLASSIFYING,
        classifyingAt: Date.now(),
      });
    }
    this.#broadcast(projectName);
  }

  trackClassified(projectName, sourceRelPath, result) {
    const key = this.#key(projectName, sourceRelPath);
    const prev = this.#items.get(key);
    if (prev) {
      prev.stage = STAGE.CLASSIFIED;
      prev.completedAt = Date.now();
      prev.result = result || {};
    } else {
      this.#items.set(key, {
        projectName,
        sourceRelPath,
        fileName: sourceRelPath.split('/').pop() || '',
        stage: STAGE.CLASSIFIED,
        completedAt: Date.now(),
        result: result || {},
      });
    }
    this.#broadcast(projectName);
    this.#scheduleClear(key);
  }

  trackFailed(projectName, sourceRelPath, error) {
    const key = this.#key(projectName, sourceRelPath);
    const prev = this.#items.get(key);
    if (prev) {
      prev.stage = STAGE.FAILED;
      prev.completedAt = Date.now();
      prev.error = error;
    } else {
      this.#items.set(key, {
        projectName,
        sourceRelPath,
        fileName: sourceRelPath.split('/').pop() || '',
        stage: STAGE.FAILED,
        completedAt: Date.now(),
        error,
      });
    }
    this.#broadcast(projectName);
    this.#scheduleClear(key);
  }

  getSnapshot(projectName) {
    const queued = [];
    const classifying = [];
    const classified = [];
    const failed = [];
    for (const item of this.#items.values()) {
      if (item.projectName !== projectName) continue;
      const entry = {
        sourceRelPath: item.sourceRelPath,
        fileName: item.fileName,
        stage: item.stage,
      };
      if (item.stage === STAGE.QUEUED) queued.push(entry);
      else if (item.stage === STAGE.CLASSIFYING) classifying.push(entry);
      else if (item.stage === STAGE.CLASSIFIED) classified.push({ ...entry, result: item.result });
      else if (item.stage === STAGE.FAILED) failed.push({ ...entry, error: item.error });
    }
    return { queued, classifying, classified, failed };
  }

  clearCompleted(projectName) {
    for (const [key, item] of this.#items.entries()) {
      if (item.projectName !== projectName) continue;
      if (item.stage === STAGE.CLASSIFIED || item.stage === STAGE.FAILED) {
        this.#items.delete(key);
        if (this.#clearTimers.has(key)) {
          clearTimeout(this.#clearTimers.get(key));
          this.#clearTimers.delete(key);
        }
      }
    }
    this.#broadcast(projectName);
  }
}

const SYSTEM_FOLDERS = new Set(['meta', 'temp', 'snippets', 'snippets/snippets-meta']);

export function validateClassifyOutput(output, folders) {
  const errors = [];

  if (!output || typeof output !== 'object') {
    return { valid: false, errors: ['Output is null or not an object'] };
  }

  const { targetRelPath, confidence } = output;

  if (typeof targetRelPath !== 'string' || !targetRelPath) {
    errors.push('targetRelPath is missing or empty');
  } else {
    const allowedPaths = new Set(folders.map((f) => f.relPath));
    if (!allowedPaths.has(targetRelPath)) {
      errors.push(`targetRelPath "${targetRelPath}" is not in the candidate folder list`);
    }

    if (SYSTEM_FOLDERS.has(targetRelPath) || targetRelPath.startsWith('meta/')) {
      errors.push(`targetRelPath "${targetRelPath}" is a system directory — classification forbidden`);
    }

    if (targetRelPath === '') {
      errors.push('targetRelPath cannot be project root');
    }
  }

  if (typeof confidence !== 'number' || confidence < 0 || confidence > 1) {
    errors.push(`confidence must be a number between 0 and 1, got: ${confidence}`);
  }

  return { valid: errors.length === 0, errors };
}

const DEFAULT_TIMEOUT_MS = 60_000;

export function withTimeout(promise, ms = DEFAULT_TIMEOUT_MS, onTimeout) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      if (typeof onTimeout === 'function') onTimeout();
      reject(new Error(`Agent timed out after ${ms}ms`));
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

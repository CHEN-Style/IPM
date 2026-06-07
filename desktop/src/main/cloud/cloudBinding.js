// C2: Cloud binding read/write for a local workspace.
//
// A bound workspace carries a `meta/cloud.json` file that links the local
// project/case directory to a cloud workspace. C2 only reads this file to
// determine binding status; the file is actually written in C3 once a local
// project is successfully published to the cloud.
//
// The schema is intentionally robust so later phases (external sources,
// connectors) can extend it without breaking older clients: unknown fields
// are preserved on read, and `features` / `extra` are open-ended containers.

import fs from 'node:fs';
import path from 'node:path';

export const CLOUD_BINDING_FILENAME = 'cloud.json';
export const CLOUD_BINDING_SCHEMA_VERSION = 1;

function getCloudBindingPath(projectRootPath) {
  return path.join(projectRootPath, 'meta', CLOUD_BINDING_FILENAME);
}

/**
 * Read `meta/cloud.json` for a workspace. Returns the parsed object, or
 * `null` if the file does not exist or cannot be parsed.
 */
export function readCloudBinding(projectRootPath) {
  const filePath = getCloudBindingPath(projectRootPath);
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Write `meta/cloud.json` for a workspace. Fills in `schemaVersion` and the
 * open-ended `features` / `extra` containers if the caller omitted them.
 *
 * C2 exposes this for completeness; the publish flow in C3 is the first real
 * caller. Writing is atomic-ish (write to tmp, then rename).
 */
export function writeCloudBinding(projectRootPath, bindingData) {
  const filePath = getCloudBindingPath(projectRootPath);
  const metaDir = path.dirname(filePath);
  fs.mkdirSync(metaDir, { recursive: true });

  const now = new Date().toISOString();
  const existing = readCloudBinding(projectRootPath) || {};
  const merged = {
    schemaVersion: CLOUD_BINDING_SCHEMA_VERSION,
    ...existing,
    ...bindingData,
    features: {
      ...(existing.features && typeof existing.features === 'object' ? existing.features : {}),
      ...(bindingData?.features && typeof bindingData.features === 'object' ? bindingData.features : {}),
    },
    extra: {
      ...(existing.extra && typeof existing.extra === 'object' ? existing.extra : {}),
      ...(bindingData?.extra && typeof bindingData.extra === 'object' ? bindingData.extra : {}),
    },
    updatedAt: now,
  };
  if (!merged.boundAt) merged.boundAt = now;

  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(merged, null, 2), 'utf-8');
  fs.renameSync(tmpPath, filePath);
  return merged;
}

/**
 * Remove `meta/cloud.json` (unbind a workspace). Returns true if a file was
 * removed, false if there was nothing to remove.
 */
export function removeCloudBinding(projectRootPath) {
  const filePath = getCloudBindingPath(projectRootPath);
  try {
    if (!fs.existsSync(filePath)) return false;
    fs.rmSync(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Determine whether a workspace is bound to the cloud.
 *
 * Returns `{ bound, binding }`. A workspace is considered bound only when the
 * file exists and carries a non-empty `cloudWorkspaceId`.
 */
export function getBindingStatus(projectRootPath) {
  const binding = readCloudBinding(projectRootPath);
  const bound = Boolean(binding && typeof binding.cloudWorkspaceId === 'string' && binding.cloudWorkspaceId);
  return { bound, binding: bound ? binding : null };
}

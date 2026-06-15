// H5: client-side skill version diffing.
//
// Manifests carry a `files[]` array of `{ path, sizeBytes, sha256? }`.
// Packages built before H5 lack per-file `sha256`; for those we degrade to a
// size comparison and flag the result with `fallback: true` so the UI can
// hint that the diff is approximate.

export function diffManifests(prevManifest, nextManifest) {
  const prevFiles = Array.isArray(prevManifest?.files) ? prevManifest.files : [];
  const nextFiles = Array.isArray(nextManifest?.files) ? nextManifest.files : [];
  const prevMap = new Map(prevFiles.map((f) => [f.path, f]));
  const nextMap = new Map(nextFiles.map((f) => [f.path, f]));

  const added = [];
  const removed = [];
  const changed = [];
  let unchanged = 0;
  let fallback = false;

  for (const [p, nf] of nextMap) {
    const pf = prevMap.get(p);
    if (!pf) {
      added.push(p);
      continue;
    }
    if (pf.sha256 && nf.sha256) {
      if (String(pf.sha256).toLowerCase() !== String(nf.sha256).toLowerCase()) changed.push(p);
      else unchanged += 1;
    } else {
      fallback = true;
      if (Number(pf.sizeBytes) !== Number(nf.sizeBytes)) changed.push(p);
      else unchanged += 1;
    }
  }
  for (const p of prevMap.keys()) {
    if (!nextMap.has(p)) removed.push(p);
  }

  return { added, removed, changed, unchanged, fallback };
}

export function diffSummaryText(diff) {
  if (!diff) return null;
  const parts = [];
  if (diff.added.length) parts.push(`+${diff.added.length} 新增`);
  if (diff.changed.length) parts.push(`${diff.changed.length} 修改`);
  if (diff.removed.length) parts.push(`-${diff.removed.length} 删除`);
  if (parts.length === 0) return '内容无变化';
  return parts.join(' · ') + (diff.fallback ? '(按大小估算)' : '');
}

// Parse the registry provenance string written by registryInstallSkill:
// `org_registry:<skillId>:<versionId>`. Returns null for non-registry skills.
export function parseRegistryProvenance(importedFrom) {
  const s = String(importedFrom || '');
  if (!s.startsWith('org_registry:')) return null;
  const parts = s.split(':');
  if (parts.length < 3) return null;
  return { skillId: parts[1], versionId: parts[2] };
}

// Suggest the next version by bumping the last numeric segment of the
// current one: 1.0.0 → 1.0.1, 2.3 → 2.4, v7 → v8. Falls back to '1.0.0'.
export function suggestNextVersion(current) {
  const s = String(current || '').trim();
  if (!s) return '1.0.0';
  const m = s.match(/^(.*?)(\d+)([^\d]*)$/);
  if (!m) return `${s}.1`;
  return `${m[1]}${Number(m[2]) + 1}${m[3]}`;
}

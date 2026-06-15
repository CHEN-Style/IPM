import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const PACKAGE_SCHEMA_VERSION = 1;
const EXCLUDED_DIRS = new Set(['.git', 'node_modules', '.DS_Store']);

export function isValidSkillName(name) {
  return typeof name === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(name);
}

function posixJoin(...parts) {
  return parts.filter(Boolean).join('/').replace(/\/+/g, '/');
}

function parseSkillFrontmatter(raw, fallbackName) {
  const text = String(raw || '');
  const fm = {};
  const match = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (match) {
    for (const line of match[1].split(/\r?\n/)) {
      const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
      if (m) fm[m[1]] = m[2].replace(/^['"]|['"]$/g, '').trim();
    }
  }
  return {
    name: typeof fm.name === 'string' && fm.name ? fm.name : fallbackName,
    description: typeof fm.description === 'string' ? fm.description : '',
    disableModelInvocation: String(fm['disable-model-invocation'] || '').toLowerCase() === 'true',
    raw: fm,
  };
}

function patchSkillName(raw, newName, fallbackDescription = '') {
  const text = String(raw || '');
  if (/^(name:\s*).+$/m.test(text)) return text.replace(/^(name:\s*).+$/m, `$1${newName}`);
  if (text.startsWith('---')) return text.replace(/^---\s*\n/, `---\nname: ${newName}\n`);
  return `---\nname: ${newName}\ndescription: ${fallbackDescription}\n---\n\n${text}`;
}

function walkFiles(root, rel = '') {
  const out = [];
  for (const entry of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.keep') continue;
    if (EXCLUDED_DIRS.has(entry.name)) continue;
    const childRel = rel ? path.join(rel, entry.name) : entry.name;
    const abs = path.join(root, childRel);
    if (entry.isDirectory()) out.push(...walkFiles(root, childRel));
    else if (entry.isFile()) out.push(abs);
  }
  return out;
}

function safeDestPath(root, relPath) {
  const clean = String(relPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!clean || clean.includes('..')) throw new Error(`invalid package path: ${relPath}`);
  const dest = path.resolve(root, ...clean.split('/').filter(Boolean));
  const rootResolved = path.resolve(root);
  const key = process.platform === 'win32' ? dest.toLowerCase() : dest;
  const rootKey = process.platform === 'win32' ? rootResolved.toLowerCase() : rootResolved;
  if (key !== rootKey && !key.startsWith(rootKey + path.sep)) {
    throw new Error(`package path escapes destination: ${relPath}`);
  }
  return dest;
}

export function createSkillPackage(skillDir, { version = '1.0.0', metadata = {} } = {}) {
  if (!skillDir || !fs.existsSync(skillDir) || !fs.statSync(skillDir).isDirectory()) {
    throw new Error('skillDir is not a directory');
  }
  const skillMdPath = path.join(skillDir, 'SKILL.md');
  if (!fs.existsSync(skillMdPath)) throw new Error('SKILL.md not found');
  const skillMd = fs.readFileSync(skillMdPath, 'utf-8');
  const parsed = parseSkillFrontmatter(skillMd, path.basename(skillDir));
  if (!isValidSkillName(parsed.name)) throw new Error(`invalid skill name: ${parsed.name}`);
  if (!parsed.description) throw new Error('SKILL.md frontmatter is missing description');

  const files = walkFiles(skillDir).map((abs) => {
    const rel = path.relative(skillDir, abs).replace(/\\/g, '/');
    const buf = fs.readFileSync(abs);
    return {
      path: rel,
      encoding: 'base64',
      content: buf.toString('base64'),
      sizeBytes: buf.length,
      // H5: per-file hash enables real version diffs; older packages without
      // it fall back to size-based comparison.
      sha256: crypto.createHash('sha256').update(buf).digest('hex'),
    };
  });
  const manifest = {
    name: parsed.name,
    slug: parsed.name,
    description: parsed.description,
    version,
    disableModelInvocation: parsed.disableModelInvocation,
    metadata,
    files: files.map((f) => ({ path: f.path, sizeBytes: f.sizeBytes, sha256: f.sha256 })),
  };
  const pkg = { schemaVersion: PACKAGE_SCHEMA_VERSION, manifest, files };
  const buffer = Buffer.from(JSON.stringify(pkg), 'utf-8');
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  return { buffer, sha256, sizeBytes: buffer.length, manifest };
}

export function readSkillPackage(buffer) {
  const text = Buffer.isBuffer(buffer) ? buffer.toString('utf-8') : Buffer.from(buffer).toString('utf-8');
  const pkg = JSON.parse(text);
  if (pkg?.schemaVersion !== PACKAGE_SCHEMA_VERSION) throw new Error('unsupported skill package schema');
  if (!pkg.manifest?.name || !Array.isArray(pkg.files)) throw new Error('invalid skill package');
  return pkg;
}

export function installSkillPackage(buffer, destRoot, {
  overwrite = false,
  newName = '',
  importedFrom = 'org_registry',
} = {}) {
  if (!destRoot) throw new Error('user skill root is not configured');
  const pkg = readSkillPackage(buffer);
  const originalName = pkg.manifest.name;
  const finalName = String(newName || originalName).trim();
  if (!isValidSkillName(finalName)) throw new Error(`invalid skill name: ${finalName}`);
  const destDir = path.join(destRoot, finalName);

  if (fs.existsSync(destDir)) {
    if (!overwrite) {
      return { ok: false, conflict: 'exists', conflictName: finalName, parsedName: originalName };
    }
    fs.rmSync(destDir, { recursive: true, force: true });
  }

  fs.mkdirSync(destDir, { recursive: true });
  for (const file of pkg.files) {
    const dest = safeDestPath(destDir, file.path);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    let content = Buffer.from(String(file.content || ''), file.encoding === 'base64' ? 'base64' : 'utf-8');
    if (file.path === 'SKILL.md' && finalName !== originalName) {
      content = Buffer.from(patchSkillName(content.toString('utf-8'), finalName, pkg.manifest.description), 'utf-8');
    }
    fs.writeFileSync(dest, content);
  }

  return {
    ok: true,
    renamed: finalName !== originalName,
    originalName,
    skill: {
      name: finalName,
      description: pkg.manifest.description || '',
      baseDir: destDir,
      filePath: path.join(destDir, 'SKILL.md'),
      source: 'imported',
      enabled: true,
      importedFrom,
    },
    manifest: pkg.manifest,
  };
}

export async function putBufferToSignedUrl(uploadUrl, buffer) {
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      // Must match the Content-Type signed by cloud/server ossClient.ts.
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(buffer.length),
    },
    body: buffer,
    duplex: 'half',
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Skill 包上传失败 (${res.status})${text ? `: ${text}` : ''}`);
  }
}

export async function downloadBuffer(downloadUrl) {
  const res = await fetch(downloadUrl, { method: 'GET' });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Skill 包下载失败 (${res.status})${text ? `: ${text}` : ''}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

export function sha256Of(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

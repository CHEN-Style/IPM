import fs from 'node:fs';
import path from 'node:path';
import { parseSkillMd, serializeSkillMd } from './skillParser.js';

const SKILLS_DIR = 'skills';
const SKILL_FILE = 'SKILL.md';

function skillsRoot(sandboxRoot) {
  return path.join(sandboxRoot, SKILLS_DIR);
}

function skillDir(sandboxRoot, skillName) {
  const safe = sanitizeName(skillName);
  if (!safe) throw new Error('Invalid skill name');
  return path.join(skillsRoot(sandboxRoot), safe);
}

function sanitizeName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

// ─── List ───

export function listSkills(sandboxRoot) {
  const root = skillsRoot(sandboxRoot);
  if (!fs.existsSync(root)) return [];

  const entries = fs.readdirSync(root, { withFileTypes: true });
  const results = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const mdPath = path.join(root, entry.name, SKILL_FILE);
    if (!fs.existsSync(mdPath)) continue;

    try {
      const raw = fs.readFileSync(mdPath, 'utf-8');
      const { meta } = parseSkillMd(raw);
      const scriptsDir = path.join(root, entry.name, 'scripts');
      const refsDir = path.join(root, entry.name, 'references');
      results.push({
        name: meta.name || entry.name,
        dirName: entry.name,
        description: meta.description,
        version: meta.version,
        maturity: meta.maturity,
        permissions: meta.permissions,
        hasScripts: fs.existsSync(scriptsDir) && fs.readdirSync(scriptsDir).length > 0,
        hasReferences: fs.existsSync(refsDir) && fs.readdirSync(refsDir).length > 0,
      });
    } catch {
      // skip malformed skill
    }
  }
  return results;
}

// ─── Get ───

export function getSkill(sandboxRoot, skillName) {
  const dir = skillDir(sandboxRoot, skillName);
  const mdPath = path.join(dir, SKILL_FILE);
  if (!fs.existsSync(mdPath)) throw new Error(`Skill "${skillName}" not found`);

  const raw = fs.readFileSync(mdPath, 'utf-8');
  const { meta, instructions } = parseSkillMd(raw);

  const scriptsDir = path.join(dir, 'scripts');
  const refsDir = path.join(dir, 'references');

  const scripts = fs.existsSync(scriptsDir)
    ? fs.readdirSync(scriptsDir).filter((f) => !f.startsWith('.'))
    : [];
  const references = fs.existsSync(refsDir)
    ? fs.readdirSync(refsDir).filter((f) => !f.startsWith('.'))
    : [];

  return { meta, instructions, scripts, references, dir, dirName: path.basename(dir) };
}

// ─── Create ───

export function createSkill(sandboxRoot, { name, description, permissions, maturity, inputs, instructions, scripts, references }) {
  const dirName = sanitizeName(name);
  if (!dirName) throw new Error('Invalid skill name');

  const dir = path.join(skillsRoot(sandboxRoot), dirName);
  if (fs.existsSync(dir)) throw new Error(`Skill "${dirName}" already exists`);

  fs.mkdirSync(dir, { recursive: true });

  const meta = {
    name: name || dirName,
    description: description || '',
    version: '1.0.0',
    permissions: permissions || [],
    maturity: maturity || 'draft',
    inputs: inputs || [],
  };

  const md = serializeSkillMd({ meta, instructions: instructions || '' });
  fs.writeFileSync(path.join(dir, SKILL_FILE), md, 'utf-8');

  if (scripts && typeof scripts === 'object') {
    const scriptsDir = path.join(dir, 'scripts');
    fs.mkdirSync(scriptsDir, { recursive: true });
    for (const [fileName, content] of Object.entries(scripts)) {
      fs.writeFileSync(path.join(scriptsDir, fileName), content, 'utf-8');
    }
  }

  if (references && typeof references === 'object') {
    const refsDir = path.join(dir, 'references');
    fs.mkdirSync(refsDir, { recursive: true });
    for (const [fileName, content] of Object.entries(references)) {
      fs.writeFileSync(path.join(refsDir, fileName), content, 'utf-8');
    }
  }

  return { dirName, dir, meta };
}

// ─── Update ───

export function updateSkill(sandboxRoot, skillName, patch) {
  const dir = skillDir(sandboxRoot, skillName);
  const mdPath = path.join(dir, SKILL_FILE);
  if (!fs.existsSync(mdPath)) throw new Error(`Skill "${skillName}" not found`);

  const raw = fs.readFileSync(mdPath, 'utf-8');
  const { meta, instructions } = parseSkillMd(raw);

  if (patch.description !== undefined) meta.description = patch.description;
  if (patch.version !== undefined) meta.version = patch.version;
  if (patch.permissions !== undefined) meta.permissions = patch.permissions;
  if (patch.maturity !== undefined) meta.maturity = patch.maturity;
  if (patch.inputs !== undefined) meta.inputs = patch.inputs;
  if (patch.name !== undefined) meta.name = patch.name;

  const newInstructions = patch.instructions !== undefined ? patch.instructions : instructions;

  const md = serializeSkillMd({ meta, instructions: newInstructions });
  fs.writeFileSync(mdPath, md, 'utf-8');

  if (patch.scripts && typeof patch.scripts === 'object') {
    const scriptsDir = path.join(dir, 'scripts');
    fs.mkdirSync(scriptsDir, { recursive: true });
    for (const [fileName, content] of Object.entries(patch.scripts)) {
      fs.writeFileSync(path.join(scriptsDir, fileName), content, 'utf-8');
    }
  }

  if (patch.references && typeof patch.references === 'object') {
    const refsDir = path.join(dir, 'references');
    fs.mkdirSync(refsDir, { recursive: true });
    for (const [fileName, content] of Object.entries(patch.references)) {
      fs.writeFileSync(path.join(refsDir, fileName), content, 'utf-8');
    }
  }

  return { dirName: path.basename(dir), meta };
}

// ─── Delete ───

export function deleteSkill(sandboxRoot, skillName) {
  const dir = skillDir(sandboxRoot, skillName);
  if (!fs.existsSync(dir)) throw new Error(`Skill "${skillName}" not found`);
  fs.rmSync(dir, { recursive: true, force: true });
  return { deleted: skillName };
}

// ─── Maturity ───

export function setSkillMaturity(sandboxRoot, skillName, maturity) {
  if (!['draft', 'stable'].includes(maturity)) {
    throw new Error(`Invalid maturity: ${maturity}. Must be "draft" or "stable".`);
  }
  return updateSkill(sandboxRoot, skillName, { maturity });
}

// ─── Script path resolution ───

export function getSkillScriptPath(sandboxRoot, skillName, relScriptPath) {
  const dir = skillDir(sandboxRoot, skillName);
  const abs = path.resolve(dir, 'scripts', relScriptPath);
  if (!abs.startsWith(dir)) throw new Error('Script path escapes skill directory');
  if (!fs.existsSync(abs)) throw new Error(`Script not found: ${relScriptPath}`);
  return abs;
}

// ─── Read reference content ───

export function readReference(sandboxRoot, skillName, refFileName) {
  const dir = skillDir(sandboxRoot, skillName);
  const abs = path.resolve(dir, 'references', refFileName);
  if (!abs.startsWith(dir)) throw new Error('Reference path escapes skill directory');
  if (!fs.existsSync(abs)) throw new Error(`Reference not found: ${refFileName}`);
  return fs.readFileSync(abs, 'utf-8');
}

/**
 * Lightweight SKILL.md parser / serializer.
 *
 * Format:
 *   ---
 *   name: foo
 *   description: bar
 *   ...
 *   ---
 *   <markdown instructions body>
 *
 * We hand-roll the YAML-subset parser to avoid adding gray-matter / js-yaml deps.
 * Supported value types: string, number, boolean, simple arrays (- item), nested objects (one level).
 */

const FRONTMATTER_FENCE = '---';

// ─── Parse ───

export function parseSkillMd(raw) {
  const text = (raw || '').replace(/\r\n/g, '\n');
  const lines = text.split('\n');

  let fmStart = -1;
  let fmEnd = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === FRONTMATTER_FENCE) {
      if (fmStart === -1) { fmStart = i; }
      else { fmEnd = i; break; }
    }
  }

  let meta = {};
  let body = text;
  if (fmStart !== -1 && fmEnd !== -1) {
    const fmLines = lines.slice(fmStart + 1, fmEnd);
    meta = parseSimpleYaml(fmLines);
    body = lines.slice(fmEnd + 1).join('\n').replace(/^\n+/, '');
  }

  meta.name = meta.name || '';
  meta.description = meta.description || '';
  meta.version = meta.version || '1.0.0';
  meta.permissions = Array.isArray(meta.permissions) ? meta.permissions : [];
  meta.maturity = meta.maturity || 'draft';
  if (!Array.isArray(meta.inputs)) meta.inputs = [];

  return { meta, instructions: body };
}

// ─── Serialize ───

export function serializeSkillMd({ meta, instructions }) {
  const lines = [FRONTMATTER_FENCE];
  lines.push(`name: ${meta.name || ''}`);
  lines.push(`description: ${meta.description || ''}`);
  lines.push(`version: ${meta.version || '1.0.0'}`);

  if (meta.permissions?.length) {
    lines.push('permissions:');
    for (const p of meta.permissions) lines.push(`  - ${p}`);
  }

  lines.push(`maturity: ${meta.maturity || 'draft'}`);

  if (meta.inputs?.length) {
    lines.push('inputs:');
    for (const inp of meta.inputs) {
      lines.push(`  - name: ${inp.name || ''}`);
      if (inp.type) lines.push(`    type: ${inp.type}`);
      if (inp.description) lines.push(`    description: ${inp.description}`);
    }
  }

  lines.push(FRONTMATTER_FENCE);
  lines.push('');
  lines.push(instructions || '');
  return lines.join('\n');
}

// ─── Minimal YAML-subset parser ───

function parseSimpleYaml(lines) {
  const result = {};
  let currentKey = null;
  let currentArray = null;
  let currentObj = null;
  let isObjArray = false;

  for (const raw of lines) {
    const line = raw;
    if (line.trim() === '' || line.trim().startsWith('#')) continue;

    const indent = line.search(/\S/);

    if (indent === 0) {
      flushArrayOrObj();
      const m = line.match(/^(\w[\w\-.]*)\s*:\s*(.*)/);
      if (!m) continue;
      const key = m[1];
      const val = m[2].trim();
      if (val === '') {
        currentKey = key;
        currentArray = [];
        isObjArray = false;
        currentObj = null;
      } else {
        result[key] = coerce(val);
      }
    } else if (indent >= 2 && currentKey !== null) {
      const trimmed = line.trim();
      if (trimmed.startsWith('- ')) {
        const itemVal = trimmed.slice(2).trim();
        const kvMatch = itemVal.match(/^(\w[\w\-.]*)\s*:\s*(.*)/);
        if (kvMatch) {
          if (currentObj) currentArray.push(currentObj);
          currentObj = { [kvMatch[1]]: coerce(kvMatch[2].trim()) };
          isObjArray = true;
        } else {
          if (!isObjArray) {
            currentArray.push(coerce(itemVal));
          }
        }
      } else if (isObjArray && currentObj) {
        const kvMatch = trimmed.match(/^(\w[\w\-.]*)\s*:\s*(.*)/);
        if (kvMatch) {
          currentObj[kvMatch[1]] = coerce(kvMatch[2].trim());
        }
      }
    }
  }

  flushArrayOrObj();
  return result;

  function flushArrayOrObj() {
    if (currentKey === null) return;
    if (isObjArray && currentObj) currentArray.push(currentObj);
    result[currentKey] = currentArray;
    currentKey = null;
    currentArray = null;
    currentObj = null;
    isObjArray = false;
  }
}

function coerce(val) {
  if (val === 'true') return true;
  if (val === 'false') return false;
  if (val === 'null' || val === '~') return null;
  if (/^-?\d+(\.\d+)?$/.test(val)) return Number(val);
  return val.replace(/^["']|["']$/g, '');
}

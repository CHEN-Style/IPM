import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const MAX_TEXT_SIZE = 512 * 1024;
const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp',
  '.mp3', '.mp4', '.avi', '.mov', '.wmv', '.flv',
  '.zip', '.rar', '.7z', '.tar', '.gz',
  '.exe', '.dll', '.so', '.dylib',
  '.db', '.sqlite', '.sqlite3',
]);

const DOCX_EXTRACT_SCRIPT = `
import zipfile, xml.etree.ElementTree as ET, sys, os
fp = sys.argv[1]
if not os.path.isfile(fp):
    print("ERROR: file not found: " + fp)
    sys.exit(1)
with zipfile.ZipFile(fp) as z:
    xml_data = z.read('word/document.xml')
tree = ET.fromstring(xml_data)
ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
paragraphs = tree.findall('.//w:p', ns)
for p in paragraphs:
    texts = [node.text or '' for node in p.findall('.//w:t', ns)]
    line = ''.join(texts).strip()
    if line:
        print(line)
`;

const XLSX_EXTRACT_SCRIPT = `
import zipfile, xml.etree.ElementTree as ET, sys, os, re
fp = sys.argv[1]
if not os.path.isfile(fp):
    print("ERROR: file not found: " + fp)
    sys.exit(1)
with zipfile.ZipFile(fp) as z:
    shared = {}
    if 'xl/sharedStrings.xml' in z.namelist():
        st = ET.fromstring(z.read('xl/sharedStrings.xml'))
        ns = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
        for i, si in enumerate(st.findall('.//s:si', ns)):
            texts = [t.text or '' for t in si.findall('.//s:t', ns)]
            shared[i] = ''.join(texts)
    sheets = [n for n in z.namelist() if re.match(r'xl/worksheets/sheet\\d+\\.xml', n)]
    sheets.sort()
    ns2 = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
    for sn in sheets[:5]:
        print(f"=== {sn} ===")
        tree = ET.fromstring(z.read(sn))
        for row in tree.findall('.//s:row', ns2):
            cells = []
            for c in row.findall('s:c', ns2):
                v = c.find('s:v', ns2)
                val = v.text if v is not None else ''
                if c.get('t') == 's' and val.isdigit():
                    val = shared.get(int(val), val)
                cells.append(val)
            print('\\t'.join(cells))
`;

const DOCUMENT_EXTRACTORS = {
  '.docx': DOCX_EXTRACT_SCRIPT,
  '.xlsx': XLSX_EXTRACT_SCRIPT,
};

function findPython() {
  const candidates = ['python3', 'python'];
  for (const cmd of candidates) {
    try {
      execFileSync(cmd, ['--version'], { encoding: 'utf-8', timeout: 5000, stdio: 'pipe' });
      return cmd;
    } catch { /* try next */ }
  }
  return null;
}

let _cachedPython;
function getPython() {
  if (_cachedPython === undefined) _cachedPython = findPython();
  return _cachedPython;
}

function extractDocumentText(resolvedPath, ext) {
  const script = DOCUMENT_EXTRACTORS[ext];
  if (!script) return null;

  const python = getPython();
  if (!python) return `[无法提取 ${ext} 文件内容: 系统未安装 Python]\n文件路径: ${resolvedPath}`;

  try {
    const stdout = execFileSync(python, ['-c', script, resolvedPath], {
      encoding: 'utf-8',
      timeout: 30_000,
      maxBuffer: 5 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    if (!stdout.trim()) return `[${ext} 文件解析成功但内容为空]\n文件路径: ${resolvedPath}`;
    return `[从 ${ext} 提取的文本内容]\n文件: ${path.basename(resolvedPath)}\n路径: ${resolvedPath}\n${'─'.repeat(40)}\n${stdout}`;
  } catch (e) {
    const stderr = e.stderr ? e.stderr.toString().slice(0, 500) : '';
    return `[${ext} 文件解析失败]\n文件路径: ${resolvedPath}\n错误: ${e.message}\n${stderr ? `详情: ${stderr}` : ''}`;
  }
}

export function createReadFileContentTool(deps = {}) {
  const { getWorkspaceDirs } = deps;

  function resolveFilePath(filePath) {
    const tryPaths = [];

    const direct = path.resolve(filePath);
    tryPaths.push(direct);
    if (fs.existsSync(direct)) return { resolved: direct, tryPaths };

    if (path.isAbsolute(filePath)) return { resolved: null, tryPaths };

    if (getWorkspaceDirs) {
      const dirs = getWorkspaceDirs();
      const roots = [dirs.projectsRoot, dirs.casesRoot, dirs.studyRoot].filter(Boolean);
      for (const root of roots) {
        const candidate = path.join(root, filePath);
        tryPaths.push(candidate);
        if (fs.existsSync(candidate)) return { resolved: candidate, tryPaths };

        try {
          const entries = fs.readdirSync(root);
          for (const sub of entries) {
            const subCandidate = path.join(root, sub, filePath);
            tryPaths.push(subCandidate);
            if (fs.existsSync(subCandidate)) return { resolved: subCandidate, tryPaths };
          }
        } catch { /* skip unreadable root */ }
      }
    }
    return { resolved: null, tryPaths };
  }

  return tool(
    async ({ filePath, maxLines }) => {
      try {
        const { resolved, tryPaths } = resolveFilePath(filePath);
        if (!resolved) {
          const tried = tryPaths.map((p) => `  - ${p}`).join('\n');
          return `文件不存在: ${filePath}\n\n[路径解析诊断] 尝试了以下路径均未找到:\n${tried}\n\n提示: 请使用 absolutePath（从 supervisor_search_files 或 supervisor_inspect_folder 返回的 absolutePath 字段）`;
        }

        const stat = fs.statSync(resolved);
        if (!stat.isFile()) return `路径不是文件: ${filePath} (resolved: ${resolved})`;

        const ext = path.extname(resolved).toLowerCase();

        if (DOCUMENT_EXTRACTORS[ext]) {
          return extractDocumentText(resolved, ext);
        }

        if (BINARY_EXTENSIONS.has(ext)) {
          return JSON.stringify({
            type: 'binary',
            name: path.basename(resolved),
            resolvedPath: resolved,
            ext,
            size: stat.size,
            modified: stat.mtime.toISOString(),
            message: '二进制文件，无法直接读取内容',
          });
        }

        if (stat.size > MAX_TEXT_SIZE) {
          const content = fs.readFileSync(resolved, 'utf-8').slice(0, MAX_TEXT_SIZE);
          return `[截断: 文件大小 ${stat.size} bytes, 仅显示前 ${MAX_TEXT_SIZE} bytes]\n路径: ${resolved}\n${'─'.repeat(40)}\n${content}`;
        }

        let content = fs.readFileSync(resolved, 'utf-8');
        if (maxLines && maxLines > 0) {
          const lines = content.split('\n');
          if (lines.length > maxLines) {
            content = lines.slice(0, maxLines).join('\n') + `\n\n[... 共 ${lines.length} 行, 仅显示前 ${maxLines} 行]`;
          }
        }
        return `[文件: ${path.basename(resolved)}]\n路径: ${resolved}\n${'─'.repeat(40)}\n${content}`;
      } catch (e) {
        return `读取文件失败: ${e.message}\n输入路径: ${filePath}`;
      }
    },
    {
      name: 'read_file_content',
      description: 'Read file content. Supports plain text, .docx, .xlsx. Use absolutePath from supervisor_search_files/supervisor_inspect_folder for reliable results. Returns extracted text for document formats.',
      schema: z.object({
        filePath: z.string().min(1).describe('File path — use absolutePath from search/inspect tool results for best reliability'),
        maxLines: z.number().optional().describe('Max lines to read (default: all)'),
      }),
    },
  );
}

export function createWriteFileContentTool(deps = {}) {
  const { getWorkspaceDirs } = deps;

  function resolveWritePath(filePath) {
    if (path.isAbsolute(filePath)) return filePath;

    if (getWorkspaceDirs) {
      const dirs = getWorkspaceDirs();
      const roots = [dirs.projectsRoot, dirs.casesRoot, dirs.studyRoot].filter(Boolean);
      for (const root of roots) {
        const candidate = path.join(root, filePath);
        if (fs.existsSync(path.dirname(candidate))) return candidate;
        try {
          const entries = fs.readdirSync(root);
          for (const sub of entries) {
            const subCandidate = path.join(root, sub, filePath);
            if (fs.existsSync(path.dirname(subCandidate))) return subCandidate;
          }
        } catch { /* skip */ }
      }
    }
    return path.resolve(filePath);
  }

  return tool(
    async ({ filePath, content, append }) => {
      try {
        const resolved = resolveWritePath(filePath);
        const dir = path.dirname(resolved);
        fs.mkdirSync(dir, { recursive: true });

        if (append) {
          fs.appendFileSync(resolved, content, 'utf-8');
          return `已追加内容到: ${resolved}`;
        }
        fs.writeFileSync(resolved, content, 'utf-8');
        return `已写入文件: ${resolved} (${Buffer.byteLength(content, 'utf-8')} bytes)`;
      } catch (e) {
        return `写入文件失败: ${e.message}\n输入路径: ${filePath}`;
      }
    },
    {
      name: 'write_file_content',
      description: 'Write or append text content to a file. Creates parent directories if needed.',
      schema: z.object({
        filePath: z.string().min(1).describe('Absolute or relative path to the file'),
        content: z.string().describe('Text content to write'),
        append: z.boolean().optional().default(false).describe('Append to file instead of overwrite'),
      }),
    },
  );
}

// desktop/src/ui/components/knowclaw-v2/SkillDetailModal.jsx
//
// SK1: full-screen detail modal for a single skill. Triggered by
// clicking a row inside `SkillManagerPanel`. Loads the SKILL.md body
// via `knowclaw:getSkillContent`, renders it as Markdown, and shows
// the skill's metadata header (name / source / enabled / path).
//
// We follow CardReaderModal's structural pattern (fixed inset-0 +
// backdrop blur + click-outside-to-close) but keep it lighter — no
// entry/exit animations, no scale transform. The skill modal is a
// reference view, not a primary surface.
//
// Markdown rendering re-uses the same `marked` setup as
// FloatingChatList: GFM + breaks, no sanitization. SKILL.md content
// comes from disk paths inside two trusted roots
// (`KNOWCLAW_SKILLS_DIR` and `KNOWCLAW_USER_SKILLS_ROOT`), validated
// by the main-process `isSafeSkillPath` guard before any read. The
// renderer therefore inherits that trust boundary — same posture as
// every other markdown surface in the app.

import { useEffect, useMemo, useState } from 'react';
import { X, Puzzle, Loader2, FolderOpen, ExternalLink } from 'lucide-react';
import { marked } from 'marked';

// Module-level config: idempotent — `marked.setOptions` is safe to
// call multiple times (every other markdown surface in the codebase
// calls it the same way at module load).
marked.setOptions({ breaks: true, gfm: true });

function renderMarkdown(text) {
  if (!text) return '';
  try {
    return marked.parse(text);
  } catch {
    // Fallback: at least show the text with HTML linebreaks so the
    // user isn't stuck looking at a blank modal if marked crashes on
    // exotic input.
    return String(text).replace(/\n/g, '<br/>');
  }
}

const SOURCE_LABELS = {
  builtin: { text: '内置', cls: 'bg-slate-100 text-slate-600' },
  user: { text: '用户', cls: 'bg-emerald-50 text-emerald-700' },
  imported: { text: '导入', cls: 'bg-blue-50 text-blue-700' },
  // SK4: workspace skills live under `<cwd>/.knowclaw/skills/` and only
  // load when the matching workspace is active.
  workspace: { text: '工作空间', cls: 'bg-amber-50 text-amber-700' },
};

const SkillDetailModal = ({ skill, onClose, cwd }) => {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Fetch SKILL.md whenever the modal opens with a different skill.
  // We don't cache across opens — skill files are small, the user
  // expects fresh content if they edited the file out of band.
  //
  // SK4: forward `cwd` so the main-side safety check trusts paths
  // under the active workspace's `.knowclaw/skills/`. Without it,
  // workspace-scoped skill files would fail the trusted-root probe
  // and the modal would only ever show "filePath is not within a
  // trusted skill root".
  useEffect(() => {
    if (!skill?.filePath) return undefined;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setContent('');
    window.ipm?.skills?.getContent?.(skill.filePath, { cwd: cwd || undefined })
      .then((res) => {
        if (cancelled) return;
        if (res?.ok) {
          // Prefer `body` (frontmatter stripped) for the rendered area;
          // the header above already shows name + description so we
          // don't want them duplicated as raw YAML at the top of the
          // body.
          setContent(res.body || res.content || '');
        } else {
          setError(res?.error || '加载失败');
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setError(String(err?.message || err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [skill?.filePath, cwd]);

  // Close on Escape. Mirrors the implicit contract of `useConfirmDialog`
  // and CardReaderModal — every modal in this app responds to Escape.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const html = useMemo(() => renderMarkdown(content), [content]);

  if (!skill) return null;

  const sourceMeta = SOURCE_LABELS[skill.source] || SOURCE_LABELS.user;

  return (
    <div
      className="fixed inset-0 z-[2000] flex items-center justify-center"
      style={{
        background: 'rgba(15, 23, 42, 0.35)',
        backdropFilter: 'blur(6px)',
      }}
      onClick={onClose}
    >
      <div
        className="w-[min(720px,92vw)] max-h-[min(82vh,820px)] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="shrink-0 px-6 py-4 border-b border-slate-100 flex items-start gap-3">
          <div className="h-10 w-10 rounded-xl bg-indigo-50 flex items-center justify-center shrink-0">
            <Puzzle size={18} className="text-indigo-500" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-[16px] font-semibold text-slate-800 truncate">{skill.name}</h2>
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${sourceMeta.cls}`}>
                {sourceMeta.text}
              </span>
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded ${
                  skill.enabled
                    ? 'bg-emerald-50 text-emerald-700'
                    : 'bg-slate-100 text-slate-500'
                }`}
              >
                {skill.enabled ? '已启用' : '已禁用'}
              </span>
              {skill.disableModelInvocation && (
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700"
                  title="此技能不会出现在 system prompt 中，仅可通过 /skill:name 命令显式调用"
                >
                  manual-only
                </span>
              )}
            </div>
            <p className="text-[12px] text-slate-500 mt-1 leading-relaxed">
              {skill.description}
            </p>
            <div className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-400">
              <FolderOpen size={11} className="shrink-0" />
              <span className="truncate" title={skill.filePath}>
                {skill.filePath}
              </span>
              {window.ipm?.knowclaw?.openInExplorer && (
                <button
                  type="button"
                  onClick={() => window.ipm.knowclaw.openInExplorer(skill.baseDir)}
                  className="ml-1 h-5 w-5 flex items-center justify-center rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors shrink-0"
                  title="在文件管理器中打开技能目录"
                  aria-label="在文件管理器中打开"
                >
                  <ExternalLink size={11} />
                </button>
              )}
            </div>
            {skill.source === 'imported' && skill.importedFrom && (
              <div className="mt-1 text-[11px] text-slate-400">
                导入自：<span className="text-slate-500">{skill.importedFrom}</span>
                {skill.importedAt && (
                  <span className="ml-1">
                    （{new Date(skill.importedAt).toLocaleString('zh-CN')}）
                  </span>
                )}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-8 w-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors shrink-0"
            title="关闭（Esc）"
            aria-label="关闭"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5">
          {loading && (
            <div className="flex items-center justify-center py-10 text-slate-400 text-[13px]">
              <Loader2 size={16} className="animate-spin mr-2" />
              正在读取 SKILL.md...
            </div>
          )}
          {!loading && error && (
            <div className="px-4 py-3 rounded-lg bg-rose-50 border border-rose-200 text-[13px] text-rose-700">
              加载失败：{error}
            </div>
          )}
          {!loading && !error && (
            <div
              className="skill-md-body text-[13px] text-slate-700 leading-relaxed"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          )}
        </div>
      </div>

      {/*
        Inline scoped styles for the markdown body. Keeps the heading
        hierarchy / code blocks / lists readable without pulling in
        Tailwind Typography (the project doesn't have it). We use a
        plain <style> tag and the `.skill-md-body` class as a scope.
        Note: this <style> tag is colocated with the modal so its
        rules don't leak — the class itself is namespaced enough.
      */}
      <style>{`
        .skill-md-body h1 { font-size: 18px; font-weight: 600; color: #1e293b; margin: 0 0 12px; line-height: 1.4; }
        .skill-md-body h2 { font-size: 15px; font-weight: 600; color: #334155; margin: 18px 0 8px; line-height: 1.4; }
        .skill-md-body h3 { font-size: 13px; font-weight: 600; color: #475569; margin: 14px 0 6px; line-height: 1.4; }
        .skill-md-body h4, .skill-md-body h5, .skill-md-body h6 { font-size: 13px; font-weight: 600; color: #475569; margin: 10px 0 4px; }
        .skill-md-body p { margin: 0 0 10px; }
        .skill-md-body ul, .skill-md-body ol { margin: 0 0 10px; padding-left: 22px; }
        .skill-md-body li { margin: 2px 0; }
        .skill-md-body li > p { margin: 0; }
        .skill-md-body code { font-size: 12px; padding: 1px 4px; border-radius: 3px; background: #f1f5f9; color: #be185d; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
        .skill-md-body pre { margin: 8px 0 12px; padding: 10px 12px; border-radius: 8px; background: #0f172a; color: #e2e8f0; font-size: 12px; line-height: 1.55; overflow-x: auto; }
        .skill-md-body pre code { background: transparent; color: inherit; padding: 0; font-size: 12px; }
        .skill-md-body blockquote { margin: 8px 0; padding: 4px 12px; border-left: 3px solid #cbd5e1; color: #64748b; background: #f8fafc; border-radius: 0 6px 6px 0; }
        .skill-md-body a { color: #4f46e5; text-decoration: none; }
        .skill-md-body a:hover { text-decoration: underline; }
        .skill-md-body hr { border: none; border-top: 1px solid #e2e8f0; margin: 14px 0; }
        .skill-md-body table { border-collapse: collapse; margin: 8px 0 12px; font-size: 12px; }
        .skill-md-body th, .skill-md-body td { border: 1px solid #e2e8f0; padding: 4px 8px; }
        .skill-md-body th { background: #f8fafc; font-weight: 600; }
        .skill-md-body strong { font-weight: 600; color: #1e293b; }
        .skill-md-body em { font-style: italic; }
      `}</style>
    </div>
  );
};

export default SkillDetailModal;

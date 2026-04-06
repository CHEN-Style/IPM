import React, { useMemo } from 'react';
import { Lock } from 'lucide-react';
import { marked } from 'marked';

const TAG_PALETTE = [
  '#E0F2FE', '#DBEAFE', '#EDE9FE', '#FCE7F3', '#FEE2E2',
  '#FEF3C7', '#D1FAE5', '#ECFDF5', '#FFF7ED', '#F0FDF4',
];
const TAG_TEXT_PALETTE = [
  '#0369A1', '#1D4ED8', '#6D28D9', '#BE185D', '#B91C1C',
  '#A16207', '#047857', '#065F46', '#C2410C', '#15803D',
];

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function TagCapsules({ tags }) {
  if (!tags || tags.length === 0) return null;
  const parsed = Array.isArray(tags) ? tags : (() => { try { return JSON.parse(tags); } catch { return []; } })();
  if (parsed.length === 0) return null;
  const show = parsed.slice(0, 3);
  const extra = parsed.length - 3;
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 8 }}>
      {show.map((t) => {
        const idx = hashStr(t) % TAG_PALETTE.length;
        return (
          <span key={t} style={{
            fontSize: 9, padding: '1px 6px', borderRadius: 9999,
            background: TAG_PALETTE[idx], color: TAG_TEXT_PALETTE[idx],
            fontFamily: 'Inter, system-ui, sans-serif',
            letterSpacing: '0.02em', whiteSpace: 'nowrap',
          }}>
            {t}
          </span>
        );
      })}
      {extra > 0 && (
        <span style={{
          fontSize: 9, padding: '1px 6px', borderRadius: 9999,
          background: '#F3F4F6', color: '#9CA3AF',
          fontFamily: 'Inter, system-ui, sans-serif',
        }}>
          +{extra}
        </span>
      )}
    </div>
  );
}

const CARD_STYLES = {
  snippet: {
    bg: '#FFFBE0',
    shadow: '0 4px 6px -1px rgba(0,0,0,0.05), 0 2px 4px -1px rgba(0,0,0,0.03)',
    padding: '20px',
  },
  webclip: {
    bg: '#FFFDF2',
    shadow: '0 4px 6px -1px rgba(0,0,0,0.05), 0 2px 4px -1px rgba(0,0,0,0.03)',
    padding: '20px',
  },
  note: {
    bg: '#ffffff',
    shadow: '0 4px 6px -1px rgba(0,0,0,0.05), 0 2px 4px -1px rgba(0,0,0,0.03)',
    padding: '24px',
  },
  screenshot: {
    bg: '#ffffff',
    shadow: '0 10px 15px -3px rgba(0,0,0,0.08), 0 4px 6px -2px rgba(0,0,0,0.04)',
    padding: '10px',
    paddingBottom: '28px',
  },
  draft: {
    bg: '#FFF9E6',
    shadow: '0 4px 6px -1px rgba(0,0,0,0.05), 0 2px 4px -1px rgba(0,0,0,0.03)',
    padding: '18px',
  },
};

const MD_STYLE = `
.board-md h1,.board-md h2,.board-md h3,.board-md h4{margin:0 0 6px;font-weight:600;color:#1F2937;line-height:1.4}
.board-md h1{font-size:15px;border-bottom:1px solid #E5E7EB;padding-bottom:4px;margin-bottom:8px}
.board-md h2{font-size:13px;color:#374151;border-bottom:1px solid #F3F4F6;padding-bottom:3px;margin-bottom:6px}
.board-md h3{font-size:12px;color:#4B5563}
.board-md h4{font-size:11px;color:#6B7280}
.board-md p{margin:0 0 6px;font-size:12px;line-height:1.7;color:#374151}
.board-md ul,.board-md ol{margin:0 0 6px;padding-left:18px}
.board-md li{font-size:12px;line-height:1.6;color:#374151;margin-bottom:2px}
.board-md strong{font-weight:600;color:#1F2937}
.board-md em{font-style:italic;color:#6B7280}
.board-md code{font-size:11px;background:#F3F4F6;padding:1px 4px;border-radius:3px;font-family:'Fira Code',monospace;color:#B91C1C}
.board-md pre{background:#F9FAFB;border:1px solid #E5E7EB;border-radius:6px;padding:8px;margin:4px 0 8px;overflow-x:auto}
.board-md pre code{background:none;padding:0;color:#374151;font-size:11px}
.board-md blockquote{margin:4px 0 8px;padding:4px 10px;border-left:3px solid #4a9e8e;background:rgba(74,158,142,0.04);color:#6B7280;font-size:12px}
.board-md hr{border:none;border-top:1px solid #E5E7EB;margin:8px 0}
.board-md a{color:#4a9e8e;text-decoration:none}
.board-md table{border-collapse:collapse;width:100%;margin:4px 0 8px;font-size:11px}
.board-md th,.board-md td{border:1px solid #E5E7EB;padding:3px 6px;text-align:left}
.board-md th{background:#F9FAFB;font-weight:600}
`;

let mdStyleInjected = false;
function ensureMdStyle() {
  if (mdStyleInjected) return;
  const el = document.createElement('style');
  el.textContent = MD_STYLE;
  document.head.appendChild(el);
  mdStyleInjected = true;
}

function hasMarkdownSyntax(text) {
  if (!text) return false;
  return /^#{1,4}\s|^\*\*|^- |\*\*|`[^`]+`|^\||\[.+\]\(.+\)/m.test(text);
}

function MarkdownBody({ text, clamp }) {
  const html = useMemo(() => {
    ensureMdStyle();
    marked.setOptions({ breaks: true, gfm: true });
    return marked.parse(text || '');
  }, [text]);

  return (
    <div
      className="board-md"
      style={{
        overflow: 'hidden',
        ...(clamp ? { display: '-webkit-box', WebkitLineClamp: clamp, WebkitBoxOrient: 'vertical' } : {}),
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function SnippetContent({ knowledge }) {
  const text = knowledge?.content_text || knowledge?.title || '';
  const isMd = hasMarkdownSyntax(text);
  return (
    <div>
      <div style={{ height: 2, background: 'rgba(0,0,0,0.06)', marginBottom: 10 }} />
      {isMd ? (
        <MarkdownBody text={text} clamp={6} />
      ) : (
        <p style={{
          fontSize: 13, lineHeight: 1.7, color: '#374151', fontWeight: 400,
          overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 6, WebkitBoxOrient: 'vertical',
        }}>
          {text}
        </p>
      )}
    </div>
  );
}

function WebclipContent({ knowledge }) {
  const text = knowledge?.content_text || knowledge?.summary || '';
  const url = knowledge?.source_url || '';
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#E5D5A0', marginTop: 4 }} />
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 9,
          color: '#4a9e8e', fontFamily: 'Inter, system-ui, sans-serif',
          border: '1px solid rgba(74,158,142,0.3)', padding: '2px 6px', borderRadius: 4,
          textTransform: 'uppercase', letterSpacing: '0.05em', background: 'rgba(255,255,255,0.5)',
        }}>
          WEB
        </span>
      </div>
      <p style={{
        fontSize: 13, lineHeight: 1.7, color: '#1F2937', fontWeight: 400,
        overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 5, WebkitBoxOrient: 'vertical',
      }}>
        {text}
      </p>
      {url && (
        <p style={{
          fontSize: 10, color: '#9CA3AF', marginTop: 8, fontFamily: 'Inter, system-ui, sans-serif',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {url.replace(/^https?:\/\//, '').slice(0, 40)}
        </p>
      )}
    </div>
  );
}

function NoteContent({ knowledge }) {
  const text = knowledge?.content_text || '';
  const created = knowledge?.created_at ? new Date(knowledge.created_at).toLocaleDateString('zh-CN') : '';
  const isMd = hasMarkdownSyntax(text);
  return (
    <div style={{ position: 'relative', overflow: 'hidden', height: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, borderBottom: '1px solid #F3F4F6', paddingBottom: 8 }}>
        <span style={{ fontFamily: 'Inter, system-ui, sans-serif', fontSize: 9, color: '#9CA3AF', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
          {created || 'NOTE'}
        </span>
        <div style={{ width: 4, height: 4, borderRadius: '50%', background: '#4a9e8e' }} />
      </div>
      {isMd ? (
        <MarkdownBody text={text} />
      ) : (
        <p style={{
          color: '#1F2937', lineHeight: 2, fontSize: 13,
          overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 8, WebkitBoxOrient: 'vertical',
        }}>
          {text}
        </p>
      )}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, width: '100%', height: 72,
        background: 'linear-gradient(to top, white, transparent)', pointerEvents: 'none',
      }} />
    </div>
  );
}

function ScreenshotContent({ knowledge }) {
  const imageSrc = knowledge?._absolutePath
    ? `ipm-file:///${knowledge._absolutePath.replace(/\\/g, '/')}`
    : '';
  const caption = knowledge?.title || '';
  return (
    <div>
      <div style={{
        width: '100%', aspectRatio: '1 / 1', background: '#F3F4F6',
        overflow: 'hidden', marginBottom: 6, position: 'relative', borderRadius: 2,
      }}>
        {imageSrc ? (
          <img src={imageSrc} alt={caption} style={{ width: '100%', height: '100%', objectFit: 'cover' }} draggable={false} />
        ) : (
          <>
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom right, #d4a883, #e8d5c4, #c7bca5)', opacity: 0.5 }} />
            <div style={{
              position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
              width: 64, height: 64, borderRadius: '50%', background: '#ffecd1', filter: 'blur(20px)', opacity: 0.6,
            }} />
          </>
        )}
      </div>
      <p style={{ textAlign: 'center', fontSize: 11, color: '#9CA3AF', fontStyle: 'italic', marginTop: 6 }}>
        {caption}
      </p>
    </div>
  );
}

function DraftContent({ knowledge }) {
  const text = knowledge?.content_text || knowledge?.title || '新草稿';
  const isMd = hasMarkdownSyntax(text);
  return (
    <div style={{ position: 'relative' }}>
      <div style={{
        position: 'absolute', top: -10, left: '50%', transform: 'translateX(-50%)',
        width: 14, height: 14, borderRadius: '50%',
        background: 'rgba(192,176,144,0.4)', border: '1px solid rgba(255,255,255,0.6)',
        boxShadow: '0 1px 2px 0 rgba(0,0,0,0.05)',
      }} />
      {isMd ? (
        <div style={{ marginTop: 4 }}>
          <MarkdownBody text={text} />
        </div>
      ) : (
        <p style={{
          fontSize: 12, lineHeight: 2, color: '#374151', fontWeight: 400, marginTop: 4,
          overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical',
        }}>
          {text}
        </p>
      )}
    </div>
  );
}

export default function BoardCard({ item, isSelected, isDragging, readOnly = false }) {
  const knowledge = item?.knowledge;

  if (!knowledge) {
    return (
      <div style={{
        background: '#F9FAFB', width: '100%', height: '100%',
        padding: 20, overflow: 'hidden',
        border: '1.5px dashed #D1D5DB',
        boxShadow: isDragging ? '0 20px 40px rgba(0,0,0,0.15)' : '0 2px 4px rgba(0,0,0,0.03)',
        outline: isSelected && !readOnly ? '1.5px solid rgba(156,163,175,0.5)' : 'none',
        outlineOffset: isSelected ? 3 : 0,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 6, opacity: 0.7,
      }}>
        <div style={{ fontSize: 20, lineHeight: 1 }}>🕊</div>
        <p style={{ fontSize: 11, color: '#9CA3AF', textAlign: 'center', fontFamily: 'Inter, system-ui, sans-serif' }}>
          源碎片已删除
        </p>
        <p style={{ fontSize: 9, color: '#D1D5DB', textAlign: 'center' }}>
          可从看板移除此卡片
        </p>
      </div>
    );
  }

  const type = knowledge.source_kind === 'draft' ? 'draft' : (knowledge.type || 'snippet');
  const style = CARD_STYLES[type] || CARD_STYLES.snippet;

  const cardStyle = useMemo(() => ({
    background: style.bg,
    boxShadow: isDragging ? '0 20px 40px rgba(0,0,0,0.15)' : style.shadow,
    padding: style.padding,
    paddingBottom: style.paddingBottom || style.padding,
    width: '100%',
    height: '100%',
    overflow: 'hidden',
    transition: isDragging ? 'none' : 'box-shadow 0.2s ease',
    outline: isSelected && !readOnly ? '1.5px solid rgba(74,158,142,0.5)' : 'none',
    outlineOffset: isSelected ? 3 : 0,
  }), [style, isDragging, isSelected, readOnly]);

  return (
    <div style={cardStyle}>
      {type === 'snippet' && <SnippetContent knowledge={knowledge} />}
      {type === 'webclip' && <WebclipContent knowledge={knowledge} />}
      {type === 'note' && <NoteContent knowledge={knowledge} />}
      {type === 'screenshot' && <ScreenshotContent knowledge={knowledge} />}
      {type === 'draft' && <DraftContent knowledge={knowledge} />}
      <TagCapsules tags={knowledge?.tags} />
    </div>
  );
}

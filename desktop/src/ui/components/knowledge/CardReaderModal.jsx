import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { X, FileText, StickyNote, Image, Globe, ExternalLink, FolderOpen, Tag, Clock, Link2, ChevronRight } from 'lucide-react';
import { marked } from 'marked';

const MD_STYLE = `
.reader-md h1{font-size:1.6em;font-weight:700;margin:0.6em 0 0.3em;color:#1F2937}
.reader-md h2{font-size:1.35em;font-weight:600;margin:0.5em 0 0.25em;color:#374151}
.reader-md h3{font-size:1.15em;font-weight:600;margin:0.4em 0 0.2em;color:#374151}
.reader-md p{margin:0.4em 0;line-height:1.75;color:#4B5563}
.reader-md ul,.reader-md ol{padding-left:1.5em;margin:0.4em 0;color:#4B5563}
.reader-md li{margin:0.2em 0;line-height:1.6}
.reader-md code{background:#F3F4F6;padding:2px 5px;border-radius:4px;font-size:0.88em;color:#6B7280}
.reader-md pre{background:#1F2937;color:#E5E7EB;padding:12px 16px;border-radius:8px;overflow-x:auto;margin:0.6em 0;font-size:0.85em}
.reader-md pre code{background:none;padding:0;color:inherit}
.reader-md blockquote{border-left:3px solid #D1D5DB;padding-left:12px;color:#6B7280;margin:0.5em 0;font-style:italic}
.reader-md a{color:#4a9e8e;text-decoration:underline}
.reader-md hr{border:none;border-top:1px solid #E5E7EB;margin:1em 0}
.reader-md table{border-collapse:collapse;width:100%;margin:0.6em 0}
.reader-md th,.reader-md td{border:1px solid #E5E7EB;padding:6px 10px;font-size:0.9em;text-align:left}
.reader-md th{background:#F9FAFB;font-weight:600}
.reader-md img{max-width:100%;border-radius:8px}
`;

function ensureMdStyle() {
  if (document.getElementById('reader-md-style')) return;
  const s = document.createElement('style');
  s.id = 'reader-md-style';
  s.textContent = MD_STYLE;
  document.head.appendChild(s);
}

function MarkdownBody({ text }) {
  ensureMdStyle();
  const html = useMemo(() => {
    try { return marked.parse(text || ''); }
    catch { return text || ''; }
  }, [text]);
  return <div className="reader-md" dangerouslySetInnerHTML={{ __html: html }} />;
}

function hasMarkdownSyntax(text) {
  if (!text) return false;
  return /^#{1,4}\s|^\*\s|^-\s|^\d+\.\s|\*\*|__|\[.*\]\(|```|^>/m.test(text);
}

export default function CardReaderModal({ item, onClose, onNavigateProject, onNavigateFile }) {
  const [visible, setVisible] = useState(false);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (item) {
      requestAnimationFrame(() => setVisible(true));
      setClosing(false);
    }
  }, [item]);

  const handleClose = useCallback(() => {
    setClosing(true);
    setVisible(false);
    setTimeout(() => onClose?.(), 300);
  }, [onClose]);

  useEffect(() => {
    if (!item) return;
    const handler = (e) => { if (e.key === 'Escape') handleClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [item, handleClose]);

  if (!item) return null;

  const knowledge = item.knowledge || {};
  const type = knowledge.type || 'snippet';
  const title = knowledge.title || item.title || '未命名';
  const contentText = knowledge.content_text || '';
  const contentJson = knowledge.content_json || '';
  const sourceUrl = knowledge.source_url || '';
  const tags = Array.isArray(knowledge.tags) ? knowledge.tags : [];
  const links = Array.isArray(knowledge.links) ? knowledge.links : [];
  const createdAt = (knowledge.created_at || '').slice(0, 10);
  const projectName = item.source_project || knowledge._projectName || '';
  const screenshotPath = knowledge._absolutePath || '';

  const webclipMeta = type === 'webclip' ? (() => { try { return JSON.parse(contentJson || '{}'); } catch { return {}; } })() : {};
  const webclipImages = Array.isArray(webclipMeta._resolvedImages) && webclipMeta._resolvedImages.length > 0
    ? webclipMeta._resolvedImages : (Array.isArray(webclipMeta.images) ? webclipMeta.images : []);

  const TypeIcon = type === 'screenshot' ? Image : type === 'note' ? StickyNote : type === 'webclip' ? Globe : FileText;
  const typeLabel = type === 'screenshot' ? '截图' : type === 'note' ? '笔记' : type === 'webclip' ? '网页摘录' : '文本碎片';
  const typeBg = type === 'screenshot' ? '#FFF1F2' : type === 'note' ? '#F0FDF4' : type === 'webclip' ? '#F0FDFA' : '#FFFBEB';
  const typeColor = type === 'screenshot' ? '#E11D48' : type === 'note' ? '#16A34A' : type === 'webclip' ? '#4a9e8e' : '#D97706';

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 2000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        backdropFilter: visible && !closing ? 'blur(16px)' : 'blur(0px)',
        background: visible && !closing ? 'rgba(0,0,0,0.25)' : 'rgba(0,0,0,0)',
        transition: 'backdrop-filter 0.35s ease, background 0.35s ease',
      }}
      onClick={handleClose}
    >
      <div
        style={{
          width: 'min(800px, 90vw)',
          maxHeight: 'min(85vh, 900px)',
          background: 'white',
          borderRadius: 20,
          boxShadow: '0 30px 60px -15px rgba(0,0,0,0.2)',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
          transform: visible && !closing ? 'scale(1) translateY(0)' : 'scale(0.92) translateY(20px)',
          opacity: visible && !closing ? 1 : 0,
          transition: 'transform 0.35s cubic-bezier(0.4,0,0.2,1), opacity 0.3s ease',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          padding: '20px 28px', borderBottom: '1px solid #F3F4F6',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 10, background: typeBg,
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <TypeIcon size={18} color={typeColor} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h2 style={{
                fontSize: 16, fontWeight: 600, color: '#1F2937', margin: 0,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {title}
              </h2>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, fontSize: 11, color: '#9CA3AF' }}>
                <span style={{
                  padding: '1px 6px', borderRadius: 4, background: typeBg, color: typeColor,
                  fontSize: 10, fontWeight: 600, textTransform: 'uppercase',
                }}>
                  {typeLabel}
                </span>
                {createdAt && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                    <Clock size={10} /> {createdAt}
                  </span>
                )}
                {projectName && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                    <FolderOpen size={10} /> {projectName}
                  </span>
                )}
              </div>
            </div>
          </div>
          <button
            onClick={handleClose}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: '#9CA3AF', padding: 6, borderRadius: 8,
              transition: 'background 0.15s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = '#F3F4F6'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div style={{
          flex: 1, overflowY: 'auto', padding: '24px 28px',
          fontSize: 14, lineHeight: 1.7, color: '#374151',
        }}>
          {type === 'screenshot' && screenshotPath && (
            <div style={{ textAlign: 'center', marginBottom: 16 }}>
              <img
                src={`ipm-file:///${screenshotPath.replace(/\\/g, '/')}`}
                alt={title}
                style={{ maxWidth: '100%', maxHeight: '60vh', borderRadius: 12, objectFit: 'contain' }}
              />
            </div>
          )}

          {type === 'webclip' && (
            <div style={{ marginBottom: 16 }}>
              {sourceUrl && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px',
                  background: '#F0FDFA', borderRadius: 10, marginBottom: 16,
                  border: '1px solid rgba(74,158,142,0.15)',
                }}>
                  <Globe size={14} color="#4a9e8e" />
                  <span style={{ flex: 1, fontSize: 12, color: '#4a9e8e', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {sourceUrl}
                  </span>
                  <button
                    onClick={() => window.ipm?.shell?.openExternal?.(sourceUrl) || window.open(sourceUrl, '_blank')}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#4a9e8e', padding: 2 }}
                  >
                    <ExternalLink size={14} />
                  </button>
                </div>
              )}
              {knowledge.summary && (
                <div style={{
                  padding: '12px 16px', background: '#FFFBEB', borderRadius: 10,
                  border: '1px solid rgba(217,119,6,0.15)', marginBottom: 16,
                  fontSize: 13, color: '#92400E', lineHeight: 1.6,
                }}>
                  <span style={{ fontWeight: 600, fontSize: 11, color: '#D97706', display: 'block', marginBottom: 4 }}>AI 摘要</span>
                  {knowledge.summary}
                </div>
              )}
              {contentText && (
                hasMarkdownSyntax(contentText)
                  ? <MarkdownBody text={contentText} />
                  : <p style={{ whiteSpace: 'pre-wrap' }}>{contentText}</p>
              )}
              {webclipImages.length > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8, marginTop: 16 }}>
                  {webclipImages.map((img, i) => (
                    <img
                      key={img}
                      src={`ipm-file:///${img.replace(/\\/g, '/')}`}
                      alt={`截图 ${i + 1}`}
                      style={{ width: '100%', borderRadius: 8, objectFit: 'contain' }}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {(type === 'snippet' || type === 'note') && contentText && (
            hasMarkdownSyntax(contentText)
              ? <MarkdownBody text={contentText} />
              : <p style={{ whiteSpace: 'pre-wrap' }}>{contentText}</p>
          )}

          {(type === 'snippet' || type === 'note') && !contentText && (
            <p style={{ color: '#9CA3AF', fontStyle: 'italic' }}>暂无内容</p>
          )}
        </div>

        {/* Footer: tags + navigation */}
        <div style={{
          padding: '16px 28px', borderTop: '1px solid #F3F4F6', flexShrink: 0,
          display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          {/* Tags */}
          {tags.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <Tag size={12} color="#9CA3AF" />
              {tags.map((tag) => (
                <span key={tag} style={{
                  padding: '2px 8px', borderRadius: 6, background: '#F3F4F6',
                  fontSize: 11, color: '#6B7280',
                }}>
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* Navigation buttons */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {projectName && onNavigateProject && (
              <button
                onClick={() => { handleClose(); onNavigateProject(projectName, item.source_domain || 'projects'); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  padding: '6px 14px', borderRadius: 8,
                  border: '1px solid #E5E7EB', background: 'white',
                  fontSize: 12, color: '#374151', cursor: 'pointer',
                  transition: 'border-color 0.15s, background 0.15s',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = '#F9FAFB'; e.currentTarget.style.borderColor = '#4a9e8e'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'white'; e.currentTarget.style.borderColor = '#E5E7EB'; }}
              >
                <FolderOpen size={13} color="#4a9e8e" />
                前往 {projectName}
                <ChevronRight size={12} color="#9CA3AF" />
              </button>
            )}

            {links.map((link) => (
              <button
                key={link.id || link.target_path}
                onClick={() => { handleClose(); onNavigateFile?.(link.target_path, link.target_kind); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  padding: '6px 14px', borderRadius: 8,
                  border: '1px solid #E5E7EB', background: 'white',
                  fontSize: 12, color: '#374151', cursor: 'pointer',
                  transition: 'border-color 0.15s, background 0.15s',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = '#F9FAFB'; e.currentTarget.style.borderColor = '#6366F1'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'white'; e.currentTarget.style.borderColor = '#E5E7EB'; }}
              >
                <Link2 size={13} color="#6366F1" />
                {link.target_path?.split(/[/\\]/).pop() || link.target_path}
                <ChevronRight size={12} color="#9CA3AF" />
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

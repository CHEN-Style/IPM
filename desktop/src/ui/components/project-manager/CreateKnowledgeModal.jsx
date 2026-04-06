import React, { useState, useRef, useCallback } from 'react';
import { X, FileText, Image, Globe, StickyNote, Check, Loader2, ExternalLink } from 'lucide-react';

const TYPES = [
  { key: 'snippet', label: '文本碎片', icon: FileText, color: '#D97706', enabled: true },
  { key: 'screenshot', label: '上传截图', icon: Image, color: '#E11D48', enabled: true },
  { key: 'webclip', label: '网页摘录', icon: Globe, color: '#3e4b9c', enabled: true },
  { key: 'note', label: '笔记', icon: StickyNote, color: '#9CA3AF', enabled: false, tip: '笔记类碎片请在知识管理页面中创建和编辑' },
];

export default function CreateKnowledgeModal({ target, onClose, onNavigateKnowledge }) {
  const { entry, projectName, domain } = target;
  const [activeType, setActiveType] = useState('snippet');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [url, setUrl] = useState('');
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const fileInputRef = useRef(null);

  const linkTarget = entry?.relPath || entry?.name || null;
  const linkKind = entry?.kind === 'dir' ? 'folder' : 'file';

  const handleImageSelect = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setImagePreview(ev.target.result);
    reader.readAsDataURL(file);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const domainOpts = { domain };
      let itemId = null;

      if (activeType === 'snippet') {
        const res = await window.ipm.knowledge.create(projectName, {
          type: 'snippet', title: title || '未命名文本', content_text: content,
        }, domainOpts);
        itemId = res?.item?.id;
      } else if (activeType === 'screenshot') {
        if (!imageFile) { setSubmitting(false); return; }
        const buffer = await imageFile.arrayBuffer();
        const res = await window.ipm.knowledge.create(projectName, {
          type: 'screenshot', title: title || imageFile.name || '截图',
        }, domainOpts);
        itemId = res?.item?.id;
        if (itemId) {
          const filePath = window.ipm.files?.getPathForFile?.(imageFile);
          if (filePath) {
            await window.ipm.knowledge.addLink(projectName, itemId, filePath, 'file', domainOpts);
          }
        }
      } else if (activeType === 'webclip') {
        if (!url) { setSubmitting(false); return; }
        const res = await window.ipm.knowledge.createWebclip(projectName, url, domainOpts);
        itemId = res?.item?.id;
      }

      if (itemId && linkTarget) {
        await window.ipm.knowledge.addLink(projectName, itemId, linkTarget, linkKind, domainOpts);
      }
      setSuccess(true);
    } catch (err) {
      console.error('Create knowledge failed:', err);
    } finally {
      setSubmitting(false);
    }
  }, [submitting, activeType, title, content, url, imageFile, projectName, domain, linkTarget, linkKind]);

  const canSubmit = activeType === 'snippet' ? (title || content)
    : activeType === 'screenshot' ? !!imageFile
    : activeType === 'webclip' ? !!url : false;

  if (success) {
    return (
      <div style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.3)', backdropFilter: 'blur(4px)',
      }} onClick={onClose}>
        <div
          style={{
            background: 'white', borderRadius: 16, padding: '32px 40px',
            boxShadow: '0 25px 50px -12px rgba(0,0,0,0.15)',
            textAlign: 'center', maxWidth: 360,
          }}
          onClick={(e) => e.stopPropagation()}
          className="animate-fadeIn"
        >
          <div style={{
            width: 48, height: 48, borderRadius: '50%', background: 'rgba(74,158,142,0.1)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px',
          }}>
            <Check size={24} color="#3e4b9c" />
          </div>
          <h3 style={{ fontSize: 16, fontWeight: 600, color: '#1F2937', marginBottom: 8 }}>创建成功</h3>
          <p style={{ fontSize: 13, color: '#6B7280', marginBottom: 24 }}>知识碎片已创建并关联</p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
            <button
              onClick={onClose}
              style={{
                padding: '8px 20px', borderRadius: 8, border: '1px solid #E5E7EB',
                background: 'white', color: '#374151', fontSize: 13, cursor: 'pointer',
              }}
            >
              留在当前页
            </button>
            <button
              onClick={() => { onClose(); onNavigateKnowledge?.(); }}
              style={{
                padding: '8px 20px', borderRadius: 8, border: 'none',
                background: '#3e4b9c', color: 'white', fontSize: 13, cursor: 'pointer',
              }}
            >
              前往知识管理
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.3)', backdropFilter: 'blur(4px)',
    }} onClick={onClose}>
      <div
        style={{
          background: 'white', borderRadius: 16, width: 480,
          boxShadow: '0 25px 50px -12px rgba(0,0,0,0.15)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
        className="animate-fadeIn"
      >
        {/* Header */}
        <div style={{
          padding: '20px 24px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, color: '#1F2937' }}>新建知识碎片</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF', padding: 4 }}>
            <X size={18} />
          </button>
        </div>

        {/* Type selector */}
        <div style={{ display: 'flex', gap: 6, padding: '16px 24px 0' }}>
          {TYPES.map((t) => (
            <button
              key={t.key}
              title={t.enabled ? t.label : t.tip}
              onClick={() => { if (t.enabled) setActiveType(t.key); }}
              style={{
                flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                padding: '10px 4px', border: activeType === t.key ? '1.5px solid #3e4b9c' : '1.5px solid #E5E7EB',
                borderRadius: 10, cursor: t.enabled ? 'pointer' : 'not-allowed',
                background: activeType === t.key ? 'rgba(74,158,142,0.04)' : 'white',
                opacity: t.enabled ? 1 : 0.45,
                transition: 'border-color 0.15s, background 0.15s',
              }}
            >
              <t.icon size={16} color={activeType === t.key ? '#3e4b9c' : t.color} />
              <span style={{ fontSize: 11, color: activeType === t.key ? '#3e4b9c' : '#6B7280' }}>{t.label}</span>
            </button>
          ))}
        </div>

        {/* Form area */}
        <div style={{ padding: '16px 24px', flex: 1, minHeight: 180 }}>
          {activeType === 'snippet' && (
            <>
              <input
                placeholder="标题（可选）"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                style={{
                  width: '100%', padding: '8px 12px', border: '1px solid #E5E7EB', borderRadius: 8,
                  fontSize: 13, outline: 'none', marginBottom: 10, boxSizing: 'border-box',
                }}
              />
              <textarea
                placeholder="输入文本内容..."
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={5}
                style={{
                  width: '100%', padding: '8px 12px', border: '1px solid #E5E7EB', borderRadius: 8,
                  fontSize: 13, outline: 'none', resize: 'vertical', boxSizing: 'border-box',
                  fontFamily: 'Inter, system-ui, sans-serif',
                }}
              />
            </>
          )}

          {activeType === 'screenshot' && (
            <>
              <input
                placeholder="标题（可选）"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                style={{
                  width: '100%', padding: '8px 12px', border: '1px solid #E5E7EB', borderRadius: 8,
                  fontSize: 13, outline: 'none', marginBottom: 10, boxSizing: 'border-box',
                }}
              />
              <div
                onClick={() => fileInputRef.current?.click()}
                style={{
                  border: '2px dashed #D1D5DB', borderRadius: 10, padding: 24,
                  textAlign: 'center', cursor: 'pointer', background: '#FAFAFA',
                  transition: 'border-color 0.15s',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#3e4b9c'; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#D1D5DB'; }}
              >
                {imagePreview ? (
                  <img src={imagePreview} alt="preview" style={{ maxWidth: '100%', maxHeight: 160, borderRadius: 8 }} />
                ) : (
                  <>
                    <Image size={28} color="#9CA3AF" style={{ marginBottom: 8 }} />
                    <p style={{ fontSize: 13, color: '#6B7280' }}>点击选择图片或拖拽上传</p>
                  </>
                )}
              </div>
              <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImageSelect} />
            </>
          )}

          {activeType === 'webclip' && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <Globe size={16} color="#3e4b9c" style={{ flexShrink: 0 }} />
                <input
                  placeholder="输入网页URL..."
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  style={{
                    flex: 1, padding: '8px 12px', border: '1px solid #E5E7EB', borderRadius: 8,
                    fontSize: 13, outline: 'none', boxSizing: 'border-box',
                  }}
                />
              </div>
              <p style={{ fontSize: 11, color: '#9CA3AF' }}>粘贴 URL 后将自动抓取网页内容和摘要</p>
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '12px 24px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          borderTop: '1px solid #F3F4F6',
        }}>
          <div style={{ fontSize: 11, color: '#9CA3AF' }}>
            {linkTarget ? (
              <span>将自动关联至：<strong style={{ color: '#6B7280' }}>{entry?.name || linkTarget}</strong></span>
            ) : (
              <span>属于项目：{projectName}</span>
            )}
          </div>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit || submitting}
            style={{
              padding: '8px 20px', borderRadius: 8, border: 'none',
              background: canSubmit && !submitting ? '#3e4b9c' : '#D1D5DB',
              color: 'white', fontSize: 13, cursor: canSubmit && !submitting ? 'pointer' : 'default',
              display: 'flex', alignItems: 'center', gap: 6,
              transition: 'background 0.15s',
            }}
          >
            {submitting ? <Loader2 size={14} className="animate-spin" /> : null}
            创建
          </button>
        </div>
      </div>
    </div>
  );
}

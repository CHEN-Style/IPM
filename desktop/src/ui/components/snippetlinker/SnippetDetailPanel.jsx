import React, { useEffect, useState } from 'react';
import { X, Sparkles, Tag, Clock } from 'lucide-react';

export const SnippetDetailPanel = ({ snippet, isOpen, onClose, onUpdate }) => {
  const [formData, setFormData] = useState(null);
  const [newTag, setNewTag] = useState('');
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    if (snippet) {
      setFormData(snippet);
      setIsDirty(false);
    }
  }, [snippet]);

  // Handle escape key
  useEffect(() => {
    const handleEsc = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    if (isOpen) window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [isOpen, onClose]);

  if (!isOpen || !formData) return null;

  const handleChange = (field, value) => {
    const updated = { ...formData, [field]: value };
    setFormData(updated);
    setIsDirty(true);

    // Auto-sync basic fields to parent for "Live" feel in list view
    if (field === 'title' || field === 'importance' || field === 'tags') {
      onUpdate?.(updated);
    }
  };

  const handleBlur = () => {
    if (isDirty && formData) {
      onUpdate?.(formData);
      setIsDirty(false);
    }
  };

  const handleAddTag = (e) => {
    if (e.key === 'Enter' && newTag.trim()) {
      e.preventDefault();
      if (!formData.tags.includes(newTag.trim())) {
        handleChange('tags', [...formData.tags, newTag.trim()]);
      }
      setNewTag('');
    }
  };

  const handleRemoveTag = (tagToRemove) => {
    handleChange(
      'tags',
      formData.tags.filter((t) => t !== tagToRemove),
    );
  };

  return (
    <>
      {/* Backdrop (Transparent; captures clicks to close) */}
      <div className="fixed inset-0 z-40 bg-black/5" onClick={onClose} aria-hidden="true" />

      {/* Slide-in Panel */}
      <div
        className={`
          fixed top-[36px] right-0 bottom-0 w-[400px] bg-white shadow-2xl z-50 transform transition-transform duration-300 ease-in-out border-l border-gray-200 flex flex-col
          ${isOpen ? 'translate-x-0' : 'translate-x-full'}
        `}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 flex items-start justify-between bg-white shrink-0">
          <div className="flex-1 mr-4">
            <input
              type="text"
              value={formData.title}
              onChange={(e) => handleChange('title', e.target.value)}
              onBlur={handleBlur}
              className="w-full text-lg font-bold text-gray-800 placeholder-gray-400 border-none outline-none focus:ring-0 p-0 bg-transparent"
              placeholder="Untitled Snippet"
            />
            <div className="flex items-center gap-2 mt-1 text-xs text-gray-400">
              <Clock size={12} />
              <span>Created {formData.createdAt}</span>
              {isDirty ? (
                <span className="text-amber-500 font-medium ml-2">Saving...</span>
              ) : (
                <span className="text-green-600 font-medium ml-2">Saved</span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 hover:bg-gray-100 rounded-full text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-8">
          {/* Main Content */}
          <section>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Content</label>
            <textarea
              value={formData.content}
              onChange={(e) => handleChange('content', e.target.value)}
              onBlur={handleBlur}
              className="w-full min-h-[150px] p-3 text-sm text-gray-700 bg-gray-50 border border-transparent rounded-lg focus:bg-white focus:border-primary-300 focus:ring-2 focus:ring-primary-100 outline-none resize-none transition-all leading-relaxed"
              placeholder="Enter knowledge details..."
            />
          </section>

          {/* AI Analysis */}
          <section className="bg-gradient-to-br from-indigo-50 to-purple-50 rounded-xl p-4 border border-indigo-100">
            <div className="flex items-center gap-2 mb-3">
              <Sparkles size={16} className="text-indigo-500" />
              <h3 className="text-sm font-semibold text-indigo-900">AI Insight</h3>
            </div>
            <div className="text-xs text-indigo-800 leading-relaxed">
              {formData.aiSummary ? (
                <p>{formData.aiSummary}</p>
              ) : (
                <div className="flex flex-col items-center justify-center py-4 text-center">
                  <p className="opacity-60 mb-2">No summary available yet.</p>
                  <button
                    type="button"
                    className="px-3 py-1.5 bg-white border border-indigo-200 rounded text-xs font-medium text-indigo-600 shadow-sm hover:bg-indigo-50 transition-colors"
                  >
                    Generate Summary
                  </button>
                </div>
              )}
            </div>
          </section>

          {/* Metadata Section */}
          <section className="space-y-6 border-t border-gray-100 pt-6">
            {/* Importance */}
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Priority / Importance</label>
              <div className="flex gap-2">
                {['low', 'medium', 'high'].map((level) => (
                  <button
                    key={level}
                    type="button"
                    onClick={() => handleChange('importance', level)}
                    className={`
                      px-3 py-1.5 rounded-md text-xs font-medium border capitalize transition-all
                      ${
                        formData.importance === level
                          ? level === 'high'
                            ? 'bg-red-50 border-red-200 text-red-700 ring-1 ring-red-200'
                            : level === 'medium'
                              ? 'bg-amber-50 border-amber-200 text-amber-700 ring-1 ring-amber-200'
                              : 'bg-blue-50 border-blue-200 text-blue-700 ring-1 ring-blue-200'
                          : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                      }
                    `}
                  >
                    {level}
                  </button>
                ))}
              </div>
            </div>

            {/* Tags */}
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Semantic Tags</label>
              <div className="flex flex-wrap gap-2 mb-2">
                {formData.tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-gray-100 text-gray-600 text-xs border border-gray-200 group"
                  >
                    {tag}
                    <button type="button" onClick={() => handleRemoveTag(tag)} className="text-gray-400 hover:text-gray-600 ml-0.5">
                      <X size={12} />
                    </button>
                  </span>
                ))}
                <div className="relative flex items-center">
                  <Tag size={12} className="absolute left-2 text-gray-400" />
                  <input
                    type="text"
                    value={newTag}
                    onChange={(e) => setNewTag(e.target.value)}
                    onKeyDown={handleAddTag}
                    className="pl-6 pr-3 py-1 w-32 text-xs bg-white border border-gray-200 rounded-md focus:border-primary-400 focus:ring-1 focus:ring-primary-200 outline-none transition-all"
                    placeholder="Add tag..."
                  />
                </div>
              </div>
            </div>

            {/* Read-only Source */}
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Source Origin</label>
              <div className="text-sm text-gray-700">{formData.source}</div>
            </div>
          </section>
        </div>
      </div>
    </>
  );
};



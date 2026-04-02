import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import '@blocknote/mantine/style.css';

function NoteEditorInner({ initialContent, markdownFallback, onChange, readOnly = false }) {
  const parsed = useMemo(() => {
    if (!initialContent) return undefined;
    try {
      const data = typeof initialContent === 'string' ? JSON.parse(initialContent) : initialContent;
      return Array.isArray(data) ? data : undefined;
    } catch {
      return undefined;
    }
  }, []);

  const editor = useCreateBlockNote({
    initialContent: parsed,
    pasteHandler: ({ event, editor: ed, defaultPasteHandler }) => {
      const plain = event.clipboardData?.getData('text/plain');
      if (plain && plain.trim()) {
        ed.pasteMarkdown(plain);
        return true;
      }
      return defaultPasteHandler();
    },
  });

  const didInit = useRef(false);
  useEffect(() => {
    if (didInit.current || parsed || !markdownFallback || !editor) return;
    didInit.current = true;
    try {
      const blocks = editor.tryParseMarkdownToBlocks(markdownFallback);
      if (blocks && blocks.length > 0) {
        editor.replaceBlocks(editor.document, blocks);
      }
    } catch { /* ignore */ }
  }, [editor, parsed, markdownFallback]);

  const handleChange = useCallback(async () => {
    if (readOnly || !onChange) return;
    const json = editor.document;
    let text = '';
    try {
      text = await editor.blocksToMarkdownLossy(json);
    } catch {
      text = json.map((b) => b?.content?.map?.((c) => c?.text || '').join('') || '').join('\n');
    }
    onChange({ json, text });
  }, [editor, onChange, readOnly]);

  return (
    <div className="blocknote-wrapper min-h-[300px] bg-white">
      <BlockNoteView
        editor={editor}
        editable={!readOnly}
        onChange={handleChange}
        theme="light"
      />
    </div>
  );
}

export default function NoteEditor({ initialContent, markdownFallback, onChange, readOnly = false, editorKey }) {
  return <NoteEditorInner key={editorKey || 'default'} initialContent={initialContent} markdownFallback={markdownFallback} onChange={onChange} readOnly={readOnly} />;
}

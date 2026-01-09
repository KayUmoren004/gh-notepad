'use client';

import { useRef, useCallback, useEffect, useState } from 'react';
import { EditorToolbar } from './editor-toolbar';
import { MarkdownPreview } from './markdown-preview';
import { ImageUploadDialog } from './image-upload-dialog';
import { cn } from '@/lib/utils';
import { Columns2, Eye, Edit3 } from 'lucide-react';
import { Button } from '@/components/ui/button';

type ViewMode = 'edit' | 'preview' | 'split';

interface MarkdownEditorProps {
  content: string;
  onChange: (content: string) => void;
  title: string;
  onTitleChange: (title: string) => void;
  className?: string;
}

export function MarkdownEditor({
  content,
  onChange,
  title,
  onTitleChange,
  className,
}: MarkdownEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('split');
  const [isImageDialogOpen, setIsImageDialogOpen] = useState(false);

  // Handle formatting commands
  const handleFormat = useCallback(
    (format: string, prefix?: string, suffix?: string) => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const selectedText = content.substring(start, end);

      let newText: string;
      let newCursorPos: number;

      if (format === 'h1' || format === 'h2' || format === 'ul' || format === 'ol' || format === 'quote') {
        // Line-level formatting
        const lineStart = content.lastIndexOf('\n', start - 1) + 1;
        const beforeLine = content.substring(0, lineStart);
        const afterStart = content.substring(lineStart);

        newText = beforeLine + prefix + afterStart;
        newCursorPos = start + prefix!.length;
      } else {
        // Inline formatting
        const before = content.substring(0, start);
        const after = content.substring(end);

        if (selectedText) {
          newText = before + prefix + selectedText + suffix + after;
          newCursorPos = start + prefix!.length + selectedText.length + suffix!.length;
        } else {
          newText = before + prefix + suffix + after;
          newCursorPos = start + prefix!.length;
        }
      }

      onChange(newText);

      // Restore cursor position
      setTimeout(() => {
        textarea.focus();
        textarea.setSelectionRange(newCursorPos, newCursorPos);
      }, 0);
    },
    [content, onChange]
  );

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target !== textareaRef.current) return;

      if (e.ctrlKey || e.metaKey) {
        switch (e.key.toLowerCase()) {
          case 'b':
            e.preventDefault();
            handleFormat('bold', '**', '**');
            break;
          case 'i':
            e.preventDefault();
            handleFormat('italic', '_', '_');
            break;
          case 'k':
            e.preventDefault();
            handleFormat('link', '[', '](url)');
            break;
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleFormat]);

  // Handle image insertion
  const handleImageInsert = useCallback(
    (url: string, alt: string) => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      const start = textarea.selectionStart;
      const before = content.substring(0, start);
      const after = content.substring(start);

      const imageMarkdown = `![${alt}](${url})`;
      const newText = before + imageMarkdown + after;

      onChange(newText);
      setIsImageDialogOpen(false);

      setTimeout(() => {
        textarea.focus();
        const newPos = start + imageMarkdown.length;
        textarea.setSelectionRange(newPos, newPos);
      }, 0);
    },
    [content, onChange]
  );

  // Handle paste for images
  const handlePaste = useCallback(
    async (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) {
            // Upload the image
            const formData = new FormData();
            formData.append('file', file);

            try {
              const response = await fetch('/api/upload', {
                method: 'POST',
                body: formData,
              });

              if (response.ok) {
                const { url } = await response.json();
                handleImageInsert(url, 'Pasted image');
              }
            } catch (error) {
              console.error('Failed to upload pasted image:', error);
            }
          }
          return;
        }
      }
    },
    [handleImageInsert]
  );

  // Handle drag and drop for images
  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      const files = e.dataTransfer?.files;
      if (!files?.length) return;

      for (const file of files) {
        if (file.type.startsWith('image/')) {
          const formData = new FormData();
          formData.append('file', file);

          try {
            const response = await fetch('/api/upload', {
                method: 'POST',
                body: formData,
            });

            if (response.ok) {
              const { url } = await response.json();
              handleImageInsert(url, file.name.split('.')[0] || 'Image');
            }
          } catch (error) {
            console.error('Failed to upload dropped image:', error);
          }
          return;
        }
      }
    },
    [handleImageInsert]
  );

  return (
    <div className={cn('flex flex-col h-full bg-background', className)}>
      {/* Title input */}
      <div className="px-4 pt-4 pb-2">
        <input
          type="text"
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          placeholder="Untitled Note"
          className="w-full text-2xl font-semibold bg-transparent border-none outline-none text-foreground placeholder:text-muted-foreground"
        />
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-border">
        <EditorToolbar
          onFormat={handleFormat}
          onImageUpload={() => setIsImageDialogOpen(true)}
          className="border-b-0 flex-1"
        />
        <div className="flex items-center gap-1 px-2">
          <Button
            variant="ghost"
            size="sm"
            className={cn('h-8 w-8 p-0', viewMode === 'edit' && 'bg-accent')}
            title="Edit mode"
            onClick={() => setViewMode('edit')}
          >
            <Edit3 className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={cn('h-8 w-8 p-0', viewMode === 'split' && 'bg-accent')}
            title="Split view"
            onClick={() => setViewMode('split')}
          >
            <Columns2 className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={cn('h-8 w-8 p-0', viewMode === 'preview' && 'bg-accent')}
            title="Preview mode"
            onClick={() => setViewMode('preview')}
          >
            <Eye className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Editor and Preview */}
      <div className="flex-1 flex overflow-hidden">
        {/* Editor pane */}
        {(viewMode === 'edit' || viewMode === 'split') && (
          <div
            className={cn(
              'flex-1 flex flex-col overflow-hidden',
              viewMode === 'split' && 'border-r border-border'
            )}
          >
            <textarea
              ref={textareaRef}
              value={content}
              onChange={(e) => onChange(e.target.value)}
              onPaste={handlePaste}
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
              placeholder="Start writing in Markdown..."
              className="flex-1 w-full p-4 bg-transparent resize-none outline-none font-mono text-sm text-foreground placeholder:text-muted-foreground"
              spellCheck={false}
            />
          </div>
        )}

        {/* Preview pane */}
        {(viewMode === 'preview' || viewMode === 'split') && (
          <div className="flex-1 overflow-auto">
            <MarkdownPreview content={content} />
          </div>
        )}
      </div>

      {/* Image upload dialog */}
      <ImageUploadDialog
        open={isImageDialogOpen}
        onOpenChange={setIsImageDialogOpen}
        onInsert={handleImageInsert}
      />
    </div>
  );
}

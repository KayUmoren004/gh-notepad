'use client';

import { Bold, Italic, Heading1, Heading2, List, ListOrdered, Code, Link, Image, Quote } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface EditorToolbarProps {
  onFormat: (format: string, prefix?: string, suffix?: string) => void;
  onImageUpload: () => void;
  className?: string;
}

const toolbarItems = [
  { icon: Bold, format: 'bold', prefix: '**', suffix: '**', title: 'Bold (Ctrl+B)' },
  { icon: Italic, format: 'italic', prefix: '_', suffix: '_', title: 'Italic (Ctrl+I)' },
  { type: 'separator' },
  { icon: Heading1, format: 'h1', prefix: '# ', suffix: '', title: 'Heading 1' },
  { icon: Heading2, format: 'h2', prefix: '## ', suffix: '', title: 'Heading 2' },
  { type: 'separator' },
  { icon: List, format: 'ul', prefix: '- ', suffix: '', title: 'Bullet List' },
  { icon: ListOrdered, format: 'ol', prefix: '1. ', suffix: '', title: 'Numbered List' },
  { type: 'separator' },
  { icon: Code, format: 'code', prefix: '`', suffix: '`', title: 'Inline Code' },
  { icon: Quote, format: 'quote', prefix: '> ', suffix: '', title: 'Quote' },
  { type: 'separator' },
  { icon: Link, format: 'link', prefix: '[', suffix: '](url)', title: 'Link' },
  { icon: Image, format: 'image', title: 'Insert Image' },
];

export function EditorToolbar({ onFormat, onImageUpload, className }: EditorToolbarProps) {
  return (
    <div className={cn('flex items-center gap-0.5 p-2 border-b border-border bg-card/50', className)}>
      {toolbarItems.map((item, index) => {
        if (item.type === 'separator') {
          return (
            <div
              key={`sep-${index}`}
              className="w-px h-5 bg-border mx-1"
            />
          );
        }

        const Icon = item.icon!;

        return (
          <Button
            key={item.format}
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground hover:bg-accent"
            title={item.title}
            onClick={() => {
              if (item.format === 'image') {
                onImageUpload();
              } else {
                onFormat(item.format!, item.prefix, item.suffix);
              }
            }}
          >
            <Icon className="h-4 w-4" />
          </Button>
        );
      })}
    </div>
  );
}

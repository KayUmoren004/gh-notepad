'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { cn } from '@/lib/utils';

interface MarkdownPreviewProps {
  content: string;
  className?: string;
}

export function MarkdownPreview({ content, className }: MarkdownPreviewProps) {
  return (
    <div
      className={cn(
        'prose prose-invert prose-sm max-w-none p-4',
        // Headings
        'prose-headings:text-foreground prose-headings:font-semibold prose-headings:border-b prose-headings:border-border prose-headings:pb-2',
        'prose-h1:text-2xl prose-h2:text-xl prose-h3:text-lg',
        // Links
        'prose-a:text-primary prose-a:no-underline hover:prose-a:underline',
        // Code
        'prose-code:text-primary prose-code:bg-muted prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none',
        'prose-pre:bg-muted prose-pre:border prose-pre:border-border',
        // Lists
        'prose-li:text-foreground prose-li:marker:text-muted-foreground',
        // Blockquote
        'prose-blockquote:border-l-primary prose-blockquote:text-muted-foreground prose-blockquote:not-italic',
        // Horizontal rule
        'prose-hr:border-border',
        // Images
        'prose-img:rounded-lg prose-img:border prose-img:border-border',
        // Tables
        'prose-table:border prose-table:border-border',
        'prose-th:bg-muted prose-th:px-3 prose-th:py-2',
        'prose-td:px-3 prose-td:py-2 prose-td:border-t prose-td:border-border',
        className
      )}
    >
      {content ? (
        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
          {content}
        </ReactMarkdown>
      ) : (
        <p className="text-muted-foreground italic">Start typing to see preview...</p>
      )}
    </div>
  );
}

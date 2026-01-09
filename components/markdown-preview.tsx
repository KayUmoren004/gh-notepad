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
        'prose prose-neutral dark:prose-invert prose-sm max-w-none p-6',
        // Headings - subtle
        'prose-headings:text-foreground prose-headings:font-semibold',
        'prose-h1:text-xl prose-h1:mb-4 prose-h1:mt-6',
        'prose-h2:text-lg prose-h2:mb-3 prose-h2:mt-5',
        'prose-h3:text-base prose-h3:mb-2 prose-h3:mt-4',
        // Paragraphs
        'prose-p:text-foreground prose-p:leading-relaxed prose-p:my-3',
        // Links - subtle underline
        'prose-a:text-foreground prose-a:underline prose-a:underline-offset-2 prose-a:decoration-muted-foreground/50 hover:prose-a:decoration-foreground',
        // Code - minimal
        'prose-code:text-foreground prose-code:bg-muted/50 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-[13px] prose-code:before:content-none prose-code:after:content-none prose-code:font-normal',
        'prose-pre:bg-muted/50 prose-pre:border prose-pre:border-border/50 prose-pre:rounded-lg',
        // Lists
        'prose-li:text-foreground prose-li:marker:text-muted-foreground prose-li:my-1',
        'prose-ul:my-3 prose-ol:my-3',
        // Blockquote - minimal
        'prose-blockquote:border-l-2 prose-blockquote:border-border prose-blockquote:pl-4 prose-blockquote:text-muted-foreground prose-blockquote:not-italic prose-blockquote:my-4',
        // Horizontal rule
        'prose-hr:border-border/50 prose-hr:my-6',
        // Images
        'prose-img:rounded-lg prose-img:border prose-img:border-border/50 prose-img:my-4',
        // Strong and em
        'prose-strong:text-foreground prose-strong:font-semibold',
        'prose-em:text-foreground',
        className
      )}
    >
      {content ? (
        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
          {content}
        </ReactMarkdown>
      ) : (
        <p className="text-muted-foreground/50 italic">Start writing to see preview...</p>
      )}
    </div>
  );
}

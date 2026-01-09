'use client';

import { formatDistanceToNow } from '@/lib/date-utils';
import { FileText, MoreHorizontal, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { Note, Tag } from '@/lib/types';

interface NoteListProps {
  notes: Note[];
  tags: Tag[];
  selectedNoteId: string | null;
  onSelectNote: (noteId: string) => void;
  onDeleteNote: (noteId: string) => void;
}

export function NoteList({
  notes,
  tags,
  selectedNoteId,
  onSelectNote,
  onDeleteNote,
}: NoteListProps) {
  const getTagColor = (tagName: string) => {
    const tag = tags.find((t) => t.name === tagName);
    return tag?.color || '#9ca3af';
  };

  if (notes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-6">
        <FileText className="h-8 w-8 text-muted-foreground/30 mb-3" />
        <p className="text-sm text-muted-foreground">No notes</p>
      </div>
    );
  }

  return (
    <div>
      {notes.map((note) => {
        const isSelected = note.id === selectedNoteId;
        const preview = note.content
          .replace(/^#+ /gm, '')
          .replace(/\*\*/g, '')
          .replace(/_/g, '')
          .replace(/`/g, '')
          .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
          .replace(/!\[([^\]]*)\]\([^)]+\)/g, '')
          .slice(0, 80);

        return (
          <div
            key={note.id}
            className={cn(
              'group px-3 py-2.5 cursor-pointer transition-colors border-b border-border/30',
              isSelected
                ? 'bg-accent/70'
                : 'hover:bg-accent/40'
            )}
            onClick={() => onSelectNote(note.id)}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-medium text-foreground truncate">
                  {note.title || 'Untitled'}
                </h3>
                {preview && (
                  <p className="text-xs text-muted-foreground truncate mt-0.5 leading-relaxed">
                    {preview}
                  </p>
                )}
                <div className="flex items-center gap-2 mt-1.5">
                  <span className="text-[11px] text-muted-foreground/70">
                    {formatDistanceToNow(note.updatedAt)}
                  </span>
                  {note.tags.length > 0 && (
                    <div className="flex gap-1">
                      {note.tags.slice(0, 2).map((tag) => (
                        <span
                          key={tag}
                          className="text-[10px] px-1.5 py-0.5 rounded"
                          style={{
                            backgroundColor: getTagColor(tag) + '15',
                            color: getTagColor(tag),
                          }}
                        >
                          {tag}
                        </span>
                      ))}
                      {note.tags.length > 2 && (
                        <span className="text-[10px] text-muted-foreground">
                          +{note.tags.length - 2}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <DropdownMenu>
                <DropdownMenuTrigger
                  className="p-1 opacity-0 group-hover:opacity-60 hover:opacity-100 hover:bg-accent rounded transition-opacity"
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive text-sm"
                    onSelect={() => onDeleteNote(note.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-2" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        );
      })}
    </div>
  );
}

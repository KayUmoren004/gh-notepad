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
    return tag?.color || '#6366f1';
  };

  if (notes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-8">
        <FileText className="h-12 w-12 text-muted-foreground/50 mb-4" />
        <h3 className="text-lg font-medium text-foreground mb-1">No notes yet</h3>
        <p className="text-sm text-muted-foreground">
          Create your first note to get started
        </p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-border">
      {notes.map((note) => {
        const isSelected = note.id === selectedNoteId;
        const preview = note.content
          .replace(/^#+ /gm, '')
          .replace(/\*\*/g, '')
          .replace(/_/g, '')
          .replace(/`/g, '')
          .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
          .replace(/!\[([^\]]*)\]\([^)]+\)/g, '')
          .slice(0, 100);

        return (
          <div
            key={note.id}
            className={cn(
              'group p-3 cursor-pointer transition-colors',
              isSelected
                ? 'bg-accent'
                : 'hover:bg-accent/50'
            )}
            onClick={() => onSelectNote(note.id)}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <h3 className="font-medium text-foreground truncate">
                  {note.title || 'Untitled'}
                </h3>
                {preview && (
                  <p className="text-sm text-muted-foreground truncate mt-0.5">
                    {preview}
                  </p>
                )}
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-xs text-muted-foreground">
                    {formatDistanceToNow(note.updatedAt)}
                  </span>
                  {note.tags.length > 0 && (
                    <div className="flex gap-1 flex-wrap">
                      {note.tags.slice(0, 3).map((tag) => (
                        <Badge
                          key={tag}
                          variant="outline"
                          className="text-xs py-0 px-1.5"
                          style={{
                            borderColor: getTagColor(tag),
                            color: getTagColor(tag),
                          }}
                        >
                          {tag}
                        </Badge>
                      ))}
                      {note.tags.length > 3 && (
                        <Badge
                          variant="outline"
                          className="text-xs py-0 px-1.5 text-muted-foreground"
                        >
                          +{note.tags.length - 3}
                        </Badge>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <DropdownMenu>
                <DropdownMenuTrigger
                  className="p-1 opacity-0 group-hover:opacity-100 hover:bg-accent rounded transition-opacity"
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreHorizontal className="h-4 w-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onSelect={() => onDeleteNote(note.id)}
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete note
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

'use client';

import { useState } from 'react';
import {
  FolderOpen,
  Folder,
  Plus,
  MoreHorizontal,
  Trash2,
  FileText,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { Note, Metadata } from '@/lib/types';

interface FolderSidebarProps {
  notes: Note[];
  metadata: Metadata;
  selectedFolder: string | null;
  onSelectFolder: (folder: string | null) => void;
  onCreateFolder: (name: string) => Promise<void>;
  onDeleteFolder: (name: string) => Promise<void>;
}

export function FolderSidebar({
  notes,
  metadata,
  selectedFolder,
  onSelectFolder,
  onCreateFolder,
  onDeleteFolder,
}: FolderSidebarProps) {
  const [isCreating, setIsCreating] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

  // Count notes per folder
  const folderCounts = notes.reduce(
    (acc, note) => {
      const folder = note.folder || '_root';
      acc[folder] = (acc[folder] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return;

    await onCreateFolder(newFolderName.trim());
    setNewFolderName('');
    setIsCreating(false);
  };

  const toggleExpand = (folder: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folder)) {
        next.delete(folder);
      } else {
        next.add(folder);
      }
      return next;
    });
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header - minimal */}
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Folders</span>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
          onClick={() => setIsCreating(true)}
          title="New folder"
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* New folder input */}
      {isCreating && (
        <div className="px-2 pb-2">
          <Input
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            placeholder="Folder name"
            className="h-7 text-sm bg-background border-border/50"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreateFolder();
              if (e.key === 'Escape') {
                setIsCreating(false);
                setNewFolderName('');
              }
            }}
            onBlur={() => {
              if (!newFolderName.trim()) {
                setIsCreating(false);
              }
            }}
          />
        </div>
      )}

      {/* Folder list */}
      <div className="flex-1 overflow-auto px-1">
        {/* All Notes */}
        <button
          className={cn(
            'w-full flex items-center gap-2 px-2 py-1.5 text-sm text-left rounded-md transition-colors',
            selectedFolder === null
              ? 'bg-accent/70 text-foreground'
              : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
          )}
          onClick={() => onSelectFolder(null)}
        >
          <FileText className="h-4 w-4 flex-shrink-0 opacity-70" />
          <span className="flex-1 truncate">All Notes</span>
          <span className="text-xs tabular-nums opacity-60">{notes.length}</span>
        </button>

        {/* Folders */}
        {metadata.folders.map((folder) => {
          const isSelected = selectedFolder === folder;
          const isExpanded = expandedFolders.has(folder);
          const count = folderCounts[folder] || 0;

          return (
            <div key={folder} className="group">
              <div
                className={cn(
                  'flex items-center gap-1 px-2 py-1.5 rounded-md transition-colors',
                  isSelected
                    ? 'bg-accent/70 text-foreground'
                    : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                )}
              >
                <button
                  className="p-0.5 hover:bg-accent rounded opacity-60 hover:opacity-100"
                  onClick={() => toggleExpand(folder)}
                >
                  {isExpanded ? (
                    <ChevronDown className="h-3 w-3" />
                  ) : (
                    <ChevronRight className="h-3 w-3" />
                  )}
                </button>

                <button
                  className="flex-1 flex items-center gap-2 text-sm text-left min-w-0"
                  onClick={() => onSelectFolder(folder)}
                >
                  {isExpanded ? (
                    <FolderOpen className="h-4 w-4 flex-shrink-0 opacity-70" />
                  ) : (
                    <Folder className="h-4 w-4 flex-shrink-0 opacity-70" />
                  )}
                  <span className="flex-1 truncate">{folder}</span>
                  <span className="text-xs tabular-nums opacity-60">{count}</span>
                </button>

                <DropdownMenu>
                  <DropdownMenuTrigger className="p-1 opacity-0 group-hover:opacity-60 hover:opacity-100 hover:bg-accent rounded transition-opacity">
                    <MoreHorizontal className="h-3 w-3" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onSelect={() => onDeleteFolder(folder)}
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Delete folder
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          );
        })}

        {/* Uncategorized (root) */}
        {folderCounts['_root'] > 0 && (
          <button
            className={cn(
              'w-full flex items-center gap-2 px-2 py-1.5 text-sm text-left rounded-md transition-colors ml-5',
              selectedFolder === '_root'
                ? 'bg-accent/70 text-foreground'
                : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
            )}
            onClick={() => onSelectFolder('_root')}
          >
            <Folder className="h-4 w-4 flex-shrink-0 opacity-50" />
            <span className="flex-1 truncate">Uncategorized</span>
            <span className="text-xs tabular-nums opacity-60">{folderCounts['_root']}</span>
          </button>
        )}
      </div>
    </div>
  );
}

'use client';

import { useState } from 'react';
import { Plus, X, Tag as TagIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { Tag, Note } from '@/lib/types';

interface TagFilterProps {
  notes: Note[];
  tags: Tag[];
  selectedTags: string[];
  onToggleTag: (tagName: string) => void;
  onCreateTag: (tag: { name: string; color: string }) => Promise<void>;
  onDeleteTag: (tagName: string) => Promise<void>;
}

const TAG_COLORS = [
  '#9ca3af', // gray
  '#ef4444', // red
  '#f97316', // orange
  '#eab308', // yellow
  '#22c55e', // green
  '#14b8a6', // teal
  '#3b82f6', // blue
  '#8b5cf6', // violet
];

export function TagFilter({
  notes,
  tags,
  selectedTags,
  onToggleTag,
  onCreateTag,
  onDeleteTag,
}: TagFilterProps) {
  const [isCreating, setIsCreating] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [selectedColor, setSelectedColor] = useState(TAG_COLORS[0]);

  // Count notes per tag
  const tagCounts = notes.reduce(
    (acc, note) => {
      note.tags.forEach((tag) => {
        acc[tag] = (acc[tag] || 0) + 1;
      });
      return acc;
    },
    {} as Record<string, number>
  );

  const handleCreateTag = async () => {
    if (!newTagName.trim()) return;

    await onCreateTag({ name: newTagName.trim(), color: selectedColor });
    setNewTagName('');
    setIsCreating(false);
    setSelectedColor(TAG_COLORS[Math.floor(Math.random() * TAG_COLORS.length)]);
  };

  return (
    <div className="border-t border-border/50">
      {/* Header - minimal */}
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
          <TagIcon className="h-3 w-3" />
          Tags
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
          onClick={() => setIsCreating(true)}
          title="New tag"
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* New tag form */}
      {isCreating && (
        <div className="px-3 pb-3 space-y-2">
          <Input
            value={newTagName}
            onChange={(e) => setNewTagName(e.target.value)}
            placeholder="Tag name"
            className="h-7 text-sm bg-background border-border/50"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreateTag();
              if (e.key === 'Escape') {
                setIsCreating(false);
                setNewTagName('');
              }
            }}
          />
          <div className="flex items-center gap-1">
            {TAG_COLORS.map((color) => (
              <button
                key={color}
                className={cn(
                  'w-4 h-4 rounded-full transition-transform',
                  selectedColor === color && 'ring-1 ring-offset-1 ring-offset-background ring-foreground/50 scale-110'
                )}
                style={{ backgroundColor: color }}
                onClick={() => setSelectedColor(color)}
              />
            ))}
          </div>
          <div className="flex gap-2">
            <Button size="sm" className="flex-1 h-7 text-xs" onClick={handleCreateTag}>
              Create
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={() => {
                setIsCreating(false);
                setNewTagName('');
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Tag list */}
      <div className="px-3 pb-3 flex flex-wrap gap-1.5">
        {tags.length === 0 && !isCreating && (
          <p className="text-xs text-muted-foreground/70">No tags</p>
        )}

        {tags.map((tag) => {
          const isSelected = selectedTags.includes(tag.name);
          const count = tagCounts[tag.name] || 0;

          return (
            <Badge
              key={tag.name}
              variant="outline"
              className={cn(
                'cursor-pointer transition-all group text-xs py-0.5 px-2 border-transparent',
                isSelected ? 'ring-1 ring-offset-1 ring-offset-background' : 'opacity-70 hover:opacity-100'
              )}
              style={{
                backgroundColor: isSelected ? tag.color + '20' : 'transparent',
                borderColor: tag.color + '40',
                color: tag.color,
                ['--tw-ring-color' as string]: tag.color + '60',
              }}
              onClick={() => onToggleTag(tag.name)}
            >
              <span>{tag.name}</span>
              <span className="ml-1 opacity-60">({count})</span>
              <button
                className="ml-1 opacity-0 group-hover:opacity-60 hover:opacity-100 transition-opacity"
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteTag(tag.name);
                }}
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </Badge>
          );
        })}

        {selectedTags.length > 0 && (
          <button
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => selectedTags.forEach(onToggleTag)}
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}

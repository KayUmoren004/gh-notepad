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
  '#ef4444', // red
  '#f97316', // orange
  '#eab308', // yellow
  '#22c55e', // green
  '#14b8a6', // teal
  '#3b82f6', // blue
  '#8b5cf6', // violet
  '#ec4899', // pink
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
    <div className="border-t border-border">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-border">
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <TagIcon className="h-4 w-4" />
          Tags
        </h2>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={() => setIsCreating(true)}
          title="New tag"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      {/* New tag form */}
      {isCreating && (
        <div className="p-3 border-b border-border space-y-2">
          <Input
            value={newTagName}
            onChange={(e) => setNewTagName(e.target.value)}
            placeholder="Tag name"
            className="h-8 text-sm"
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
                  'w-5 h-5 rounded-full transition-transform',
                  selectedColor === color && 'ring-2 ring-offset-2 ring-offset-background ring-primary scale-110'
                )}
                style={{ backgroundColor: color }}
                onClick={() => setSelectedColor(color)}
              />
            ))}
          </div>
          <div className="flex gap-2">
            <Button size="sm" className="flex-1" onClick={handleCreateTag}>
              Create
            </Button>
            <Button
              size="sm"
              variant="ghost"
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
      <div className="p-3 flex flex-wrap gap-2">
        {tags.length === 0 && !isCreating && (
          <p className="text-xs text-muted-foreground">No tags yet</p>
        )}

        {tags.map((tag) => {
          const isSelected = selectedTags.includes(tag.name);
          const count = tagCounts[tag.name] || 0;

          return (
            <Badge
              key={tag.name}
              variant={isSelected ? 'default' : 'outline'}
              className={cn(
                'cursor-pointer transition-all group pr-1',
                isSelected && 'ring-1 ring-offset-1 ring-offset-background'
              )}
              style={{
                backgroundColor: isSelected ? tag.color : 'transparent',
                borderColor: tag.color,
                color: isSelected ? '#fff' : tag.color,
              }}
              onClick={() => onToggleTag(tag.name)}
            >
              <span className="mr-1">{tag.name}</span>
              <span className="text-xs opacity-70">({count})</span>
              <button
                className="ml-1 opacity-0 group-hover:opacity-100 hover:bg-black/20 rounded p-0.5 transition-opacity"
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteTag(tag.name);
                }}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          );
        })}

        {selectedTags.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-xs"
            onClick={() => selectedTags.forEach(onToggleTag)}
          >
            Clear filters
          </Button>
        )}
      </div>
    </div>
  );
}

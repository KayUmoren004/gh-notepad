'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth-provider';
import { useNotes } from '@/lib/hooks/use-notes';
import { MarkdownEditor } from '@/components/markdown-editor';
import { FolderSidebar } from '@/components/folder-sidebar';
import { TagFilter } from '@/components/tag-filter';
import { NoteList } from '@/components/note-list';
import { SyncStatus } from '@/components/sync-status';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import {
  Plus,
  Search,
  Menu,
  X,
  LogOut,
  User,
  ChevronLeft,
  Loader2,
  PenLine,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export default function NotesPage() {
  const router = useRouter();
  const { user, isLoading: authLoading, isAuthenticated, logout } = useAuth();
  const {
    notes,
    metadata,
    syncStatus,
    isLoading: notesLoading,
    createNote,
    updateNote,
    deleteNote,
    syncNotes,
    addFolder,
    removeFolder,
    addTag,
    removeTag,
  } = useNotes();

  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Redirect if not authenticated
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/');
    }
  }, [authLoading, isAuthenticated, router]);

  // Filter notes
  const filteredNotes = useMemo(() => {
    return notes.filter((note) => {
      // Folder filter
      if (selectedFolder !== null) {
        if (selectedFolder === '_root') {
          if (note.folder !== null) return false;
        } else {
          if (note.folder !== selectedFolder) return false;
        }
      }

      // Tag filter
      if (selectedTags.length > 0) {
        if (!selectedTags.every((tag) => note.tags.includes(tag))) return false;
      }

      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        return (
          note.title.toLowerCase().includes(query) ||
          note.content.toLowerCase().includes(query)
        );
      }

      return true;
    });
  }, [notes, selectedFolder, selectedTags, searchQuery]);

  // Get selected note
  const selectedNote = useMemo(() => {
    return notes.find((n) => n.id === selectedNoteId) || null;
  }, [notes, selectedNoteId]);

  // Create new note
  const handleCreateNote = useCallback(async () => {
    const newNote = await createNote({
      title: 'Untitled',
      content: '',
      folder: selectedFolder === '_root' ? null : selectedFolder,
      tags: [],
    });
    setSelectedNoteId(newNote.id);
  }, [createNote, selectedFolder]);

  // Update note content
  const handleContentChange = useCallback(
    (content: string) => {
      if (selectedNoteId) {
        updateNote(selectedNoteId, { content });
      }
    },
    [selectedNoteId, updateNote]
  );

  // Update note title
  const handleTitleChange = useCallback(
    (title: string) => {
      if (selectedNoteId) {
        updateNote(selectedNoteId, { title });
      }
    },
    [selectedNoteId, updateNote]
  );

  // Delete note
  const handleDeleteNote = useCallback(
    async (noteId: string) => {
      await deleteNote(noteId);
      if (selectedNoteId === noteId) {
        setSelectedNoteId(null);
      }
    },
    [deleteNote, selectedNoteId]
  );

  // Toggle tag selection
  const handleToggleTag = useCallback((tagName: string) => {
    setSelectedTags((prev) =>
      prev.includes(tagName)
        ? prev.filter((t) => t !== tagName)
        : [...prev, tagName]
    );
  }, []);

  // Loading state
  if (authLoading || (notesLoading && notes.length === 0)) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Loading notes...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-background flex flex-col overflow-hidden">
      {/* Header - minimal chrome */}
      <header className="h-12 border-b border-border/50 flex items-center justify-between px-3 flex-shrink-0 bg-background/80 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          {/* Mobile menu button */}
          <Button
            variant="ghost"
            size="sm"
            className="lg:hidden h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          >
            {isMobileMenuOpen ? (
              <X className="h-4 w-4" />
            ) : (
              <Menu className="h-4 w-4" />
            )}
          </Button>

          {/* Sidebar toggle */}
          <Button
            variant="ghost"
            size="sm"
            className="hidden lg:flex h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
          >
            <Menu className="h-4 w-4" />
          </Button>

          {/* Back button when note is selected on mobile */}
          {selectedNote && (
            <Button
              variant="ghost"
              size="sm"
              className="lg:hidden h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
              onClick={() => setSelectedNoteId(null)}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
          )}

          <span className="text-sm font-medium text-foreground">Notes</span>
        </div>

        <div className="flex items-center gap-2">
          <SyncStatus status={syncStatus} onSync={syncNotes} />

          <DropdownMenu>
            <DropdownMenuTrigger
              className="inline-flex items-center justify-center gap-2 rounded-md text-sm transition-colors hover:bg-accent h-8 px-2"
            >
              {user?.avatar_url ? (
                <img
                  src={user.avatar_url}
                  alt={user.login}
                  className="h-5 w-5 rounded-full"
                />
              ) : (
                <User className="h-4 w-4 text-muted-foreground" />
              )}
              <span className="hidden sm:inline text-sm text-muted-foreground">{user?.login}</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={logout}>
                <LogOut className="h-4 w-4 mr-2" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <aside
          className={cn(
            'border-r border-border/50 bg-sidebar flex-shrink-0 flex flex-col overflow-hidden transition-all duration-200',
            // Desktop
            'hidden lg:flex',
            isSidebarOpen ? 'w-60' : 'w-0 border-r-0',
            // Mobile overlay
            isMobileMenuOpen &&
              'fixed inset-0 z-50 w-full lg:relative lg:w-60 flex bg-background'
          )}
        >
          <FolderSidebar
            notes={notes}
            metadata={metadata}
            selectedFolder={selectedFolder}
            onSelectFolder={(folder) => {
              setSelectedFolder(folder);
              setIsMobileMenuOpen(false);
            }}
            onCreateFolder={addFolder}
            onDeleteFolder={removeFolder}
          />
          <TagFilter
            notes={notes}
            tags={metadata.tags}
            selectedTags={selectedTags}
            onToggleTag={handleToggleTag}
            onCreateTag={addTag}
            onDeleteTag={removeTag}
          />
        </aside>

        {/* Note list */}
        <div
          className={cn(
            'w-64 border-r border-border/50 flex flex-col overflow-hidden flex-shrink-0 bg-background',
            // Hide on mobile when note is selected
            selectedNote && 'hidden lg:flex'
          )}
        >
          {/* Search and New button */}
          <div className="p-2 border-b border-border/50 flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search..."
                className="pl-7 h-8 text-sm bg-transparent border-border/50"
              />
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
              onClick={handleCreateNote}
              title="New note"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>

          {/* Notes */}
          <div className="flex-1 overflow-auto">
            <NoteList
              notes={filteredNotes}
              tags={metadata.tags}
              selectedNoteId={selectedNoteId}
              onSelectNote={setSelectedNoteId}
              onDeleteNote={handleDeleteNote}
            />
          </div>
        </div>

        {/* Editor */}
        <main
          className={cn(
            'flex-1 flex flex-col overflow-hidden bg-background',
            // Hide on mobile when no note is selected
            !selectedNote && 'hidden lg:flex'
          )}
        >
          {selectedNote ? (
            <MarkdownEditor
              key={selectedNote.id}
              content={selectedNote.content}
              onChange={handleContentChange}
              title={selectedNote.title}
              onTitleChange={handleTitleChange}
            />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
              <div className="h-12 w-12 rounded-lg bg-muted/50 flex items-center justify-center mb-4">
                <PenLine className="h-5 w-5 text-muted-foreground" />
              </div>
              <h2 className="text-base font-medium text-foreground mb-1">
                Select a note
              </h2>
              <p className="text-sm text-muted-foreground mb-6">
                Choose from the list or create a new one
              </p>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleCreateNote}
              >
                <Plus className="h-4 w-4 mr-1.5" />
                New note
              </Button>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

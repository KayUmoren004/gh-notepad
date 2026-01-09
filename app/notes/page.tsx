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
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Loading your notes...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-background flex flex-col overflow-hidden">
      {/* Header */}
      <header className="h-14 border-b border-border flex items-center justify-between px-4 flex-shrink-0">
        <div className="flex items-center gap-3">
          {/* Mobile menu button */}
          <Button
            variant="ghost"
            size="sm"
            className="lg:hidden h-8 w-8 p-0"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          >
            {isMobileMenuOpen ? (
              <X className="h-5 w-5" />
            ) : (
              <Menu className="h-5 w-5" />
            )}
          </Button>

          {/* Sidebar toggle */}
          <Button
            variant="ghost"
            size="sm"
            className="hidden lg:flex h-8 w-8 p-0"
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
          >
            <Menu className="h-5 w-5" />
          </Button>

          {/* Back button when note is selected on mobile */}
          {selectedNote && (
            <Button
              variant="ghost"
              size="sm"
              className="lg:hidden h-8 w-8 p-0"
              onClick={() => setSelectedNoteId(null)}
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
          )}

          <h1 className="font-semibold text-foreground">Notes</h1>
        </div>

        <div className="flex items-center gap-3">
          <SyncStatus status={syncStatus} onSync={syncNotes} />

          <DropdownMenu>
            <DropdownMenuTrigger
              className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 hover:bg-accent hover:text-accent-foreground h-8 px-3"
            >
              {user?.avatar_url ? (
                <img
                  src={user.avatar_url}
                  alt={user.login}
                  className="h-6 w-6 rounded-full"
                />
              ) : (
                <User className="h-4 w-4" />
              )}
              <span className="hidden sm:inline">{user?.name || user?.login}</span>
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
            'border-r border-border bg-card flex-shrink-0 flex flex-col overflow-hidden transition-all duration-200',
            // Desktop
            'hidden lg:flex',
            isSidebarOpen ? 'w-64' : 'w-0 border-r-0',
            // Mobile overlay
            isMobileMenuOpen &&
              'fixed inset-0 z-50 w-full lg:relative lg:w-64 flex'
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
            'w-72 border-r border-border flex flex-col overflow-hidden flex-shrink-0',
            // Hide on mobile when note is selected
            selectedNote && 'hidden lg:flex'
          )}
        >
          {/* Search and New button */}
          <div className="p-3 border-b border-border flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search notes..."
                className="pl-8 h-9"
              />
            </div>
            <Button size="sm" className="h-9" onClick={handleCreateNote}>
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
            'flex-1 flex flex-col overflow-hidden',
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
              <div className="h-16 w-16 rounded-2xl bg-muted flex items-center justify-center mb-4">
                <Plus className="h-8 w-8 text-muted-foreground" />
              </div>
              <h2 className="text-xl font-semibold text-foreground mb-2">
                No note selected
              </h2>
              <p className="text-muted-foreground mb-4">
                Select a note from the list or create a new one
              </p>
              <Button onClick={handleCreateNote}>
                <Plus className="h-4 w-4 mr-2" />
                New Note
              </Button>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

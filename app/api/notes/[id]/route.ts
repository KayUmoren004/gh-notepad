import { NextRequest, NextResponse } from 'next/server';
import { getTokenFromCookie } from '@/lib/github-auth';
import { getNoteById, updateNote, deleteNote } from '@/lib/github-notes';

// GET /api/notes/[id] - Get a single note
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const token = await getTokenFromCookie();
  const { id } = await params;

  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const note = await getNoteById(token, id);

    if (!note) {
      return NextResponse.json({ error: 'Note not found' }, { status: 404 });
    }

    return NextResponse.json({ note });
  } catch (error) {
    console.error('Failed to get note:', error);
    return NextResponse.json(
      { error: 'Failed to fetch note' },
      { status: 500 }
    );
  }
}

// PUT /api/notes/[id] - Update a note
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const token = await getTokenFromCookie();
  const { id } = await params;

  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { title, content, folder, tags, sha } = body;

    if (!sha) {
      return NextResponse.json(
        { error: 'SHA is required for updates' },
        { status: 400 }
      );
    }

    const updatedNote = await updateNote(
      token,
      id,
      { title, content, folder, tags },
      sha
    );

    return NextResponse.json({ note: updatedNote });
  } catch (error) {
    console.error('Failed to update note:', error);
    return NextResponse.json(
      { error: 'Failed to update note' },
      { status: 500 }
    );
  }
}

// DELETE /api/notes/[id] - Delete a note
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const token = await getTokenFromCookie();
  const { id } = await params;

  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const sha = searchParams.get('sha');

    if (!sha) {
      return NextResponse.json(
        { error: 'SHA is required for deletion' },
        { status: 400 }
      );
    }

    await deleteNote(token, id, sha);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete note:', error);
    return NextResponse.json(
      { error: 'Failed to delete note' },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { getTokenFromCookie } from '@/lib/github-auth';
import { getAllNotes, createNote, getMetadata } from '@/lib/github-notes';

// GET /api/notes - Get all notes
export async function GET() {
  const token = await getTokenFromCookie();

  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const [notes, metadata] = await Promise.all([
      getAllNotes(token),
      getMetadata(token),
    ]);

    return NextResponse.json({ notes, metadata });
  } catch (error) {
    console.error('Failed to get notes:', error);
    return NextResponse.json(
      { error: 'Failed to fetch notes' },
      { status: 500 }
    );
  }
}

// POST /api/notes - Create a new note
export async function POST(request: NextRequest) {
  const token = await getTokenFromCookie();

  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { title, content, folder, tags } = body;

    if (!title || typeof title !== 'string') {
      return NextResponse.json(
        { error: 'Title is required' },
        { status: 400 }
      );
    }

    const note = await createNote(token, {
      title,
      content: content || "",
      folder: folder || null,
      tags: tags || [],
    });

    return NextResponse.json({ note }, { status: 201 });
  } catch (error) {
    console.error("Failed to create note:", error);
    const message =
      error instanceof Error && error.message
        ? error.message
        : "Failed to create note";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

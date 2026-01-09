import { NextRequest, NextResponse } from 'next/server';
import { getTokenFromCookie } from '@/lib/github-auth';
import {
  getMetadata,
  addFolder,
  removeFolder,
  addTag,
  removeTag,
} from '@/lib/github-notes';

// GET /api/metadata - Get folders and tags
export async function GET() {
  const token = await getTokenFromCookie();

  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const metadata = await getMetadata(token);
    return NextResponse.json({ metadata });
  } catch (error) {
    console.error('Failed to get metadata:', error);
    return NextResponse.json(
      { error: 'Failed to fetch metadata' },
      { status: 500 }
    );
  }
}

// POST /api/metadata - Add folder or tag
export async function POST(request: NextRequest) {
  const token = await getTokenFromCookie();

  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { type, name, color } = body;

    if (type === 'folder') {
      if (!name || typeof name !== 'string') {
        return NextResponse.json(
          { error: 'Folder name is required' },
          { status: 400 }
        );
      }
      await addFolder(token, name);
    } else if (type === 'tag') {
      if (!name || typeof name !== 'string') {
        return NextResponse.json(
          { error: 'Tag name is required' },
          { status: 400 }
        );
      }
      await addTag(token, { name, color: color || '#6366f1' });
    } else {
      return NextResponse.json(
        { error: 'Invalid type. Must be "folder" or "tag"' },
        { status: 400 }
      );
    }

    const metadata = await getMetadata(token);
    return NextResponse.json({ metadata }, { status: 201 });
  } catch (error) {
    console.error('Failed to add metadata:', error);
    return NextResponse.json(
      { error: 'Failed to add metadata' },
      { status: 500 }
    );
  }
}

// DELETE /api/metadata - Remove folder or tag
export async function DELETE(request: NextRequest) {
  const token = await getTokenFromCookie();

  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type');
    const name = searchParams.get('name');

    if (!type || !name) {
      return NextResponse.json(
        { error: 'Type and name are required' },
        { status: 400 }
      );
    }

    if (type === 'folder') {
      await removeFolder(token, name);
    } else if (type === 'tag') {
      await removeTag(token, name);
    } else {
      return NextResponse.json(
        { error: 'Invalid type. Must be "folder" or "tag"' },
        { status: 400 }
      );
    }

    const metadata = await getMetadata(token);
    return NextResponse.json({ metadata });
  } catch (error) {
    console.error('Failed to remove metadata:', error);
    return NextResponse.json(
      { error: 'Failed to remove metadata' },
      { status: 500 }
    );
  }
}

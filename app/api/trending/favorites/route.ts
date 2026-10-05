import { NextResponse } from 'next/server';
import { getUserIdFromRequest, requireAuth } from '@/app/api/_lib/auth';
import {
  getUserFavorites,
  getUserFavoriteKeys,
  addFavorite,
  removeFavorite,
} from '@/lib/trending/favorites';

export async function GET(request: Request) {
  try {
    const userId = getUserIdFromRequest(request);
    if (!userId) {
      return NextResponse.json({
        success: true,
        authenticated: false,
        favorites: [],
        favoriteKeys: [],
      });
    }

    const favorites = getUserFavorites(userId);
    const favoriteKeys = getUserFavoriteKeys(userId);

    return NextResponse.json({
      success: true,
      authenticated: true,
      favorites,
      favoriteKeys,
    });
  } catch (error: any) {
    console.error('[api/trending/favorites] GET Error:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to get favorites' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const userId = requireAuth(request);
    const body = await request.json();

    const { source, sourceName, itemId, title, url, heat, desc, category, date } = body;
    if (!source || !itemId || !title) {
      return NextResponse.json(
        { success: false, error: 'source, itemId and title are required' },
        { status: 400 }
      );
    }

    const favorite = addFavorite(userId, {
      source,
      sourceName: sourceName || source,
      itemId,
      title,
      url: url || '',
      heat,
      desc,
      category,
      date,
    });

    const favoriteKeys = getUserFavoriteKeys(userId);

    return NextResponse.json({
      success: true,
      favorite,
      favoriteKeys,
    });
  } catch (error: any) {
    const isAuthError = error?.message === 'Unauthorized';
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to save favorite' },
      { status: isAuthError ? 401 : 500 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const userId = requireAuth(request);
    const { searchParams } = new URL(request.url);
    let source = searchParams.get('source');
    let itemId = searchParams.get('itemId');

    if (!source || !itemId) {
      try {
        const body = await request.json();
        source = source || body.source;
        itemId = itemId || body.itemId;
      } catch {
        // query param was enough or body is empty
      }
    }

    if (!source || !itemId) {
      return NextResponse.json(
        { success: false, error: 'source and itemId are required' },
        { status: 400 }
      );
    }

    const removed = removeFavorite(userId, source, itemId);
    const favoriteKeys = getUserFavoriteKeys(userId);

    return NextResponse.json({
      success: true,
      removed,
      favoriteKeys,
    });
  } catch (error: any) {
    const isAuthError = error?.message === 'Unauthorized';
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to remove favorite' },
      { status: isAuthError ? 401 : 500 }
    );
  }
}

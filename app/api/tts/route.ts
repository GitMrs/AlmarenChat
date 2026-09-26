import { NextResponse } from 'next/server';
import { requireAuth } from '@/app/api/_lib/auth';
import { getAvailableVoices, synthesizeSpeech } from '@/lib/tts';

export const runtime = 'nodejs';

// GET /api/tts - Return voices list OR synthesize if text param is provided
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const text = url.searchParams.get('text');

    // If no text parameter is provided, return available voice presets
    if (!text) {
      return NextResponse.json({
        ok: true,
        voices: getAvailableVoices(),
      });
    }

    // If text is provided, verify authentication and stream audio
    requireAuth(request);

    if (text.length > 2000) {
      return NextResponse.json({ error: 'Text exceeds maximum length of 2000 characters' }, { status: 400 });
    }

    const voice = url.searchParams.get('voice') || undefined;
    const rate = url.searchParams.get('rate') || undefined;
    const pitch = url.searchParams.get('pitch') || undefined;

    const audioBuffer = await synthesizeSpeech(text, { voice, rate, pitch });

    return new Response(new Uint8Array(audioBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': String(audioBuffer.length),
        'Cache-Control': 'public, max-age=86400, stale-while-revalidate=3600',
      },
    });
  } catch (error: any) {
    if (error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('[TTS GET Error]:', error);
    return NextResponse.json({ error: error.message || 'TTS synthesis failed' }, { status: 500 });
  }
}

// POST /api/tts - Synthesize text to audio/mpeg
export async function POST(request: Request) {
  try {
    requireAuth(request);

    const body = await request.json().catch(() => ({}));
    const { text, voice, rate, pitch } = body;

    if (!text || typeof text !== 'string' || !text.trim()) {
      return NextResponse.json({ error: 'Text is required and must not be empty' }, { status: 400 });
    }

    if (text.length > 2000) {
      return NextResponse.json({ error: 'Text exceeds maximum length of 2000 characters' }, { status: 400 });
    }

    const audioBuffer = await synthesizeSpeech(text, { voice, rate, pitch });

    return new Response(new Uint8Array(audioBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': String(audioBuffer.length),
        'Cache-Control': 'public, max-age=86400, stale-while-revalidate=3600',
      },
    });
  } catch (error: any) {
    if (error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('[TTS POST Error]:', error);
    return NextResponse.json({ error: error.message || 'TTS synthesis failed' }, { status: 500 });
  }
}

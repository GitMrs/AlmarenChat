import { NextResponse } from 'next/server';
import { getUserIdFromRequest } from '@/app/api/_lib/auth';
import { cleanMarkdownForTTS, getAvailableVoices, synthesizeSpeech } from '@/lib/tts';

export const runtime = 'nodejs';

// GET /api/tts - Return voices list OR synthesize if text param is provided
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const rawText = url.searchParams.get('text');

    // If no text parameter is provided, return available voice presets
    if (!rawText) {
      return NextResponse.json({
        ok: true,
        voices: getAvailableVoices(),
      });
    }

    // Edge TTS is free and disk cached; allow guest users with fallback
    getUserIdFromRequest(request);

    let text = cleanMarkdownForTTS(rawText);
    if (!text) {
      return NextResponse.json({ error: 'Text to synthesize cannot be empty' }, { status: 400 });
    }

    if (text.length > 3500) {
      text = text.slice(0, 3500);
    }

    const voice = url.searchParams.get('voice') || undefined;
    const rate = url.searchParams.get('rate') || undefined;
    const pitch = url.searchParams.get('pitch') || undefined;
    const rawNamespace = url.searchParams.get('cacheNamespace');
    const cacheNamespace = typeof rawNamespace === 'string' && /^[a-z0-9_-]+$/i.test(rawNamespace)
      ? rawNamespace as any
      : undefined;
    const timeoutParam = url.searchParams.get('timeoutMs') || url.searchParams.get('timeout');
    const timeoutMs = timeoutParam ? parseInt(timeoutParam, 10) : undefined;

    const audioBuffer = await synthesizeSpeech(text, {
      voice,
      rate,
      pitch,
      timeoutMs: timeoutMs && timeoutMs > 0 ? timeoutMs : undefined,
      cacheNamespace,
    });

    return new Response(new Uint8Array(audioBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': String(audioBuffer.length),
        'Cache-Control': 'public, max-age=86400, stale-while-revalidate=3600',
        'X-TTS-Cache': (audioBuffer as any).cacheStatus || 'MISS',
      },
    });
  } catch (error: any) {
    if (error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error.code === 'EMPTY_TEXT' || error.message?.includes('cannot be empty')) {
      return NextResponse.json({ error: error.message || 'Text to synthesize cannot be empty' }, { status: 400 });
    }
    if (error.message?.includes('timed out') || error.message?.includes('stalled')) {
      console.warn('[TTS GET Timeout]:', error.message);
      return NextResponse.json({ error: error.message }, { status: 504 });
    }
    if (error.code === 'TTS_HANDSHAKE_FORBIDDEN') {
      console.warn('[TTS GET Handshake Rejected]:', error.message);
      return NextResponse.json({ error: 'Edge TTS 拒绝连接（HTTP 403），请检查握手协议兼容性、服务器时间或服务访问限制。', code: error.code }, { status: 502 });
    }
    if (error.code === 'TTS_CONNECTION_ERROR' || error.message?.includes('non-101') || error.message?.includes('ECONNRESET')) {
      console.warn('[TTS GET Network Error]:', error.message);
      return NextResponse.json(
        { error: 'Edge TTS 连接失败，请检查网络或代理；握手被拒绝时也可能是协议兼容性问题。' },
        { status: 502 }
      );
    }
    console.error('[TTS GET Error]:', error);
    return NextResponse.json({ error: error.message || 'TTS synthesis failed' }, { status: 500 });
  }
}

// POST /api/tts - Synthesize text to audio/mpeg
export async function POST(request: Request) {
  try {
    // Edge TTS is free and disk cached; allow guest users with fallback
    getUserIdFromRequest(request);

    const body = await request.json().catch(() => ({}));
    const { text: rawText, voice, rate, pitch, cacheNamespace: rawNamespace, timeoutMs: rawTimeout } = body;

    if (!rawText || typeof rawText !== 'string' || !rawText.trim()) {
      return NextResponse.json({ error: 'Text is required and must not be empty' }, { status: 400 });
    }

    let text = cleanMarkdownForTTS(rawText);
    if (!text) {
      return NextResponse.json({ error: 'Text to synthesize cannot be empty' }, { status: 400 });
    }

    if (text.length > 3500) {
      text = text.slice(0, 3500);
    }

    const cacheNamespace = typeof rawNamespace === 'string' && /^[a-z0-9_-]+$/i.test(rawNamespace)
      ? rawNamespace as any
      : undefined;
    const timeoutMs = typeof rawTimeout === 'number' && rawTimeout > 0 ? rawTimeout : undefined;

    const audioBuffer = await synthesizeSpeech(text, {
      voice,
      rate,
      pitch,
      timeoutMs,
      cacheNamespace,
    });

    return new Response(new Uint8Array(audioBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': String(audioBuffer.length),
        'Cache-Control': 'public, max-age=86400, stale-while-revalidate=3600',
        'X-TTS-Cache': (audioBuffer as any).cacheStatus || 'MISS',
      },
    });
  } catch (error: any) {
    if (error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error.code === 'EMPTY_TEXT' || error.message?.includes('cannot be empty')) {
      return NextResponse.json({ error: error.message || 'Text to synthesize cannot be empty' }, { status: 400 });
    }
    if (error.message?.includes('timed out') || error.message?.includes('stalled')) {
      console.warn('[TTS POST Timeout]:', error.message);
      return NextResponse.json({ error: error.message }, { status: 504 });
    }
    if (error.code === 'TTS_HANDSHAKE_FORBIDDEN') {
      console.warn('[TTS POST Handshake Rejected]:', error.message);
      return NextResponse.json({ error: 'Edge TTS 拒绝连接（HTTP 403），请检查握手协议兼容性、服务器时间或服务访问限制。', code: error.code }, { status: 502 });
    }
    if (error.code === 'TTS_CONNECTION_ERROR' || error.message?.includes('non-101') || error.message?.includes('ECONNRESET')) {
      console.warn('[TTS POST Network Error]:', error.message);
      return NextResponse.json(
        { error: 'Edge TTS 连接失败，请检查网络或代理；握手被拒绝时也可能是协议兼容性问题。' },
        { status: 502 }
      );
    }
    console.error('[TTS POST Error]:', error);
    return NextResponse.json({ error: error.message || 'TTS synthesis failed' }, { status: 500 });
  }
}

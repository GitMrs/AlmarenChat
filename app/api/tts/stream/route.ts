import { NextResponse } from 'next/server';
import { getUserIdFromRequest } from '@/app/api/_lib/auth';
import { cleanMarkdownForTTS, getVoiceById, streamFishTTS } from '@/lib/tts';

export const runtime = 'nodejs';

/** Stream Fish Audio chunks for the low-latency phone path. */
export async function POST(request: Request) {
  try {
    getUserIdFromRequest(request);
    const body = await request.json().catch(() => ({}));
    const rawText = typeof body.text === 'string' ? body.text : '';
    const text = cleanMarkdownForTTS(rawText).trim();
    if (!text) return NextResponse.json({ error: 'Text is required and must not be empty' }, { status: 400 });
    if (text.length > 3500) return NextResponse.json({ error: 'Text is too long for streaming TTS' }, { status: 400 });

    const voice = typeof body.voice === 'string' ? body.voice : 'fish-nari';
    const voiceMeta = getVoiceById(voice);
    if (voiceMeta?.engine !== 'fish-audio' && !voice.startsWith('fish-')) {
      return NextResponse.json({ error: 'Streaming TTS currently supports Fish Audio voices only' }, { status: 400 });
    }
    const upstream = await streamFishTTS(text, {
      referenceId: voiceMeta?.referenceId,
      format: 'mp3',
      latency: 'balanced',
    });
    if (!upstream.ok || !upstream.body) {
      const detail = await upstream.text().catch(() => 'Fish Audio streaming request failed');
      return NextResponse.json({ error: detail || `Fish Audio HTTP ${upstream.status}` }, { status: 502 });
    }
    return new Response(upstream.body, {
      status: 200,
      headers: {
        'Content-Type': upstream.headers.get('content-type') || 'audio/mpeg',
        'Cache-Control': 'no-store',
        'Transfer-Encoding': 'chunked',
        'X-TTS-Streaming': 'fish-audio-http',
      },
    });
  } catch (error: any) {
    console.error('[TTS stream error]:', error);
    return NextResponse.json({ error: error?.message || 'Streaming TTS failed' }, { status: 502 });
  }
}

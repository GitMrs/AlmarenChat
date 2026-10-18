import fs from 'node:fs';
import path from 'node:path';
import { smartFetch } from '../network/proxy.ts';

function getFishApiKey() {
  if (process.env.FISH_AUDIO_API_KEY) return process.env.FISH_AUDIO_API_KEY;
  if (process.env.flishKey) return process.env.flishKey;
  if (process.env.FISH_KEY) return process.env.FISH_KEY;
  try {
    const envPath = path.resolve(process.cwd(), '.env');
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf-8');
      const match = content.match(/(?:FISH_AUDIO_API_KEY|flishKey|FISH_KEY)=([^\r\n]+)/);
      if (match && match[1]) return match[1].trim();
    }
  } catch {}
  return null;
}

export async function synthesizeFishTTS(text, options = {}) {
  const apiKey = getFishApiKey();
  if (!apiKey) {
    throw new Error('Fish Audio API key not found in environment');
  }

  const referenceId = options.referenceId || 'faccba1a8ac54016bcfc02761285e67f';
  const timeoutMs = options.timeoutMs || 8500;

  const response = await smartFetch('https://api.fish.audio/v1/tts', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      model: 's2.1-pro-free',
    },
    body: JSON.stringify({
      text,
      reference_id: referenceId,
      format: 'mp3',
    }),
    prefer: 'proxy-first',
    timeoutMs,
  });

  if (!response.ok) {
    throw new Error(`Fish Audio TTS failed: HTTP ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength < 500) {
    throw new Error('Fish Audio returned empty or corrupted audio');
  }

  return Buffer.from(arrayBuffer);
}

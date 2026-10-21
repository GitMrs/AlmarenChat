import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';

process.env.VIDEO_ASR_ENABLED = '1';

const asr = await import('./video-asr.mjs');

function mockFetch(routes) {
  const calls = [];
  const impl = async (url) => {
    const u = String(url);
    calls.push(u);
    for (const [match, responder] of routes) {
      if (u.includes(match)) {
        const result = typeof responder === 'function' ? await responder(u) : responder;
        return {
          ok: result.ok !== false,
          status: result.status || 200,
          json: async () => result.json,
          text: async () => result.text ?? JSON.stringify(result.json),
          arrayBuffer: async () => result.arrayBuffer ?? new TextEncoder().encode(result.text || '').buffer,
        };
      }
    }
    return { ok: false, status: 404, json: async () => null, text: async () => '', arrayBuffer: async () => new ArrayBuffer(0) };
  };
  impl.calls = calls;
  return impl;
}

test('getBilibiliAudioUrl 选最低码率的音频流', async () => {
  const fetchImpl = mockFetch([
    ['/x/player/playurl', {
      json: {
        code: 0,
        data: {
          dash: {
            audio: [
              { bandwidth: 200000, baseUrl: 'https://audio-hi.m4s' },
              { bandwidth: 50000, baseUrl: 'https://audio-lo.m4s' },
            ],
          },
        },
      },
    }],
  ]);

  const url = await asr.getBilibiliAudioUrl('BV1test', 123, { fetchImpl });
  assert.equal(url, 'https://audio-lo.m4s');
});

test('getBilibiliAudioUrl 无 dash 音频时返回 null', async () => {
  const fetchImpl = mockFetch([
    ['/x/player/playurl', { json: { code: 0, data: { dash: {} } } }],
  ]);
  const url = await asr.getBilibiliAudioUrl('BV1test', 123, { fetchImpl });
  assert.equal(url, null);
});

test('ASR 开关 VIDEO_ASR_ENABLED=0 时直接返回 null', async () => {
  process.env.VIDEO_ASR_ENABLED = '0';
  try {
    const result = await asr.transcribeBilibiliVideo({ bvid: 'BV1x', cid: 1, duration: 60 }, { fetchImpl: mockFetch([]) });
    assert.equal(result, null);
  } finally {
    process.env.VIDEO_ASR_ENABLED = '1';
  }
});

test('超过时长上限的视频不触发转写', async () => {
  process.env.VIDEO_ASR_MAX_DURATION_S = '60';
  try {
    const fetchImpl = mockFetch([]);
    const result = await asr.transcribeBilibiliVideo({ bvid: 'BV1y', cid: 1, duration: 300 }, { fetchImpl });
    assert.equal(result, null);
    assert.equal(fetchImpl.calls.length, 0); // 连音频地址都不该拉
  } finally {
    delete process.env.VIDEO_ASR_MAX_DURATION_S;
  }
});

test('有缓存时直接返回缓存文本，不再走网络', async () => {
  const bvid = 'BV1cachetest';
  const cachePath = asr.getAsrCachePath(bvid);
  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  await fs.writeFile(cachePath, JSON.stringify({ bvid, text: '缓存的转写文本', at: new Date().toISOString() }));
  try {
    const fetchImpl = mockFetch([]);
    const result = await asr.transcribeBilibiliVideo({ bvid, cid: 1, duration: 60 }, { fetchImpl });
    assert.equal(result.text, '缓存的转写文本');
    assert.equal(result.cached, true);
    assert.equal(fetchImpl.calls.length, 0);
  } finally {
    await fs.rm(cachePath, { force: true }).catch(() => {});
  }
});

test('looksLikeHallucination 识别 whisper 无限重复幻听', () => {
  assert.equal(asr.looksLikeHallucination('我看你不太好看你不太好看你不太好看你不太好看你不太好看你不太'), true);
  assert.equal(asr.looksLikeHallucination('今天介绍舒芙蕾的做法，首先准备蛋白和低筋面粉。'), false);
  assert.equal(asr.looksLikeHallucination(''), false);
  assert.equal(asr.looksLikeHallucination('哈哈哈哈哈哈哈哈'), false); // 片段过短（<6字）不误伤口语
});

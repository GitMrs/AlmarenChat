import assert from 'node:assert/strict';
import test from 'node:test';

import {
  fetchBilibiliVideoText,
  fetchVideoContent,
  fetchYouTubeVideoText,
  formatVideoContent,
  isMusicOrNoiseOnlySubtitle,
  isSubtitleMatchingVideo,
  parseVideoUrl,
} from './web-video.mjs';

function mockFetch(routes) {
  return async (url) => {
    const key = Object.keys(routes).find((prefix) => String(url).startsWith(prefix));
    if (!key) throw new Error(`unexpected url: ${url}`);
    const body = routes[key];
    return {
      ok: true,
      async json() {
        return typeof body === 'string' ? JSON.parse(body) : body;
      },
      async text() {
        return typeof body === 'string' ? body : JSON.stringify(body);
      },
    };
  };
}

test('parseVideoUrl recognizes bilibili and youtube url forms', () => {
  assert.deepEqual(parseVideoUrl('https://www.bilibili.com/video/BV1ALnw6YE4S/?spm=1'), {
    platform: 'bilibili',
    id: 'BV1ALnw6YE4S',
  });
  assert.deepEqual(parseVideoUrl('https://b23.tv/BV1ALnw6YE4S'), {
    platform: 'bilibili',
    id: 'BV1ALnw6YE4S',
  });
  assert.deepEqual(parseVideoUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42'), {
    platform: 'youtube',
    id: 'dQw4w9WgXcQ',
  });
  assert.deepEqual(parseVideoUrl('https://youtu.be/dQw4w9WgXcQ'), {
    platform: 'youtube',
    id: 'dQw4w9WgXcQ',
  });
  assert.deepEqual(parseVideoUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ'), {
    platform: 'youtube',
    id: 'dQw4w9WgXcQ',
  });
  assert.equal(parseVideoUrl('https://sspai.com/post/115209'), null);
  assert.equal(parseVideoUrl('not a url'), null);
});

test('fetchBilibiliVideoText merges metadata and subtitle body', async () => {
  const fetchImpl = mockFetch({
    'https://api.bilibili.com/x/web-interface/view': {
      code: 0,
      data: {
        title: '向量检索入门',
        desc: '从零理解 embedding',
        duration: 754,
        owner: { name: '某UP主' },
        pages: [{ cid: 123456 }],
      },
    },
    'https://api.bilibili.com/x/player/v2': {
      code: 0,
      data: {
        subtitle: {
          subtitles: [
            { lan: 'en', subtitle_url: '//example.com/en.json' },
            { lan: 'zh-CN', subtitle_url: '//example.com/zh.json' },
          ],
        },
      },
    },
    'https://example.com/zh.json': {
      body: [
        { content: '第一段字幕', from: 0, to: 300 },
        { content: '第二段字幕', from: 300, to: 700 },
        { content: ' ', from: 700, to: 754 },
      ],
    },
  });

  const info = await fetchBilibiliVideoText('BV1ALnw6YE4S', { fetchImpl });
  assert.equal(info.title, '向量检索入门');
  assert.equal(info.uploader, '某UP主');
  assert.equal(info.duration, 754);
  // 优先中文字幕，空段被过滤
  assert.equal(info.subtitleText, '第一段字幕\n第二段字幕');
});

test('fetchBilibiliVideoText returns empty subtitleText when no subtitles', async () => {
  const fetchImpl = mockFetch({
    'https://api.bilibili.com/x/web-interface/view': {
      code: 0,
      data: { title: '无字幕视频', desc: '', duration: 60, owner: { name: 'UP' }, pages: [{ cid: 1 }] },
    },
    'https://api.bilibili.com/x/player/v2': { code: 0, data: { subtitle: { subtitles: [] } } },
  });
  const info = await fetchBilibiliVideoText('BV1ALnw6YE4S', { fetchImpl });
  assert.equal(info.subtitleText, '');
});

test('bilibili prefers wbi endpoint and ai-zh track, rejects low-coverage subtitles', async () => {
  // wbi/v2 可用时优先走 wbi（nav 提供签名 key），且 ai-zh 优先于人工 zh
  const wbiFetch = mockFetch({
    'https://api.bilibili.com/x/web-interface/view': {
      code: 0,
      data: { title: 'T', desc: '', duration: 100, owner: { name: 'U' }, pages: [{ cid: 7 }] },
    },
    'https://api.bilibili.com/x/web-interface/nav': {
      code: 0,
      data: { wbi_img: { img_url: 'https://i0.hdslb.com/bfs/wbi/aaa.png', sub_url: 'https://i0.hdslb.com/bfs/wbi/bbb.png' } },
    },
    'https://api.bilibili.com/x/player/wbi/v2': {
      code: 0,
      data: {
        subtitle: {
          subtitles: [
            { lan: 'zh-Hans', subtitle_url: '//example.com/human.json' },
            { lan: 'ai-zh', subtitle_url: '//example.com/ai.json' },
          ],
        },
      },
    },
    'https://example.com/ai.json': {
      body: [{ content: 'AI字幕内容', from: 0, to: 95 }],
    },
  });
  const info = await fetchBilibiliVideoText('BV1ALnw6YE4S', { fetchImpl: wbiFetch });
  assert.equal(info.subtitleText, 'AI字幕内容');

  // 中文轨覆盖度不足（串缓存脏数据）时，自动降级到下一优先级的 ai-en 轨
  const dirtyZhFetch = mockFetch({
    'https://api.bilibili.com/x/web-interface/view': {
      code: 0,
      data: { title: 'T', desc: '', duration: 600, owner: { name: 'U' }, pages: [{ cid: 7 }] },
    },
    'https://api.bilibili.com/x/player/v2': {
      code: 0,
      data: {
        subtitle: {
          subtitles: [
            { lan: 'ai-zh', subtitle_url: '//example.com/dirty-zh.json' },
            { lan: 'ai-en', subtitle_url: '//example.com/en.json' },
          ],
        },
      },
    },
    'https://example.com/dirty-zh.json': { body: [{ content: '别的视频的字幕', from: 0, to: 30 }] },
    'https://example.com/en.json': { body: [{ content: 'correct english track', from: 0, to: 590 }] },
  });
  const degraded = await fetchBilibiliVideoText('BV1ALnw6YE4S', { fetchImpl: dirtyZhFetch });
  assert.equal(degraded.subtitleText, 'correct english track');

  // 唯一字幕轨覆盖度不足 → 返回空，走兜底
  const lowCoverageFetch = mockFetch({
    'https://api.bilibili.com/x/web-interface/view': {
      code: 0,
      data: { title: 'T', desc: '', duration: 600, owner: { name: 'U' }, pages: [{ cid: 7 }] },
    },
    'https://api.bilibili.com/x/player/v2': {
      code: 0,
      data: { subtitle: { subtitles: [{ lan: 'zh-CN', subtitle_url: '//example.com/zh.json' }] } },
    },
    'https://example.com/zh.json': { body: [{ content: '只有开头有字幕', from: 0, to: 30 }] },
  });
  const low = await fetchBilibiliVideoText('BV1ALnw6YE4S', { fetchImpl: lowCoverageFetch });
  assert.equal(low.subtitleText, '');
});

test('fetchYouTubeVideoText parses captionTracks from player response', async () => {
  const playerResponse = {
    videoDetails: {
      title: 'Embedding Tutorial',
      author: 'Channel',
      shortDescription: 'A tutorial about embeddings',
      lengthSeconds: '600',
    },
    captions: {
      playerCaptionsTracklistRenderer: {
        captionTracks: [
          { languageCode: 'en', baseUrl: 'https://youtube.example/en.ttml' },
          { languageCode: 'zh-CN', baseUrl: 'https://youtube.example/zh.ttml' },
        ],
      },
    },
  };
  const html = `<html><script>var ytInitialPlayerResponse = ${JSON.stringify(playerResponse)};</script></html>`;
  const xml =
    '<transcript><text start="0" dur="2">第一段 &amp; 介绍</text><text start="2" dur="2">第二段</text></transcript>';
  const fetchImpl = mockFetch({
    'https://www.youtube.com/watch': html,
    'https://youtube.example/zh.ttml': xml,
  });

  const info = await fetchYouTubeVideoText('dQw4w9WgXcQ', { fetchImpl });
  assert.equal(info.title, 'Embedding Tutorial');
  assert.equal(info.uploader, 'Channel');
  assert.equal(info.duration, 600);
  assert.equal(info.subtitleText, '第一段 & 介绍\n第二段');
});

test('fetchVideoContent returns null for unsupported urls and never throws', async () => {
  assert.equal(await fetchVideoContent('https://sspai.com/post/1', { fetchImpl: mockFetch({}) }), null);
  const failing = async () => {
    throw new Error('network down');
  };
  assert.equal(
    await fetchVideoContent('https://www.bilibili.com/video/BV1ALnw6YE4S', { fetchImpl: failing }),
    null
  );
});

test('formatVideoContent renders title, uploader and subtitle', () => {
  const text = formatVideoContent({
    platform: 'bilibili',
    title: '标题',
    uploader: 'UP',
    desc: '简介',
    duration: 125,
    subtitleText: '字幕内容',
  });
  assert.ok(text.includes('# 标题'));
  assert.ok(text.includes('B站'));
  assert.ok(text.includes('2:05'));
  assert.ok(text.includes('【字幕正文】'));
});

test('isMusicOrNoiseOnlySubtitle filters pure BGM/symbol tracks and keeps spoken speech', () => {
  assert.equal(isMusicOrNoiseOnlySubtitle('♪ ♫ ♪\n[音乐]\n（掌声）'), true);
  assert.equal(isMusicOrNoiseOnlySubtitle('♪♪♪ 啦啦啦'), true);
  assert.equal(
    isMusicOrNoiseOnlySubtitle('♪ 欢迎大家来到今天的向量检索教程，我们一起来看看核心原理与工程实践'),
    false
  );
  assert.equal(isMusicOrNoiseOnlySubtitle('今天我们来聊聊向量检索的工程实践'), false);
});

test('isSubtitleMatchingVideo detects cross-video CDN cache mismatch while allowing valid tracks', () => {
  const title = '深入理解 TypeScript 类型体操与泛型推导';
  const desc = '本期视频讲解条件类型、infer 关键字以及协变逆变的核心用法';
  const mismatchedSubtitle =
    '今天教大家做一道正宗的红烧肉，首先准备五花肉五百克，冷水下锅加入葱姜料酒焯水，捞出控干水分后下冰糖炒出糖色，炖煮四十分钟即可收汁出锅。';
  const matchedSubtitle =
    '很多同学在写 TypeScript 泛型推导的时候经常搞不清楚 infer 关键字的边界条件，今天我们就从条件类型开始一步步拆解。';

  assert.equal(isSubtitleMatchingVideo(title, desc, mismatchedSubtitle), false);
  assert.equal(isSubtitleMatchingVideo(title, desc, matchedSubtitle), true);
});

test('fetchBilibiliVideoText skips music-only or mismatched tracks and supports subtitle_url_v2', async () => {
  const fetchImpl = mockFetch({
    'https://api.bilibili.com/x/web-interface/view': {
      code: 0,
      data: {
        title: '深入理解 TypeScript 类型体操与泛型推导',
        desc: '讲解条件类型与 infer 关键字',
        duration: 100,
        owner: { name: 'TS讲师' },
        pages: [{ cid: 888 }],
      },
    },
    'https://api.bilibili.com/x/player/v2': {
      code: 0,
      data: {
        subtitle: {
          subtitles: [
            { lan: 'ai-zh', subtitle_url: '//example.com/music.json' },
            { lan: 'zh-CN', subtitle_url: '//example.com/wrong-video.json' },
            { lan: 'zh-Hans', subtitle_url: '', subtitle_url_v2: '//example.com/valid-v2.json' },
          ],
        },
      },
    },
    'https://example.com/music.json': {
      body: [{ content: '♪ ♫ [音乐]', from: 0, to: 90 }],
    },
    'https://example.com/wrong-video.json': {
      body: [
        {
          content:
            '今天教大家做一道正宗的红烧肉，首先准备五花肉五百克，冷水下锅加入葱姜料酒焯水，捞出控干水分后下冰糖炒出糖色，炖煮四十分钟即可收汁出锅。',
          from: 0,
          to: 90,
        },
      ],
    },
    'https://example.com/valid-v2.json': {
      body: [
        {
          content:
            '很多同学在写 TypeScript 泛型推导的时候经常搞不清楚 infer 关键字的边界条件，今天我们就从条件类型开始拆解。',
          from: 0,
          to: 90,
        },
      ],
    },
  });

  const info = await fetchBilibiliVideoText('BV1ALnw6YE4S', { fetchImpl });
  assert.ok(info.subtitleText.includes('TypeScript 泛型推导'));
});


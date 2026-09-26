import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanMarkdownForTTS, getAvailableVoices, getVoiceById, synthesizeSpeech } from './index.mjs';

test('cleanMarkdownForTTS strips bold asterisks and markdown symbols cleanly', () => {
  assert.equal(
    cleanMarkdownForTTS('**诺克斯**：我已经看穿了对手的意图！这一手**太绝了**！'),
    '诺克斯：我已经看穿了对手的意图！这一手太绝了！'
  );

  assert.equal(
    cleanMarkdownForTTS('哼，**本小姐**才没有输！只是*手滑*了一下！'),
    '哼，本小姐才没有输！只是手滑了一下！'
  );

  assert.equal(
    cleanMarkdownForTTS('### 标题\n> 引用内容\n- 项目一\n1. 第一步'),
    '标题\n引用内容\n项目一\n1、第一步'
  );

  assert.equal(
    cleanMarkdownForTTS('点击[链接文本](https://example.com)查看，图片![头像](https://example.com/a.png)'),
    '点击链接文本查看，图片'
  );

  assert.equal(
    cleanMarkdownForTTS('代码如下：\n```python\nprint("hello")\n```\n明白了吗？'),
    '代码如下：\n\n明白了吗？'
  );

  assert.equal(
    cleanMarkdownForTTS('<think>先思考一下</think>你好呀！'),
    '你好呀！'
  );
});

test('getAvailableVoices returns curated voices including Xiaoyi and Yunxi', () => {
  const voices = getAvailableVoices();
  assert.ok(voices.length >= 5);
  const xiaoyi = voices.find((v) => v.id === 'zh-CN-XiaoyiNeural');
  assert.ok(xiaoyi);
  assert.equal(xiaoyi.name, '晓伊');
  assert.equal(xiaoyi.isDefault, true);

  const yunxi = voices.find((v) => v.id === 'zh-CN-YunxiNeural');
  assert.ok(yunxi);
  assert.equal(yunxi.name, '云希');
});

test('getVoiceById resolves matching voice and defaults safely', () => {
  const v = getVoiceById('zh-CN-YunxiNeural');
  assert.equal(v.id, 'zh-CN-YunxiNeural');

  const fallback = getVoiceById('non-existent-voice');
  assert.ok(fallback.id);
});

test('synthesizeSpeech rejects empty text', async () => {
  await assert.rejects(
    async () => synthesizeSpeech('   '),
    /Text to synthesize cannot be empty/
  );
});

test('synthesizeSpeech generates valid MP3 audio buffer from Edge TTS', async () => {
  const audio = await synthesizeSpeech('你好，我是晓伊！', {
    voice: 'zh-CN-XiaoyiNeural',
    rate: '+5%',
    timeoutMs: 15000,
  });

  assert.ok(Buffer.isBuffer(audio));
  assert.ok(audio.length > 500, `Audio buffer length ${audio.length} should be > 500 bytes`);

  // Verify caching on identical request
  const start = Date.now();
  const cachedAudio = await synthesizeSpeech('你好，我是晓伊！', {
    voice: 'zh-CN-XiaoyiNeural',
    rate: '+5%',
  });
  const elapsed = Date.now() - start;
  assert.equal(audio.length, cachedAudio.length);
  assert.ok(elapsed < 50, `Cached synthesis should be virtually instant, took ${elapsed}ms`);
});

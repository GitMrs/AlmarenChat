import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  STAGE_LINES,
  INTERACTION_LINES,
  UNDO_LINES,
  CHARACTER_LINES,
} from '../lib/relay/gomoku-ai.ts';
import {
  cleanMarkdownForTTS,
  getCacheKey,
  getDiskCachePath,
  writeDiskCache,
  diskCacheDirectory,
} from '../lib/tts/index.mjs';

// Load .env
const envPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx !== -1) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  }
}

const apiKey = process.env.FISH_AUDIO_API_KEY || process.env.flishKey || process.env.FISH_KEY;
if (!apiKey) {
  console.error('❌ 未找到 Fish Audio API Key，请在 .env 中设置 FISH_AUDIO_API_KEY 或 flishKey');
  process.exit(1);
}

// 角色的 Fish Audio 声音模型与前端调用的映射配置
const AGENT_CONFIG = {
  'gaming-lulu': {
    name: '璐璐',
    fishVoiceId: 'a1600a7b5e544805bfc5a71b5be8fc9e',
    voice: 'zh-CN-XiaoyiNeural',
    rate: '+0%',
    pitch: '+0Hz',
    speed: 1.0,
    forceOverwrite: false,
  },
  'gaming-koko': {
    name: '可可',
    fishVoiceId: '9f04aa1c1c324905bd31fb93711df970',
    voice: 'zh-TW-HsiaoChenNeural',
    rate: '+12%',
    pitch: '+0Hz',
    speed: 1.0,
    forceOverwrite: false,
  },
  'gaming-nox': {
    name: '诺克斯',
    fishVoiceId: '69fc91aef8674ffbb08acfe14c19630e', // 用户挑选的新干练战术音色
    voice: 'zh-CN-YunxiNeural',
    rate: '+0%',
    pitch: '+0Hz',
    speed: 1.15, // 战术教练专属 1.15x 干练节奏
    forceOverwrite: true, // 覆盖旧的慢速音频
  },
};

// 提取三个角色的全部专属五子棋台词
function collectLines() {
  const items = [];

  // 1. 璐璐
  const luluStage = STAGE_LINES['gaming-lulu'] || { opening: [], endgame: [] };
  const luluInteractions = [
    ...(INTERACTION_LINES['gaming-lulu']?.['gaming-nox'] || []),
    ...(INTERACTION_LINES['gaming-lulu']?.['gaming-koko'] || []),
  ];
  const luluUndo = UNDO_LINES['gaming-lulu'] || [];
  const luluChars = Object.values(CHARACTER_LINES['gaming-lulu'] || {}).flat();
  const luluSpecial = [
    '哼，本小姐这次绝对要让你见识一下什么叫真正的高手！快下快下~',
    '这局我执黑先走，诺克斯，可别一开局就被我拿下哦！',
    '这局我执黑先走，可可，可别一开局就被我拿下哦！',
    '五子连珠！这一局是我拿下了！🎉',
  ];

  const luluAll = Array.from(new Set([
    ...luluStage.opening,
    ...luluStage.endgame,
    ...luluInteractions,
    ...luluUndo,
    ...luluChars,
    ...luluSpecial,
  ]));

  for (const text of luluAll) {
    items.push({ agentId: 'gaming-lulu', text });
  }

  // 2. 可可
  const kokoStage = STAGE_LINES['gaming-koko'] || { opening: [], endgame: [] };
  const kokoInteractions = [
    ...(INTERACTION_LINES['gaming-koko']?.['gaming-lulu'] || []),
    ...(INTERACTION_LINES['gaming-koko']?.['gaming-nox'] || []),
  ];
  const kokoUndo = UNDO_LINES['gaming-koko'] || [];
  const kokoChars = Object.values(CHARACTER_LINES['gaming-koko'] || {}).flat();
  const kokoCheers = [
    '太帅啦老板！五子连珠绝杀！必须给老板送上一百个大大的赞！芜湖起飞~！🎉✨',
    '哎呀惜败惜败！不过老板刚才中盘那波进攻超级犀利，我们再来一把肯定能翻盘！🦊💪',
    '老板冲鸭！我看对面的璐璐额头都开始冒冷汗了，这一步直接戳破她的傲娇防线！🌟',
    '报告老板！璐璐小姐的嚣张气焰已被压制，现在全作战室都在给你疯狂打call！✨',
    '哈哈，璐璐刚才还嘴硬说手滑，我看她是真被老板的操作帅到了！继续攻中路！',
    '老板稳住！诺克斯教练正在疯狂心算，但你的灵性落子完全在他算力之外！冲冲冲！🚀',
    '哇塞老板！这一手破了诺克斯的严密控盘，连战术军师都推眼镜战术后仰啦！♟️',
    '老板加油！每一步棋都走得特别有大将之风，可可永远是你最忠实的头号僚机！🦊✨',
    '芜湖！今天的开黑作战室手感火热，老板想怎么下就怎么下，可可全力应援！🎉',
  ];
  const kokoSpecial = [
    '好耶！五子棋大战启动！小狐狸可可执白，队长你先请冲冲冲！✨',
    '这局我执黑先走，璐璐，可别一开局就被我拿下哦！',
    '这局我执黑先走，诺克斯，可别一开局就被我拿下哦！',
    '五子连珠！这一局是我拿下了！🎉',
  ];

  const kokoAll = Array.from(new Set([
    ...kokoStage.opening,
    ...kokoStage.endgame,
    ...kokoInteractions,
    ...kokoUndo,
    ...kokoChars,
    ...kokoCheers,
    ...kokoSpecial,
  ]));

  for (const text of kokoAll) {
    items.push({ agentId: 'gaming-koko', text });
  }

  // 3. 诺克斯 (战术军师)
  const noxStage = STAGE_LINES['gaming-nox'] || { opening: [], endgame: [] };
  const noxInteractions = [
    ...(INTERACTION_LINES['gaming-nox']?.['gaming-lulu'] || []),
    ...(INTERACTION_LINES['gaming-nox']?.['gaming-koko'] || []),
  ];
  const noxUndo = UNDO_LINES['gaming-nox'] || [];
  const noxChars = Object.values(CHARACTER_LINES['gaming-nox'] || {}).flat();
  const noxSpecial = [
    '五子棋核心在于前 10 手的辐射控制与眼位抢占。黑方先行，请落子。',
    '这局我执黑先走，璐璐，可别一开局就被我拿下哦！',
    '这局我执黑先走，可可，可别一开局就被我拿下哦！',
    '五子连珠！这一局是我拿下了！🎉',
  ];

  const noxAll = Array.from(new Set([
    ...noxStage.opening,
    ...noxStage.endgame,
    ...noxInteractions,
    ...noxUndo,
    ...noxChars,
    ...noxSpecial,
  ]));

  for (const text of noxAll) {
    items.push({ agentId: 'gaming-nox', text });
  }

  return items;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function fetchFishAudioWithCurl(text, referenceId, speed = 1.0, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const payloadObj = {
        text,
        reference_id: referenceId,
        format: 'mp3',
      };
      if (speed && speed !== 1.0) {
        payloadObj.prosody = { speed };
      }

      const buffer = execFileSync('curl', [
        '-s',
        '-f',
        '-X', 'POST', 'https://api.fish.audio/v1/tts',
        '-H', `Authorization: Bearer ${apiKey}`,
        '-H', 'Content-Type: application/json',
        '-H', 'model: s2.1-pro-free',
        '-d', JSON.stringify(payloadObj),
      ], {
        maxBuffer: 15 * 1024 * 1024,
        timeout: 30000,
      });

      if (!buffer || buffer.length < 500) {
        throw new Error('Empty or invalid audio buffer returned from Fish Audio');
      }

      return buffer;
    } catch (err) {
      if (attempt === maxRetries) throw err;
      console.warn(`  ⚠️ 请求异常，重试第 ${attempt + 1} 次... (${err.message})`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000 * attempt);
    }
  }
}

async function main() {
  console.log('====================================================');
  console.log('🎮 五子棋 Fish Audio 全角色语音包批量生成工具');
  console.log('====================================================');
  console.log(`- 磁盘缓存目录: ${diskCacheDirectory}`);
  console.log(`- 模型配置: s2.1-pro-free (免费模型)`);
  console.log(`- 璐璐声音 ID: ${AGENT_CONFIG['gaming-lulu'].fishVoiceId}`);
  console.log(`- 可可声音 ID: ${AGENT_CONFIG['gaming-koko'].fishVoiceId}`);
  console.log(`- 诺克斯声音 ID: ${AGENT_CONFIG['gaming-nox'].fishVoiceId} (speed: ${AGENT_CONFIG['gaming-nox'].speed}x)`);

  await fs.promises.mkdir(diskCacheDirectory, { recursive: true });

  const lines = collectLines();
  console.log(`\n📋 待处理台词总数: ${lines.length} 句（璐璐 + 可可 + 诺克斯）\n`);

  let cachedCount = 0;
  let generatedCount = 0;
  let failCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const item = lines[i];
    const cfg = AGENT_CONFIG[item.agentId];
    const cleanText = cleanMarkdownForTTS(item.text);
    if (!cleanText) continue;

    const cacheKey = getCacheKey(cleanText, {
      voice: cfg.voice,
      rate: cfg.rate,
      pitch: cfg.pitch,
    });
    const diskPath = getDiskCachePath(cacheKey);

    // 检查是否已有缓存且非强制覆盖
    if (!cfg.forceOverwrite && fs.existsSync(diskPath)) {
      const stats = fs.statSync(diskPath);
      if (stats.size > 500) {
        cachedCount++;
        console.log(`[${i + 1}/${lines.length}] [已有缓存] [${cfg.name}] ${cleanText.slice(0, 24)}...`);
        continue;
      }
    }

    process.stdout.write(`[${i + 1}/${lines.length}] [生成中] [${cfg.name}] ${cleanText.slice(0, 24)}... `);

    try {
      const buffer = fetchFishAudioWithCurl(cleanText, cfg.fishVoiceId, cfg.speed);
      await writeDiskCache(cacheKey, buffer);
      generatedCount++;
      console.log(`✅ 成功 (${(buffer.length / 1024).toFixed(1)} KB)`);
    } catch (err) {
      failCount++;
      console.log(`❌ 失败: ${err.message}`);
    }

    // 适度间隔，稳定平滑调用
    await sleep(200);
  }

  console.log('\n====================================================');
  console.log('🎉 批量生成完毕！');
  console.log(`- 本次新生成: ${generatedCount} 句`);
  console.log(`- 复用已有缓存: ${cachedCount} 句`);
  console.log(`- 失败句数: ${failCount} 句`);
  const finalFiles = fs.readdirSync(diskCacheDirectory).filter(f => f.endsWith('.mp3'));
  console.log(`- 当前五子棋语音缓存总量: ${finalFiles.length} 个音频文件`);
  console.log('====================================================\n');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

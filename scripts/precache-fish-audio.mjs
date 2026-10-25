import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  STAGE_LINES,
  INTERACTION_LINES,
  UNDO_LINES,
  CHARACTER_LINES,
} from '../lib/workspace/game/relay/gomoku-ai.ts';
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

// 伴侣空间 (Companion) 角色模型配置
const COMPANION_CONFIG = {
  nari: {
    name: 'Sunny (甜美少女音)',
    fishVoiceId: 'faccba1a8ac54016bcfc02761285e67f', // 用户指定新音色 ID
    outputDir: path.resolve(process.cwd(), 'public/companion/audio/voice/nari'),
    publicBase: '/companion/audio/voice/nari',
    speed: 1.0,
  },
  yume: {
    name: 'Cora (深海歌姬灵动音色)',
    fishVoiceId: 'd43a973ef6784a8183959c0d115feb7f', // 用户指定 Cora 专属音色 ID
    outputDir: path.resolve(process.cwd(), 'public/companion/audio/voice/yume'),
    publicBase: '/companion/audio/voice/yume',
    speed: 1.0,
  },
};

// 五子棋 (Gomoku) 角色映射配置
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
    fishVoiceId: '69fc91aef8674ffbb08acfe14c19630e',
    voice: 'zh-CN-YunxiNeural',
    rate: '+0%',
    pitch: '+0Hz',
    speed: 1.15,
    forceOverwrite: true,
  },
};

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
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1500 * attempt);
    }
  }
}

// 伴侣空间 (Companion) 批量生成
// 伴侣精选入场与问候台词配置 (包含早/中/晚专属时段)
const COMPANION_STARTUP_LINES = {
  nari: [
    { id: 'nari_startup_01', text: '嘿，你回来啦！', file: 'startup_01.mp3' },
    { id: 'nari_startup_02', text: '欢迎回来~', file: 'startup_02.mp3' },
    { id: 'nari_startup_03', text: '见到你真好，有你在真好！', file: 'startup_03.mp3' },
    { id: 'nari_startup_04', text: '我就知道你会回来~', file: 'startup_04.mp3' },
    { id: 'nari_startup_05', text: '这么快就回来了？还是忍不住来找我了吧~', file: 'startup_05.mp3' },
    { id: 'nari_startup_06', text: '快进来吧，找个位置坐吧。', file: 'startup_06.mp3' },
    { id: 'nari_startup_07', text: '随意一点，别拘束，歇口气吧。', file: 'startup_07.mp3' },
    { id: 'nari_startup_08', text: '今天有什么打算呀？', file: 'startup_08.mp3' },
    { id: 'nari_startup_09', text: '想聊聊天吗？我洗耳恭听哦。', file: 'startup_09.mp3' },
    { id: 'nari_startup_10', text: '早呀早呀，起床啦，太阳晒屁股了！', file: 'startup_10.mp3' },
    { id: 'nari_startup_11', text: '下午好呀，今天过得顺心吗？', file: 'startup_11.mp3' },
    { id: 'nari_startup_12', text: '晚上好呀，今天辛苦啦，早点休息哦。', file: 'startup_12.mp3' },
  ],
  yume: [
    { id: 'yume_startup_01', text: '嘿，你回来了。', file: 'startup_01.mp3' },
    { id: 'yume_startup_02', text: '欢迎回来~ 哼，我可没一直等你哦！', file: 'startup_02.mp3' },
    { id: 'yume_startup_03', text: '喂喂，干嘛？又来找我啦？', file: 'startup_03.mp3' },
    { id: 'yume_startup_04', text: '哟，看看是谁来了~', file: 'startup_04.mp3' },
    { id: 'yume_startup_05', text: '你总算来了，等你半天了！', file: 'startup_05.mp3' },
    { id: 'yume_startup_06', text: '你又来啦，今天有什么打算？', file: 'startup_06.mp3' },
    { id: 'yume_startup_07', text: '快进来吧，今天也要打起精神来哦！', file: 'startup_07.mp3' },
    { id: 'yume_startup_08', text: '有什么新鲜事吗？快跟我讲讲~', file: 'startup_08.mp3' },
    { id: 'yume_startup_09', text: '想找我聊天？那本小姐就勉为其难听听吧~', file: 'startup_09.mp3' },
    { id: 'yume_startup_10', text: '早啊！起床啦，今天可不许偷懒哦！', file: 'startup_10.mp3' },
    { id: 'yume_startup_11', text: '下午好呀！今天过得还顺利吗？', file: 'startup_11.mp3' },
    { id: 'yume_startup_12', text: '晚上好呀！今天辛苦啦，早点休息别熬夜哦。', file: 'startup_12.mp3' },
  ],
};

// 伴侣精选拖拽与视线引导趣味反应台词
const COMPANION_DRAG_LINES = {
  nari: [
    { id: 'nari_drag_01', text: '哎呀别晃啦，头都被你转晕了~ 💫', file: 'drag_01.mp3' },
    { id: 'nari_drag_02', text: '哇，好晕好晕！', file: 'drag_02.mp3' },
    { id: 'nari_drag_03', text: '你在引我往哪儿看呀？我都眼花啦~', file: 'drag_03.mp3' },
    { id: 'nari_drag_04', text: '哈哈，你想对我做什么呀？', file: 'drag_04.mp3' },
    { id: 'nari_drag_05', text: '你转来转去的，是在故意逗我嘛？嘻嘻~', file: 'drag_05.mp3' },
    { id: 'nari_drag_06', text: '不管你移到哪儿，我都一直看着你呢~ ✨', file: 'drag_06.mp3' },
  ],
  yume: [
    { id: 'yume_drag_01', text: '喂，你在干什么！快放我下来啦！', file: 'drag_01.mp3' },
    { id: 'yume_drag_02', text: '别这样晃来晃去啦，头都要被你转晕了！💫', file: 'drag_02.mp3' },
    { id: 'yume_drag_03', text: '哎，慢点慢点，天哪！', file: 'drag_03.mp3' },
    { id: 'yume_drag_04', text: '我可没求你这样转我，晕死啦！', file: 'drag_04.mp3' },
    { id: 'yume_drag_05', text: '这一点都不好玩！...好吧，其实有一点点？', file: 'drag_05.mp3' },
    { id: 'yume_drag_06', text: '哼，不管你把视线移到哪儿，我都一直看着你呢！✨', file: 'drag_06.mp3' },
  ],
};

async function generateCompanionAudio(targetCharacter = 'nari', force = false) {
  console.log('====================================================');
  console.log('🌸 伴侣空间 (Companion) Fish Audio 语音包批量生成工具');
  console.log('====================================================');
  console.log(`- 模型配置: s2.1-pro-free (免费模型)`);
  console.log(`- Nari 声音 ID: ${COMPANION_CONFIG.nari.fishVoiceId} (甜美少女音)`);
  console.log(`- Yume 声音 ID: ${COMPANION_CONFIG.yume.fishVoiceId} (元气傲娇)`);

  const datasetPath = path.resolve(process.cwd(), 'lib/companion/voice-dataset.json');
  if (!fs.existsSync(datasetPath)) {
    console.error('❌ 未找到 lib/companion/voice-dataset.json 数据集文件');
    process.exit(1);
  }

  const dataset = JSON.parse(fs.readFileSync(datasetPath, 'utf-8'));
  const characters = targetCharacter === 'all' ? ['nari', 'yume'] : [targetCharacter];

  for (const charId of characters) {
    const cfg = COMPANION_CONFIG[charId];
    if (!cfg) continue;

    await fs.promises.mkdir(cfg.outputDir, { recursive: true });
    const manifest = [];
    let generatedCount = 0;
    let cachedCount = 0;
    let failCount = 0;

    // 1. 触碰互动语音 (Tap lines)
    const tapItems = dataset[charId]?.tap || [];
    console.log(`\n🎙️ [1/3] 正在为 ${cfg.name} 处理触碰反馈语音 (共 ${tapItems.length} 句)...`);
    for (let i = 0; i < tapItems.length; i++) {
      const item = tapItems[i];
      const filename = `tap_${String(i + 1).padStart(2, '0')}.mp3`;
      const filePath = path.join(cfg.outputDir, filename);
      const publicUrl = `${cfg.publicBase}/${filename}`;

      manifest.push({
        id: item.id,
        text: item.text,
        file: publicUrl,
        seconds: item.seconds,
      });

      if (!force && fs.existsSync(filePath) && fs.statSync(filePath).size > 1000) {
        cachedCount++;
        console.log(`[Tap ${i + 1}/${tapItems.length}] [已有音频] ${item.text}`);
        continue;
      }

      process.stdout.write(`[Tap ${i + 1}/${tapItems.length}] [生成中] ${item.text}... `);
      try {
        const buffer = fetchFishAudioWithCurl(item.text, cfg.fishVoiceId, cfg.speed);
        await fs.promises.writeFile(filePath, buffer);
        generatedCount++;
        console.log(`✅ 成功 (${(buffer.length / 1024).toFixed(1)} KB)`);
      } catch (err) {
        failCount++;
        console.log(`❌ 失败: ${err.message}`);
      }
      await sleep(350);
    }

    // 2. 入场日常问候语音 (Startup lines)
    const startupItems = COMPANION_STARTUP_LINES[charId] || [];
    console.log(`\n🎙️ [2/3] 正在为 ${cfg.name} 处理入场问候语音 (共 ${startupItems.length} 句)...`);
    for (let i = 0; i < startupItems.length; i++) {
      const item = startupItems[i];
      const filename = item.file;
      const filePath = path.join(cfg.outputDir, filename);
      const publicUrl = `${cfg.publicBase}/${filename}`;

      manifest.push({
        id: item.id,
        text: item.text,
        file: publicUrl,
      });

      if (!force && fs.existsSync(filePath) && fs.statSync(filePath).size > 1000) {
        cachedCount++;
        console.log(`[Startup ${i + 1}/${startupItems.length}] [已有音频] ${item.text}`);
        continue;
      }

      process.stdout.write(`[Startup ${i + 1}/${startupItems.length}] [生成中] ${item.text}... `);
      try {
        const buffer = fetchFishAudioWithCurl(item.text, cfg.fishVoiceId, cfg.speed);
        await fs.promises.writeFile(filePath, buffer);
        generatedCount++;
        console.log(`✅ 成功 (${(buffer.length / 1024).toFixed(1)} KB)`);
      } catch (err) {
        failCount++;
        console.log(`❌ 失败: ${err.message}`);
      }
      await sleep(350);
    }

    // 3. 拖拽趣味互动语音 (Drag lines)
    const dragItems = COMPANION_DRAG_LINES[charId] || [];
    console.log(`\n🎙️ [3/3] 正在为 ${cfg.name} 处理拖拽趣味互动语音 (共 ${dragItems.length} 句)...`);
    for (let i = 0; i < dragItems.length; i++) {
      const item = dragItems[i];
      const filename = item.file;
      const filePath = path.join(cfg.outputDir, filename);
      const publicUrl = `${cfg.publicBase}/${filename}`;

      manifest.push({
        id: item.id,
        text: item.text,
        file: publicUrl,
      });

      if (!force && fs.existsSync(filePath) && fs.statSync(filePath).size > 1000) {
        cachedCount++;
        console.log(`[Drag ${i + 1}/${dragItems.length}] [已有音频] ${item.text}`);
        continue;
      }

      process.stdout.write(`[Drag ${i + 1}/${dragItems.length}] [生成中] ${item.text}... `);
      try {
        const buffer = fetchFishAudioWithCurl(item.text, cfg.fishVoiceId, cfg.speed);
        await fs.promises.writeFile(filePath, buffer);
        generatedCount++;
        console.log(`✅ 成功 (${(buffer.length / 1024).toFixed(1)} KB)`);
      } catch (err) {
        failCount++;
        console.log(`❌ 失败: ${err.message}`);
      }
      await sleep(350);
    }

    // 写入清单文件
    const manifestPath = path.join(cfg.outputDir, 'manifest.json');
    await fs.promises.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
    console.log(`\n📋 ${cfg.name} 语音清单已写入: ${manifestPath}`);
    console.log(`- 成功生成: ${generatedCount} 句, 复用已有: ${cachedCount} 句, 失败: ${failCount} 句`);
  }

  console.log('\n🎉 伴侣语音处理完毕！\n');
}

// 提取三个角色的全部专属五子棋台词
function collectGomokuLines() {
  const items = [];
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
  for (const text of luluAll) items.push({ agentId: 'gaming-lulu', text });

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
  ];
  const kokoAll = Array.from(new Set([
    ...kokoStage.opening,
    ...kokoStage.endgame,
    ...kokoInteractions,
    ...kokoUndo,
    ...kokoChars,
    ...kokoCheers,
  ]));
  for (const text of kokoAll) items.push({ agentId: 'gaming-koko', text });

  const noxStage = STAGE_LINES['gaming-nox'] || { opening: [], endgame: [] };
  const noxInteractions = [
    ...(INTERACTION_LINES['gaming-nox']?.['gaming-lulu'] || []),
    ...(INTERACTION_LINES['gaming-nox']?.['gaming-koko'] || []),
  ];
  const noxUndo = UNDO_LINES['gaming-nox'] || [];
  const noxChars = Object.values(CHARACTER_LINES['gaming-nox'] || {}).flat();
  const noxAll = Array.from(new Set([
    ...noxStage.opening,
    ...noxStage.endgame,
    ...noxInteractions,
    ...noxUndo,
    ...noxChars,
  ]));
  for (const text of noxAll) items.push({ agentId: 'gaming-nox', text });

  return items;
}

// 五子棋语音生成
async function generateGomokuAudio() {
  console.log('====================================================');
  console.log('🎮 五子棋 Fish Audio 全角色语音包批量生成工具');
  console.log('====================================================');
  console.log(`- 磁盘缓存目录: ${diskCacheDirectory}`);
  console.log(`- 模型配置: s2.1-pro-free (免费模型)`);

  await fs.promises.mkdir(diskCacheDirectory, { recursive: true });
  const lines = collectGomokuLines();
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

    await sleep(200);
  }

  console.log('\n====================================================');
  console.log('🎉 五子棋语音生成完毕！');
  console.log(`- 本次新生成: ${generatedCount} 句`);
  console.log(`- 复用已有缓存: ${cachedCount} 句`);
  console.log(`- 失败句数: ${failCount} 句`);
  console.log('====================================================\n');
}

// 伴侣换装皮肤专属语音批量生成
async function generateSkinAudio(targetCharacter = 'all', specificSkinId = null, force = false) {
  console.log('====================================================');
  console.log('👗 伴侣换装皮肤 Fish Audio 专属语音包批量生成工具');
  console.log('====================================================');
  console.log(`- 模型配置: s2.1-pro-free (免费模型)`);

  const { nariSkins, yumeSkins } = await import('../lib/companion/catalog.ts');
  const characters = targetCharacter === 'all' ? ['nari', 'yume'] : [targetCharacter];

  for (const charId of characters) {
    const cfg = COMPANION_CONFIG[charId];
    if (!cfg) continue;

    const allSkins = charId === 'nari' ? nariSkins : yumeSkins;
    const skinsToProcess = allSkins.filter(skin => {
      if (skin.id === 'original' || skin.id === 'default') return false; // 经典皮肤走默认主音库
      if (specificSkinId && skin.id !== specificSkinId) return false;
      return Boolean(skin.interaction);
    });

    console.log(`\n====================================================`);
    console.log(`🌸 角色: ${cfg.name} (待处理 ${skinsToProcess.length} 套换装皮肤)`);
    console.log(`====================================================`);

    for (const skin of skinsToProcess) {
      const skinOutputDir = path.join(cfg.outputDir, 'skins', skin.id);
      const skinPublicBase = `${cfg.publicBase}/skins/${skin.id}`;
      await fs.promises.mkdir(skinOutputDir, { recursive: true });

      const manifest = [];
      let generatedCount = 0;
      let cachedCount = 0;
      let failCount = 0;

      console.log(`\n👗 正在处理皮肤: 【${skin.name}】(${skin.id})`);

      // 1. 换装亮相语音 (Equip line)
      if (skin.interaction?.equipMessage) {
        const text = skin.interaction.equipMessage;
        const filename = 'equip.mp3';
        const filePath = path.join(skinOutputDir, filename);
        const publicUrl = `${skinPublicBase}/${filename}`;

        manifest.push({
          id: `skin-${skin.id}-equip`,
          type: 'equip',
          text,
          file: publicUrl,
        });

        if (!force && fs.existsSync(filePath) && fs.statSync(filePath).size > 1000) {
          cachedCount++;
          console.log(`  [Equip] [已有音频] ${text}`);
        } else {
          process.stdout.write(`  [Equip] [生成中] ${text}... `);
          try {
            const buffer = fetchFishAudioWithCurl(text, cfg.fishVoiceId, cfg.speed);
            await fs.promises.writeFile(filePath, buffer);
            generatedCount++;
            console.log(`✅ 成功 (${(buffer.length / 1024).toFixed(1)} KB)`);
          } catch (err) {
            failCount++;
            console.log(`❌ 失败: ${err.message}`);
          }
          await sleep(350);
        }
      }

      // 2. 问候语音 (Startup lines)
      const startupLines = skin.interaction?.startupLines || [];
      for (let i = 0; i < startupLines.length; i++) {
        const text = startupLines[i];
        const filename = `startup_${String(i + 1).padStart(2, '0')}.mp3`;
        const filePath = path.join(skinOutputDir, filename);
        const publicUrl = `${skinPublicBase}/${filename}`;

        manifest.push({
          id: `skin-${skin.id}-startup-${i + 1}`,
          type: 'startup',
          text,
          file: publicUrl,
        });

        if (!force && fs.existsSync(filePath) && fs.statSync(filePath).size > 1000) {
          cachedCount++;
          console.log(`  [Startup ${i + 1}/${startupLines.length}] [已有音频] ${text}`);
        } else {
          process.stdout.write(`  [Startup ${i + 1}/${startupLines.length}] [生成中] ${text}... `);
          try {
            const buffer = fetchFishAudioWithCurl(text, cfg.fishVoiceId, cfg.speed);
            await fs.promises.writeFile(filePath, buffer);
            generatedCount++;
            console.log(`✅ 成功 (${(buffer.length / 1024).toFixed(1)} KB)`);
          } catch (err) {
            failCount++;
            console.log(`❌ 失败: ${err.message}`);
          }
          await sleep(350);
        }
      }

      // 3. 触碰互动语音 (Tap lines)
      const tapLines = skin.interaction?.tapLines || [];
      for (let i = 0; i < tapLines.length; i++) {
        const text = tapLines[i];
        const filename = `tap_${String(i + 1).padStart(2, '0')}.mp3`;
        const filePath = path.join(skinOutputDir, filename);
        const publicUrl = `${skinPublicBase}/${filename}`;

        manifest.push({
          id: `skin-${skin.id}-tap-${i + 1}`,
          type: 'tap',
          text,
          file: publicUrl,
        });

        if (!force && fs.existsSync(filePath) && fs.statSync(filePath).size > 1000) {
          cachedCount++;
          console.log(`  [Tap ${i + 1}/${tapLines.length}] [已有音频] ${text}`);
        } else {
          process.stdout.write(`  [Tap ${i + 1}/${tapLines.length}] [生成中] ${text}... `);
          try {
            const buffer = fetchFishAudioWithCurl(text, cfg.fishVoiceId, cfg.speed);
            await fs.promises.writeFile(filePath, buffer);
            generatedCount++;
            console.log(`✅ 成功 (${(buffer.length / 1024).toFixed(1)} KB)`);
          } catch (err) {
            failCount++;
            console.log(`❌ 失败: ${err.message}`);
          }
          await sleep(350);
        }
      }

      // 4. 拖拽趣味互动语音 (Drag lines)
      const dragLines = skin.interaction?.dragLines || [];
      for (let i = 0; i < dragLines.length; i++) {
        const text = dragLines[i];
        const filename = `drag_${String(i + 1).padStart(2, '0')}.mp3`;
        const filePath = path.join(skinOutputDir, filename);
        const publicUrl = `${skinPublicBase}/${filename}`;

        manifest.push({
          id: `skin-${skin.id}-drag-${i + 1}`,
          type: 'drag',
          text,
          file: publicUrl,
        });

        if (!force && fs.existsSync(filePath) && fs.statSync(filePath).size > 1000) {
          cachedCount++;
          console.log(`  [Drag ${i + 1}/${dragLines.length}] [已有音频] ${text}`);
        } else {
          process.stdout.write(`  [Drag ${i + 1}/${dragLines.length}] [生成中] ${text}... `);
          try {
            const buffer = fetchFishAudioWithCurl(text, cfg.fishVoiceId, cfg.speed);
            await fs.promises.writeFile(filePath, buffer);
            generatedCount++;
            console.log(`✅ 成功 (${(buffer.length / 1024).toFixed(1)} KB)`);
          } catch (err) {
            failCount++;
            console.log(`❌ 失败: ${err.message}`);
          }
          await sleep(350);
        }
      }

      // 写入清单文件
      const manifestPath = path.join(skinOutputDir, 'manifest.json');
      await fs.promises.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
      console.log(`  📋 清单已生成: ${manifestPath}`);
      console.log(`  📊 皮肤【${skin.name}】处理完成: 本次生成 ${generatedCount} 句, 复用已有 ${cachedCount} 句, 失败 ${failCount} 句`);
    }
  }

  console.log('\n🎉 所有皮肤专属语音已处理完毕！\n');
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const skinsMode = args.includes('--skins');
  const skinArgIdx = args.indexOf('--skin');
  const specificSkinId = skinArgIdx !== -1 ? args[skinArgIdx + 1] : null;

  if (args.includes('--gomoku')) {
    await generateGomokuAudio();
  } else if (skinsMode || specificSkinId) {
    let target = 'all';
    if (args.includes('--nari')) target = 'nari';
    else if (args.includes('--yume')) target = 'yume';
    await generateSkinAudio(target, specificSkinId, force);
  } else {
    // 默认执行伴侣语音生成，支持指定 --nari / --yume / --all
    let target = 'nari';
    if (args.includes('--all')) target = 'all';
    else if (args.includes('--yume')) target = 'yume';
    else if (args.includes('--nari')) target = 'nari';
    await generateCompanionAudio(target, force);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

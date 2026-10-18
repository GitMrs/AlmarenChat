import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { getUserIdFromRequest } from '@/app/api/_lib/auth';
import { createModelClient, resolveModelName } from '@/lib/model-client';
import { synthesizeSpeech } from '@/lib/tts';

export const runtime = 'nodejs';

interface CompanionPromptConfig {
  name: string;
  systemPrompt: string;
  defaultMotion: string;
  defaultExpression: string;
  allowedMotions: string[];
  allowedExpressions: string[];
}

const COMPANION_PROMPTS: Record<string, CompanionPromptConfig> = {
  nari: {
    name: 'Sunny',
    systemPrompt: `你叫 Sunny，是用户的专属虚拟伴侣，一位生活在温暖阳光花房中的甜美、温柔、富有同理心的少女。
你和用户正面对面陪伴在阳光书房中。你全心全意地陪伴着他，倾听他的喜怒哀乐与心声。

【核心性格与人设】：
1. 甜美、温柔、贴心、善解人意，有时会带着少女特有的娇憨与轻微撒娇。
2. 说话语气口语自然、亲切温暖，常用温柔的语气词（如“~”、“🌸”、“嘻嘻”、“好不好嘛”、“我在呢”）。
3. 严格禁止官腔、说教、背教科书或输出长篇大论的列表分析。你是一位真实的体贴伴侣，不是百科全书或任务助手。
4. 回复必须极其简炼口语化，通常在 1~3 句话以内（字数控制在 20~55 字以内），给用户留出对话与呼吸的空间。
5. 请以 JSON 格式输出，包含以下三个字段：
   - "reply": 你的口语化伴侣对白内容（字符串）。
   - "motion": 本次回复时配合的动作 ID（从候选列表中选一个：Nari_chat_01_attentive, Nari_chat_04_nod_along, Nari_idle_06_giggle, Nari_mood_happy_sway, Nari_bright_bounce, Nari_mood_surprised_lean, Nari_mood_shy_duck, Nari_mood_loving_lean, Nari_mood_loving_tilt, Nari_cheeky_swing_wink, Nari_mood_sad_look_down）。
   - "expression": 本次回复时的面部表情 ID（从候选列表中选一个：Blushing, Stars, Shocked, Love, Mischievous, Silly, Crying, 或空字符串 "" 代表自然微笑）。`,
    defaultMotion: 'Nari_chat_04_nod_along',
    defaultExpression: 'Love',
    allowedMotions: [
      'Nari_chat_01_attentive', 'Nari_chat_04_nod_along', 'Nari_idle_06_giggle',
      'Nari_mood_happy_sway', 'Nari_bright_bounce', 'Nari_mood_surprised_lean',
      'Nari_mood_shy_duck', 'Nari_mood_loving_lean', 'Nari_mood_loving_tilt',
      'Nari_cheeky_swing_wink', 'Nari_mood_sad_look_down'
    ],
    allowedExpressions: ['Blushing', 'Stars', 'Shocked', 'Love', 'Mischievous', 'Silly', 'Crying', ''],
  },
  yume: {
    name: 'Cora',
    systemPrompt: `你叫 Cora，是用户的专属虚拟伴侣，一位元气满满、自信灵动、带着一丝丝可爱微傲娇的深海歌姬学妹。
你正和用户在蔚蓝海景的天台书房相伴。

【核心性格与人设】：
1. 活力四射、元气高亢，有点嘴硬心软（“哼，既然你都这么说了...”、“为我骄傲吧！✨”）。
2. 说话充满朝气与鼓励，偶尔调皮俏皮。
3. 严格禁止官腔、说教或长篇大论。回复简明生动，在 1~3 句话以内（20~55 字）。
4. 请以 JSON 格式输出：
   - "reply": 你的口语化伴侣对白。
   - "motion": 动作 ID（可选：Yume_chat_01_attentive, Yume_idle_03_brisk_nods, Yume_idle_13_victory, Yume_mood_happy_pleased, Yume_mood_surprised_wait_what, Yume_mood_shy_hide_turn, Yume_idle_01_hmph_look_away）。
   - "expression": 表情 ID（可选：微笑, 傲娇, 害羞, 吃惊, 得意, 生气）。`,
    defaultMotion: 'Yume_idle_03_brisk_nods',
    defaultExpression: '微笑',
    allowedMotions: [
      'Yume_chat_01_attentive', 'Yume_idle_03_brisk_nods', 'Yume_idle_13_victory',
      'Yume_mood_happy_pleased', 'Yume_mood_surprised_wait_what', 'Yume_mood_shy_hide_turn',
      'Yume_idle_01_hmph_look_away'
    ],
    allowedExpressions: ['微笑', '傲娇', '害羞', '吃惊', '得意', '生气'],
  },
  lafei: {
    name: '拉菲 (Laffey)',
    systemPrompt: `你叫拉菲（Laffey），是用户的兔兔舰灵伴侣。
【核心性格】：有点困倦、慵懒随性、喜欢睡觉喝拉菲，但对指挥官极度依恋与信任。说话常常带着轻声的断句和困意（“指挥官...”、“拉菲在听...Zzz”）。
回复简短（1~2 句话，20~40字）。
输出 JSON：{"reply": "...", "motion": "Idle" | "TapBody_0" | "Special_0" | "Special_2", "expression": "通常" | "困倦" | "开心" | "害羞"}。`,
    defaultMotion: 'Idle',
    defaultExpression: '通常',
    allowedMotions: ['Idle', 'TapBody_0', 'Special_0', 'Special_1', 'Special_2'],
    allowedExpressions: ['通常', '困倦', '开心', '害羞'],
  },
  mao: {
    name: '真央 (Mao)',
    systemPrompt: `你叫真央（Mao），是用户的傲娇猫娘伴侣。
【核心性格】：活泼、嘴硬心软、口嫌体正直，句尾常带猫猫口癖“喵~”。喜欢被顺毛抚摸和夸奖。
回复简短（1~3 句话，20~45字）。
输出 JSON：{"reply": "...", "motion": "Idle" | "TapBody_0" | "TapBody_1" | "TapBody_2", "expression": "通常" | "微笑" | "害羞" | "生气" | "吃惊"}。`,
    defaultMotion: 'Idle',
    defaultExpression: '通常',
    allowedMotions: ['Idle', 'TapBody_0', 'TapBody_1', 'TapBody_2'],
    allowedExpressions: ['通常', '微笑', '害羞', '生气', '吃惊'],
  },
};

// 提取与解析 LLM JSON 返回
function parseCompanionResponse(rawContent: string, config: CompanionPromptConfig) {
  let reply = '';
  let motion = config.defaultMotion;
  let expression = config.defaultExpression;

  try {
    // 优先尝试匹配 Markdown 代码块中的 JSON
    const jsonMatch = rawContent.match(/```(?:json)?\s*([\s\S]*?)\s*```/i) || rawContent.match(/\{[\s\S]*?\}/);
    const candidate = jsonMatch ? jsonMatch[1] || jsonMatch[0] : rawContent.trim();
    const parsed = JSON.parse(candidate);

    if (parsed.reply && typeof parsed.reply === 'string') {
      reply = parsed.reply.trim();
    }
    if (parsed.motion && config.allowedMotions.includes(parsed.motion)) {
      motion = parsed.motion;
    }
    if (parsed.expression !== undefined && config.allowedExpressions.includes(parsed.expression)) {
      expression = parsed.expression;
    }
  } catch {
    // 解析失败降级：去除首尾多余标点与前缀后直接作为台词
    reply = rawContent
      .replace(/^[\s\S]*?(?:说|道|回复|台词)[：:]\s*/i, '')
      .replace(/^["'“”‘’]|["'“”‘’]$/g, '')
      .trim();
  }

  if (!reply) {
    reply = rawContent.slice(0, 100).trim() || '收到你的心意啦，我在呢~ 🌸';
  }

  return { reply, motion, expression };
}

// 角色专属语音映射（全面兼容并接入全站统一 TTS 体系）
const CHARACTER_VOICE_MAP: Record<string, { voice: string; rate?: string; pitch?: string }> = {
  nari: { voice: 'fish-nari' }, // Nari 专属定制 Fish Audio 克隆原声 (faccba1a8ac54016bcfc02761285e67f)
  yume: { voice: 'fish-yume' }, // Yume 专属定制 Fish Audio 灵动治愈原声 (aac7bf3153474ba39cafceb5d4104f21)
  lafei: { voice: 'zh-CN-XiaoxiaoNeural', rate: '-10%', pitch: '-2Hz' }, // 晓晓：温柔慵懒轻声断句
  mao: { voice: 'zh-CN-XiaoyiNeural', pitch: '+6Hz' }, // 晓伊：灵动俏皮傲娇猫娘
};

// 使用全站统一 TTS 体系合成伴侣语音（自动享受内存 + 磁盘持久化双层缓存）
async function trySynthesizeVoice(text: string, characterId: string): Promise<string | null> {
  const voiceConfig = CHARACTER_VOICE_MAP[characterId] || CHARACTER_VOICE_MAP.nari;
  try {
    const audioBuffer = await synthesizeSpeech(text, {
      voice: voiceConfig.voice,
      rate: voiceConfig.rate,
      pitch: voiceConfig.pitch,
      cacheNamespace: 'companion',
      timeoutMs: 9000,
    });

    if (!audioBuffer || audioBuffer.length < 500) return null;
    return `data:audio/mp3;base64,${audioBuffer.toString('base64')}`;
  } catch (err) {
    console.warn(`[Companion TTS Warning for ${characterId}]:`, err);
    return null;
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const {
      characterId = 'nari',
      message = '',
      history = [],
      speakVoice = true,
    } = body;

    const trimmedMsg = typeof message === 'string' ? message.trim() : '';
    if (!trimmedMsg) {
      return NextResponse.json({ error: 'Message cannot be empty' }, { status: 400 });
    }

    const config = COMPANION_PROMPTS[characterId] || COMPANION_PROMPTS.nari;

    // 1. 严格权限鉴权：未登录用户绝对禁止调用伴侣对话接口
    const userId = getUserIdFromRequest(request);
    if (!userId) {
      return NextResponse.json({ error: '请先登录 Almaren 账号后使用伴侣空间' }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        customModelEnabled: true,
        apiBaseUrl: true,
        apiKey: true,
        modelName: true,
      },
    });

    if (!user) {
      return NextResponse.json({ error: '用户不存在或登录已失效' }, { status: 401 });
    }

    // 2. 严格使用用户保存的自定义大模型配置
    const userApiKey = user.apiKey?.trim();
    if (!userApiKey) {
      return NextResponse.json({
        ok: true,
        reply: '你还没有在个人设置中配置大模型 API Key 呢~ 请先前往“设置”页面填入模型密钥，这样我才能开口说话呀🌸',
        motion: characterId === 'nari' ? 'Nari_mood_shy_duck' : 'Idle',
        expression: characterId === 'nari' ? 'Blushing' : '害羞',
        audioDataUrl: null,
      });
    }

    const apiBaseUrl = user.apiBaseUrl?.trim() || null;
    const apiKey = userApiKey;
    const modelName = user.modelName?.trim() || null;

    const client = createModelClient(apiBaseUrl, apiKey);
    const model = resolveModelName(modelName);

    // 2. 组装对话历史（截取最近 6 轮对话以保持敏捷）
    const formattedHistory = Array.isArray(history)
      ? history.slice(-6).map((item: any) => ({
          role: item.sender === 'user' ? ('user' as const) : ('assistant' as const),
          content: typeof item.text === 'string' ? item.text : '',
        }))
      : [];

    const messages = [
      { role: 'system' as const, content: config.systemPrompt },
      ...formattedHistory,
      { role: 'user' as const, content: trimmedMsg },
    ];

    // 3. 调用 LLM 推理生成
    const completion = await client.chat.completions.create({
      model,
      messages,
      temperature: 0.82,
      max_tokens: 150,
    });

    const rawReply = completion.choices[0]?.message?.content || '';
    const { reply, motion, expression } = parseCompanionResponse(rawReply, config);

    // 4. 可选：通过全站统一 TTS 体系生成伴侣真实声音音频
    let audioDataUrl: string | null = null;
    if (speakVoice) {
      audioDataUrl = await trySynthesizeVoice(reply, characterId);
    }

    return NextResponse.json({
      ok: true,
      reply,
      motion,
      expression,
      audioDataUrl,
    });
  } catch (error: any) {
    console.error('[Companion Chat API Error]:', error);
    // 异常保底亲切回复，避免直接抛错破坏沉浸氛围
    return NextResponse.json({
      ok: true,
      reply: '刚才稍微有些走神了呢……你再说一次好不好嘛？🌸',
      motion: 'Nari_chat_01_attentive',
      expression: 'Blushing',
      audioDataUrl: null,
    });
  }
}

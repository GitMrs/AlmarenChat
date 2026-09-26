export const CURATED_VOICES = [
  {
    id: 'zh-CN-XiaoyiNeural',
    name: '晓伊',
    gender: 'Female',
    locale: 'zh-CN',
    description: '灵动俏皮、活泼少女音，情绪张力强，二次元/游戏陪玩首选',
    tags: ['游戏陪玩', '活泼二次元', '推荐'],
    isDefault: true,
  },
  {
    id: 'zh-CN-YunxiNeural',
    name: '云希',
    gender: 'Male',
    locale: 'zh-CN',
    description: '阳光青年、富有感染力，常用于游戏解说、战术分析与日常开黑',
    tags: ['游戏解说', '阳光男声', '推荐'],
  },
  {
    id: 'zh-CN-XiaoxiaoNeural',
    name: '晓晓',
    gender: 'Female',
    locale: 'zh-CN',
    description: '温柔知性、清晰自然，适合贴身管家、生活陪伴与日常倾听',
    tags: ['贴身小伴', '温柔知性', '日常陪伴'],
  },
  {
    id: 'zh-CN-YunjianNeural',
    name: '云健',
    gender: 'Male',
    locale: 'zh-CN',
    description: '沉稳磁性、成熟专业，适合硬核战术导师与深度复盘',
    tags: ['沉稳磁性', '专业解说'],
  },
  {
    id: 'zh-CN-YunxiaNeural',
    name: '云夏',
    gender: 'Male',
    locale: 'zh-CN',
    description: '少年活力、朝气蓬勃的正太音，元气搭子',
    tags: ['少年活力', '元气搭子'],
  },
  {
    id: 'zh-CN-YunyangNeural',
    name: '云扬',
    gender: 'Male',
    locale: 'zh-CN',
    description: '专业沉稳、播音主持腔，适合严肃分析、新闻播报与商业导师',
    tags: ['专业播音', '严肃导师'],
  },
  {
    id: 'zh-CN-liaoning-XiaobeiNeural',
    name: '晓北',
    gender: 'Female',
    locale: 'zh-CN',
    description: '东北老铁、风趣幽默，性格直爽热情，聊天接梗一把手',
    tags: ['东北方言', '幽默风趣'],
  },
  {
    id: 'en-US-JennyNeural',
    name: 'Jenny',
    gender: 'Female',
    locale: 'en-US',
    description: 'Natural, clear and friendly English female voice',
    tags: ['English', 'Natural'],
  },
  {
    id: 'en-US-GuyNeural',
    name: 'Guy',
    gender: 'Male',
    locale: 'en-US',
    description: 'Calm, confident and natural English male voice',
    tags: ['English', 'Professional'],
  },
];

export const DEFAULT_VOICE_ID = 'zh-CN-XiaoyiNeural';

// Whitelist of all known voices confirmed to work with Edge TTS API
export const SUPPORTED_VOICE_IDS = new Set([
  ...CURATED_VOICES.map((v) => v.id),
  'zh-CN-shaanxi-XiaoniNeural',
  'en-US-AndrewNeural',
  'en-US-AvaNeural',
]);

// Map legacy or unsupported voices to verified replacements
const LEGACY_VOICE_FALLBACKS = {
  'zh-CN-XiaomengNeural': 'zh-CN-XiaoxiaoNeural',
};

export function getVoiceById(voiceId) {
  if (!voiceId) {
    return CURATED_VOICES[0];
  }
  const resolvedId = LEGACY_VOICE_FALLBACKS[voiceId] || voiceId;
  return CURATED_VOICES.find((v) => v.id === resolvedId) || CURATED_VOICES[0];
}

export function resolveSafeVoice(voiceId) {
  if (!voiceId) return DEFAULT_VOICE_ID;
  if (LEGACY_VOICE_FALLBACKS[voiceId]) {
    return LEGACY_VOICE_FALLBACKS[voiceId];
  }
  if (SUPPORTED_VOICE_IDS.has(voiceId)) {
    return voiceId;
  }
  return DEFAULT_VOICE_ID;
}

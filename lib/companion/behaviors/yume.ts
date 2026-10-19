import type { CompanionBehavior, QuickPromptItem } from './types';
import type { CompanionCharacter } from '../catalog';
import type { VoiceLine } from '../voice';

const quickPrompts: QuickPromptItem[] = [
  {
    emoji: '👋',
    label: '拍拍头',
    userText: '（轻轻拍了拍你的头）',
    motion: 'happy',
    fallbackReply: '哇！突然摸头，心跳都漏了一拍呢！(*>ω<*)',
  },
  {
    emoji: '✨',
    label: '夸夸我',
    userText: '今天我很努力，快夸夸我！',
    motion: 'greeting',
    fallbackReply: '太厉害啦！我就知道你最行了，为你超级骄傲！🎉',
  },
  {
    emoji: '🍵',
    label: '有点累',
    userText: '今天感觉有点累了…',
    motion: 'talk',
    fallbackReply: '给你递上一杯温温的奶茶~ 别硬撑，有我陪你放空休息！',
  },
  {
    emoji: '💭',
    label: '在想什么',
    userText: '你现在在想什么呢？',
    motion: 'talk',
    fallbackReply: '在想等会儿咱们要不要一起放首歌听听呢！',
  },
  {
    emoji: '🌙',
    label: '晚安啦',
    userText: '今天先到这里啦，晚安！',
    motion: 'greeting',
    fallbackReply: '晚安好梦~ 蓄满电量，明天一起继续冲鸭！🚀',
  },
];

const idlePool = [
  'Yume_idle_03_brisk_nods',
  'Yume_chat_03_shy_glance',
  'Yume_idle_10_smug_wink',
  'Yume_idle_11_double_take',
  'Yume_idle_13_victory',
  'Yume_mood_happy_pleased',
  'Yume_chat_02_listen_tilt',
  'Yume_chat_05_readjust',
  'Yume_cheeky_swing_wink',
  'Yume_mood_loving_soft',
] as const;

export const yumeBehavior: CompanionBehavior = {
  id: 'yume',
  name: 'Cora',
  speakerTag: '🌸 Cora',
  initialMotion: 'Yume_idle_03_brisk_nods',
  idlePool,
  tapSymbols: ['🌸', '✨', '💖', '⭐'],
  listeningMotion: 'Yume_chat_01_attentive',
  tapExpressionId: 'Shy',
  defaultSceneBg: 'ocean_room',
  quickPrompts,

  getStartupReaction: (character: CompanionCharacter) => {
    const startupMotions = ['Yume_idle_03_brisk_nods', 'Yume_chat_01_attentive', 'Yume_idle_13_victory'];
    const m = character.motions.find(candidate => startupMotions.includes(candidate.id));
    return { targetMotionId: m?.id };
  },

  getDragReaction: (character: CompanionCharacter, _line: VoiceLine) => {
    const dragMotions = ['Yume_mood_surprised_wait_what', 'Yume_idle_01_hmph_look_away'];
    const m = character.motions.find(candidate => dragMotions.includes(candidate.id));
    return { targetMotionId: m?.id, targetExpression: '' };
  },

  getSurrenderReaction: (character: CompanionCharacter, defaultExpression: string) => {
    const shyMotion = character.motions.find(m =>
      m.id.includes('shy') || m.id.includes('flustered') || m.id.includes('happy')
    );
    return {
      targetMotionId: shyMotion?.id,
      targetExpression: defaultExpression,
      line: {
        id: 'surrender',
        text: '停……停手啦！受不了啦！(>_<)',
        seconds: 2.0,
      },
    };
  },

  getRapidTapReaction: (character: CompanionCharacter, defaultExpression: string) => {
    const rapidMotion = character.motions.find(m =>
      m.id.toLowerCase().includes('surprised_jolt') ||
      m.id.toLowerCase().includes('giggle') ||
      m.id.toLowerCase().includes('shy_twist') ||
      m.id.toLowerCase().includes('bounce')
    );
    return { targetMotionId: rapidMotion?.id, targetExpression: defaultExpression };
  },

  getRandomTapReaction: (character: CompanionCharacter, defaultExpression: string) => {
    const tapMotions = character.motions.filter(m =>
      m.id.toLowerCase().includes('giggle') ||
      m.id.toLowerCase().includes('shy') ||
      m.id.toLowerCase().includes('bounce') ||
      m.id.toLowerCase().includes('wink') ||
      m.id.toLowerCase().includes('pop') ||
      m.group === '心情' ||
      m.group === '互动'
    );
    const chosen = tapMotions.length > 0 ? tapMotions[Math.floor(Math.random() * tapMotions.length)].id : undefined;
    return { targetMotionId: chosen, targetExpression: defaultExpression };
  },
};

import type { CompanionBehavior, QuickPromptItem } from './types';
import type { CompanionCharacter } from '../catalog';
import type { VoiceLine } from '../voice';

const quickPrompts: QuickPromptItem[] = [
  {
    emoji: '👋',
    label: '拍拍头',
    userText: '（轻轻拍了拍你的头）',
    motion: 'happy',
    fallbackReply: '嘻嘻，被摸头发感觉好安心呀… (*´▽`*)',
  },
  {
    emoji: '✨',
    label: '夸夸我',
    userText: '今天我很努力，快夸夸我！',
    motion: 'greeting',
    fallbackReply: '你一直都超级棒的！今天也是满分的一天，给你一朵小红花 🌸',
  },
  {
    emoji: '🍵',
    label: '有点累',
    userText: '今天感觉有点累了…',
    motion: 'talk',
    fallbackReply: '辛苦啦…快靠着放松一会儿吧，我会一直安安静静陪着你。',
  },
  {
    emoji: '💭',
    label: '在想什么',
    userText: '你现在在想什么呢？',
    motion: 'talk',
    fallbackReply: '在想…此刻有你陪在身边，时光都变得很温柔。',
  },
  {
    emoji: '🌙',
    label: '晚安啦',
    userText: '今天先到这里啦，晚安！',
    motion: 'greeting',
    fallbackReply: '好梦呀~ 闭上眼睛好好休息，明天我依然在这里等你！✨',
  },
];

const idlePool = [
  'Nari_idle_02_double_bounce',
  'Nari_idle_08_look_around',
  'Nari_idle_06_giggle',
  'Nari_idle_04_flirty_lashes',
  'Nari_idle_13_tease_peek',
  'Nari_chat_02_listen_tilt',
  'Nari_chat_03_warm_breath',
  'Nari_chat_05_readjust',
  'Nari_mood_happy_sway',
  'Nari_cheeky_swing_wink',
] as const;

export const nariBehavior: CompanionBehavior = {
  id: 'nari',
  name: 'Sunny',
  speakerTag: '🌸 Sunny',
  initialMotion: 'Nari_idle_02_double_bounce',
  idlePool,
  tapSymbols: ['🌸', '✨', '💕', '⭐'],
  listeningMotion: 'Nari_chat_01_attentive',
  tapExpressionId: 'Blushing',
  defaultSceneBg: 'cherry_room',
  quickPrompts,

  getStartupReaction: (character: CompanionCharacter) => {
    const startupMotions = ['Nari_chat_01_attentive', 'Nari_idle_02_listen_nod', 'Nari_idle_03_nod_nod'];
    const m = character.motions.find(candidate => startupMotions.includes(candidate.id));
    return { targetMotionId: m?.id };
  },

  getDragReaction: (character: CompanionCharacter, line: VoiceLine) => {
    const dragMotions = [
      'Nari_idle_08_look_around',
      'Nari_mood_surprised_lean',
      'Nari_cheeky_swing_wink',
      'Nari_mood_happy_sway',
      'Nari_bright_bounce',
    ];
    const chosen = dragMotions[Math.floor(Math.random() * dragMotions.length)];
    const m = character.motions.find(candidate => candidate.id === chosen);
    let targetExpression = 'Shocked';
    if (line.id === 'nari_drag_01' || line.id === 'nari_drag_02') {
      targetExpression = 'Silly';
    } else if (line.id === 'nari_drag_05') {
      targetExpression = 'Mischievous';
    } else if (line.id === 'nari_drag_06') {
      targetExpression = 'Love';
    }
    return { targetMotionId: m?.id, targetExpression };
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
        text: '呀~ 投降啦，真的好痒呀！(*ﾉωﾉ)',
        audioUrl: '/companion/audio/voice/nari/tap_09.mp3',
        seconds: 2.2,
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

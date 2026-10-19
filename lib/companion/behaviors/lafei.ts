import type { CompanionBehavior, QuickPromptItem } from './types';
import type { CompanionCharacter } from '../catalog';
import type { VoiceLine } from '../voice';

const quickPrompts: QuickPromptItem[] = [
  {
    emoji: '👋',
    label: '摸摸头',
    userText: '（轻轻摸了摸拉菲的长耳朵）',
    motion: 'TapHead',
    fallbackReply: '嗯……耳朵被摸了……好舒服，拉菲要睡着了……💤',
  },
  {
    emoji: '💤',
    label: '好困',
    userText: '拉菲，今天感觉好困呀……',
    motion: 'Idle',
    fallbackReply: '那就靠在拉菲身边一起睡吧……指挥官，晚安……',
  },
  {
    emoji: '🍷',
    label: '递饮料',
    userText: '（递上一瓶特调饮料）',
    motion: 'Special_2',
    fallbackReply: '谢谢指挥官……拉菲补充完能量了……(咕嘟咕嘟)',
  },
  {
    emoji: '✨',
    label: '夸奖拉菲',
    userText: '拉菲今天也很棒，辛苦啦！',
    motion: 'Special_0',
    fallbackReply: '指挥官也是……辛苦了。拉菲会一直在港区等你的。',
  },
  {
    emoji: '🌙',
    label: '晚安',
    userText: '拉菲，今晚早点睡，晚安~',
    motion: 'Idle',
    fallbackReply: '晚安……指挥官。在梦里也要继续见面哦……',
  },
];

const idlePool = [
  'Idle',
  'Special_0',
  'Special_1',
  'Special_3',
  'Special_4',
] as const;

export const lafeiBehavior: CompanionBehavior = {
  id: 'lafei',
  name: '拉菲',
  speakerTag: '🐰 拉菲',
  initialMotion: 'Idle',
  idlePool,
  tapSymbols: ['🍷', '💤', '🐰', '⭐', '✨'],
  listeningMotion: 'Special_0',
  tapExpressionId: '',
  defaultSceneBg: 'ocean_room',
  quickPrompts,

  getStartupReaction: (character: CompanionCharacter) => {
    const m = character.motions.find(candidate => candidate.id === 'Idle');
    return { targetMotionId: m?.id };
  },

  getDragReaction: (character: CompanionCharacter, _line: VoiceLine) => {
    const m = character.motions.find(candidate => candidate.id === 'TapBody_0');
    return { targetMotionId: m?.id };
  },

  getSurrenderReaction: (character: CompanionCharacter, defaultExpression: string) => {
    const motion = character.motions.find(m => m.id === 'TapBody_1');
    return {
      targetMotionId: motion?.id,
      targetExpression: defaultExpression,
      line: {
        id: 'surrender',
        text: '要...要坏掉了...指挥官...呜',
        seconds: 2.2,
      },
    };
  },

  getRapidTapReaction: (character: CompanionCharacter, defaultExpression: string) => {
    const rapidMotion = character.motions.find(m => m.id === 'TapBody_0');
    return { targetMotionId: rapidMotion?.id, targetExpression: defaultExpression };
  },

  getRandomTapReaction: (character: CompanionCharacter, defaultExpression: string) => {
    const tapPool = ['TapHead', 'TapBody_0', 'Special_2', 'Idle'];
    const chosen = tapPool[Math.floor(Math.random() * tapPool.length)];
    const motion = character.motions.find(m => m.id === chosen);
    return { targetMotionId: motion?.id, targetExpression: defaultExpression };
  },
};

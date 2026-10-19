import type { CompanionBehavior, QuickPromptItem } from './types';
import type { CompanionCharacter } from '../catalog';
import type { VoiceLine } from '../voice';

const quickPrompts: QuickPromptItem[] = [
  {
    emoji: '🐾',
    label: '摸下巴',
    userText: '（轻轻挠了挠真央的下巴）',
    motion: 'TapBody_0',
    fallbackReply: '呼噜噜噜……下巴好舒服喵……主人最懂真央了喵~(ฅ´ω`ฅ)',
  },
  {
    emoji: '🐟',
    label: '小鱼干',
    userText: '（拿出一袋顶级小鱼干递过去）',
    motion: 'TapBody_1',
    fallbackReply: '哇！是小鱼干喵！嗷呜一口吃掉，最喜欢主人了喵！✨',
  },
  {
    emoji: '😺',
    label: '蹭蹭',
    userText: '（把脸贴过来轻轻蹭了蹭）',
    motion: 'TapBody_2',
    fallbackReply: '蹭蹭~ 真央身上有主人的味道了喵，盖章认定喵！',
  },
  {
    emoji: '✨',
    label: '夸乖猫',
    userText: '真央今天真乖，奖励摸摸耳朵！',
    motion: 'TapBody_1',
    fallbackReply: '嘿嘿~ 真央一直都是世界上最乖的猫娘喵！(骄傲抬头)',
  },
  {
    emoji: '🌙',
    label: '晚安',
    userText: '真央，钻进被窝睡觉啦，晚安~',
    motion: 'Idle',
    fallbackReply: '喵呜~ 钻进主人怀里蜷成一团，呼噜噜……晚安喵……',
  },
];

const idlePool = [
  'Idle',
  'TapBody_1',
  'TapBody_2',
] as const;

export const maoBehavior: CompanionBehavior = {
  id: 'mao',
  name: '真央',
  speakerTag: '🐾 真央',
  initialMotion: 'Idle',
  idlePool,
  tapSymbols: ['🐾', '🐟', '😺', '✨', '⭐'],
  listeningMotion: 'TapBody_1',
  tapExpressionId: '害羞',
  defaultSceneBg: 'cherry_room',
  quickPrompts,

  getStartupReaction: (character: CompanionCharacter) => {
    const m = character.motions.find(candidate => candidate.id === 'Idle');
    return { targetMotionId: m?.id, targetExpression: '开心' };
  },

  getDragReaction: (character: CompanionCharacter, _line: VoiceLine) => {
    const m = character.motions.find(candidate => candidate.id === 'TapBody_1');
    return { targetMotionId: m?.id, targetExpression: '害羞' };
  },

  getSurrenderReaction: (character: CompanionCharacter, _defaultExpression: string) => {
    const motion = character.motions.find(m => m.id === 'TapBody_1');
    return {
      targetMotionId: motion?.id,
      targetExpression: '害羞',
      line: {
        id: 'surrender',
        text: '呜哇太痒了不要呀~~ (///ω///)',
        seconds: 2.4,
      },
    };
  },

  getRapidTapReaction: (character: CompanionCharacter, _defaultExpression: string) => {
    const rapidMotion = character.motions.find(m => m.id === 'TapBody_0');
    return { targetMotionId: rapidMotion?.id, targetExpression: '生气' };
  },

  getRandomTapReaction: (character: CompanionCharacter, _defaultExpression: string) => {
    const tapPool = ['TapBody_0', 'TapBody_1', 'TapBody_2', 'Idle'];
    const chosen = tapPool[Math.floor(Math.random() * tapPool.length)];
    const motion = character.motions.find(m => m.id === chosen);
    const expPool = ['开心', '害羞', '惊讶', ''];
    const targetExpression = expPool[Math.floor(Math.random() * expPool.length)];
    return { targetMotionId: motion?.id, targetExpression };
  },
};

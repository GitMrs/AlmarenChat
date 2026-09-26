import { getRandomWordPair, type WordPair } from './words.ts';
import type { Agent } from '@/types';

export type UndercoverRole = 'civilian' | 'undercover';

export interface UndercoverPlayer {
  id: string; // 'user' | 'gaming-lulu' | 'gaming-koko' | 'gaming-nox' | ...
  name: string;
  avatar: string;
  role: UndercoverRole;
  word: string;
  isAlive: boolean;
  voice: string;
  rate?: string;
  statement?: string;
  statementHistory: string[];
  votesReceived: number;
}

export type UndercoverPhase =
  | 'dealing'           // 准备发牌阶段（查看手牌）
  | 'statement'         // 轮流陈述环节
  | 'discussion'        // 自由质询与辩论
  | 'voting'            // 全员投票放逐
  | 'elimination'       // 揭晓票数与淘汰
  | 'undercover_guess'  // 卧底绝地反杀（被投出时猜测平民词）
  | 'game_over';        // 游戏结束与战报

export interface DiscussionMessage {
  id: string;
  senderId: string;
  senderName: string;
  senderAvatar: string;
  senderVoice: string;
  senderRate?: string;
  text: string;
  timestamp: number;
  type?: 'statement' | 'discussion' | 'system';
}

export interface UndercoverGameState {
  id: string;
  round: number;
  phase: UndercoverPhase;
  wordPair: WordPair;
  civilianWord: string;
  undercoverWord: string;
  players: UndercoverPlayer[];
  speakerOrder: string[]; // 存玩家 id 列表
  currentSpeakerIndex: number;
  messages: DiscussionMessage[];
  votes: Record<string, string>; // voterId -> targetPlayerId
  eliminatedPlayer: UndercoverPlayer | null;
  winner: 'civilian' | 'undercover' | null;
  winReason?: string;
  historyRounds: Array<{
    round: number;
    eliminatedId?: string;
  }>;
}

export const DEFAULT_TABLE_AGENTS = [
  { id: 'gaming-lulu', name: '璐璐', avatar: '🐱', voice: 'zh-CN-XiaoyiNeural', roleText: '傲娇陪玩搭子' },
  { id: 'gaming-koko', name: '可可', avatar: '🦊', voice: 'zh-TW-HsiaoChenNeural', rate: '+12%', roleText: '元气开黑僚机' },
  { id: 'gaming-nox', name: '诺克斯', avatar: '♟️', voice: 'zh-CN-YunxiNeural', roleText: '战术大局军师' },
];

/**
 * 提取紧凑名字（去除“· 傲娇陪玩搭子”等后缀）
 */
export const getShortName = (name: string) => {
  if (!name) return '';
  return name.split(/[·•\-_(（]/)[0].trim() || name;
};

/**
 * 初始化一局全新的“谁是卧底”对局
 */
export function createUndercoverGame(
  userCustomName = '玩家（你）',
  tableAgents: Array<{ id: string; name: string; avatar: string; voice: string; rate?: string }> = DEFAULT_TABLE_AGENTS
): UndercoverGameState {
  const wordPair = getRandomWordPair();
  const allParticipantIds = ['user', ...tableAgents.map((a) => a.id)];

  // 随机挑选 1 名卧底
  const undercoverIndex = Math.floor(Math.random() * allParticipantIds.length);
  const undercoverId = allParticipantIds[undercoverIndex];

  const players: UndercoverPlayer[] = [
    {
      id: 'user',
      name: userCustomName,
      avatar: '🧑‍💻',
      role: undercoverId === 'user' ? 'undercover' : 'civilian',
      word: undercoverId === 'user' ? wordPair.undercoverWord : wordPair.civilianWord,
      isAlive: true,
      voice: 'zh-CN-XiaoxiaoNeural',
      statementHistory: [],
      votesReceived: 0,
    },
    ...tableAgents.map((agent) => ({
      id: agent.id,
      name: getShortName(agent.name),
      avatar: agent.avatar,
      role: (undercoverId === agent.id ? 'undercover' : 'civilian') as UndercoverRole,
      word: undercoverId === agent.id ? wordPair.undercoverWord : wordPair.civilianWord,
      isAlive: true,
      voice: agent.voice,
      rate: agent.rate,
      statementHistory: [],
      votesReceived: 0,
    })),
  ];

  // 随机洗牌初始发言顺序
  const shuffledOrder = [...players.map((p) => p.id)].sort(() => Math.random() - 0.5);

  return {
    id: `undercover-${Date.now()}`,
    round: 1,
    phase: 'dealing',
    wordPair,
    civilianWord: wordPair.civilianWord,
    undercoverWord: wordPair.undercoverWord,
    players,
    speakerOrder: shuffledOrder,
    currentSpeakerIndex: 0,
    messages: [
      {
        id: `sys-${Date.now()}`,
        senderId: 'system',
        senderName: '裁判',
        senderAvatar: '⚖️',
        senderVoice: '',
        text: '【本局规则】4人暗牌对决，内含 3 名平民与 1 名卧底。请点击翻开你的秘密手牌，并在轮到你时用一句话描述它！',
        timestamp: Date.now(),
        type: 'system',
      },
    ],
    votes: {},
    eliminatedPlayer: null,
    winner: null,
    historyRounds: [],
  };
}

/**
 * 为 AI 角色生成契合性格与词汇的描述语句
 */
export function getAgentClueStatement(player: UndercoverPlayer, wordPair: WordPair, round = 1): string {
  const isUndercover = player.role === 'undercover';
  const roleKey = isUndercover ? 'undercover' : 'civilian';

  let cluePool: string[] = [];
  if (player.id === 'gaming-lulu' && wordPair.clues.lulu) {
    cluePool = wordPair.clues.lulu[roleKey];
  } else if (player.id === 'gaming-koko' && wordPair.clues.koko) {
    cluePool = wordPair.clues.koko[roleKey];
  } else if (player.id === 'gaming-nox' && wordPair.clues.nox) {
    cluePool = wordPair.clues.nox[roleKey];
  } else if (player.id === 'gaming-dm' && wordPair.clues.dm) {
    cluePool = wordPair.clues.dm[roleKey];
  }

  if (cluePool && cluePool.length > 0) {
    // 尽量根据轮次挑选不重复的线索
    const index = (round - 1) % cluePool.length;
    return cluePool[index] || cluePool[0];
  }

  // 通用风格兜底
  if (player.id === 'gaming-lulu') {
    return isUndercover
      ? '哼，反正平时到处都能见到，某些人还自以为很懂它，真幼稚！'
      : '这个东西挺常见的，本小姐平时虽然不用，但某些笨蛋肯定经常用~';
  }
  if (player.id === 'gaming-koko') {
    return isUndercover
      ? '哇塞！这个超级好玩的，看到它我就感觉心情特别好！冲冲冲！✨'
      : '每天生活里必不可少的好伙伴！快乐能量直接加满！🎉';
  }
  if (player.id === 'gaming-nox') {
    return isUndercover
      ? '基于功能与形态分析，具备特定的场景适用性与高频辨识度。'
      : '从常识逻辑推导，该事物属于日常高频接触类别，特征鲜明。';
  }

  return '这是一个大家都很熟悉的事物，日常生活中经常能碰到。';
}

/**
 * 生成各 AI 角色在辩论/指认环节的犀利互怼与推理分析
 */
export function getAgentDebateLine(
  agentPlayer: UndercoverPlayer,
  suspectPlayer: UndercoverPlayer,
  state: UndercoverGameState
): string {
  const agentId = agentPlayer.id;
  const suspectName = suspectPlayer.name;

  if (agentId === 'gaming-nox') {
    const noxLines = [
      `根据前序发言推演，${suspectName} 的表述在核心语义上存在明显偏离，算法测算嫌疑度 76%。`,
      `注意 ${suspectName} 刚才那句话的避重就轻，完全在泛化概念，大概率属于信息不对称的卧底。`,
      `逻辑推导显示，${suspectName} 的陈述缺乏专属特征支撑，我提议本轮集中票选 ${suspectName}。`,
      `两轮对比来看，${suspectName} 的用词出现前后割裂，符合卧底试图隐瞒特征的典型特征。`,
    ];
    return noxLines[Math.floor(Math.random() * noxLines.length)];
  }

  if (agentId === 'gaming-lulu') {
    const luluLines = [
      `喂！${suspectName}，你刚才说话眼神都在飘，词不达意的，本小姐看你分明就是卧底！`,
      `少在那里装无辜了！${suspectName} 描述得那么模糊，不是卧底还能是谁，敢不敢正面回答我！`,
      `哼！本小姐第六感向来奇准，${suspectName} 从第一轮开始就笑得很可疑，投他就对了！`,
      `诺克斯算来算去太磨叽了，本小姐直接指认 ${suspectName}，有破绽就别想瞒过我的眼睛！`,
    ];
    return luluLines[Math.floor(Math.random() * luluLines.length)];
  }

  if (agentId === 'gaming-koko') {
    const kokoLines = [
      `嗷呜！可可的小狐狸雷达响啦！${suspectName} 刚才发言的时候尾巴……啊不对是嘴角偷偷动了一下，超可疑！🦊✨`,
      `救命救命！大家听我说，${suspectName} 刚才说的完全跟我们的不一样，这一票可可必须投给他！`,
      `嘿嘿！被我抓住小尾巴了吧，${suspectName}，老实交代你的小秘密，不然大家要把你投出局咯！🎉`,
      `虽然大家都很可爱，但是为了平民胜利，本狐狸只能闭眼指认 ${suspectName} 啦！冲鸭！`,
    ];
    return kokoLines[Math.floor(Math.random() * kokoLines.length)];
  }

  return `我认为 ${suspectName} 的发言有疑点，建议大家把票投给他。`;
}

/**
 * 模拟 AI 的投票决策（基于启发式嫌疑评分）
 */
export function determineAgentVote(
  voter: UndercoverPlayer,
  alivePlayers: UndercoverPlayer[],
  state: UndercoverGameState
): string {
  // 不能投自己
  const candidates = alivePlayers.filter((p) => p.id !== voter.id);
  if (candidates.length === 0) return voter.id;

  // 1. 如果自己是卧底，尽量投其他人（平民），优先投最被大家怀疑的人来保全自己
  if (voter.role === 'undercover') {
    // 找出不是自己的、看起来嫌疑度最高的玩家进行栽赃
    return candidates[Math.floor(Math.random() * candidates.length)].id;
  }

  // 2. 如果自己是平民：
  // 找出真正的卧底（有 60% 概率嗅觉敏锐，40% 可能会被带偏）
  const realUndercover = candidates.find((p) => p.role === 'undercover');
  if (realUndercover && Math.random() < 0.65) {
    return realUndercover.id;
  }

  // 否则随机或者根据轮次投票给某位候选人
  return candidates[Math.floor(Math.random() * candidates.length)].id;
}

/**
 * 裁决投票结算
 */
export function tallyVotes(
  votes: Record<string, string>,
  alivePlayers: UndercoverPlayer[]
): {
  eliminatedId: string | null;
  voteCounts: Record<string, number>;
  isTie: boolean;
} {
  const counts: Record<string, number> = {};
  for (const targetId of Object.values(votes)) {
    counts[targetId] = (counts[targetId] || 0) + 1;
  }

  let maxVotes = 0;
  let candidates: string[] = [];

  for (const [targetId, count] of Object.entries(counts)) {
    if (count > maxVotes) {
      maxVotes = count;
      candidates = [targetId];
    } else if (count === maxVotes) {
      candidates.push(targetId);
    }
  }

  // 平票判断
  if (candidates.length > 1) {
    return {
      eliminatedId: null,
      voteCounts: counts,
      isTie: true,
    };
  }

  return {
    eliminatedId: candidates[0] || null,
    voteCounts: counts,
    isTie: false,
  };
}

/**
 * 检查胜负状态
 */
export function checkUndercoverGameOver(players: UndercoverPlayer[]): {
  isOver: boolean;
  winner: 'civilian' | 'undercover' | null;
  reason?: string;
} {
  const alivePlayers = players.filter((p) => p.isAlive);
  const aliveUndercovers = alivePlayers.filter((p) => p.role === 'undercover');
  const aliveCivilians = alivePlayers.filter((p) => p.role === 'civilian');

  // 1. 所有卧底都被淘汰 -> 平民胜利！
  if (aliveUndercovers.length === 0) {
    return {
      isOver: true,
      winner: 'civilian',
      reason: '🎉 卧底已全部被指认淘汰！平民阵营大获全胜！',
    };
  }

  // 2. 存活平民人数 <= 存活卧底人数 -> 卧底获胜！
  if (aliveCivilians.length <= aliveUndercovers.length) {
    return {
      isOver: true,
      winner: 'undercover',
      reason: '💀 平民伤亡惨重，卧底已成功伪装反客为主！卧底阵营获胜！',
    };
  }

  return {
    isOver: false,
    winner: null,
  };
}

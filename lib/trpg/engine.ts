/**
 * TRPG 跑团状态机与剧情运转引擎
 */

import {
  evaluateCocCheck,
  evaluateDndCheck,
  rollDice,
} from './dice.ts';
import type {
  SkillCheckResult,
  CheckLevel,
} from './dice.ts';
import {
  SCENARIOS,
} from './scenarios.ts';
import type {
  TrpgScenario,
  ScenarioNode,
  ScenarioCharacterPreset,
  NodeChoice,
} from './scenarios.ts';

export interface TrpgItemDefinition {
  name: string;
  category: 'consumable' | 'key_item' | 'equipment';
  icon: string;
  description: string;
  hpDelta?: number;
  sanDelta?: number;
}

export interface CompanionSkillsState {
  lulu: { used: boolean; activeForNextCheck: boolean };
  koko: { used: boolean };
  nox: { used: boolean; activeForNextCheck: boolean };
}

export interface TrpgHistoryItem {
  id: string;
  timestamp: number;
  nodeId: string;
  nodeTitle: string;
  narration: string;
  choiceLabel?: string;
  checkResult?: SkillCheckResult;
  outcomeText?: string;
  companionSpeech?: {
    agentId: 'gaming-lulu' | 'gaming-koko' | 'gaming-nox' | 'gaming-dm';
    agentName: string;
    agentAvatar: string;
    text: string;
  };
}

export interface TrpgGameState {
  scenarioId: string;
  scenario: TrpgScenario;
  character: ScenarioCharacterPreset;
  currentNodeId: string;
  status: 'playing' | 'rolling' | 'game_over' | 'victory';
  pendingChoice: NodeChoice | null;
  lastChoice: NodeChoice | null;
  pendingCheck: {
    rule: 'coc' | 'dnd';
    skillName: string;
    targetValue: number;
    modifier: number;
    dc?: number;
  } | null;
  lastCheckResult: SkillCheckResult | null;
  companionSkills: CompanionSkillsState;
  history: TrpgHistoryItem[];
  turnCount: number;
  rollCount: number;
  successCount: number;
  fumbleCount: number;
  criticalCount: number;
}

const AGENT_INFO: Record<string, { name: string; avatar: string }> = {
  'gaming-lulu': { name: '璐璐 · 傲娇陪玩搭子', avatar: '🐱' },
  'gaming-koko': { name: '可可 · 元气开黑僚机', avatar: '🦊' },
  'gaming-nox': { name: '诺克斯 · 战术复盘军师', avatar: '♟️' },
  'gaming-dm': { name: '守秘人 · 奇幻跑团 DM', avatar: '📜' },
};

/**
 * 道具百科与效果定义表
 */
export const ITEM_CATALOG: Record<string, TrpgItemDefinition> = {
  '战地急救绷带': {
    name: '战地急救绷带',
    category: 'consumable',
    icon: '🩹',
    description: '经过军规无菌处理的急救绷带，迅速止血包扎，恢复 5 点 HP。',
    hpDelta: 5,
  },
  '初级治疗药水': {
    name: '初级治疗药水',
    category: 'consumable',
    icon: '🧪',
    description: '在红宝石玻璃瓶中翻滚的草药灵药，迅速愈合撕裂伤，恢复 8 点 HP。',
    hpDelta: 8,
  },
  '浓缩镇静剂': {
    name: '浓缩镇静剂',
    category: 'consumable',
    icon: '💉',
    description: '阿卡姆圣玛丽精神病院配发的特效镇静药，抚平深渊恐惧，恢复 15 点 SAN。',
    sanDelta: 15,
  },
  '高纯度医疗酒精与止血绷带': {
    name: '高纯度医疗酒精与止血绷带',
    category: 'consumable',
    icon: '🍶',
    description: '烈酒消毒加纱布包扎，恢复 4 点 HP 与 3 点 SAN。',
    hpDelta: 4,
    sanDelta: 3,
  },
  '异界荧光舒缓草': {
    name: '异界荧光舒缓草',
    category: 'consumable',
    icon: '🌿',
    description: '温室采摘的奇异荧光植物，揉碎吸入可舒缓神经，恢复 6 点 HP 与 6 点 SAN。',
    hpDelta: 6,
    sanDelta: 6,
  },
  '军用斯安威斯坦试剂': {
    name: '军用斯安威斯坦试剂',
    category: 'consumable',
    icon: '⚡',
    description: '短时强化神经反射与心智防线的纳米强化液，恢复 6 点 HP 与 8 点理智。',
    hpDelta: 6,
    sanDelta: 8,
  },
  '充能军用注射剂': {
    name: '充能军用注射剂',
    category: 'consumable',
    icon: '💉',
    description: '创伤小组紧急神经修复注射针，恢复 8 点 HP 与 10 点理智。',
    hpDelta: 8,
    sanDelta: 10,
  },
  '电磁干扰手雷': {
    name: '电磁干扰手雷',
    category: 'consumable',
    icon: '💣',
    description: '高能 EMP 战术手雷，瞬间瘫痪机械武装。',
  },
  '雕花铜钥匙': {
    name: '雕花铜钥匙',
    category: 'key_item',
    icon: '🔑',
    description: '刻有黑石家族徽记的复古黄铜钥匙，能无声开启二楼书斋与暗柜。',
  },
  '旧神星印残卷': {
    name: '旧神星印残卷',
    category: 'key_item',
    icon: '📜',
    description: '记载着拉莱耶旧神封印符文阵眼的古老羊皮卷，是直面深渊眷族的制胜秘钥。',
  },
  '先祖银制五芒星圣徽': {
    name: '先祖银制五芒星圣徽',
    category: 'equipment',
    icon: '🌟',
    description: '纯银精雕的五芒星圣徽，散发温润神圣的幽蓝光芒，能庇佑理智。',
  },
  '银制旧神星之护符': {
    name: '银制旧神星之护符',
    category: 'equipment',
    icon: '🌟',
    description: '纯银精雕的旧神星印护身符，散发温润神圣的幽蓝光芒。',
  },
  '老旧镀银怀表': {
    name: '老旧镀银怀表',
    category: 'equipment',
    icon: '⏱️',
    description: '规律滴答作响的镀银怀表，凝视它可帮助调查员在迷狂中维持理性。',
  },
  '强光防风手电': {
    name: '强光防风手电',
    category: 'equipment',
    icon: '🔦',
    description: '大功率防风手电，照亮一切隐匿在暗影中的蛛丝马迹。',
  },
  '黄铜放大镜': {
    name: '黄铜放大镜',
    category: 'equipment',
    icon: '🔍',
    description: '质感厚重的黄铜手柄放大镜，侦查细节的得力助手。',
  },
  '柯尔特转轮手枪 (空包/实弹)': {
    name: '柯尔特转轮手枪 (空包/实弹)',
    category: 'equipment',
    icon: '🔫',
    description: '退役军官的可靠伙伴，提供强有力的自卫火力。',
  },
  '军用折叠匕首': {
    name: '军用折叠匕首',
    category: 'equipment',
    icon: '🗡️',
    description: '高碳钢淬火折叠匕首，锋利坚固。',
  },
  '泛黄的古羊皮纸日记': {
    name: '泛黄的古羊皮纸日记',
    category: 'key_item',
    icon: '📔',
    description: '密大民俗学者记录的古籍研读手札与古拉莱耶语注记。',
  },
  '羽毛笔与墨水': {
    name: '羽毛笔与墨水',
    category: 'equipment',
    icon: '🪶',
    description: '用于现场抄录古老星图与仪式符文的学者工具。',
  },
  '镀金圣徽战锤': {
    name: '镀金圣徽战锤',
    category: 'equipment',
    icon: '🔨',
    description: '铭刻晨曦圣徽的重装战锤，挥击时伴随破晓雷鸣。',
  },
  '矮人重钢塔盾': {
    name: '矮人重钢塔盾',
    category: 'equipment',
    icon: '🛡️',
    description: '矮人名匠锻造的重装塔盾，能硬抗巨石冲击与烈焰吐息。',
  },
  '精工复合猎弓': {
    name: '精工复合猎弓',
    category: 'equipment',
    icon: '🏹',
    description: '高张力暗影复合弓，射程远、破甲性能极佳。',
  },
  '暗影淬毒匕首': {
    name: '暗影淬毒匕首',
    category: 'equipment',
    icon: '🗡️',
    description: '涂抹了幽影盲目毒素的锐利短刃。',
  },
  '精钢撬锁套件': {
    name: '精钢撬锁套件',
    category: 'equipment',
    icon: '🧰',
    description: '游侠与盗贼必备的精密撬锁工具，可巧解各类机械暗锁。',
  },
  '星木法杖': {
    name: '星木法杖',
    category: 'equipment',
    icon: '🪄',
    description: '导流奥术能量的核心法杖，顶部镶嵌着聚能星钻。',
  },
  '法术书 (火球术/护盾术)': {
    name: '法术书 (火球术/护盾术)',
    category: 'equipment',
    icon: '📖',
    description: '记录塑能学派法术真言与手势构形的法师圣典。',
  },
  '法力水晶': {
    name: '法力水晶',
    category: 'equipment',
    icon: '🔮',
    description: '储蓄着纯净以太奥术的充能水晶。',
  },
  '矮人淬火破龙战斧': {
    name: '矮人淬火破龙战斧',
    category: 'equipment',
    icon: '🪓',
    description: '矮人符文铁匠布鲁诺以王室秘法淬火的重型战斧，对龙鳞有致命破坏力。',
  },
  '充能破龙符文石': {
    name: '充能破龙符文石',
    category: 'key_item',
    icon: '💎',
    description: '神殿魔像核心掉落的古老符文石，充盈着贯穿龙鳞的雷霆之力。',
  },
  '火焰抗性护符': {
    name: '火焰抗性护符',
    category: 'equipment',
    icon: '🛡️',
    description: '红铜火晶石护符，免疫低阶火焰灼烧并减轻龙息伤害。',
  },
  '传奇赤龙之心': {
    name: '传奇赤龙之心',
    category: 'key_item',
    icon: '👑',
    description: '红龙幼主的核心，永不熄灭的龙炎心脏，至高勇者的证明。',
  },
  '赤龙蛋与泰坦铸造卷轴': {
    name: '赤龙蛋与泰坦铸造卷轴',
    category: 'key_item',
    icon: '🥚',
    description: '从巨龙眼皮底下盗出的绝世宝藏，包含温热赤龙蛋与失传铸造卷轴。',
  },
  '军用级接入仓': {
    name: '军用级接入仓',
    category: 'equipment',
    icon: '💾',
    description: '军用科技最高规格赛博空间网络接入仓，运算缓冲极快。',
  },
  '消音动能手枪': {
    name: '消音动能手枪',
    category: 'equipment',
    icon: '🔫',
    description: '装配重型消音管与动能弹药的暗杀手枪。',
  },
  '高频热能螳螂刀': {
    name: '高频热能螳螂刀',
    category: 'equipment',
    icon: '🦾',
    description: '双臂内置高频超热能纳米刀刃，挥击可轻松切开装甲板。',
  },
  '重型喷子“屠夫”': {
    name: '重型喷子“屠夫”',
    category: 'equipment',
    icon: '💥',
    description: '近身火力暴风骤雨般的八管重型霰弹枪。',
  },
  '原型 AI【Nemesis】核心芯片': {
    name: '原型 AI【Nemesis】核心芯片',
    category: 'key_item',
    icon: '💿',
    description: '荒坂顶级军工级强人工智能原型芯片，夜之城至高财富。',
  },
};

/**
 * 道具定义检索
 */
export function getItemDefinition(name: string): TrpgItemDefinition {
  if (ITEM_CATALOG[name]) return ITEM_CATALOG[name];
  // 模糊匹配
  for (const [key, def] of Object.entries(ITEM_CATALOG)) {
    if (name.includes(key) || key.includes(name)) {
      return def;
    }
  }
  return {
    name,
    category: 'key_item',
    icon: '📦',
    description: '一件随身携带的冒险物资。',
  };
}

/**
 * 创建新跑团对局
 */
export function createTrpgGame(
  scenarioId = 'coc_blackwood_manor',
  presetId?: string,
  customName?: string
): TrpgGameState {
  const scenario = SCENARIOS.find((s) => s.id === scenarioId) || SCENARIOS[0];
  const preset =
    scenario.characterPresets.find((p) => p.id === presetId) ||
    scenario.characterPresets[0];

  const character: ScenarioCharacterPreset = {
    ...preset,
    name: customName?.trim() || preset.name,
    inventory: [...preset.inventory],
    stats: { ...preset.stats },
    skills: { ...preset.skills },
  };

  const startNode = scenario.nodes[scenario.startNodeId] || Object.values(scenario.nodes)[0];

  const initialHistory: TrpgHistoryItem[] = [
    {
      id: `hist_init_${Date.now()}`,
      timestamp: Date.now(),
      nodeId: startNode.id,
      nodeTitle: startNode.title,
      narration: startNode.narration,
    },
  ];

  return {
    scenarioId: scenario.id,
    scenario,
    character,
    currentNodeId: startNode.id,
    status: 'playing',
    pendingChoice: null,
    lastChoice: null,
    pendingCheck: null,
    lastCheckResult: null,
    companionSkills: {
      lulu: { used: false, activeForNextCheck: false },
      koko: { used: false },
      nox: { used: false, activeForNextCheck: false },
    },
    history: initialHistory,
    turnCount: 1,
    rollCount: 0,
    successCount: 0,
    fumbleCount: 0,
    criticalCount: 0,
  };
}

/**
 * 玩家选择一个行动分支
 */
export function selectChoice(
  state: TrpgGameState,
  choiceId: string
): TrpgGameState {
  const currentNode = state.scenario.nodes[state.currentNodeId];
  if (!currentNode) return state;

  const choice = currentNode.choices.find((c) => c.id === choiceId);
  if (!choice) return state;

  // 校验关键道具前置条件
  if (choice.requiredItem) {
    const hasItem = state.character.inventory.some(
      (it) => it === choice.requiredItem || it.includes(choice.requiredItem!)
    );
    if (!hasItem) return state;
  }

  // 扣减消耗的关键道具（如果有设置）
  let updatedInventory = [...state.character.inventory];
  if (choice.requiredItem && choice.consumeRequiredItem) {
    const idx = updatedInventory.findIndex(
      (it) => it === choice.requiredItem || it.includes(choice.requiredItem!)
    );
    if (idx !== -1) {
      updatedInventory.splice(idx, 1);
    }
  }

  // 1. 如果该选项有检定要求，进入 'rolling' 摇骰判定阶段
  if (choice.check) {
    let targetValue = choice.check.targetValue || 60;
    let modifier = 0;

    if (choice.check.rule === 'coc') {
      const charSkill = state.character.skills[choice.check.skillName];
      if (charSkill !== undefined) {
        targetValue = charSkill;
      } else if (choice.check.statKey && state.character.stats[choice.check.statKey]) {
        targetValue = state.character.stats[choice.check.statKey];
      }
    } else {
      const modStat = choice.check.modifierStat;
      if (modStat && state.character.stats[modStat]) {
        modifier = Math.floor((state.character.stats[modStat] - 10) / 2);
      }
      targetValue = choice.check.dc || choice.check.targetValue || 12;
    }

    return {
      ...state,
      character: {
        ...state.character,
        inventory: updatedInventory,
      },
      status: 'rolling',
      pendingChoice: choice,
      pendingCheck: {
        rule: choice.check.rule,
        skillName: choice.check.skillName,
        targetValue,
        modifier,
        dc: choice.check.dc,
      },
    };
  }

  // 2. 如果是直接过渡选项（无需检定）
  const nextNodeId = choice.directNextNodeId || state.currentNodeId;
  const nextNode = state.scenario.nodes[nextNodeId] || currentNode;

  const nextHistoryItem: TrpgHistoryItem = {
    id: `hist_${Date.now()}`,
    timestamp: Date.now(),
    nodeId: nextNode.id,
    nodeTitle: nextNode.title,
    narration: nextNode.narration,
    choiceLabel: choice.label,
    outcomeText: choice.directText,
  };

  const isEnding = Boolean(nextNode.isEnding);

  return {
    ...state,
    character: {
      ...state.character,
      inventory: updatedInventory,
    },
    currentNodeId: nextNode.id,
    status: isEnding
      ? (nextNode.endingType === 'frenzy' || nextNode.endingType === 'tragedy' ? 'game_over' : 'victory')
      : 'playing',
    pendingChoice: null,
    pendingCheck: null,
    turnCount: state.turnCount + 1,
    history: [...state.history, nextHistoryItem],
  };
}

/**
 * 执行骰子检定（结算 pendingCheck）
 */
export function executePendingCheck(
  state: TrpgGameState,
  forcedRoll?: number
): TrpgGameState {
  if (!state.pendingCheck || !state.pendingChoice) return state;

  let { rule, skillName, targetValue, modifier, dc } = state.pendingCheck;
  const choice = state.pendingChoice;

  // 诺克斯战术加持：提升 25 点 COC 基准值 或 降低 4 点 DND DC
  const noxActive = state.companionSkills.nox.activeForNextCheck;
  if (noxActive) {
    if (rule === 'coc') {
      targetValue = Math.min(99, targetValue + 25);
    } else {
      if (dc !== undefined) {
        dc = Math.max(2, dc - 4);
      } else {
        targetValue = Math.max(2, targetValue - 4);
      }
    }
  }

  let checkResult: SkillCheckResult;
  if (rule === 'coc') {
    checkResult = evaluateCocCheck(skillName, targetValue, forcedRoll);
  } else {
    checkResult = evaluateDndCheck(skillName, dc || targetValue, modifier, forcedRoll);
  }

  // 璐璐战术加持：若掷骰成功，自动提升为【🌟 致命大成功】
  const luluActive = state.companionSkills.lulu.activeForNextCheck;
  if (luluActive && checkResult.isSuccess && checkResult.level !== 'critical_success') {
    checkResult = {
      ...checkResult,
      level: 'critical_success',
      summary: `🌟 致命大成功 (璐璐傲娇鼓劲加护！)`,
      detail: `${checkResult.detail} ➔ 经璐璐暴击引导升级为大成功！`,
    };
  }

  // 统计计数
  let rollCount = state.rollCount + 1;
  let successCount = state.successCount;
  let fumbleCount = state.fumbleCount;
  let criticalCount = state.criticalCount;

  if (checkResult.level === 'critical_success') {
    criticalCount++;
    successCount++;
  } else if (checkResult.level === 'fumble') {
    fumbleCount++;
  } else if (checkResult.isSuccess) {
    successCount++;
  }

  // 计算分支与数值收益/减损
  const outcome = checkResult.isSuccess ? choice.successOutcome : choice.failureOutcome;
  let hpDelta = outcome?.hpDelta || 0;
  let sanDelta = outcome?.sanDelta || 0;
  const itemGained = outcome?.itemGained;
  const itemLost = outcome?.itemLost;
  let outcomeText = outcome?.text || (checkResult.isSuccess ? '你凭借着果断与运气达成了目标！' : '事与愿违，局势超出了你的掌控。');

  // 大成功额外增益
  if (checkResult.level === 'critical_success' && choice.criticalSuccessBonus) {
    outcomeText += `\n${choice.criticalSuccessBonus.text}`;
    if (choice.criticalSuccessBonus.hpDelta) hpDelta += choice.criticalSuccessBonus.hpDelta;
    if (choice.criticalSuccessBonus.sanDelta) sanDelta += choice.criticalSuccessBonus.sanDelta;
  }

  // 大失败惩罚
  if (checkResult.level === 'fumble' && choice.fumblePenalty) {
    outcomeText += `\n${choice.fumblePenalty.text}`;
    if (choice.fumblePenalty.hpDelta) hpDelta += choice.fumblePenalty.hpDelta;
    if (choice.fumblePenalty.sanDelta) sanDelta += choice.fumblePenalty.sanDelta;
  }

  // 更新角色属性
  const updatedHp = Math.max(0, Math.min(state.character.maxHp, state.character.hp + hpDelta));
  const updatedSan = state.character.san !== undefined
    ? Math.max(0, Math.min(state.character.maxSan || 100, state.character.san + sanDelta))
    : undefined;

  let updatedInventory = [...state.character.inventory];
  if (itemGained && !updatedInventory.includes(itemGained)) {
    updatedInventory.push(itemGained);
  }
  if (choice.criticalSuccessBonus?.itemGained && !updatedInventory.includes(choice.criticalSuccessBonus.itemGained)) {
    updatedInventory.push(choice.criticalSuccessBonus.itemGained);
  }
  if (itemLost) {
    updatedInventory = updatedInventory.filter((it) => it !== itemLost);
  }

  // 决定下一个节点
  const nextNodeId = outcome?.nextNodeId || state.currentNodeId;
  const nextNode = state.scenario.nodes[nextNodeId] || state.scenario.nodes[state.currentNodeId];

  // 队友反应
  let companionSpeechItem = undefined;
  if (outcome?.companionSpeech) {
    const info = AGENT_INFO[outcome.companionSpeech.agentId] || AGENT_INFO['gaming-koko'];
    companionSpeechItem = {
      agentId: outcome.companionSpeech.agentId,
      agentName: info.name,
      agentAvatar: info.avatar,
      text: outcome.companionSpeech.text,
    };
  }

  // 检查是否因 HP 归零或 SAN 归零而中途死亡/狂乱
  let finalStatus: 'playing' | 'game_over' | 'victory' = 'playing';
  if (updatedHp <= 0) {
    finalStatus = 'game_over';
    outcomeText += '\n【由于体力消耗殆尽，你的意识沉入永恒的黑暗中……】';
  } else if (updatedSan !== undefined && updatedSan <= 0) {
    finalStatus = 'game_over';
    outcomeText += '\n【理智彻底归零！你的心灵被不可名状的恐惧彻底撕裂，陷入无可挽回的永恒狂乱……】';
  } else if (nextNode.isEnding) {
    finalStatus = nextNode.endingType === 'frenzy' || nextNode.endingType === 'tragedy' ? 'game_over' : 'victory';
  }

  const nextHistoryItem: TrpgHistoryItem = {
    id: `hist_${Date.now()}`,
    timestamp: Date.now(),
    nodeId: nextNode.id,
    nodeTitle: nextNode.title,
    narration: nextNode.narration,
    choiceLabel: choice.label,
    checkResult,
    outcomeText,
    companionSpeech: companionSpeechItem,
  };

  return {
    ...state,
    character: {
      ...state.character,
      hp: updatedHp,
      san: updatedSan,
      inventory: updatedInventory,
    },
    companionSkills: {
      ...state.companionSkills,
      lulu: { ...state.companionSkills.lulu, activeForNextCheck: false },
      nox: { ...state.companionSkills.nox, activeForNextCheck: false },
    },
    currentNodeId: nextNode.id,
    status: finalStatus,
    pendingChoice: null,
    lastChoice: choice,
    pendingCheck: null,
    lastCheckResult: checkResult,
    history: [...state.history, nextHistoryItem],
    turnCount: state.turnCount + 1,
    rollCount,
    successCount,
    fumbleCount,
    criticalCount,
  };
}

/**
 * 触发队友战术支援技能
 */
export function triggerCompanionAssist(
  state: TrpgGameState,
  companionId: 'gaming-lulu' | 'gaming-koko' | 'gaming-nox'
): TrpgGameState {
  const skills = state.companionSkills;

  if (companionId === 'gaming-koko') {
    if (skills.koko.used) return state;

    const hpGain = 8;
    const sanGain = 10;
    const newHp = Math.min(state.character.maxHp, state.character.hp + hpGain);
    const newSan = state.character.san !== undefined
      ? Math.min(state.character.maxSan || 100, state.character.san + sanGain)
      : undefined;

    const histItem: TrpgHistoryItem = {
      id: `assist_${Date.now()}`,
      timestamp: Date.now(),
      nodeId: state.currentNodeId,
      nodeTitle: '🤝 队友战术援护 · 可可',
      narration: `【可可战术支援 · 元气救援】可可提着应急箱飞奔而至：“呼……终于赶上了！别慌，止血绷带与神经舒缓凝胶全部安排上！”你的伤口迅速愈合，战栗的心智重获安定！（HP +${hpGain}${newSan !== undefined ? `，SAN +${sanGain}` : ''}）`,
      companionSpeech: {
        agentId: 'gaming-koko',
        agentName: AGENT_INFO['gaming-koko'].name,
        agentAvatar: AGENT_INFO['gaming-koko'].avatar,
        text: '怎么样怎么样？好受多了吧！有我在，绝不会让你轻易倒下的！加把劲冲呀！🦊✨',
      },
    };

    return {
      ...state,
      character: {
        ...state.character,
        hp: newHp,
        san: newSan,
      },
      companionSkills: {
        ...skills,
        koko: { used: true },
      },
      history: [...state.history, histItem],
    };
  }

  if (companionId === 'gaming-nox') {
    if (skills.nox.used) return state;

    const histItem: TrpgHistoryItem = {
      id: `assist_${Date.now()}`,
      timestamp: Date.now(),
      nodeId: state.currentNodeId,
      nodeTitle: '🤝 队友战术援护 · 诺克斯',
      narration: `【诺克斯战术支援 · 概率推演】诺克斯推了推战术目镜，全息光屏上迅速锁定场景薄弱点：“已生成最优力学轨迹与气流窗口。下次行动判定基准值提升 25%（或 DC 降低 4 点）。”`,
      companionSpeech: {
        agentId: 'gaming-nox',
        agentName: AGENT_INFO['gaming-nox'].name,
        agentAvatar: AGENT_INFO['gaming-nox'].avatar,
        text: '战术优势窗口已为你展开。按标记节点切入，胜率已达到理论峰值。♟️',
      },
    };

    return {
      ...state,
      companionSkills: {
        ...skills,
        nox: { used: true, activeForNextCheck: true },
      },
      history: [...state.history, histItem],
    };
  }

  if (companionId === 'gaming-lulu') {
    if (skills.lulu.used) return state;

    const histItem: TrpgHistoryItem = {
      id: `assist_${Date.now()}`,
      timestamp: Date.now(),
      nodeId: state.currentNodeId,
      nodeTitle: '🤝 队友战术援护 · 璐璐',
      narration: `【璐璐战术支援 · 傲娇鼓劲】璐璐狠狠敲了敲你的护盾：“听好啦！下一次给我拿出吃奶的力气瞄准弱点砸！本小姐可不允许我的搭档在关键时刻掉链子！（下次检定成功自动触发【🌟 致命大成功】！）”`,
      companionSpeech: {
        agentId: 'gaming-lulu',
        agentName: AGENT_INFO['gaming-lulu'].name,
        agentAvatar: AGENT_INFO['gaming-lulu'].avatar,
        text: '哼！才……才不是特意帮你的呢！我只是不想看你笨手笨脚出丑而已！给我一击必杀啦！🐱💥',
      },
    };

    return {
      ...state,
      companionSkills: {
        ...skills,
        lulu: { used: true, activeForNextCheck: true },
      },
      history: [...state.history, histItem],
    };
  }

  return state;
}

/**
 * 主动使用背包道具
 */
export function useInventoryItem(
  state: TrpgGameState,
  itemName: string
): { state: TrpgGameState; success: boolean; message: string } {
  const itemIndex = state.character.inventory.findIndex(
    (it) => it === itemName || it.startsWith(itemName) || itemName.startsWith(it)
  );

  if (itemIndex === -1) {
    return {
      state,
      success: false,
      message: `背包中未找到物品【${itemName}】`,
    };
  }

  const exactItemName = state.character.inventory[itemIndex];
  const itemDef = getItemDefinition(exactItemName);

  // 如果是非消耗品（如装备或关键道具）
  if (itemDef.category !== 'consumable' && !itemDef.hpDelta && !itemDef.sanDelta) {
    const inspectHistoryItem: TrpgHistoryItem = {
      id: `inspect_${Date.now()}`,
      timestamp: Date.now(),
      nodeId: state.currentNodeId,
      nodeTitle: '🔍 检视道具',
      narration: `【物品检视】你仔细端详着随身携带的【${itemDef.icon} ${itemDef.name}】—— ${itemDef.description}`,
      companionSpeech: {
        agentId: 'gaming-nox',
        agentName: AGENT_INFO['gaming-nox'].name,
        agentAvatar: AGENT_INFO['gaming-nox'].avatar,
        text: `此道具属于【${itemDef.category === 'key_item' ? '关键剧情信物' : '常备装备'}】，在特定场景或抉择中将自动触发专属优势或跳过检定。`,
      },
    };

    return {
      state: {
        ...state,
        history: [...state.history, inspectHistoryItem],
      },
      success: true,
      message: `你检视了【${itemDef.name}】`,
    };
  }

  // 消耗品使用
  const hpDelta = itemDef.hpDelta || 0;
  const sanDelta = itemDef.sanDelta || 0;

  const newHp = Math.max(0, Math.min(state.character.maxHp, state.character.hp + hpDelta));
  const newSan = state.character.san !== undefined
    ? Math.max(0, Math.min(state.character.maxSan || 100, state.character.san + sanDelta))
    : undefined;

  // 从背包中移除或扣减
  let updatedInventory = [...state.character.inventory];
  updatedInventory.splice(itemIndex, 1);

  const healTexts: string[] = [];
  if (hpDelta > 0) healTexts.push(`生命值 +${hpDelta} (当前: ${newHp}/${state.character.maxHp})`);
  if (sanDelta > 0 && newSan !== undefined) healTexts.push(`理智值 +${sanDelta} (当前: ${newSan}/${state.character.maxSan})`);
  const effectSummary = healTexts.length > 0 ? `（${healTexts.join('，')}）` : '';

  const useHistoryItem: TrpgHistoryItem = {
    id: `item_use_${Date.now()}`,
    timestamp: Date.now(),
    nodeId: state.currentNodeId,
    nodeTitle: '🎒 道具使用',
    narration: `【使用道具】你迅速取出了【${itemDef.icon} ${itemDef.name}】并即刻使用！${itemDef.description}${effectSummary}`,
    companionSpeech: {
      agentId: 'gaming-koko',
      agentName: AGENT_INFO['gaming-koko'].name,
      agentAvatar: AGENT_INFO['gaming-koko'].avatar,
      text: hpDelta > 0 || (sanDelta > 0 && newSan !== undefined)
        ? '太棒啦！伤口和精神都得到了缓解！这波及时补给太关键了，感觉整个人又充满活力了！'
        : '道具生效了！局势尽在掌握！',
    },
  };

  const nextState: TrpgGameState = {
    ...state,
    character: {
      ...state.character,
      hp: newHp,
      san: newSan,
      inventory: updatedInventory,
    },
    history: [...state.history, useHistoryItem],
  };

  return {
    state: nextState,
    success: true,
    message: `成功使用【${itemDef.name}】${effectSummary}`,
  };
}

/**
 * 消耗 1 点命运点 (LUCK) 逆天改命重掷！
 */
export function rerollWithFatePoint(state: TrpgGameState): TrpgGameState {
  if (state.character.luck <= 0) return state;
  if (!state.lastCheckResult || !state.lastChoice) return state;

  const updatedLuck = state.character.luck - 1;

  // 构造重掷消息
  const luckHistoryItem: TrpgHistoryItem = {
    id: `luck_${Date.now()}`,
    timestamp: Date.now(),
    nodeId: state.currentNodeId,
    nodeTitle: '命运逆转 · 幸运点消耗',
    narration: `【消耗 1 点命运点】宿命之线在刹那间产生涟漪！你屏气凝神，命运女神赋予了你重新掷骰的机会！（剩余命运点：${updatedLuck}）`,
    companionSpeech: {
      agentId: 'gaming-koko',
      agentName: AGENT_INFO['gaming-koko'].name,
      agentAvatar: AGENT_INFO['gaming-koko'].avatar,
      text: '逆转乾坤！！我相信这次命运之骰一定会站在我们这边！冲冲冲！！',
    },
  };

  // 恢复到 rolling 状态，用刚才的技能重新掷
  return {
    ...state,
    character: {
      ...state.character,
      luck: updatedLuck,
    },
    status: 'rolling',
    pendingChoice: state.lastChoice,
    pendingCheck: {
      rule: state.lastCheckResult.rule,
      skillName: state.lastCheckResult.skillName,
      targetValue: state.lastCheckResult.targetValue,
      modifier: state.lastCheckResult.modifier,
    },
    history: [...state.history.slice(0, -1), luckHistoryItem],
  };
}

/**
 * 执行自由行动 (Free Action)
 */
export function performFreeAction(
  state: TrpgGameState,
  actionText: string
): TrpgGameState {
  if (!actionText.trim()) return state;
  const trimmed = actionText.trim();

  // 根据文本中的关键词匹配检定倾向
  let skillName = '机智应变';
  let rule = state.scenario.system;
  let targetValue = 60;
  let dc = 13;

  if (/看|搜|找|查|观察|寻找|摸索/i.test(trimmed)) {
    skillName = '侦查';
    targetValue = state.character.skills['侦查'] || 65;
    dc = 12;
  } else if (/砸|撞|推|砍|打|踢|劈|力量|拆/i.test(trimmed)) {
    skillName = '力量';
    targetValue = state.character.stats['str'] || 60;
    dc = 14;
  } else if (/跑|闪|跳|溜|爬|敏捷|躲/i.test(trimmed)) {
    skillName = '敏捷闪避';
    targetValue = state.character.stats['dex'] || 65;
    dc = 13;
  } else if (/咒|经|神|法|冥想|意志|心/i.test(trimmed)) {
    skillName = '意志/神秘学';
    targetValue = state.character.stats['pow'] || 70;
    dc = 14;
  }

  // 构造一个虚拟的 custom choice
  const customChoice: NodeChoice = {
    id: `custom_${Date.now()}`,
    label: `【自由行动】${trimmed.slice(0, 24)}...`,
    description: trimmed,
    check: {
      rule,
      skillName,
      targetValue,
      dc,
    },
    successOutcome: {
      levelGroup: 'success',
      text: `守秘人判定通过：你的自由行动【${trimmed}】收到了奇效！你灵巧地借势破局，稳住了当前场面。`,
      nextNodeId: state.currentNodeId,
      companionSpeech: {
        agentId: 'gaming-nox',
        text: '出人意料的战术思路，有效规避了常规盲区。',
      },
    },
    failureOutcome: {
      levelGroup: 'failure',
      text: `守秘人判定失败：你的意图【${trimmed}】受到了环境阻碍，并未达到预期效果，险些失去平衡！`,
      nextNodeId: state.currentNodeId,
      hpDelta: -2,
      companionSpeech: {
        agentId: 'gaming-lulu',
        text: '喂！你这脑回路到底怎么想的啦！别瞎折腾吓唬人好不好！',
      },
    },
  };

  return {
    ...state,
    status: 'rolling',
    pendingChoice: customChoice,
    pendingCheck: {
      rule,
      skillName,
      targetValue,
      modifier: 0,
      dc,
    },
  };
}

/**
 * 生成 Markdown 格式的跑团战报（用于一键分享到空间群聊）
 */
export function generateTrpgBattleReport(state: TrpgGameState): string {
  const char = state.character;
  const isWon = state.status === 'victory';
  const currentNode = state.scenario.nodes[state.currentNodeId];

  let statusBadge = isWon ? '🏆【大获全胜 · 传奇凯旋】' : '💀【宿命陨落 · 饮恨深渊】';
  if (currentNode?.endingTitle) {
    statusBadge = currentNode.endingTitle;
  }

  const inventoryList = char.inventory.length > 0 ? char.inventory.join('、') : '无';

  const report = [
    `### 🎲 沉浸跑团战报 ·《${state.scenario.title}》`,
    `> **${state.scenario.tagline}**`,
    '',
    `**冒险者**：${char.name}（${char.className} ${char.avatar}）`,
    `**规则体系**：${state.scenario.systemName} ｜ **难度**：${state.scenario.difficulty}`,
    `**结局评定**：${statusBadge}`,
    '',
    '#### 📊 最终状态与结算指标',
    `- ❤️ **终局生命值 (HP)**: ${char.hp} / ${char.maxHp}`,
    char.san !== undefined ? `- 🧠 **终局理智值 (SAN)**: ${char.san} / ${char.maxSan}` : '',
    `- 🎒 **探索获得道具**: ${inventoryList}`,
    `- 🎲 **命运掷骰总计**: ${state.rollCount} 次 (🌟大成功: ${state.criticalCount} | ✅成功: ${state.successCount} | 💀大失败: ${state.fumbleCount})`,
    `- ⏱️ **历经场景幕数**: ${state.turnCount} 幕`,
    '',
    '#### 📜 守秘人史诗终局批语',
    `> ${currentNode?.narration.replace(/\n/g, '\n> ') || '命运的齿轮在夜幕中停止了转动，旅行者的传奇将长存于群星之下。'}`,
    '',
    '*(来自空间开黑工坊「沉浸跑团 · 命运骰子」)*',
  ]
    .filter(Boolean)
    .join('\n');

  return report;
}

export const STORAGE_KEY_TRPG_SAVE = 'almaren_trpg_active_save';

function getStorage(): Storage | null {
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage;
  }
  if (typeof globalThis !== 'undefined' && (globalThis as unknown as { localStorage?: Storage }).localStorage) {
    return (globalThis as unknown as { localStorage: Storage }).localStorage;
  }
  return null;
}

/**
 * 将当前进行中的对局持久化至本地存储
 */
export function saveTrpgGame(state: TrpgGameState): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    if (state.status === 'victory' || state.status === 'game_over') {
      clearSavedTrpgGame();
      return;
    }
    storage.setItem(STORAGE_KEY_TRPG_SAVE, JSON.stringify(state));
  } catch (err) {
    console.error('Failed to save TRPG game state:', err);
  }
}

/**
 * 从本地存储加载进行中的冒险存档
 */
export function loadSavedTrpgGame(): TrpgGameState | null {
  const storage = getStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(STORAGE_KEY_TRPG_SAVE);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TrpgGameState;

    // 基础完整性校验
    if (!parsed.scenarioId || !parsed.currentNodeId || !parsed.character) {
      return null;
    }

    // 重新连接最新 scenario 实例，确保节点与选项引用一致
    const latestScenario = SCENARIOS.find((s) => s.id === parsed.scenarioId) || SCENARIOS[0];
    parsed.scenario = latestScenario;

    // 校验当前节点是否存在
    if (!latestScenario.nodes[parsed.currentNodeId]) {
      parsed.currentNodeId = latestScenario.startNodeId;
    }

    return parsed;
  } catch (err) {
    console.error('Failed to load TRPG game state:', err);
    return null;
  }
}

/**
 * 清除已保存的冒险进度
 */
export function clearSavedTrpgGame(): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.removeItem(STORAGE_KEY_TRPG_SAVE);
  } catch (err) {
    console.error('Failed to clear TRPG game state:', err);
  }
}

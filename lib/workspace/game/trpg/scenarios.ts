/**
 * TRPG 沉浸剧本库与世界观节点定义
 * 包含：
 * 1. 《迷雾庄园怪谈》（克苏鲁 COC 7th 体系 · 深度分支与多重终局）
 * 2. 《遗忘矿坑的龙吼》（龙与地下城 D&D 5e 体系 · 矮人铁匠营救与屠龙/神偷/契约）
 * 3. 《赛博雨夜 · 荒坂密档》（赛博朋克 2077 体系）
 */

import type { CheckLevel } from './dice.ts';

export interface ScenarioCharacterPreset {
  id: string;
  name: string;
  className: string;
  avatar: string;
  description: string;
  hp: number;
  maxHp: number;
  san?: number;
  maxSan?: number;
  luck: number; // 命运点（可用于失败时逆天改命重掷）
  stats: Record<string, number>; // 属性值，如 str, dex, int, pow 等
  skills: Record<string, number>; // 技能值，如 '侦查': 75, '神秘学': 65
  inventory: string[];
}

export interface NodeChoiceCheck {
  rule: 'coc' | 'dnd';
  skillName: string;
  statKey?: string; // 如 'int', 'dex', 'str'
  targetValue?: number; // COC技能基准 或 DND DC
  dc?: number; // DND 目标难度
  modifierStat?: string; // DND 加值对应的属性
}

export interface NodeOutcome {
  levelGroup: 'success' | 'failure'; // 'success' 包含 critical/extreme/hard/regular; 'failure' 包含 failure/fumble
  text: string;
  hpDelta?: number;
  sanDelta?: number;
  itemGained?: string;
  itemLost?: string;
  nextNodeId: string;
  effects?: StoryEffects;
  companionSpeech?: {
    agentId: 'gaming-lulu' | 'gaming-koko' | 'gaming-nox';
    text: string;
  };
}

export interface NodeChoice {
  id: string;
  label: string;
  description: string;
  /** 自由行动在检定完成后使用的临时 DM 裁决文本。 */
  narration?: string;
  suggestions?: string[];
  icon?: string;
  tag?: string; // 标识偏向，如【侦查 1d100】、【力量 1d20】
  check?: NodeChoiceCheck;
  requiredItem?: string; // 需要拥有的关键道具 (支持模糊匹配，如 '雕花铜钥匙')
  consumeRequiredItem?: boolean; // 选择后是否消耗该道具
  requires?: StoryRequirements;
  effects?: StoryEffects;
  // 直接跳转（若无检定）
  directNextNodeId?: string;
  directText?: string;
  // 检定结果跳转分支
  successOutcome?: NodeOutcome;
  failureOutcome?: NodeOutcome;
  criticalSuccessBonus?: {
    text: string;
    itemGained?: string;
    hpDelta?: number;
    sanDelta?: number;
    companionSpeech?: {
      agentId: 'gaming-lulu' | 'gaming-koko' | 'gaming-nox';
      text: string;
    };
  };
  fumblePenalty?: {
    text: string;
    hpDelta?: number;
    sanDelta?: number;
    itemLost?: string;
    companionSpeech?: {
      agentId: 'gaming-lulu' | 'gaming-koko' | 'gaming-nox';
      text: string;
    };
  };
}

export interface StoryRequirements {
  flags?: string[];
  notFlags?: string[];
  evidence?: string[];
  minClockMinutes?: number;
  characterIds?: string[];
}

export interface StoryEffects {
  setFlags?: string[];
  clearFlags?: string[];
  addEvidence?: string[];
  removeEvidence?: string[];
  timeMinutes?: number;
  chapter?: number;
  npcs?: Record<string, { alive?: boolean; trustDelta?: number }>;
}

export interface ScenarioNode {
  id: string;
  title: string;
  location: string;
  environmentAtmosphere: string; // 氛围提示，如 "🌧️ 暴雨倾盆 · 雷电交加"
  bgGradient: string; // 沉浸式场景配色渐变
  narration: string; // 守秘人主持人的主描述文本
  dmAudioSnippet?: string; // 适合朗读的段落
  choices: NodeChoice[];
  isEnding?: boolean;
  endingType?: 'triumph' | 'frenzy' | 'tragedy' | 'escape' | 'secret' | 'martyr';
  endingTitle?: string;
}

export interface TrpgScenario {
  id: string;
  title: string;
  system: 'coc' | 'dnd';
  systemName: string;
  genre: string;
  difficulty: '入门' | '进阶' | '硬核炼狱';
  coverIcon: string;
  tagline: string;
  description: string;
  themeColor: string;
  characterPresets: ScenarioCharacterPreset[];
  startNodeId: string;
  nodes: Record<string, ScenarioNode>;
}

export const SCENARIOS: TrpgScenario[] = [
  // -------------------------------------------------------------------------
  // 1. 克苏鲁神话：迷雾庄园怪谈（深度分支扩容 + 多重终局真相）
  // -------------------------------------------------------------------------
  {
    id: 'coc_blackwood_manor',
    title: '迷雾庄园怪谈',
    system: 'coc',
    systemName: 'COC 7th 调查团',
    genre: '克苏鲁神话 · 悬疑调查',
    difficulty: '进阶',
    coverIcon: '🐙',
    tagline: '“黑石庄园的壁炉已冷，当低语在耳边汇聚成潮，理智便如薄冰般碎裂……”',
    description: '阿卡姆近郊的布莱克伍德古宅在暴风雨中矗立。学者艾伯纳研究星空异象离奇失踪，作为受邀而来的调查员，你需要在午夜前探明庄园异变的真相。',
    themeColor: 'from-emerald-950 via-slate-900 to-teal-950',
    characterPresets: [
      {
        id: 'investigator-allen',
        name: '艾伦 · 怀尔德',
        className: '私家侦探',
        avatar: '🕵️‍♂️',
        description: '敏锐的观察力与老练的直觉，擅长从微小痕迹中还原真相。',
        hp: 12,
        maxHp: 12,
        san: 75,
        maxSan: 85,
        luck: 3,
        stats: { str: 55, dex: 60, int: 75, con: 60, pow: 75 },
        skills: { 侦查: 75, 聆听: 65, 心理学: 60, 格斗: 50, 敏捷闪避: 60 },
        inventory: ['老旧镀银怀表', '强光防风手电', '浓缩镇静剂', '黄铜放大镜'],
      },
      {
        id: 'investigator-sara',
        name: '塞拉 · 莫斯',
        className: '密大民俗学者',
        avatar: '📜',
        description: '精通古阿卡姆文献与拉莱耶残卷，意志坚定，深谙古老秘仪。',
        hp: 10,
        maxHp: 10,
        san: 85,
        maxSan: 90,
        luck: 3,
        stats: { str: 40, dex: 50, int: 85, con: 50, pow: 85 },
        skills: { 神秘学: 80, 侦查: 65, 历史古籍: 75, 精神分析: 70, 聆听: 50 },
        inventory: ['泛黄的古羊皮纸日记', '银制旧神星之护符', '浓缩镇静剂', '羽毛笔与墨水'],
      },
      {
        id: 'investigator-reyno',
        name: '雷诺 · 柯林斯',
        className: '退役军官',
        avatar: '🛡️',
        description: '身经百战，体魄强健，面对异象具有极高的胆魄与应变能力。',
        hp: 16,
        maxHp: 16,
        san: 65,
        maxSan: 75,
        luck: 3,
        stats: { str: 75, dex: 65, int: 60, con: 75, pow: 65 },
        skills: { 格斗: 75, 射击: 65, 力量破拆: 70, 敏捷闪避: 65, 聆听: 55 },
        inventory: ['柯尔特转轮手枪 (空包/实弹)', '军用折叠匕首', '战地急救绷带', '战地急救绷带'],
      },
    ],
    startNodeId: 'node_foyer',
    nodes: {
      // 第一幕：门厅玄关
      node_foyer: {
        id: 'node_foyer',
        title: '第一幕：暴雨狂澜与血迹门厅',
        location: '布莱克伍德庄园 · 门厅玄关',
        environmentAtmosphere: '🌧️ 窗外电闪雷鸣 · 潮湿刺鼻的腥水味',
        bgGradient: 'from-slate-950 via-slate-900 to-indigo-950',
        narration:
          '你推开沉重的雕花橡木大门。外面的狂风暴雨被隔绝在身后，庄园内部死寂得令人窒息。玄关地面上铺着潮湿的波斯地毯，但奇怪的是，泥泞中混杂着发黑的粘稠血迹，一路蜿蜒指向二楼的书斋与楼梯深处。座钟停摆在 11 点 47 分，指针正微微颤抖，仿佛在抗拒着某种无形的磁场。',
        choices: [
          {
            id: 'c1_investigate_carpet',
            label: '仔细勘验地面血迹与泥泞印记',
            description: '通过敏锐的侦查眼光，推断受害者的离去方向与挣扎痕迹。',
            tag: '【侦查 1d100】',
            check: { rule: 'coc', skillName: '侦查', targetValue: 70 },
            successOutcome: {
              levelGroup: 'success',
              text: '你蹲下身，用手电照亮泥迹。这不是普通的人类脚印，脚尖处有着类似蹼足的蹼痕！你在墙根踢脚线处发现了一枚被慌乱遗落的【雕花铜钥匙】，可无声开启二楼书斋与机关！',
              itemGained: '雕花铜钥匙',
              nextNodeId: 'node_study',
              effects: { setFlags: ['found_copper_key', 'saw_nonhuman_tracks'], addEvidence: ['蹼足脚印'], timeMinutes: 25, chapter: 2 },
              companionSpeech: {
                agentId: 'gaming-nox',
                text: '注意看脚印间距，逃跑者当时步频极乱，而且蹼痕拖拽说明目标具有两栖或深潜异化特征。这把钥匙是关键道具。',
              },
            },
            failureOutcome: {
              levelGroup: 'failure',
              text: '地毯上刺鼻的水腥味突然剧烈翻涌，你揉了揉刺痛的眼睛，只感到头晕目眩，甚至不慎踩翻了旁边的青铜烛台，发出巨大的回声！',
              sanDelta: -2,
              nextNodeId: 'node_study',
              effects: { setFlags: ['heard_manor_warning'], addEvidence: ['异常水腥味'], timeMinutes: 25, chapter: 2 },
              companionSpeech: {
                agentId: 'gaming-lulu',
                text: '笨蛋！走路能不能看路啊！这声响绝对把楼上的怪东西全吵醒了！快握紧手电啦！',
              },
            },
            criticalSuccessBonus: {
              text: '大成功！你不仅精准推断出足迹，还在翻开的地毯夹层内找到了一瓶未开封的【浓缩镇静剂】！',
              itemGained: '浓缩镇静剂',
            },
            fumblePenalty: {
              text: '大失败！泥泞里潜伏着带腐蚀性的黑泥寄生虫，剧痛刺入你的指尖，手电险些脱手摔碎！',
              hpDelta: -3,
              sanDelta: -5,
            },
          },
          {
            id: 'c2_listen_shadows',
            label: '循着低语与幽光，前往西侧【幽暗宴会大厅】',
            description: '捕捉古宅西翼隐秘的刀叉声与诡异咀嚼回响。',
            tag: '【聆听 1d100】',
            check: { rule: 'coc', skillName: '聆听', targetValue: 60 },
            successOutcome: {
              levelGroup: 'success',
              text: '在雷鸣的间隙，你捕捉到了西侧宴会厅传来的低沉祷告与银制餐刀碰撞声。你轻巧地压低脚步，避开了地上的碎玻璃，潜入了宴会大厅！',
              sanDelta: 1,
              nextNodeId: 'node_dining',
              effects: { setFlags: ['heard_west_wing_ritual'], addEvidence: ['宴会厅祷告声'], timeMinutes: 15, chapter: 2 },
              companionSpeech: {
                agentId: 'gaming-koko',
                text: '哇！你耳朵太灵了吧！提前探明西侧有动静，太有侦探范儿了！我们悄悄摸进去！',
              },
            },
            failureOutcome: {
              levelGroup: 'failure',
              text: '你将耳朵贴近门缝，突然一阵尖锐至极的深海尖啸刺穿耳膜！你的脑海里浮现出溺亡在万丈冰渊的幻觉，跌跌撞撞撞进了宴会厅。',
              sanDelta: -4,
              nextNodeId: 'node_dining',
              effects: { setFlags: ['heard_west_wing_ritual'], timeMinutes: 15, chapter: 2 },
              companionSpeech: {
                agentId: 'gaming-lulu',
                text: '喂！你脸色怎么突然变得跟石灰一样惨白？！别吓我啊，快深呼吸！',
              },
            },
          },
          {
            id: 'c3_explore_gallery',
            label: '循着潮湿咸风，探索东侧【阴暗温室画廊】',
            description: '东翼玻璃穹顶下隐隐散发着奇异的蓝绿色荧光。',
            tag: '【潜行闪避 1d100】',
            check: { rule: 'coc', skillName: '敏捷闪避', targetValue: 60 },
            successOutcome: {
              levelGroup: 'success',
              text: '你如同一只灵巧的黑猫无声滑过东侧走廊，推开了通往温室画廊的水晶玻璃门。奇异的荧光菌菇在夜色中如星海起伏。',
              nextNodeId: 'node_gallery',
              effects: { setFlags: ['entered_greenhouse'], addEvidence: ['异界菌菇'], timeMinutes: 20, chapter: 2 },
              companionSpeech: {
                agentId: 'gaming-nox',
                text: '完美的潜行轨迹。东侧温室气流充沛，有很大几率藏有古生物样本或药剂原料。',
              },
            },
            failureOutcome: {
              levelGroup: 'failure',
              text: '你在回廊转角踩到了湿滑的苔藓，摔了个结结实实，手肘擦破流血，狼狈地滚入了温室门内。',
              hpDelta: -2,
              nextNodeId: 'node_gallery',
              effects: { setFlags: ['entered_greenhouse'], timeMinutes: 20, chapter: 2 },
            },
          },
          {
            id: 'c4_rush_upstairs',
            label: '毫不迟疑，持械快步直奔二楼藏书斋',
            description: '时间紧迫，直接抢占主动权，冲入异变核心。',
            directNextNodeId: 'node_study',
            directText: '你紧握手电与防身武器，踩着咯吱作响的木质楼梯，以最快速度冲上了二楼走廊。',
            effects: { setFlags: ['rushed_upstairs'], timeMinutes: 10, chapter: 2 },
          },
        ],
      },

      // 第二幕A：幽暗烛光宴会大厅 (新增支线房间)
      node_dining: {
        id: 'node_dining',
        title: '第二幕·西翼：幽暗烛光宴会大厅',
        location: '布莱克伍德古宅西翼 · 幽暗长桌大厅',
        environmentAtmosphere: '🕯️ 银质餐烛摇曳 · 腐败长桌上冒着热气的深海祭品',
        bgGradient: 'from-amber-950 via-slate-900 to-stone-950',
        narration:
          '推开雕花双扇门，宴会厅中弥漫着刺鼻的深海盐卤与血腥味。长桌上陈列着一具被剖开的半人半鱼深潜者遗骸，银质餐盘里盛满了散发紫黑微光的内脏。正前方墙壁上悬挂着布莱克伍德家族历代伯爵的巨幅油画，画中人的双眼在烛光下仿佛正转动眼球凝视着你！一扇隐秘的运菜送物暗门通往地底深处。',
        choices: [
          {
            id: 'c_dining_portrait',
            label: '勘验先祖油画画框后的秘密夹层',
            description: '察觉到画框边缘有反复挪动的磨损印迹，内藏暗格。',
            tag: '【侦查 1d100】',
            check: { rule: 'coc', skillName: '侦查', targetValue: 65 },
            successOutcome: {
              levelGroup: 'success',
              text: '你在三世伯爵画像背后摸到了一处弹簧暗掣！暗盒弹开，里面静静躺着一枚雕刻精细的【先祖银制五芒星圣徽】与一瓶密封完好的【浓缩镇静剂】！',
              itemGained: '先祖银制五芒星圣徽',
              nextNodeId: 'node_cellar_corridor',
              effects: { setFlags: ['found_silver_seal'], addEvidence: ['先祖银制五芒星圣徽'], timeMinutes: 30, chapter: 3 },
              companionSpeech: {
                agentId: 'gaming-nox',
                text: '银质五芒星圣徽是对抗深渊眷族的核心信物，不仅能稳固精神理智，还能共鸣削弱邪神护盾。重大战术斩获。',
              },
            },
            failureOutcome: {
              levelGroup: 'failure',
              text: '触碰画框的刹那，画像中先祖的眼球突然流出污血！强烈的精神污染震荡了你的神智，你尖叫着后退，撞翻了餐台！',
              sanDelta: -5,
              nextNodeId: 'node_cellar_corridor',
              effects: { setFlags: ['angered_portrait'], timeMinutes: 30, chapter: 3 },
              companionSpeech: {
                agentId: 'gaming-lulu',
                text: '咿呀！画里的人怎么在瞪着我们看啦！快别摸了，吓死人了！',
              },
            },
          },
          {
            id: 'c_dining_feast',
            label: '破译餐盘周围刻印的拉莱耶禁咒符文',
            description: '研究祭祀银盘上的铭文，分析地底主宰的弱点与仪轨。',
            tag: '【神秘学 1d100】',
            check: { rule: 'coc', skillName: '神秘学', targetValue: 70 },
            successOutcome: {
              levelGroup: 'success',
              text: '你强忍恶心辨识符文。这是深渊眷族的降临祭文，但你敏锐地发现了仪式的致命漏洞：“虚空之眼畏惧纯净白银，引信爆裂可断绝地底磁场”！你的认知得到了升华（SAN +3），并获得了【旧神星印残卷】！',
              sanDelta: 3,
              itemGained: '旧神星印残卷',
              nextNodeId: 'node_cellar_corridor',
              effects: { setFlags: ['decoded_ritual_weakness'], addEvidence: ['祭仪的银器弱点'], timeMinutes: 35, chapter: 3 },
            },
            failureOutcome: {
              levelGroup: 'failure',
              text: '那些非人的祭文令你的脑神经如针扎般剧痛，餐盘里的血肉仿佛在蠕动，你狂呕不止，精神遭受重挫！',
              sanDelta: -6,
              hpDelta: -2,
              nextNodeId: 'node_cellar_corridor',
              effects: { setFlags: ['decoded_ritual_failed'], timeMinutes: 35, chapter: 3 },
            },
          },
          {
            id: 'c_dining_to_cellar',
            label: '撬开运菜升降机的铁栅栏，沿滑轮缆绳滑入地窖回廊',
            description: '避开正门，通过厨房隐秘通道直捣黄龙。',
            directNextNodeId: 'node_cellar_corridor',
            directText: '你戴上皮手套，抓紧粗麻缆绳，顺着狭窄的送餐井轻巧地滑落至地窖阴暗的回廊。',
            effects: { setFlags: ['used_service_lift'], timeMinutes: 20, chapter: 3 },
          },
        ],
      },

      // 第二幕B：阴暗温室与星象画廊 (新增支线房间)
      node_gallery: {
        id: 'node_gallery',
        title: '第二幕·东翼：阴暗温室与星象画廊',
        location: '布莱克伍德古宅东翼 · 水晶玻璃温室',
        environmentAtmosphere: '🌿 穹顶暴雨轰鸣 · 散发妖异荧光的异星菌菇',
        bgGradient: 'from-emerald-950 via-teal-950 to-slate-950',
        narration:
          '整座温室被巨大铁艺玻璃穹顶笼罩，外面暴风雨倾盆拍打。这里的植物全非地球物种——扭曲的紫黑色藤蔓在石柱上缓慢呼吸蠕动，泥土中生长着大簇散发淡蓝冷光的异界菌菇。温室正中矗立着一尊无面神祇的黑石雕像，雕像手中捧着转动的星轨罗盘，基座下隐约可见通往地下的地道。',
        choices: [
          {
            id: 'c_gallery_herbs',
            label: '辨识并萃取异界荧光菌菇的舒缓成分',
            description: '利用侦查与医学知识，采集具有强效修复神经功效的奇花异草。',
            tag: '【侦查/医学 1d100】',
            check: { rule: 'coc', skillName: '侦查', targetValue: 65 },
            successOutcome: {
              levelGroup: 'success',
              text: '你小心翼翼地切取下最纯净的荧光孢子。这种异界植物汁液具有不可思议的安神与愈合奇效！你获得了【异界荧光舒缓草】（HP+6, SAN+6）！',
              itemGained: '异界荧光舒缓草',
              nextNodeId: 'node_cellar_corridor',
              effects: { setFlags: ['harvested_luminous_herb'], addEvidence: ['异界菌菇样本'], timeMinutes: 25, chapter: 3 },
              companionSpeech: {
                agentId: 'gaming-koko',
                text: '太神奇了！这草药发着柔和的光，闻一闻就觉得神清气爽！好东西，快收好！',
              },
            },
            failureOutcome: {
              levelGroup: 'failure',
              text: '你不慎碰碎了旁边的毒孢子囊！一团呛人的紫色粉尘炸开，灼痛了你的呼吸道，你咳血不止！',
              hpDelta: -3,
              sanDelta: -3,
              nextNodeId: 'node_cellar_corridor',
              effects: { setFlags: ['contaminated_by_spores'], timeMinutes: 25, chapter: 3 },
            },
          },
          {
            id: 'c_gallery_statue',
            label: '拨动无面石雕手托的星轨罗盘，对齐天狼星座',
            description: '运用神秘学与天体学识，尝试触发雕像底座的机械暗道。',
            tag: '【神秘学 1d100】',
            check: { rule: 'coc', skillName: '神秘学', targetValue: 70 },
            successOutcome: {
              levelGroup: 'success',
              text: '随着罗盘指针咔哒归位，石雕眼窝处亮起纯净的群星蓝光！雕像基座轰然旋开，露出了暗格内的【旧神星印残卷】，一条干燥平整的直达地窖秘道展现在眼前！',
              itemGained: '旧神星印残卷',
              nextNodeId: 'node_cellar_corridor',
              effects: { setFlags: ['decoded_star_compass'], addEvidence: ['星轨罗盘暗道'], timeMinutes: 30, chapter: 3 },
              companionSpeech: {
                agentId: 'gaming-nox',
                text: '古老星图机关被完美破译，跳过了所有伏兵警戒区，直达深渊前哨。',
              },
            },
            failureOutcome: {
              levelGroup: 'failure',
              text: '罗盘对位错误！石雕内部喷射出高压冰霜寒流，冻伤了你的双手，石阶暗门粗暴地卡在半空。',
              hpDelta: -4,
              nextNodeId: 'node_cellar_corridor',
              effects: { setFlags: ['failed_star_compass'], timeMinutes: 30, chapter: 3 },
            },
          },
          {
            id: 'c_gallery_to_study',
            label: '沿着温室后方的回旋木梯踏入二楼书斋',
            description: '折返前往艾伯纳学者的私人核心书房。',
            directNextNodeId: 'node_study',
            directText: '你顺着回旋木梯快步登楼，推开了二楼藏书斋的暗门。',
            effects: { setFlags: ['returned_to_study'], timeMinutes: 15, chapter: 3 },
          },
        ],
      },

      // 第二幕C：星图密室与血色手稿
      node_study: {
        id: 'node_study',
        title: '第二幕·核心：星图密室与血色手稿',
        location: '庄园二楼 · 艾伯纳学者的私人书斋',
        environmentAtmosphere: '🕯️ 烛火忽明忽暗 · 满壁天体星图与禁断书籍',
        bgGradient: 'from-emerald-950 via-slate-900 to-slate-950',
        narration:
          '书斋的门虚掩着。推开门，一股浓烈的旧书霉味与焦糊味扑面而来。整面墙被画满了错乱扭曲的未知星座，墨迹还是湿润的。壁炉里焚烧着大半手稿，但桌面上依然摊开着一本由粗糙人皮缝制的密卷——正是失传的《拉莱耶断章》。在书架背后的暗壁处，一扇通往地底的暗门正不断渗出刺骨的冰霜寒气。',
        choices: [
          {
            id: 'c_study_use_key',
            label: '🔑【道具专属】以【雕花铜钥匙】无声开启暗柜与地底秘门',
            description: '拥有门厅发现的雕花黄铜钥匙，无需任何检定即可安全破局。',
            requiredItem: '雕花铜钥匙',
            directNextNodeId: 'node_cellar_corridor',
            directText:
              '你将雕花铜钥匙插入暗柜锁孔，轻轻一拧，咔哒一声机簧无声滑开！不仅暗门平稳洞开，柜内还完好保留了一套【战地急救绷带】！',
            effects: { setFlags: ['opened_study_secret_door'], addEvidence: ['学者暗柜'], timeMinutes: 20, chapter: 3 },
          },
          {
            id: 'c1_read_necronomicon',
            label: '破译《拉莱耶断章》桌上手稿的星象秘密',
            description: '利用神秘学知识，寻找克制异界造物的法阵符文。',
            tag: '【神秘学 1d100】',
            check: { rule: 'coc', skillName: '神秘学', targetValue: 65 },
            successOutcome: {
              levelGroup: 'success',
              text: '你的指尖划过禁忌的文字。虽然精神受到不可名状的震荡（SAN -2），但你成功破译出封印仪式的关键：“以纯银五芒星置于地窖祭坛正中，唱诵旧神归位之歌”！你获得了【旧神星印残卷】！',
              sanDelta: -2,
              itemGained: '旧神星印残卷',
              nextNodeId: 'node_cellar_corridor',
              effects: { setFlags: ['decoded_ritual_formula'], addEvidence: ['封印仪式公式'], timeMinutes: 35, chapter: 3 },
              companionSpeech: {
                agentId: 'gaming-nox',
                text: '高风险高收益。获得了封印公式，我们直捣黄龙胜算将提升至 85% 以上。',
              },
            },
            failureOutcome: {
              levelGroup: 'failure',
              text: '那些非人类的文字仿佛在羊皮纸上扭曲蠕动，直往你的眼眶里钻！你目睹了无垠星海中不可名状的巨大眼眸，san 值剧烈暴跌！',
              sanDelta: -8,
              nextNodeId: 'node_cellar_corridor',
              effects: { setFlags: ['read_forbidden_text'], timeMinutes: 35, chapter: 3 },
              companionSpeech: {
                agentId: 'gaming-koko',
                text: '别看啦别看啦！快把书合上！可恶，这些古籍简直是有毒的！喝口热水缓一缓！',
              },
            },
            criticalSuccessBonus: {
              text: '绝世大成功！不仅完全领悟封印秘法，还在书脊暗夹中找到了一枚散发纯净蓝光的【银制旧神星之护符】！',
              itemGained: '银制旧神星之护符',
              sanDelta: 5,
            },
            fumblePenalty: {
              text: '大失败！心智被书中深渊意志入侵，你发出痛苦的惨嚎，陷入急性临时狂躁症，撕毁了日记并咳出一口鲜血！',
              hpDelta: -4,
              sanDelta: -12,
            },
          },
          {
            id: 'c2_pick_secret_door',
            label: '破拆或技巧性解开通往地底的机械暗门',
            description: '通过敏捷撬锁或力量强拆，开启寒气森森的地窖通道。',
            tag: '【敏捷/巧手 1d100】',
            check: { rule: 'coc', skillName: '敏捷', targetValue: 60 },
            successOutcome: {
              levelGroup: 'success',
              text: '咔哒一声轻响！你用随身别针巧妙拨动了齿轮暗簧，暗门无声滑开。你没有触发任何警报，悄然顺着盘旋石阶踏入地底。',
              nextNodeId: 'node_cellar_corridor',
              companionSpeech: {
                agentId: 'gaming-lulu',
                text: '哼，看不出来你手还挺巧的嘛！……才、才没有夸你呢！跟紧我，别走丢了！',
              },
            },
            failureOutcome: {
              levelGroup: 'failure',
              text: '机关年久失修，一声沉重的金属崩裂声轰鸣回荡！暗门被硬生生卡住，你不得不费尽全力用肩膀撞开，手臂被铁刺划伤，流血不止！',
              hpDelta: -3,
              nextNodeId: 'node_cellar_corridor',
              companionSpeech: {
                agentId: 'gaming-nox',
                text: '机关触发产生了 80 分贝噪音，地底的潜伏者已经进入警戒状态，准备迎击。',
              },
            },
          },
          {
            id: 'c3_search_fireplace',
            label: '搜查未燃尽的壁炉与学者抽屉',
            description: '寻找防身武器或急救物资。',
            directNextNodeId: 'node_cellar_corridor',
            directText: '你在壁炉旁的铁盒里搜出了一瓶【高纯度医疗酒精与止血绷带】（HP +4），随后推开暗门踏入地窖深处。',
          },
          {
            id: 'c_study_allen_caseboard',
            label: '【艾伦专属】重建案发现场，找出学者最后的行动轨迹',
            description: '把壁炉灰烬、门锁磨痕和湿脚印拼成一条完整的逃生路线。',
            requires: { characterIds: ['investigator-allen'] },
            tag: '【私家侦探专属】',
            directNextNodeId: 'node_cellar_corridor',
            directText: '艾伦没有急着翻动书页，而是先把灰烬和门锁磨痕画在随身案情板上。线索拼合后，你确认艾伯纳是主动走进地窖的，并在暗柜夹层找到一枚【沾血铜牌】。',
            effects: { setFlags: ['allen_reconstructed_scene'], addEvidence: ['学者主动进入地窖', '沾血的铜牌'], timeMinutes: 20, chapter: 3 },
          },
          {
            id: 'c_study_sara_marginalia',
            label: '【塞拉专属】比对古籍旁注，解读被抹去的旧神祷文',
            description: '民俗学者能看懂书页边缘留下的早期仪式注释。',
            requires: { characterIds: ['investigator-sara'] },
            tag: '【密大民俗学者专属】',
            directNextNodeId: 'node_cellar_corridor',
            directText: '塞拉用羽毛笔蘸取墨水，沿着几乎被刮掉的旁注重新描摹。祷文揭示了“不要回应祭坛回声”的禁忌，你还在书脊里找到一片【旧神星印残卷】。',
            effects: { setFlags: ['sara_decoded_marginalia'], addEvidence: ['祭坛回声规则', '旧神星印残卷'], timeMinutes: 25, chapter: 3 },
          },
          {
            id: 'c_study_reyno_breach',
            label: '【雷诺专属】检查暗门结构，寻找最快的撤离与爆破点',
            description: '退役军官优先判断建筑承重和战术撤离路线。',
            requires: { characterIds: ['investigator-reyno'] },
            tag: '【退役军官专属】',
            directNextNodeId: 'node_cellar_corridor',
            directText: '雷诺沿着墙根敲击石砖，迅速标出三处承重薄弱点。你在暗门旁找到一卷【战地急救绷带】，并记住了必要时可以炸塌回廊的撤退位置。',
            effects: { setFlags: ['reyno_marked_escape_route'], addEvidence: ['地窖爆破撤离点'], timeMinutes: 15, chapter: 3 },
          },
          {
            id: 'c_study_to_attic',
            label: '攀爬走廊尽头的折叠铝梯，前往三楼阁楼观测密室',
            description: '去古宅最高点利用天文望远镜观测暴雨夜空的异变。',
            directNextNodeId: 'node_attic',
            directText: '你拉下走廊天花板上的折叠铝梯，轻巧地攀上了三楼阁楼观测密室。',
            effects: { setFlags: ['climbed_to_attic'], timeMinutes: 10 },
          },
        ],
      },

      // 第二幕D：三楼阁楼观测密室与夜空深渊
      node_attic: {
        id: 'node_attic',
        title: '第二幕·顶层：阁楼密室与星空深渊',
        location: '布莱克伍德庄园三楼 · 阁楼天文观测室',
        environmentAtmosphere: '🔭 暴风雨洗刷天窗 · 黄铜天文望远镜对准诡异夜空',
        bgGradient: 'from-indigo-950 via-slate-900 to-purple-950',
        narration:
          '阁楼天花板倾斜压抑，空气中弥漫着松木与尘土的气息。大厅中央架设着一台军工级黄铜天文望远镜，镜筒穿过天窗对准暴雨翻滚的苍穹。角落里堆放着未拆封的测绘仪器箱与一只贴有阿卡姆大学封条的生铁保险箱。透过天窗外倾斜的雨檐，隐约有一根粗重的铁制排水管道通向外侧庭院。',
        choices: [
          {
            id: 'c_attic_telescope',
            label: '凑近黄铜望远镜目镜，观测云层深处不可名状的异变',
            description: '透过目镜直视星空异变的本质，可能洞悉真相但会冲击心智。',
            tag: '【神秘学 1d100】',
            check: { rule: 'coc', skillName: '神秘学', targetValue: 65 },
            successOutcome: {
              levelGroup: 'success',
              text: '透过高倍目镜，你震惊地发现暴雨云层深处是一团横跨数公里的紫黑色触须星云！你洞悉了深渊裂隙的力场弱点（SAN -3），并获得了【深空星图坐标】！',
              sanDelta: -3,
              itemGained: '深空星图坐标',
              nextNodeId: 'node_study',
              effects: { setFlags: ['observed_deep_space'], addEvidence: ['深空触须星云'], timeMinutes: 20, chapter: 3 },
              companionSpeech: {
                agentId: 'gaming-nox',
                text: '宏观天文观测证实了维度裂隙的锚点位置，这对我们封印主祭坛提供了极关键的数据支撑。',
              },
            },
            failureOutcome: {
              levelGroup: 'failure',
              text: '目镜中突然睁开了一只布满血丝的巨大虚空眼眸！直视不可名状的深渊瞬间灼痛了你的神经，你惨叫着跌倒在地！',
              sanDelta: -7,
              nextNodeId: 'node_study',
              effects: { setFlags: ['attic_sanity_shaken'], timeMinutes: 15, chapter: 3 },
              companionSpeech: {
                agentId: 'gaming-lulu',
                text: '笨蛋！快离开那个望远镜啦！看你整个人都在发抖……拉着我的手，先下楼！',
              },
            },
          },
          {
            id: 'c_attic_safebox',
            label: '撬开密大封条的生铁保险箱，搜寻医疗与镇静补给',
            description: '利用精巧手法开启锁扣，获取高价值战术药剂。',
            tag: '【敏捷闪避 1d100】',
            check: { rule: 'coc', skillName: '敏捷闪避', targetValue: 60 },
            successOutcome: {
              levelGroup: 'success',
              text: '伴随着清脆的锁簧弹响，生铁箱盖应声掀开！里面整齐收纳着珍贵的【浓缩镇静剂】与【战地急救绷带】！',
              itemGained: '浓缩镇静剂',
              nextNodeId: 'node_study',
              effects: { setFlags: ['opened_attic_safebox'], timeMinutes: 20, chapter: 3 },
              companionSpeech: {
                agentId: 'gaming-koko',
                text: '哇塞！满满的医疗物资！这波补给简直是雪中送炭，我们又能满血复活啦！',
              },
            },
            failureOutcome: {
              levelGroup: 'failure',
              text: '别针在锁芯中断裂卡死，箱体防盗机关释放出刺鼻的催泪性烟雾，呛得你眼泪直流。',
              hpDelta: -2,
              nextNodeId: 'node_study',
              effects: { setFlags: ['attic_safe_jammed'], timeMinutes: 15, chapter: 3 },
            },
          },
          {
            id: 'c_attic_return_study',
            label: '沿着铝制折叠梯返回二楼学者书斋',
            description: '整理阁楼所得情报，返回主书房继续推演地窖通道。',
            directNextNodeId: 'node_study',
            directText: '你抓紧折叠铝梯的防滑扶手，轻捷地顺着梯级返回了二楼书房。',
            effects: { timeMinutes: 10 },
          },
        ],
      },

      // 第三幕：地窖回廊与狂乱眷族守卫 (新增过渡枢纽节点)
      node_cellar_corridor: {
        id: 'node_cellar_corridor',
        title: '第三幕：潮湿回廊与狂乱仆从',
        location: '布莱克伍德古宅地下 · 拱形石窟回廊',
        environmentAtmosphere: '💧 冰冷滴水声 · 混合着深海鱼腥与狂热祈祷的沙哑回音',
        bgGradient: 'from-slate-950 via-teal-950 to-purple-950',
        narration:
          '穿过暗门与陡峭石阶，你来到了庄园地下的古老石砌回廊。地表风暴的轰鸣在这里被吸收殆尽，取而代之的是无处不在的滴水声。回廊两侧摆满了浸泡着不可名状器官的福尔马林玻璃罐。前方廊道中，两名面部已严重畸变、长出两栖鱼鳃与凸出眼珠的异化仆从正手持锈蚀钢叉来回巡逻，喉咙深处发出“咕噜……克苏鲁……”的狂热碎语。',
        choices: [
          {
            id: 'c_cellar_search_archive',
            label: '沿着蹼足脚印，搜查回廊尽头的旧档案柜',
            description: '门厅发现的非人足迹在这里再次出现，柜中可能保存庄园历任主人的实验记录。',
            requires: { evidence: ['蹼足脚印'] },
            tag: '【侦查 1d100】',
            check: { rule: 'coc', skillName: '侦查', targetValue: 60 },
            successOutcome: {
              levelGroup: 'success',
              text: '你沿着湿漉漉的蹼足脚印找到一只嵌在石墙里的铅封档案柜。里面的记录证明，艾伯纳并非第一个被庄园主人带到祭坛的学者，旧档案还标出了祭坛的第二处封印阵眼。',
              nextNodeId: 'node_archive_vault',
              effects: { setFlags: ['found_archive_record', 'learned_second_seal'], addEvidence: ['庄园人体实验档案', '第二处封印阵眼'], timeMinutes: 35, chapter: 4 },
              companionSpeech: {
                agentId: 'gaming-nox',
                text: '这不是单纯的祭祀，而是一场持续数十年的人体实验。第二处阵眼或许能让我们在祭坛上获得一次补救机会。',
              },
            },
            failureOutcome: {
              levelGroup: 'failure',
              text: '档案柜的铅封突然裂开，里面积存的黑色霉尘扑面而来。你只来得及撕下一页残纸，便听见巡逻仆从朝这边逼近。',
              sanDelta: -4,
              nextNodeId: 'node_basement',
              effects: { setFlags: ['disturbed_archive'], addEvidence: ['残缺实验记录'], timeMinutes: 35, chapter: 4 },
            },
          },
          {
            id: 'c_cellar_ambush',
            label: '潜伏阴影之中，雷霆突袭制服异化仆从！',
            description: '凭借过硬的近战格斗与突袭本能，无声放倒守卫。',
            tag: '【格斗/力量 1d100】',
            check: { rule: 'coc', skillName: '格斗', targetValue: 65 },
            successOutcome: {
              levelGroup: 'success',
              text: '你如猎豹般跃出阴影，一记重击砸晕首名守卫，顺势缴下钢叉逼停另一人！惊恐的异化仆从在濒死时颤抖着吐露实情：“艾伯纳老爷在深渊祭坛……虚空之裂……就在前面大厅……”你在其身上搜出了一卷【战地急救绷带】！',
              itemGained: '战地急救绷带',
              nextNodeId: 'node_basement',
              effects: { setFlags: ['learned_altar_location'], addEvidence: ['异化仆从口供'], timeMinutes: 20, chapter: 4 },
              companionSpeech: {
                agentId: 'gaming-nox',
                text: '干净利落的突袭打击。逼问出的情报确认了目标方位，前方就是终局祭坛。',
              },
            },
            failureOutcome: {
              levelGroup: 'failure',
              text: '异化仆从的皮肤坚韧如鱼鳞，滑开了你的拳锋！锈蚀钢叉狠狠划破了你的大腿，鲜血直流，守卫的嘶吼引得地穴深处震动！',
              hpDelta: -5,
              nextNodeId: 'node_basement',
              effects: { setFlags: ['alerted_altar_guard'], timeMinutes: 15, chapter: 4 },
              companionSpeech: {
                agentId: 'gaming-lulu',
                text: '喂！流了好多血！你没事吧笨蛋！快甩掉他们往前跑！',
              },
            },
          },
          {
            id: 'c_cellar_stealth',
            label: '借助石柱阴影与滴水声掩护，潜行通过警戒区',
            description: '利用敏捷与隐蔽技巧，在不惊动任何守卫的情况下穿过回廊。',
            tag: '【敏捷闪避 1d100】',
            check: { rule: 'coc', skillName: '敏捷闪避', targetValue: 65 },
            successOutcome: {
              levelGroup: 'success',
              text: '你轻巧地贴着潮湿的岩壁滑行，异化守卫浑浊的白内障眼珠完全没有察觉你的存在。你悄然穿过长廊，抵达了尽头的黑曜石神庙大门。',
              nextNodeId: 'node_basement',
              companionSpeech: {
                agentId: 'gaming-koko',
                text: '嘘……太刺激了！就像特工电影一样！安全通过！前面就是大 Boss 房啦！',
              },
            },
            failureOutcome: {
              levelGroup: 'failure',
              text: '你不慎碰倒了地上的玻璃罐，福尔马林药水碎了一地！守卫惊觉并投掷钢叉，刺伤了你的后背，你拼死撞开神庙大门！',
              hpDelta: -4,
              sanDelta: -2,
              nextNodeId: 'node_basement',
            },
          },
          {
            id: 'c_cellar_sedative',
            label: '💉【道具专属】以强光手电致盲，果断为其注射【浓缩镇静剂】',
            description: '利用镇静药剂抚平仆从脑中的疯狂神经，将其从不可名状的蛊惑中唤醒。',
            requiredItem: '浓缩镇静剂',
            consumeRequiredItem: true,
            directNextNodeId: 'node_basement',
            directText:
              '强光瞬间刺痛了仆从的眼睛！你飞身上前，精准将浓缩镇静剂扎入其颈动脉。仆从眼中的浑浊狂乱缓缓褪去，流下悔恨的眼泪：“谢谢你……调查员……快去祭坛！用纯银的星之护符嵌入祭坛顶端……方能平息撕裂空间的深渊！”他将一枚【银制旧神星之护符】交到你的掌心！',
            effects: { setFlags: ['calmed_mutated_servant'], addEvidence: ['祭坛封印提示'], timeMinutes: 10, chapter: 4, npcs: { servant: { trustDelta: 30 } } },
          },
        ],
      },

      // 第四幕前置：旧档案库（调查中段扩展节点）
      node_archive_vault: {
        id: 'node_archive_vault',
        title: '第四幕前置：旧档案库与失踪者名册',
        location: '庄园地下旧档案区 · 铅封档案库',
        environmentAtmosphere: '📚 潮湿纸页翻动声 · 墙后传来断续的呼吸与抓挠',
        bgGradient: 'from-stone-950 via-slate-900 to-indigo-950',
        narration:
          '铅封档案柜后藏着一间狭窄的石室。墙面钉满了历代调查者与仆人的名牌，许多名字被黑墨粗暴划去。中央的长桌上摊着三本不同年代的实验账册，最上面那本还残留着新鲜的潮气。墙后传来三短一长的敲击声，像有人在用最后的力气求救。',
        choices: [
          {
            id: 'c_archive_read_ledger',
            label: '完整解读三本实验账册，拼出祭坛运作规律',
            description: '把失踪者名册、星象记录和封印损耗互相对照。',
            tag: '【神秘学 1d100】',
            check: { rule: 'coc', skillName: '神秘学', targetValue: 70 },
            successOutcome: {
              levelGroup: 'success',
              text: '你将三本账册按年份重排，发现庄园每隔十三年就会更换一次祭品。最后一页还画出了礼拜堂的第二封印路线，并标注：银制护符必须在裂隙完全张开前嵌入阵眼。',
              nextNodeId: 'node_hidden_chapel',
              effects: { setFlags: ['decoded_archive_ledger'], addEvidence: ['封印仪式公式', '失踪者名册'], timeMinutes: 45, chapter: 5 },
              companionSpeech: {
                agentId: 'gaming-nox',
                text: '账册确认了时间窗口。我们还有机会在裂隙完全张开前完成双重封印。',
              },
            },
            failureOutcome: {
              levelGroup: 'failure',
              text: '账册中的星图在你眼前重叠成一片旋转的黑色海面。你没能读完，但撕下了标有银色阵眼的那一页，墙后的敲击声也突然停止。',
              sanDelta: -6,
              nextNodeId: 'node_hidden_chapel',
              effects: { setFlags: ['damaged_archive_ledger'], addEvidence: ['残缺封印公式'], timeMinutes: 35, chapter: 5 },
            },
          },
          {
            id: 'c_archive_search_relic',
            label: '翻找失踪者遗物，寻找能抵抗深渊低语的物品',
            description: '不继续阅读禁书，优先寻找能在终局保命的实物。',
            tag: '【侦查 1d100】',
            check: { rule: 'coc', skillName: '侦查', targetValue: 65 },
            successOutcome: {
              levelGroup: 'success',
              text: '你在一只标有“艾伯纳·B”的铁盒里找到一枚银制旧神星之护符，以及一张写着“不要相信祭坛回声”的便条。护符的边缘还刻着礼拜堂入口的方向。',
              itemGained: '银制旧神星之护符',
              nextNodeId: 'node_hidden_chapel',
              effects: { setFlags: ['found_relic_in_archive'], addEvidence: ['祭坛回声警告'], timeMinutes: 30, chapter: 5 },
              companionSpeech: {
                agentId: 'gaming-koko',
                text: '这枚护符看起来就是最后的保命牌！先把它收好，千万别弄丢啦！',
              },
            },
            failureOutcome: {
              levelGroup: 'failure',
              text: '铁盒里的弹簧机关突然弹开，腐蚀性的黑水溅上你的手腕。你只抢到一张沾血的名牌，便听见档案库外传来钢叉拖地的声音。',
              hpDelta: -3,
              nextNodeId: 'node_hidden_chapel',
              effects: { setFlags: ['triggered_archive_alarm'], addEvidence: ['沾血的失踪者名牌'], timeMinutes: 25, chapter: 5 },
            },
          },
          {
            id: 'c_archive_follow_breathing',
            label: '放弃翻阅，拆开墙板追踪求救声',
            description: '优先确认墙后是否还有活人，可能错过部分档案线索。',
            directNextNodeId: 'node_hidden_chapel',
            directText:
              '你用肩膀撞开潮湿的墙板。后面没有活人，只有一条通往地下礼拜堂的狭缝，以及一串刚刚留下的湿脚印。',
            effects: { setFlags: ['followed_archive_breathing'], addEvidence: ['礼拜堂湿脚印'], timeMinutes: 15, chapter: 5 },
          },
        ],
      },

      // 隐藏支线：旧档案标记出的地下礼拜堂
      node_hidden_chapel: {
        id: 'node_hidden_chapel',
        title: '第四幕前置：被遗忘的地下礼拜堂',
        location: '庄园地下旧档案区 · 封闭礼拜堂',
        environmentAtmosphere: '🕯️ 熄灭的蜡烛 · 墙面残留着无法辨认的祷文',
        bgGradient: 'from-indigo-950 via-slate-950 to-stone-950',
        narration:
          '档案中标记的暗门通向一座被石墙封死的小礼拜堂。褪色壁画描绘着两道交错的银色圆环，地面散落着庄园历代仆人的铜制名牌。角落里传来微弱的呼吸声，像是还有人被困在这里。',
        choices: [
          {
            id: 'c_chapel_restore_mural',
            label: '依照档案修复墙面的第二封印圆环',
            description: '将残缺的符文重新排列，为祭坛终局提前准备备用封印。',
            tag: '【神秘学 1d100】',
            check: { rule: 'coc', skillName: '神秘学', targetValue: 65 },
            successOutcome: {
              levelGroup: 'success',
              text: '你用炭笔补全了壁画中缺失的符号。两道圆环短暂亮起，地下深处传来一声压抑的嘶鸣，仿佛某种力量已经察觉到你的准备。',
              nextNodeId: 'node_chapel_ritual',
              effects: { setFlags: ['prepared_backup_seal'], addEvidence: ['备用封印已准备'], timeMinutes: 30, chapter: 5 },
              companionSpeech: { agentId: 'gaming-nox', text: '备用阵眼已经预热。终局时即使主封印失败，也有机会争取一次补救。' },
            },
            failureOutcome: {
              levelGroup: 'failure',
              text: '符文排列错了一笔，礼拜堂里的蜡烛同时熄灭。你只能记住大概位置，带着不完整的修复结果继续前进。',
              sanDelta: -3,
              nextNodeId: 'node_basement',
              effects: { setFlags: ['damaged_backup_seal'], timeMinutes: 30, chapter: 5 },
            },
          },
          {
            id: 'c_chapel_rescue_servant',
            label: '循着呼吸声，解救被锁在祭坛旁的老仆人',
            description: '冒险打开锈死的铁笼，确认他是否知道艾伯纳学者的下落。',
            tag: '【力量/敏捷 1d100】',
            check: { rule: 'coc', skillName: '力量破拆', targetValue: 60 },
            successOutcome: {
              levelGroup: 'success',
              text: '铁锁在你的撬动下断裂。老仆人告诉你，艾伯纳还活着，但祭坛上的主裂隙已经开始吞噬他的记忆。',
              nextNodeId: 'node_chapel_ritual',
              effects: { setFlags: ['rescued_old_servant', 'learned_scholar_alive'], addEvidence: ['艾伯纳仍然活着'], timeMinutes: 20, chapter: 5, npcs: { servant: { trustDelta: 45 } } },
            },
            failureOutcome: {
              levelGroup: 'failure',
              text: '铁笼的锁芯在最后一刻卡死，老仆人只能把一枚沾血的铜牌塞进你手里，催促你立刻前往祭坛。',
              hpDelta: -2,
              nextNodeId: 'node_basement',
              effects: { setFlags: ['received_servant_token'], addEvidence: ['沾血的铜牌'], timeMinutes: 20, chapter: 5 },
            },
          },
        ],
      },

      // 第四幕前置：第二封印仪式准备
      node_chapel_ritual: {
        id: 'node_chapel_ritual',
        title: '第四幕前置：第二封印的仪式准备',
        location: '庄园地下旧礼拜堂 · 双环阵眼',
        environmentAtmosphere: '🔔 远处祭坛震动 · 银色圆环忽明忽暗 · 老仆人的低声祷告',
        bgGradient: 'from-indigo-950 via-slate-950 to-violet-950',
        narration:
          '礼拜堂中央的两道银色圆环开始缓慢转动。每一次重合，地面就传来一次沉闷的震动，仿佛深处有什么东西在敲门。油灯在壁龛中摇曳，墙后隐约传来老仆人或祭坛回声的低语：只要在这里完成准备，祭坛上的裂隙就不会立刻吞噬你们。',
        choices: [
          {
            id: 'c_ritual_align_rings',
            label: '按照档案公式对齐两道银环，准备备用封印',
            description: '把已经获得的线索转化为终局时可以使用的安全窗口。',
            requires: { evidence: ['封印仪式公式'] },
            tag: '【神秘学 1d100】',
            check: { rule: 'coc', skillName: '神秘学', targetValue: 70 },
            successOutcome: {
              levelGroup: 'success',
              text: '两道银环在最后一刻完全重合。礼拜堂的墙壁上浮现出一条通往祭坛的安全路线，你把备用阵眼的启动顺序牢牢记在脑中。',
              nextNodeId: 'node_basement',
              effects: { setFlags: ['prepared_backup_seal', 'aligned_second_seal'], addEvidence: ['备用封印已准备'], timeMinutes: 35, chapter: 6 },
              companionSpeech: {
                agentId: 'gaming-nox',
                text: '备用阵眼已进入可用状态。终局至少多出一次纠错窗口。',
              },
            },
            failureOutcome: {
              levelGroup: 'failure',
              text: '银环错开半寸，反噬的震动让你的牙龈渗出血丝。虽然没有完成准备，但你看清了阵眼真正的启动方向。',
              sanDelta: -4,
              nextNodeId: 'node_basement',
              effects: { setFlags: ['misaligned_second_seal'], addEvidence: ['残缺备用封印线索'], timeMinutes: 25, chapter: 6 },
            },
          },
          {
            id: 'c_ritual_question_servant',
            label: '先询问老仆人：艾伯纳究竟为什么打开裂隙',
            description: '用剩余时间确认幕后动机，也许能发现终局的隐藏条件。',
            requires: { flags: ['rescued_old_servant'] },
            tag: '【心理学 1d100】',
            check: { rule: 'coc', skillName: '心理学', targetValue: 60 },
            successOutcome: {
              levelGroup: 'success',
              text: '老仆人承认，艾伯纳并非被迫研究星之眷族，而是想用自己的记忆交换亡妻的复生。你得知祭坛回声会模仿死者的声音，任何回应都会增强裂隙。',
              nextNodeId: 'node_basement',
              effects: { setFlags: ['learned_scholar_motive', 'understood_altar_echo'], addEvidence: ['祭坛回声规则'], timeMinutes: 30, chapter: 6, npcs: { servant: { trustDelta: 20 } } },
              companionSpeech: {
                agentId: 'gaming-lulu',
                text: '原来那个学者是自己跳进坑里的……到了祭坛，千万别回应任何像亲人在叫你的声音！',
              },
            },
            failureOutcome: {
              levelGroup: 'failure',
              text: '老仆人被远处的低语吓得语无伦次，只反复说着“不要回应”。你没能问出完整真相，只能带着这句警告赶往祭坛。',
              sanDelta: -2,
              nextNodeId: 'node_basement',
              effects: { setFlags: ['heard_do_not_answer'], addEvidence: ['不要回应的警告'], timeMinutes: 20, chapter: 6 },
            },
          },
          {
            id: 'c_ritual_listen_echo',
            label: '没有活人回应，贴近墙面辨认祭坛回声的规律',
            description: '老仆人没有被救出，只能从墙后的低语中寻找可用信息。',
            requires: { notFlags: ['rescued_old_servant'] },
            tag: '【聆听 1d100】',
            check: { rule: 'coc', skillName: '聆听', targetValue: 65 },
            successOutcome: {
              levelGroup: 'success',
              text: '你分辨出低语并不是老仆人的声音，而是祭坛模仿死者时重复的诱饵。只要不回应，它就无法锁定你的精神位置。',
              nextNodeId: 'node_basement',
              effects: { setFlags: ['understood_altar_echo'], addEvidence: ['祭坛回声规则'], timeMinutes: 20, chapter: 6 },
              companionSpeech: {
                agentId: 'gaming-koko',
                text: '听到了吗？那不是人在说话！我们记住规律，到了祭坛千万别被它骗啦！',
              },
            },
            failureOutcome: {
              levelGroup: 'failure',
              text: '低语在墙后突然变成你最熟悉的声音。你没有回应，却仍被那阵回声震得头晕目眩，只能赶紧离开礼拜堂。',
              sanDelta: -5,
              nextNodeId: 'node_basement',
              effects: { setFlags: ['heard_false_echo'], timeMinutes: 15, chapter: 6 },
            },
          },
          {
            id: 'c_ritual_burn_records',
            label: '烧毁剩余实验账册，切断庄园与祭坛的共鸣',
            description: '牺牲一部分真相，换取进入终局时更低的精神污染。',
            directNextNodeId: 'node_basement',
            directText:
              '你把最危险的账册投入礼拜堂的油灯。黑烟升起时，庄园深处的震动短暂减弱，通往祭坛的石门终于停止渗出冷雾。',
            effects: { setFlags: ['burned_ritual_records'], addEvidence: ['共鸣暂时中断'], timeMinutes: 15, chapter: 6 },
          },
        ],
      },

      // 第四幕：深渊祭坛与星之眷族 (终局决战舞台)
      node_basement: {
        id: 'node_basement',
        title: '第四幕·终决：深渊祭坛与星之眷族',
        location: '黑石庄园地底 · 深渊祭坛大厅',
        environmentAtmosphere: '⚡ 紫黑色虚空闪电 · 不可名状的黏液与深渊低语',
        bgGradient: 'from-purple-950 via-slate-950 to-emerald-950',
        narration:
          '走下百级潮湿冰冷的石阶，你来到了庄园地底的巨型古老拱顶神庙。石柱上生满了散发微弱磷光的菌菇，中央的黑曜石祭坛四周沸腾着紫黑色的粘稠液体。学者艾伯纳倒在祭坛边缘生死未卜，而祭坛上方——一团由无数眼珠、触须与翻滚黑雾构成的星之眷族正在撕开现实维度的裂隙！四周的空间开始坍塌！',
        choices: [
          {
            id: 'c0_confront_scholar',
            label: '【线索专属】先唤醒艾伯纳，追问他为何主动打开裂隙',
            description: '只有确认学者还活着，并掌握相关线索后，才有机会当面对质。',
            requires: { evidence: ['艾伯纳仍然活着'], notFlags: ['scholar_confronted'] },
            tag: '【心理学 1d100】',
            check: { rule: 'coc', skillName: '心理学', targetValue: 65 },
            successOutcome: {
              levelGroup: 'success',
              text: '艾伯纳在你的质问中睁开眼睛。他承认自己为了复活亡妻，主动用调查者和仆人的记忆喂养裂隙。可当他听见祭坛模仿亡妻的声音时，终于意识到自己被骗了。他把最后一枚银色阵钉交给你，请你结束这一切。',
              nextNodeId: 'node_basement',
              effects: { setFlags: ['scholar_confronted', 'scholar_regrets'], addEvidence: ['艾伯纳的忏悔', '银色阵钉'], timeMinutes: 10, chapter: 7, npcs: { scholar: { trustDelta: 25 } } },
              companionSpeech: {
                agentId: 'gaming-nox',
                text: '动机已确认：这是人为开启的裂隙，不是单纯的外神入侵。银色阵钉可能是最后的稳定工具。',
              },
            },
            failureOutcome: {
              levelGroup: 'failure',
              text: '艾伯纳在半梦半醒间只吐出一句“她还在回声里”。祭坛的低语立刻盖过了他的声音，你没能得到完整解释，但确认他仍然拒绝面对真相。',
              sanDelta: -4,
              nextNodeId: 'node_basement',
              effects: { setFlags: ['scholar_confronted', 'scholar_unrepentant'], addEvidence: ['艾伯纳的回声执念'], timeMinutes: 8, chapter: 7 },
            },
          },
          {
            id: 'c0_scholar_counterseal',
            label: '【隐藏路线】让悔悟的艾伯纳握住银色阵钉，共同完成反制封印',
            description: '只有先让艾伯纳承认错误，并找到银色阵钉，才能尝试这条高风险协作路线。',
            requires: { flags: ['scholar_regrets'], evidence: ['银色阵钉'] },
            tag: '【神秘学 1d100】',
            check: { rule: 'coc', skillName: '神秘学', targetValue: 75 },
            successOutcome: {
              levelGroup: 'success',
              text: '艾伯纳用最后的力气将银色阵钉刺入祭坛核心。你接过他念到一半的旧神祷文，两道银环与主阵眼同时亮起。裂隙没有爆裂，而是在悔悟者的记忆中缓慢闭合。',
              sanDelta: -4,
              nextNodeId: 'ending_triumph',
              effects: { setFlags: ['scholar_redeemed', 'sealed_the_rift'], addEvidence: ['悔悟者完成反制封印'], timeMinutes: 15, npcs: { scholar: { trustDelta: 40 } } },
              companionSpeech: { agentId: 'gaming-koko', text: '你们做到了！这次不是一个人扛下所有东西，而是让犯错的人亲手把裂隙关上了！' },
            },
            failureOutcome: {
              levelGroup: 'failure',
              text: '银色阵钉刺入的瞬间，祭坛回声反过来夺走了艾伯纳的意识。你只能拽着他从崩塌的石阶撤离，封印没有完成，但裂隙暂时被压回了地下。',
              hpDelta: -4,
              sanDelta: -8,
              nextNodeId: 'ending_escape',
              effects: { setFlags: ['scholar_lost_to_echo', 'buried_the_altar'], timeMinutes: 15, npcs: { scholar: { alive: false } } },
            },
          },
          {
            id: 'c0_reinforce_second_seal',
            label: '根据旧档案，先修复祭坛下方的第二处封印阵眼',
            description: '绕开正面冲突，利用调查途中获得的档案寻找被掩盖的备用阵眼。',
            requires: { evidence: ['第二处封印阵眼'] },
            tag: '【神秘学 1d100】',
            check: { rule: 'coc', skillName: '神秘学', targetValue: 70 },
            successOutcome: {
              levelGroup: 'success',
              text: '你按照旧档案中的逆向符号修复了祭坛底部的第二阵眼。两道银白色光环同时收束，裂隙被压回原本的尺度，艾伯纳也从昏迷中苏醒。',
              sanDelta: -5,
              nextNodeId: 'ending_triumph',
              effects: { setFlags: ['reinforced_second_seal', 'rescued_scholar'], addEvidence: ['双阵眼封印成功'], timeMinutes: 25, npcs: { scholar: { trustDelta: 40 } } },
            },
            failureOutcome: {
              levelGroup: 'failure',
              text: '逆向符号缺失了一角，第二阵眼只维持了片刻便再次崩裂。你趁着短暂的收束间隙背起艾伯纳逃离祭坛。',
              hpDelta: -5,
              nextNodeId: 'ending_escape',
              effects: { setFlags: ['failed_second_seal', 'rescued_scholar'], timeMinutes: 25, npcs: { scholar: { trustDelta: 15 } } },
            },
          },
          {
            id: 'c1_cast_seal_ritual',
            label: '冲向黑曜石祭坛中心，施展旧神星之封印！',
            description: '用理智与意志抵抗深渊凝视，将封印符文嵌入祭坛阵眼。',
            requires: { evidence: ['封印仪式公式'] },
            tag: '【意志 POW 1d100】',
            check: { rule: 'coc', skillName: '意志', targetValue: 70 },
            successOutcome: {
              levelGroup: 'success',
              text: '你高举护符，迎着呼啸的虚空狂风咬破舌尖保持清醒！伴随着古老言灵的律动，一道炫目的璀璨银光自祭坛冲天而起，触须在光芒中发出凄厉的惨叫，虚空裂隙被硬生生合拢！',
              sanDelta: -3,
              nextNodeId: 'ending_triumph',
              effects: { setFlags: ['sealed_the_rift'], addEvidence: ['成功封印裂隙'], timeMinutes: 20 },
              companionSpeech: {
                agentId: 'gaming-koko',
                text: '光！看啊！好耀眼的光芒！！裂缝关上了！我们赢了！！呜呜呜太帅了！！',
              },
            },
            failureOutcome: {
              levelGroup: 'failure',
              text: '深渊的威压远超凡人想象！不可名状的宇宙真相如排山倒海般冲刷着你的神经，你跪倒在祭坛前，思维陷入了万劫不复的混沌迷狂……',
              sanDelta: -30,
              hpDelta: -6,
              nextNodeId: 'ending_frenzy',
              effects: { setFlags: ['failed_the_seal'], timeMinutes: 20 },
              companionSpeech: {
                agentId: 'gaming-lulu',
                text: '喂！！醒醒！别看它的眼睛啊啊啊！！……可恶，来不及了吗……',
              },
            },
            criticalSuccessBonus: {
              text: '传奇大成功！不仅完美封印了眷族，旧神的光辉更反哺了你的心智，洗净了所有不可名状的污秽！',
              sanDelta: 20,
              hpDelta: 6,
            },
            fumblePenalty: {
              text: '绝望大失败！祭坛发生虚空内爆，现实法则彻底崩坏，你整个人被卷入了冰冷未知的深渊奇点……',
              sanDelta: -50,
              hpDelta: -20,
            },
          },
          {
            id: 'c2_rescue_and_dynamite',
            label: '背起学者艾伯纳，点燃随身雷管炸塌地窖穹顶！',
            description: '以凡人之力对抗神迹，用烈性炸药物理隔绝深渊通道。',
            tag: '【敏捷闪避 1d100】',
            check: { rule: 'coc', skillName: '敏捷闪避', targetValue: 65 },
            successOutcome: {
              levelGroup: 'success',
              text: '引信在火花中嗤嗤作响！你扛起学者狂奔上楼，在千钧一发之际跃出暗门。身后伴随着轰然巨响，数十吨巨石彻底将深渊祭坛与怪物掩埋！',
              hpDelta: -2,
              nextNodeId: 'ending_escape',
              effects: { setFlags: ['buried_the_altar', 'rescued_scholar'], addEvidence: ['祭坛被掩埋'], timeMinutes: 15, npcs: { scholar: { trustDelta: 25 } } },
              companionSpeech: {
                agentId: 'gaming-nox',
                text: '炸药爆速 6800m/s，落石冲击波封锁了所有空间裂口。战术撤退非常成功，我们活下来了。',
              },
            },
            failureOutcome: {
              levelGroup: 'failure',
              text: '崩塌的碎石砸中了你的后背！剧痛让你险些昏厥，虽然勉强爬出了地窖，但重伤与毒雾让你倒在了废墟中……',
              hpDelta: -8,
              nextNodeId: 'ending_escape',
              effects: { setFlags: ['buried_the_altar'], timeMinutes: 15, npcs: { scholar: { alive: false } } },
              companionSpeech: {
                agentId: 'gaming-koko',
                text: '坚持住啊！我们已经跑出来了！救护车和支援马上就到！千万不要闭眼！',
              },
            },
          },
          {
            id: 'c3_secret_symbiosis',
            label: '👁️【禁断抉择】直面深渊不可名状意志，达成意识共生契约！',
            description: '放弃凡人的平庸伪装，以无上神髓拥抱浩瀚星辰真相。',
            requires: { flags: ['read_forbidden_text'] },
            tag: '【神秘学 1d100】',
            check: { rule: 'coc', skillName: '神秘学', targetValue: 65 },
            successOutcome: {
              levelGroup: 'success',
              text: '你不仅没有移开视线，反而将双手按在涌动的虚空原液上！狂暴的星之眷族在你的精神共鸣下停止了破坏，祂的意志如甘露般灌入你的颅腔。你没有疯，你进化了——现实在你眼中变成了可被重写的线条！',
              sanDelta: -20,
              hpDelta: 10,
              nextNodeId: 'ending_secret_pact',
              effects: { setFlags: ['accepted_the_abyss'], timeMinutes: 10 },
              companionSpeech: {
                agentId: 'gaming-nox',
                text: '神经信号未崩溃……相反，脑波频率呈现非欧几何量子态。你成为了跨维度的共生宿主。',
              },
            },
            failureOutcome: {
              levelGroup: 'failure',
              text: '凡人的脑髓根本无法承载虚空之海！狂暴的信息流瞬间烧毁了你的神经中枢，你在惨笑中被深渊同化为一具傀儡……',
              sanDelta: -40,
              nextNodeId: 'ending_frenzy',
              effects: { setFlags: ['lost_to_the_abyss'], timeMinutes: 10 },
            },
          },
          {
            id: 'c4_martyr_charge',
            label: '🕯️【悲壮牺牲】将所有燃料与护符抱入怀中，冲向虚空核心舍身同烬！',
            description: '用凡人之躯为世界筑起最后一道堤坝，让学者带着真相逃离。',
            tag: '【体质/力量 1d100】',
            check: { rule: 'coc', skillName: '体质', targetValue: 65 },
            successOutcome: {
              levelGroup: 'success',
              text: '你将艾伯纳学者一把推出了神庙大门，反手锁死了唯一的精钢闸门。在漫天触须缠绕上来的刹那，你毅然引爆了所有的高爆燃料与银质圣徽！神圣的炽白烈焰彻底吞噬了一切黑暗！',
              hpDelta: -99,
              nextNodeId: 'ending_martyr',
              companionSpeech: {
                agentId: 'gaming-lulu',
                text: '笨蛋！你……你干嘛把门锁上啊！快开门啊呜呜呜……别丢下我一个人……',
              },
            },
            failureOutcome: {
              levelGroup: 'failure',
              text: '引爆被触须的强酸黏液阻隔了片刻，虽然爆炸依然摧毁了祭坛，但你也遭受了撕心裂肺的酷刑……',
              hpDelta: -99,
              nextNodeId: 'ending_martyr',
            },
          },
        ],
      },

      // ---------------- 多重终局 ----------------
      // 1. True Ending: 传奇凯旋
      ending_triumph: {
        id: 'ending_triumph',
        title: '终局：破晓晨光与星之守护者',
        location: '布莱克伍德庄园外 · 黎明山岗',
        environmentAtmosphere: '🌅 乌云散去 · 金色朝阳洒满大地',
        bgGradient: 'from-amber-950 via-slate-900 to-emerald-950',
        narration:
          '当第一缕晨曦刺破翻滚的铅灰色浓云，古宅内所有的异响与寒气已烟消云散。学者艾伯纳苏醒过来，握住你的手老泪纵横。庄园的地下封印已然加固，黑石镇恢复了宁静。你将《旧神星印残卷》锁入金属匣内，作为一名真正直面过深渊并凯旋的调查员，你的传奇将在阿卡姆的隐秘卷宗中被永世传唱。',
        isEnding: true,
        endingType: 'triumph',
        endingTitle: '🏆 传奇凯旋 · 星之守护者 (True Ending)',
        choices: [],
      },

      // 2. Normal Ending: 艰难生还
      ending_escape: {
        id: 'ending_escape',
        title: '终局：废墟余烬与幸存者的沉默',
        location: '远眺布莱克伍德庄园 · 归途列车',
        environmentAtmosphere: '🌫️ 晨雾袅袅 · 古宅化为滚滚灰烬',
        bgGradient: 'from-slate-900 via-stone-900 to-indigo-950',
        narration:
          '随着剧烈的爆炸，耸立百年的布莱克伍德古宅在一片火海中崩塌陷落，深埋于地底。你和幸存的艾伯纳学者坐在颠簸的归途列车上，谁也没有再提及昨夜地窖里的恐惧。你凝视着窗外飞逝的原野，怀表依然在规律地滴答作响。你深知，有些秘密不该被揭开，而你带回了一条珍贵的生命。',
        isEnding: true,
        endingType: 'escape',
        endingTitle: '🛡️ 艰难生还 · 破晓余烬 (Normal Ending)',
        choices: [],
      },

      // 3. Secret Ending: 禁断共生者
      ending_secret_pact: {
        id: 'ending_secret_pact',
        title: '终局：禁忌觉醒 · 深渊代行者',
        location: '阿卡姆古宅之巅 · 永恒星空之下',
        environmentAtmosphere: '🌌 群星列宿倒映于瞳仁 · 现实维度的掌控者',
        bgGradient: 'from-purple-950 via-slate-950 to-teal-950',
        narration:
          '暴风雨停歇了，但你眼中的世界已彻底改变。凡人所见的石墙与尘土，在你眼中只是一串串颤抖的弦。你静静伫立在庄园塔尖，星之眷族的低语不再是疯狂的梦呓，而是宇宙宏大律动的诗篇。你没有成为祭品，而是成为了虚空在物质界的代行者。阿卡姆的迷雾中，一个超凡的新神悄然诞生……',
        isEnding: true,
        endingType: 'secret',
        endingTitle: '👁️ 禁忌觉醒 · 深渊共生者 (Secret Ending)',
        choices: [],
      },

      // 4. Martyr Ending: 悲壮牺牲
      ending_martyr: {
        id: 'ending_martyr',
        title: '终局：永夜守望者 · 破晓前的绝响',
        location: '黑石庄园残垣 · 烈士纪念碑前',
        environmentAtmosphere: '🕯️ 微风拂过白花 · 守秘人脱帽致哀',
        bgGradient: 'from-stone-950 via-slate-900 to-amber-950',
        narration:
          '艾伯纳学者活了下来，并向调查协会带回了完整的报告。在报告的最后一页，用颤抖的笔迹写满了你的名字。你用最壮烈的决绝将不可名状的恐怖关回了虚空，阿卡姆的清晨依然如期到来，人们在阳光下漫步、欢笑，无人知晓昨夜曾有一位英雄在冰冷的黑石庄园地底，用生命阻挡了世界的终焉。',
        isEnding: true,
        endingType: 'martyr',
        endingTitle: '🕯️ 悲壮牺牲 · 永夜守望者 (Martyr Ending)',
        choices: [],
      },

      // 5. Bad Ending: 永恒狂乱
      ending_frenzy: {
        id: 'ending_frenzy',
        title: '终局：狂笑深渊与星空祭礼',
        location: '阿卡姆圣玛丽精神病院 · 铁栅囚室',
        environmentAtmosphere: '🌌 无尽的星空幻象 · 疯癫诡异的咯咯笑声',
        bgGradient: 'from-purple-950 via-black to-rose-950',
        narration:
          '几天后，搜救队在坍塌的古宅废墟中找到了你。你的身体完好无损，但瞳孔中倒映着任何凡人都不曾见过的瑰丽星云。你不停地在白墙上用指甲刻划着未知的星轨，咯咯地对着虚空狂笑。医生们叹息着关上了铁门，但只有你知道——祂们已经醒来，群星已经归位……',
        isEnding: true,
        endingType: 'frenzy',
        endingTitle: '💀 永恒狂乱 · 深渊信徒 (Bad Ending)',
        choices: [],
      },
    },
  },

  // -------------------------------------------------------------------------
  // 2. 龙与地下城：遗忘矿坑的龙吼（矮人铁匠营救 + 屠龙/龙语霸主/怪盗秘宝）
  // -------------------------------------------------------------------------
  {
    id: 'dnd_forgotten_mine',
    title: '遗忘矿坑的龙吼',
    system: 'dnd',
    systemName: 'D&D 5e 地牢探险',
    genre: '奇幻剑与魔法 · 地牢闯关',
    difficulty: '入门',
    coverIcon: '🐉',
    tagline: '“锈蚀矿镐敲不开命运的锁链，但一把锋利的秘银重剑与一颗无畏的心可以！”',
    description: '矮人古代王国留下的焰心深渊矿坑重见天日。无冬城传来紧急委托，矿坑深处苏醒了一头幼年红龙，熔岩正在吞噬矿脉。勇士，拔出你的武器，掷出你的宿命 D20！',
    themeColor: 'from-amber-950 via-stone-900 to-orange-950',
    characterPresets: [
      {
        id: 'hero-valan',
        name: '瓦兰 · 晨曦之盾',
        className: '风暴圣骑士',
        avatar: '🛡️',
        description: '身披重型板甲，手持炽光战锤，誓言守护正义与队友。',
        hp: 24,
        maxHp: 24,
        luck: 3,
        stats: { str: 16, dex: 10, con: 16, int: 10, wis: 14, cha: 14 },
        skills: { 力量athletics: 3, 威吓intimidate: 2, 洞察insight: 2 },
        inventory: ['镀金圣徽战锤', '矮人重钢塔盾', '初级治疗药水', '初级治疗药水'],
      },
      {
        id: 'hero-lilith',
        name: '莉莉丝 · 影舞者',
        className: '暗影游侠',
        avatar: '🏹',
        description: '出没于暗影之中的致命神射手，精通机关拆除与潜行刺杀。',
        hp: 18,
        maxHp: 18,
        luck: 3,
        stats: { str: 10, dex: 18, con: 12, int: 14, wis: 14, cha: 10 },
        skills: { 敏捷stealth: 4, 巧手thievery: 4, 察觉perception: 3 },
        inventory: ['精工复合猎弓', '暗影淬毒匕首', '精钢撬锁套件', '初级治疗药水'],
      },
      {
        id: 'hero-karl',
        name: '卡尔 · 烈焰编织者',
        className: '塑能学派法师',
        avatar: '🧙‍♂️',
        description: '操纵奥术洪流与元素护盾的施法者，学识渊博。',
        hp: 14,
        maxHp: 14,
        luck: 3,
        stats: { str: 8, dex: 14, con: 12, int: 18, wis: 12, cha: 12 },
        skills: { 奥秘arcana: 4, 历史history: 4, 调查investigation: 3 },
        inventory: ['星木法杖', '法术书 (火球术/护盾术)', '法力水晶', '初级治疗药水'],
      },
    ],
    startNodeId: 'dnd_entrance',
    nodes: {
      // 第一幕：断裂吊桥与哥布林暗哨
      dnd_entrance: {
        id: 'dnd_entrance',
        title: '第一幕：断裂吊桥与哥布林埋伏',
        location: '锈蚀山脉 · 焰心矿坑坑道入口',
        environmentAtmosphere: '🔥 空气中弥漫着硫磺味 · 坑道深处隐隐回荡着低沉龙吟',
        bgGradient: 'from-stone-950 via-amber-950 to-stone-900',
        narration:
          '穿过锈迹斑斑的矮人钢铁闸门，眼前是一道宽达数十尺的地下断崖深渊，下方滚滚流淌着暗红色的地热岩浆。连接两端的唯一路径是一座摇摇欲坠的铁索木板吊桥。吊桥对岸搭建着哥布林的粗陋箭塔，三只涂着战漆的哥布林哨兵正拉满骨弓，瞄准了你的胸膛！而在断崖侧面的岩隙中，隐约传来矮人的咒骂声与铁链抽打声。',
        choices: [
          {
            id: 'd1_shield_charge',
            label: '举起盾牌发起雷霆冲锋，强行突破吊桥！',
            description: '依靠千锤百炼的强悍体魄与力量，格挡箭矢撞碎箭塔。',
            tag: '【力量冲锋 DC 13】',
            check: { rule: 'dnd', skillName: '力量冲锋', dc: 13, modifierStat: 'str' },
            successOutcome: {
              levelGroup: 'success',
              text: '你如同一枚重装炮弹般冲过摇晃的吊桥！哥布林的骨箭在你的盾牌上迸出火星弹开，轰然一声，你直接撞塌了箭塔，哥布林惨叫着跌入深渊！',
              nextNodeId: 'dnd_forge',
              companionSpeech: {
                agentId: 'gaming-lulu',
                text: '哇！这撞击力也太猛了吧！……咳，虽然毫无美感，但勉强算你威风一次啦！',
              },
            },
            failureOutcome: {
              levelGroup: 'failure',
              text: '吊桥的腐朽木板在重压下突然断裂！你一脚踏空，虽然凭借本能扒住铁索爬了上来，但左肩中了一记毒箭！',
              hpDelta: -5,
              nextNodeId: 'dnd_forge',
              companionSpeech: {
                agentId: 'gaming-koko',
                text: '啊啊啊中箭了！别慌别慌，我这就帮你拔箭包扎！挺住呀！',
              },
            },
            criticalSuccessBonus: {
              text: '天然 20 大成功！战锤携带神圣雷鸣将哨卡轰碎，还顺势在哥布林首领尸体上搜出了一枚【火焰抗性护符】！',
              itemGained: '火焰抗性护符',
            },
            fumblePenalty: {
              text: '天然 1 大失败！你脚底打滑直接卡在桥缝中，成为了活靶子，被乱箭射伤！',
              hpDelta: -8,
            },
          },
          {
            id: 'd1_stealth_snipe',
            label: '借助钟乳石阴影隐匿，暗影狙杀敌方哨兵',
            description: '利用精湛敏捷与远程射术，在敌方察觉前将其逐个击毙。',
            tag: '【敏捷潜行 DC 12】',
            check: { rule: 'dnd', skillName: '敏捷潜行', dc: 12, modifierStat: 'dex' },
            successOutcome: {
              levelGroup: 'success',
              text: '你宛如游荡在阴影中的鬼魅，连搭三箭，三道破空利啸精准贯穿咽喉！哥布林无声倒地，你优雅平稳地跨过了吊桥。',
              nextNodeId: 'dnd_forge',
              companionSpeech: {
                agentId: 'gaming-nox',
                text: '精准弹道，用时 2.4 秒全清暗哨，极佳的隐匿战术执行。',
              },
            },
            failureOutcome: {
              levelGroup: 'failure',
              text: '踩到了地上的碎石发出脆响！哥布林敲响了警戒铜锣，毒箭雨铺天盖地袭来，你狼狈翻滚才脱离险境。',
              hpDelta: -4,
              nextNodeId: 'dnd_forge',
            },
          },
          {
            id: 'd1_stalactite_shot',
            label: '一箭射穿崖壁钟乳石，砸塌哨卡并震开【矮人水牢】暗道',
            description: '观察岩层力学薄弱点，以巧破千斤，开辟营救友军新路线。',
            tag: '【察觉/射击 DC 12】',
            check: { rule: 'dnd', skillName: '弱点观察', dc: 12, modifierStat: 'wis' },
            successOutcome: {
              levelGroup: 'success',
              text: '破空之矢命中钟乳石最脆脆弱的结晶节！数吨重的巨型钟乳石轰然坠落，不仅将箭塔砸得粉碎，更在断崖侧壁砸开了一座水牢入口，里面的矮人呼救声清晰可闻！',
              nextNodeId: 'dnd_dwarf_prison',
              companionSpeech: {
                agentId: 'gaming-koko',
                text: '好厉害！！一箭双雕！水牢里好像真的关着被俘虏的矮人大叔！我们快去救他！',
              },
            },
            failureOutcome: {
              levelGroup: 'failure',
              text: '箭矢偏离了准星，擦出火星反弹，反而引来对岸哥布林的一轮齐射！',
              hpDelta: -3,
              nextNodeId: 'dnd_forge',
            },
          },
        ],
      },

      // 第二幕A：地底囚笼与矮人铁匠营救 (新增支线)
      dnd_dwarf_prison: {
        id: 'dnd_dwarf_prison',
        title: '第二幕·支线：地底水牢与矮人铁匠',
        location: '矿坑二层西侧 · 锈铁囚笼水牢',
        environmentAtmosphere: '⛓️ 铁索碰撞声与豺狼人磨刀声 · 弥漫着麦酒与血水气味',
        bgGradient: 'from-amber-950 via-stone-900 to-stone-950',
        narration:
          '你翻过碎石踏入水牢。水牢深处，一位须发斑白、满身肌肉的矮人符文铁匠【布鲁诺】正被沉重的秘银镣铐锁在石柱上。两只凶暴的红皮豺狼人正狞笑着挥舞带刺铁鞭逼问锻造秘密。矮人吐出一口带血的唾沫：“就算老子骨头被敲碎，也不会把破龙符文交给你们这群狗头杂碎！”',
        choices: [
          {
            id: 'd_prison_break',
            label: '怒吼拔兵，正面强袭斩杀豺狼人看守！',
            description: '以绝对武力压制恶徒，砸碎锁链救出铁匠。',
            tag: '【力量攻击 DC 13】',
            check: { rule: 'dnd', skillName: '狂怒突袭', dc: 13, modifierStat: 'str' },
            successOutcome: {
              levelGroup: 'success',
              text: '兵刃裹挟着雷霆之势将豺狼人守卫斩翻在地！战锤狠狠砸碎秘银铁锁，矮人布鲁诺重获自由！他激动地锤击胸膛：“好汉子！作为报答，老子把这柄藏在炉灰里的【矮人淬火破龙战斧】送给你！红龙肚皮下方第三片反向龙鳞，就是它的死穴！”',
              itemGained: '矮人淬火破龙战斧',
              nextNodeId: 'dnd_forge',
              companionSpeech: {
                agentId: 'gaming-nox',
                text: '获得传说级破龙战斧与致命弱点情报。在后续决战中，屠龙命中与伤害判定大幅增强。',
              },
            },
            failureOutcome: {
              levelGroup: 'failure',
              text: '豺狼人挥舞毒鞭缠住了你的武器！虽然最终击毙了恶犬，但你的手臂被倒钩撕得皮开肉绽！布鲁诺为你包扎伤口后同行。',
              hpDelta: -5,
              itemGained: '矮人淬火破龙战斧',
              nextNodeId: 'dnd_forge',
            },
          },
          {
            id: 'd_prison_lockpick',
            label: '潜行暗杀看守，精妙撬开秘银镣铐',
            description: '不发出任何声响救出矮人，并缴获豺狼人的补给。',
            tag: '【巧手敏捷 DC 12】',
            check: { rule: 'dnd', skillName: '巧手开锁', dc: 12, modifierStat: 'dex' },
            successOutcome: {
              levelGroup: 'success',
              text: '暗影匕首无声划过咽喉，你在眨眼间解开了繁琐的矮人机械锁！布鲁诺赞叹你的手艺，并在守卫营地搜出了一瓶【初级治疗药水】！随后他将王室神殿通关口令告知了你。',
              itemGained: '初级治疗药水',
              nextNodeId: 'dnd_forge',
            },
            failureOutcome: {
              levelGroup: 'failure',
              text: '开锁套件在生锈的锁芯里卡住了！你不得不费力用石头砸开，巨大的声响震得通道落石滚滚。',
              hpDelta: -2,
              nextNodeId: 'dnd_forge',
            },
          },
          {
            id: 'd_prison_sneak_past',
            label: '时间紧迫，直插前方符文锻造神殿',
            description: '直接前往神殿中枢。',
            directNextNodeId: 'dnd_forge',
            directText: '你快步穿过水牢回廊，顺着升腾着火光的盘旋台阶冲入了宏伟的矮人符文神殿。',
          },
        ],
      },

      // 第二幕B：符文神殿与古代钢铁魔像
      dnd_forge: {
        id: 'dnd_forge',
        title: '第二幕·中枢：符文神殿与古代钢铁魔像',
        location: '矮人古代锻造大厅',
        environmentAtmosphere: '⚙️ 巨大齿轮轰鸣 · 熔炉中燃烧着千年不灭的泰坦火种',
        bgGradient: 'from-amber-950 via-stone-900 to-red-950',
        narration:
          '地底空间豁然开阔。一座巍峨如山峰的古代矮人符文锻造神殿矗立在眼前。大殿中央伫立着一尊高逾三丈的精钢魔像守卫。它的胸口镶嵌着炽热的核心宝石，伴随着沉重的金属摩擦声，它的巨眼亮起红光，手中战斧重重砸向地面：“入侵者……答出锻造之誓，或受烈火裁决！”',
        choices: [
          {
            id: 'd2_dwarf_command',
            label: '👑【矮人同盟】矮人布鲁诺高唱王室密歌，唤醒魔像守护程序',
            description: '已成功救出矮人铁匠布鲁诺，王室血统令魔像完全俯首听命。',
            requiredItem: '矮人淬火破龙战斧',
            directNextNodeId: 'dnd_dragon_lair',
            directText:
              '布鲁诺高举破龙战斧，声如洪钟地唱响古矮人战歌！钢铁魔像眼中红光转为柔和金芒，巨大的钢铁身躯单膝跪地，将胸前一块【充能破龙符文石】与精钢护符双手奉上，并升起直通龙巢的精金升降梯！',
          },
          {
            id: 'd2_solve_riddle',
            label: '解析魔像身上的古代符文，诵读矮人誓词',
            description: '运用奥秘与历史学识，和平解除守卫魔像的战斗程序。',
            tag: '【智力奥秘 DC 14】',
            check: { rule: 'dnd', skillName: '奥秘解析', dc: 14, modifierStat: 'int' },
            successOutcome: {
              levelGroup: 'success',
              text: '你认出了胸口铭刻的符文：“铁骨铸心，火炼真金！”魔像眼中红光转为柔和的金芒，它单膝下跪让开通道，并将核心掉落的一块【充能破龙符文石】赠予了你！',
              itemGained: '充能破龙符文石',
              nextNodeId: 'dnd_dragon_lair',
              companionSpeech: {
                agentId: 'gaming-nox',
                text: '这就是智力的力量。不费一兵一卒获得强化 buff，破龙石对龙鳞伤害有 50% 额外加成。',
              },
            },
            failureOutcome: {
              levelGroup: 'failure',
              text: '念错了发音！魔像判定错误，双臂挥起狂暴飓风，巨大的冲击波将你震飞出数十米，胸口重重砸在石柱上！',
              hpDelta: -6,
              nextNodeId: 'dnd_dragon_lair',
              companionSpeech: {
                agentId: 'gaming-lulu',
                text: '啊啊啊！谁让你乱念咒语的！痛不痛呀……快起来，那笨铁块好像自检断电了，快溜！',
              },
            },
          },
          {
            id: 'd2_strike_core',
            label: '抢先出击，飞身跃起直刺魔像能量核心！',
            description: '不讲道理的武力裁决，在魔像蓄力完成前将其核心破坏。',
            tag: '【力量攻击 DC 15】',
            check: { rule: 'dnd', skillName: '弱点猛击', dc: 15, modifierStat: 'str' },
            successOutcome: {
              levelGroup: 'success',
              text: '战锤/箭矢裹挟着撕裂空气的破音声精准轰入核心晶石！伴随着耀眼的电流爆鸣，钢铁魔像轰然跪倒坍塌，为你清空了道路！',
              nextNodeId: 'dnd_dragon_lair',
            },
            failureOutcome: {
              levelGroup: 'failure',
              text: '坚固的附魔装甲弹开了你的攻击！魔像回敬一记铁拳，若不是护盾抵挡，几乎要将你肋骨拍断！',
              hpDelta: -7,
              nextNodeId: 'dnd_dragon_lair',
            },
          },
        ],
      },

      // 第三幕：熔岩巢穴与烈焰红龙之怒
      dnd_dragon_lair: {
        id: 'dnd_dragon_lair',
        title: '第三幕·决战：熔岩巢穴与烈焰红龙之怒',
        location: '矿坑最深处 · 炽热龙巢金库',
        environmentAtmosphere: '🌋 熔岩火海 · 如同小山般的矮人金币与闪烁的巨龙竖瞳',
        bgGradient: 'from-red-950 via-amber-950 to-stone-950',
        narration:
          '踏入最终的热浪深渊，满地都是流淌的金币、秘银甲胄与璀璨的各色宝石。而在这座金币山丘顶端，盘踞着一头双翼展开达二十米的红龙幼主【萨格洛斯】！它缓缓昂起狰狞的头颅，赤金色的竖瞳带着俯瞰蝼蚁的威压，喉咙深处已然亮起毁灭一切的吐息烈焰：“可怜的凡人……妄图盗取属于巨龙的财宝吗？化为焦炭吧！”',
        choices: [
          {
            id: 'd3_slay_dragon',
            label: '借势冲顶，迎着滔天龙炎挥出终结之刃！',
            description: '将全部信念注入兵刃，斩断龙角直刺心脏！',
            tag: '【终极力量 DC 15】',
            check: { rule: 'dnd', skillName: '屠龙之击', dc: 15, modifierStat: 'str' },
            successOutcome: {
              levelGroup: 'success',
              text: '你腾空跃起，在漫天烈焰中如同一道不灭的流光！破龙兵刃狠狠轰入红龙心脏弱点！红龙发出震天动地的悲鸣轰然倒地，龙威溃散！你完成了凡人屠龙的传奇壮举！',
              itemGained: '传奇赤龙之心',
              nextNodeId: 'dnd_ending_legend',
              companionSpeech: {
                agentId: 'gaming-koko',
                text: '芜湖！！！屠龙勇士诞生啦！！！这可是真正的龙啊！我要在整个费伦大陆到处宣传你的名字！！',
              },
            },
            failureOutcome: {
              levelGroup: 'failure',
              text: '灼热的龙炎吐息将你的防御尽数融化！虽然你重创了红龙的一只翅膀，但也被扫飞摔落金币堆，生命垂危……',
              hpDelta: -12,
              nextNodeId: 'dnd_ending_escape',
              companionSpeech: {
                agentId: 'gaming-lulu',
                text: '喂！撑住啊！别死啊笨蛋！龙已经被你打跑了……快喝治疗药水啊呜呜呜！',
              },
            },
            criticalSuccessBonus: {
              text: '天然 20 传奇屠龙！一击斩下龙头，整座龙巢的宝藏与【传奇赤龙之心】尽归你所有！',
              itemGained: '传奇赤龙之心',
              hpDelta: 10,
            },
            fumblePenalty: {
              text: '天然 1 大绝望！脚底金币滑坡，正面硬吃了毁灭龙息……',
              hpDelta: -25,
            },
          },
          {
            id: 'd3_dragon_pact',
            label: '以古龙语和无双霸气，同红龙缔结荣耀契约',
            description: '以利益与强者尊严交涉，不战而屈人之兵。',
            tag: '【魅力交涉 DC 14】',
            check: { rule: 'dnd', skillName: '龙之交涉', dc: 14, modifierStat: 'cha' },
            successOutcome: {
              levelGroup: 'success',
              text: '你毫无惧色地直视龙瞳，以威严的龙语提出了互惠誓约：为其提供无冬城的供奉，而红龙将成为你的守护盟友！巨龙收敛烈焰，发出了赞许的长啸！',
              nextNodeId: 'dnd_ending_diplomat',
              companionSpeech: {
                agentId: 'gaming-nox',
                text: '最高明的统帅。将敌方最具威胁的终极战力转化为最强大的战略盟友，满分决策。',
              },
            },
            failureOutcome: {
              levelGroup: 'failure',
              text: '幼龙暴躁地嘲弄凡人的虚伪，一尾扫来将你掀翻在地，你不得不拼死拖着重伤夺路狂奔！',
              hpDelta: -8,
              nextNodeId: 'dnd_ending_escape',
            },
          },
          {
            id: 'd3_phantom_heist',
            label: '💰【神偷怪盗】借金币滑坡溜到巨龙腹底，窃走龙蛋与古代卷轴！',
            description: '不硬拼蛮力，用神乎其神的盗贼身手将至宝神不知鬼不觉卷走。',
            tag: '【敏捷巧手 DC 14】',
            check: { rule: 'dnd', skillName: '敏捷盗宝', dc: 14, modifierStat: 'dex' },
            successOutcome: {
              levelGroup: 'success',
              text: '你如同一缕青烟滑过炽热的金币斜坡！在巨龙昂首咆哮的间隙，你轻灵地将发光的【赤龙蛋】与矮人至高【泰坦铸造卷轴】塞入空间背包，并顺着通风竖井潇洒脱身！',
              itemGained: '赤龙蛋与泰坦铸造卷轴',
              nextNodeId: 'dnd_ending_phantom_thief',
              companionSpeech: {
                agentId: 'gaming-koko',
                text: '天哪！！你竟然在龙眼皮子底下把龙蛋给偷出来了！太刺激了！这拿去拍卖行能买下一整座城！',
              },
            },
            failureOutcome: {
              levelGroup: 'failure',
              text: '金币碰擦的声响惊动了红龙！巨爪拍下激起漫天熔岩，你虽然抢下一包金币，但后背被严重烫伤！',
              hpDelta: -9,
              nextNodeId: 'dnd_ending_escape',
            },
          },
          {
            id: 'd3_blast_lava_dam',
            label: '射碎岩浆蓄水坝，引地下暗河水形成蒸汽爆炸突围！',
            description: '利用水火相克的物理法则，掀起漫天蒸汽掩护撤退。',
            tag: '【体质/力量 DC 13】',
            check: { rule: 'dnd', skillName: '爆破应变', dc: 13, modifierStat: 'con' },
            successOutcome: {
              levelGroup: 'success',
              text: '冰冷的地底暗河如巨蟒般倒灌入沸腾的岩浆湖！千万立方米的白色蒸汽瞬间吞没龙穴，巨龙被烫得狂怒咆哮却难辨方向。你从容扛起重伤的战友突围而出！',
              nextNodeId: 'dnd_ending_escape',
            },
            failureOutcome: {
              levelGroup: 'failure',
              text: '蒸汽冲击波反噬了洞口！你被狂暴的热浪掀飞，虽然冲出了洞穴，但防护甲胄全被烧毁。',
              hpDelta: -7,
              nextNodeId: 'dnd_ending_escape',
            },
          },
        ],
      },

      // ---------------- 多重终局 ----------------
      // 1. True Ending: 传奇屠龙者
      dnd_ending_legend: {
        id: 'dnd_ending_legend',
        title: '终局：无冬城的传奇屠龙骑士',
        location: '无冬城大圣堂 · 授勋广场',
        environmentAtmosphere: '🎺 凯旋号角高鸣 · 漫天飞舞的鲜花与欢呼',
        bgGradient: 'from-amber-950 via-stone-900 to-yellow-950',
        narration:
          '你带着红龙之首与矮人王国的远古秘宝踏出矿坑。无冬城领主亲自出迎，全城百姓在街头为你唱响英雄赞歌。你被册封为王国的终身名誉领主与龙裔护卫队长，酒馆里到处传唱着你在熔岩龙巢掷出致命一击的豪迈史诗！',
        isEnding: true,
        endingType: 'triumph',
        endingTitle: '🏆 传奇屠龙者 · 王国守护神 (True Ending)',
        choices: [],
      },

      // 2. Epic Ending: 龙语领主
      dnd_ending_diplomat: {
        id: 'dnd_ending_diplomat',
        title: '终局：龙骑霸主与双生王座',
        location: '锈蚀山脉绝顶 · 龙吼峰',
        environmentAtmosphere: '🌪️ 狂风怒号 · 红龙振翅伴于左右',
        bgGradient: 'from-red-950 via-stone-900 to-amber-950',
        narration:
          '你没有成为屠夫，而是成为了自古以来第一位驾驭红龙的龙语领袖。萨格洛斯视你为唯一的知己与战友。当你的身影出现在山巅，群山之中的部落与王国无不对你低头致敬。一段全新的人龙盟约纪元因你而启！',
        isEnding: true,
        endingType: 'triumph',
        endingTitle: '👑 龙语领主 · 荣耀缔约者 (Epic Ending)',
        choices: [],
      },

      // 3. Secret Ending: 虚空魅影神偷
      dnd_ending_phantom_thief: {
        id: 'dnd_ending_phantom_thief',
        title: '终局：虚空魅影与富可敌国之誓',
        location: '深水城 · 影子盗贼公会最高圣所',
        environmentAtmosphere: '💰 宝石耀眼生辉 · 孵化中的红龙幼崽散发着温热金光',
        bgGradient: 'from-emerald-950 via-slate-900 to-amber-950',
        narration:
          '在红龙疯狂的咆哮声中，你早已消失得无影无踪。谁能想到，不仅是全大陆梦寐以求的泰坦卷轴，连红龙最珍贵的后代都成了你的囊中之物！在深水城的黑市与贵族圈，你的名字成为了不可捉摸的传奇怪盗。多年后，当你骑着亲自孵化长大的赤龙现身天际，整个世界将再度为你屏息！',
        isEnding: true,
        endingType: 'secret',
        endingTitle: '💰 虚空魅影 · 龙金神偷 (Secret Ending)',
        choices: [],
      },

      // 4. Normal Ending: 艰难生还
      dnd_ending_escape: {
        id: 'dnd_ending_escape',
        title: '终局：余烬逃生与重生的誓言',
        location: '矿山外扎营地 · 篝火前',
        environmentAtmosphere: '🔥 寂静荒野 · 缠满绷带但眼神坚毅',
        bgGradient: 'from-stone-950 via-slate-900 to-amber-950',
        narration:
          '虽然身负重伤、满身焦黑，但你凭借着惊人的毅力活着拖着队友爬出了正在塌陷的矿道。你在篝火旁咽下麦酒，检查着怀里拼死带出的古代秘银矿石。你活了下来，而所有未能杀死你的，都将化作下一次重返龙巢、拔剑决胜的无尽力量！',
        isEnding: true,
        endingType: 'escape',
        endingTitle: '🛡️ 浴火余生 · 誓言重临 (Normal Ending)',
        choices: [],
      },
    },
  },

  // -------------------------------------------------------------------------
  // 3. 赛博朋克：赛博雨夜 · 荒坂密档
  // -------------------------------------------------------------------------
  {
    id: 'cyber_night_city',
    title: '赛博雨夜 · 荒坂密档',
    system: 'coc',
    systemName: '赛博朋克 2077 规则',
    genre: '赛博朋克 · 黑客潜行特工',
    difficulty: '硬核炼狱',
    coverIcon: '⚡',
    tagline: '“夜之城没有活着的传奇，但今晚，你会把荒坂的防火墙烧成灰烬。”',
    description: '狗镇边缘暴雨倾盆，一架运送未知军工级 AI 原型的荒坂武装浮空车坠毁在高架立交桥。你是接下委托的独狼佣兵，潜入、破译、带货突围，别死在暴恐机动队赶来之前！',
    themeColor: 'from-cyan-950 via-slate-950 to-fuchsia-950',
    characterPresets: [
      {
        id: 'cyber-v7',
        name: 'V-7 · 幽灵黑客',
        className: '网络游侠 (Netrunner)',
        avatar: '💻',
        description: '搭载军工科技神经调制解调器与黑客义眼，在赛博空间翻江倒海。',
        hp: 14,
        maxHp: 14,
        san: 70,
        maxSan: 80,
        luck: 3,
        stats: { str: 45, dex: 65, int: 85, con: 55, pow: 70 },
        skills: { 黑客入侵: 80, 侦查: 70, 潜行: 65, 战术枪械: 50 },
        inventory: ['军用级接入仓', '军用斯安威斯坦试剂', '电磁干扰手雷', '消音动能手枪'],
      },
      {
        id: 'cyber-psycho',
        name: '克劳德 · 钢铁暴徒',
        className: '重装街头武侍 (Solo)',
        avatar: '🦾',
        description: '浑身搭载斯安威斯坦与钛合金骨骼，近身肉搏宛若人形推土机。',
        hp: 22,
        maxHp: 22,
        san: 55,
        maxSan: 70,
        luck: 3,
        stats: { str: 80, dex: 70, int: 50, con: 80, pow: 55 },
        skills: { 格斗: 80, 战术枪械: 75, 敏捷闪避: 70, 侦查: 55 },
        inventory: ['高频热能螳螂刀', '重型喷子“屠夫”', '充能军用注射剂', '充能军用注射剂'],
      },
    ],
    startNodeId: 'cyber_crash_site',
    nodes: {
      cyber_crash_site: {
        id: 'cyber_crash_site',
        title: '第一幕：暴雨立交与巡逻机械犬',
        location: '夜之城外围 · 坠毁浮空车立交桥',
        environmentAtmosphere: '🌧️ 霓虹倒影闪烁 · 浓烟、机油味与警报红光',
        bgGradient: 'from-cyan-950 via-slate-950 to-purple-950',
        narration:
          '酸雨打在你的风衣上，发出噼啪声响。坠毁的浮空车机翼冒着刺目的蓝白色电火花，残骸四周两只荒坂最新型的“百眼”武装机械犬正在来回巡逻，红外扫描线在雨雾中织成密不透风的死亡警戒网。主驾驶舱的军用级加密服务器还在进行自我销毁倒计时：03:42……',
        choices: [
          {
            id: 'c_hack_dogs',
            label: '远程接入机械犬局域网，上传【系统过载】病毒',
            description: '黑入巡逻机械体底层代码，令其自相残杀瘫痪。',
            tag: '【黑客入侵 1d100】',
            check: { rule: 'coc', skillName: '黑客入侵', targetValue: 75 },
            successOutcome: {
              levelGroup: 'success',
              text: '你的义眼泛起幽蓝荧光！代码洪流如手术刀般切断了机械犬的加密信道，两只机械犬瞬间短路冒烟瘫痪！你轻松掠过警戒线跳入驾驶舱。',
              nextNodeId: 'cyber_core',
              companionSpeech: {
                agentId: 'gaming-nox',
                text: '用时 1.8 秒瘫痪哨兵网络，没有触发荒坂中央告警。执行效率达到 S 级。',
              },
            },
            failureOutcome: {
              levelGroup: 'failure',
              text: '对方装有荒坂自适应黑冰！强烈的神经反冲如重锤般撞击你的脑神经，机械犬瞬间索敌，车载机枪朝你疯狂扫射！',
              hpDelta: -5,
              sanDelta: -4,
              nextNodeId: 'cyber_core',
              companionSpeech: {
                agentId: 'gaming-lulu',
                text: '啊啊啊脑子要烧焦了啦！笨蛋快找掩体！子弹把衣服都打烂了！',
              },
            },
            criticalSuccessBonus: {
              text: '大成功！不仅夺取了机械犬权限，还让其反向搜出了浮空车军火箱里的【军用斯安威斯坦试剂】！',
              itemGained: '军用斯安威斯坦试剂',
            },
            fumblePenalty: {
              text: '大失败！黑冰直接反噬义体，神经系统濒临过载崩溃！',
              hpDelta: -8,
              sanDelta: -10,
            },
          },
          {
            id: 'c_mantis_blitz',
            label: '开启光学迷彩，拔出螳螂刀斩碎巡逻机甲！',
            description: '不搞花哨的，用纯粹的速度与纳米利刃斩开防线。',
            tag: '【潜行格斗 1d100】',
            check: { rule: 'coc', skillName: '潜行', targetValue: 65 },
            successOutcome: {
              levelGroup: 'success',
              text: '雨滴在半空中被切成两段！你以肉眼无法捕捉的高速掠过，螳螂刀带起炽热火光，两尊机械犬在轰鸣声中身首异处！',
              nextNodeId: 'cyber_core',
            },
            failureOutcome: {
              levelGroup: 'failure',
              text: '光学迷彩在酸雨中短路闪烁！机枪擦过你的肩膀，虽然解决了机械犬，但你也挂了彩。',
              hpDelta: -4,
              nextNodeId: 'cyber_core',
            },
          },
        ],
      },

      cyber_core: {
        id: 'cyber_core',
        title: '第二幕：量子核心与赛博空间死斗',
        location: '浮空车残骸 · 军用量子机房',
        environmentAtmosphere: '⚡ 液氮泄漏冷气 · 虚幻数据洪流在视网膜上狂乱投影',
        bgGradient: 'from-fuchsia-950 via-slate-950 to-cyan-950',
        narration:
          '你破开防爆门。核心控制台上悬浮着一块通体晶莹、正流转着金色数据符文的芯片——荒坂最新型强人工智能原型【Nemesis】。当你伸手触碰插槽的刹那，AI 自卫程序启动，你的意识被强行拖入由纯粹几何算力构建的深红赛博深渊，一个顶天立地的数码死神正高举数据镰刀斩落！',
        choices: [
          {
            id: 'c_breach_ai',
            label: '以意志为刃，正面攻破深红死神算力核心！',
            description: '在赛博空间进行纯粹的意志与算力对决，强行驯服 AI。',
            tag: '【意志 POW 1d100】',
            check: { rule: 'coc', skillName: '意志', targetValue: 70 },
            successOutcome: {
              levelGroup: 'success',
              text: '你在意识深渊中筑起不灭的防火墙！数据镰刀在接触你的瞬间崩碎为漫天金色光雨。原型 AI 认同了你的权限，芯片被安全弹出，落入你的掌心！',
              itemGained: '原型 AI【Nemesis】核心芯片',
              nextNodeId: 'cyber_ending_legend',
              companionSpeech: {
                agentId: 'gaming-koko',
                text: '哇塞！！金色传说！那漫天的数据流简直像烟花一样！你简直是黑客之神！',
              },
            },
            failureOutcome: {
              levelGroup: 'failure',
              text: '可怕的赛博精神错乱冲击几乎烧毁你的额叶！你狂喷一口鲜血硬生生扯断神经插管，虽然夺下了芯片，但脑组织遭受严重创伤！',
              hpDelta: -6,
              sanDelta: -15,
              nextNodeId: 'cyber_ending_legend',
            },
            criticalSuccessBonus: {
              text: '大成功！完美融合 AI 算法，你的黑客入侵技能永久提升 10 点，且额外获得 200,000 匿名信用点！',
              itemGained: '传奇协议：神级后门',
            },
            fumblePenalty: {
              text: '大失败！赛博精神病彻底爆发，在无尽的电光幻象中你的意识被格式化……',
              hpDelta: -20,
              sanDelta: -30,
            },
          },
        ],
      },

      cyber_ending_legend: {
        id: 'cyber_ending_legend',
        title: '终局：夜之城活着的传奇',
        location: '来生酒吧 (Afterlife) · 专属卡座',
        environmentAtmosphere: '🍸 霓虹酒光 · 调酒师将一杯以你命名的鸡尾酒推至面前',
        bgGradient: 'from-amber-950 via-purple-950 to-slate-950',
        narration:
          '暴恐机动队的浮空车抵达坠毁现场时，除了一地废铁与烧毁的电路，什么也没留下。此刻，在夜之城最著名的佣兵圣殿【来生酒吧】，调酒师克莱尔将一杯加了龙舌兰与辣椒粉的深红烈酒推到你面前：“敬今晚的胜利者……这杯酒，以你的名字命名。”你晃动酒杯，芯片安稳地躺在口袋里，夜之城又诞生了一个活着的传奇！',
        isEnding: true,
        endingType: 'triumph',
        endingTitle: '👑 夜之城活着的传奇 · 来生不朽 (Legend Ending)',
        choices: [],
      },
    },
  },
];

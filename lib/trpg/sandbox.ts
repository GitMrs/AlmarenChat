/**
 * TRPG 开放式沙盘世界模型与守秘人动态推理裁决引擎
 * 核心设计：
 * 1. 彻底打破预制死板选项树，以「自由行动宣言」为第一公民核心
 * 2. 维护布莱克伍德古宅空间物理沙盘（空间地图、可交互实体、动态线索网、末日异象侵蚀钟）
 * 3. 守秘人根据玩家描述的智慧（RP、工具利用、隐蔽细节）动态给予加值/减值，实时推演真实后果
 * 4. 每轮由 DM 动态生成 2~3 个场景灵感行动建议 (Inspiration Suggestions)
 */

import type { SkillCheckResult, CheckLevel } from './dice.ts';
import { evaluateCocCheck } from './dice.ts';
import type { ScenarioCharacterPreset } from './scenarios.ts';

export interface SandboxInteractable {
  name: string;
  keywords: string[];
  description: string;
  clueId?: string;
  clueText?: string;
  itemGiven?: string;
  requiresItem?: string;
  hpDelta?: number;
  sanDelta?: number;
}

export interface SandboxRoom {
  id: string;
  name: string;
  area: string;
  atmosphere: string;
  narration: string;
  exits: Record<string, string>; // 比如 '二楼': 'study', '宴会厅': 'dining_hall'
  interactables: SandboxInteractable[];
  defaultSuggestions: string[];
}

export interface SandboxActionEvaluation {
  actionText: string;
  intent: 'inspect' | 'move' | 'use_item' | 'combat' | 'stealth' | 'talk' | 'ritual' | 'creative';
  targetRoomId?: string;
  requiresCheck: boolean;
  checkRule?: 'coc' | 'dnd';
  skillName?: string;
  baseTargetValue?: number;
  bonusModifier?: number;
  bonusReason?: string;
  targetDC?: number;
  directNarration?: string;
  hpDelta?: number;
  sanDelta?: number;
  itemGained?: string;
  itemLost?: string;
  clueDiscovered?: { id: string; title: string; text: string };
  tensionDelta?: number;
  companionReaction?: {
    agentId: 'gaming-lulu' | 'gaming-koko' | 'gaming-nox';
    text: string;
  };
  newSuggestions?: string[];
}

/**
 * 布莱克伍德古宅开放式沙盘全场景定义
 */
export const BLACKWOOD_SANDBOX_ROOMS: Record<string, SandboxRoom> = {
  foyer: {
    id: 'foyer',
    name: '门厅玄关',
    area: '古宅一层 · 前厅',
    atmosphere: '🌧️ 窗外电闪雷鸣 · 潮湿刺鼻的深海盐卤味',
    narration:
      '你推开沉重的雕花橡木大门。外面的狂风暴雨被隔绝在身后，大厅内部死寂阴冷。地面铺着浸透泥泞的波斯地毯，奇怪的深海黏液混杂着发黑血迹一路蜿蜒。一座巨大的老式黄铜座钟矗立在楼梯转角，壁炉里尚有暗红余烬，西侧通向宴会大厅，东侧水晶门通往温室画廊，正前方木质回旋楼梯通往二楼私人书斋。',
    exits: {
      '二楼': 'study',
      '书斋': 'study',
      '书房': 'study',
      '楼上': 'study',
      '西': 'dining_hall',
      '宴会厅': 'dining_hall',
      '东': 'greenhouse',
      '温室': 'greenhouse',
      '画廊': 'greenhouse',
      '门外': 'courtyard',
      '庭院': 'courtyard',
    },
    interactables: [
      {
        name: '停摆座钟',
        keywords: ['座钟', '钟', '时钟', '指针', '表', '时针', '分针'],
        description: '黄铜座钟的指针逆向颤动停留在 11点47分，磁场极不稳定，钟摆背面刻有微小的非欧几何凹槽。',
        clueId: 'clue_clock',
        clueText: '座钟指针停在 11:47 是由于庄园地底的虚空裂隙正在扭曲周遭时空，逆行符文昭示着午夜正是星辰归位之时。',
      },
      {
        name: '泥泞血迹与地毯',
        keywords: ['地毯', '泥泞', '血迹', '脚印', '足迹', '地面', '地板', '地'],
        description: '地毯上的发黑脚印有着明显的蹼足特征，两步之间间距极大且拖沓。翻开踢脚线夹层，一枚冰凉的雕花铜钥匙滚落出来！',
        clueId: 'clue_webbed_feet',
        clueText: '脚印残留深海两栖黏液，逃跑者处于深潜者异化晚期；遗落的黄铜钥匙刻有黑石家族徽记。',
        itemGiven: '雕花铜钥匙',
      },
      {
        name: '壁炉余烬与火钳',
        keywords: ['壁炉', '火钳', '余烬', '铁钳', '炭火', '柴火'],
        description: '壁炉灰烬里散落着撕碎的羊皮纸残页。壁炉旁斜靠着一柄沉甸甸的纯铜防火钳，手感扎实，是极好的防身钝器。',
        itemGiven: '黄铜火钳 (防身钝器)',
      },
    ],
    defaultSuggestions: [
      '蹲下用手电仔细勘验地毯上的泥泞蹼足与血痕走向',
      '拿起壁炉旁的黄铜火钳防身，悄步推开西侧宴会大厅门',
      '握紧武器，顺着木质楼梯快步直奔二楼学者书房',
    ],
  },

  dining_hall: {
    id: 'dining_hall',
    name: '幽暗长桌宴会大厅',
    area: '古宅西翼 · 宴席厅',
    atmosphere: '🕯️ 银烛摇曳 · 腐败长桌上冒着热气的深海祭品',
    narration:
      '穿过双扇木门，宴会厅中弥漫着浓烈的咸腥腐败气味。十二人座的雕花长桌上陈列着银质餐盘，盘中盛着某种散发紫黑微光的深海生物内脏，甚至还在缓慢脉动！正前方墙壁上悬挂着三世伯爵的巨幅等身肖像油画，画中人的双眼在昏黄烛光下仿佛转动凝视着你。在角落的餐具柜后，有一座通往地底的手摇送餐升降井。',
    exits: {
      '门厅': 'foyer',
      '大门': 'foyer',
      '升降井': 'cellar_corridor',
      '地窖': 'cellar_corridor',
      '地下': 'cellar_corridor',
    },
    interactables: [
      {
        name: '伯爵肖像油画',
        keywords: ['画像', '油画', '肖像', '画框', '先祖', '画'],
        description: '触摸画框边缘发现暗扣！暗格应声弹开，露出一枚纯银五芒星圣徽与一瓶未开封的高纯度浓缩镇静剂！',
        clueId: 'clue_ancestor_portrait',
        clueText: '先祖油画暗格藏有白银五芒星圣徽，古阿卡姆文献记载白银能驱散深渊心智蛊惑。',
        itemGiven: '先祖银制五芒星圣徽',
        sanDelta: 3,
      },
      {
        name: '长桌祭品与餐盘',
        keywords: ['长桌', '餐盘', '祭品', '肉', '骨', '食物', '盘子'],
        description: '银质餐盘边缘用极细的尖刀雕刻着古拉莱耶禁咒真言，详细记录了眷族在接触强光与白银时的剧烈排斥反应！',
        clueId: 'clue_abyss_feast',
        clueText: '祭品边缘铭文证实：深海眷族由有机质与非欧磁场凝聚，强光致盲与白银刺穿能重创其核心。',
      },
      {
        name: '送餐升降机井',
        keywords: ['升降井', '缆绳', '滑轮', '井', '送餐口', '升降机'],
        description: '铁网升降井连接地窖厨房，粗麻缆绳尚可承重，拉开铁栅栏即可顺绳滑降直达地底回廊。',
      },
    ],
    defaultSuggestions: [
      '用放大镜仔细勘验三世伯爵肖像画框周围的异常缝隙',
      '用火钳挑开餐盘上的祭品，以神秘学知识辨识拉莱耶符文',
      '拉开升降井铁门，抓牢粗麻缆绳悄然滑降至地底',
    ],
  },

  greenhouse: {
    id: 'greenhouse',
    name: '阴暗温室与星象画廊',
    area: '古宅东翼 · 水晶花房',
    atmosphere: '🌿 穹顶暴雨轰鸣 · 散发妖异荧光的异星菌菇',
    narration:
      '这是一座巨大的铁艺维多利亚风格水晶温室。暴雨疯狂撞击着玻璃穹顶，发出震耳欲聋的声响。四周培育着完全超出地球常理的深渊菌菇与紫黑色藤蔓，在昏暗中散发出幽蓝色的柔和冷光。温室正中矗立着一尊无面神祇的黑曜石雕像，雕像双手托着转动的星象天仪罗盘。温室后方有一座精巧的回旋木梯直通二楼书房。',
    exits: {
      '门厅': 'foyer',
      '大门': 'foyer',
      '书斋': 'study',
      '书房': 'study',
      '楼上': 'study',
      '暗道': 'cellar_corridor',
      '地窖': 'cellar_corridor',
    },
    interactables: [
      {
        name: '异界荧光舒缓草',
        keywords: ['菌菇', '蘑菇', '孢子', '植物', '花', '草', '荧光'],
        description: '小心翼翼地切取下最饱满的蓝色荧光孢子！这种异星汁液能极大平复战栗神经，恢复 6 点 HP 与 6 点 SAN！',
        itemGiven: '异界荧光舒缓草',
      },
      {
        name: '无面神祇石雕与天仪',
        keywords: ['石雕', '雕像', '罗盘', '天仪', '石像', '机关'],
        description: '将天仪刻度对齐天狼星方位，咔哒一声，石雕脚下暗格滑开，露出了泛黄的【旧神星印残卷】，一条干燥石阶通向地底！',
        clueId: 'clue_statue_compass',
        clueText: '温室石雕暗道直通深渊前哨，残卷记载着星辰归位时封闭虚空之眼的阵眼站位。',
        itemGiven: '旧神星印残卷',
      },
    ],
    defaultSuggestions: [
      '小心采集石柱上散发纯净蓝光的异界荧光菌菇',
      '研究中央石雕手中的星轨天仪，尝试旋转机关星座',
      '踏上后方的回旋木梯，悄然从侧门登入二楼书房',
    ],
  },

  study: {
    id: 'study',
    name: '二楼学者私人藏书斋',
    area: '古宅二层 · 核心书斋',
    atmosphere: '🕯️ 烛火忽明忽暗 · 满壁天体星图与焦黑残卷',
    narration:
      '推开虚掩的厚实胡桃木门，一股浓烈的旧书霉味与松节油焦糊味扑鼻而来。整整三面书架被翻得狼藉一片，墙壁上以血墨绘制着巨大的扭曲星盘图。书桌正中央摊开着一本由粗糙鞣制皮质缝制的手稿——《拉莱耶断章》。在壁炉背后的暗壁处，一扇通往地底的玄铁密门正不断往外渗出刺骨寒霜，锁孔是精致的雕花铜锁。走廊深处还有一道折叠铝梯通向阁楼。',
    exits: {
      '门厅': 'foyer',
      '楼下': 'foyer',
      '温室': 'greenhouse',
      '阁楼': 'attic',
      '地窖': 'cellar_corridor',
      '暗门': 'cellar_corridor',
    },
    interactables: [
      {
        name: '《拉莱耶断章》手稿',
        keywords: ['断章', '手稿', '书', '人皮', '密卷', '笔记', '拉莱耶'],
        description: '桌上手稿记载着艾伯纳学者的绝笔手记：“祂在呼唤我……以白银五芒置于地底祭坛……唯有意志如铁者能直视群星……”',
        clueId: 'clue_necronomicon',
        clueText: '手稿揭示：艾伯纳并非邪恶信徒，而是试图在仪式完成前利用旧神星印压制眷族，但心智濒临失守。',
        sanDelta: -2,
      },
      {
        name: '玄铁暗门与锁孔',
        keywords: ['暗门', '锁', '钥匙孔', '机关门', '铁门'],
        requiresItem: '雕花铜钥匙',
        description: '将门厅搜出的雕花铜钥匙插入锁芯，轻轻转动，沉重铁门无声滑开，不仅露出了盘旋石阶，暗格里还藏着一卷战地急救绷带！',
        itemGiven: '战地急救绷带',
      },
      {
        name: '满墙血墨星图',
        keywords: ['星图', '星象', '墙', '壁画', '星座', '血图'],
        description: '星图上详细用红线串联了阿尔德巴兰星与仙女座星云，标注了子夜12点整现实屏障最薄弱的交汇奇点。',
        clueId: 'clue_star_map',
        clueText: '星图确认了时空危机时刻：午夜 12:00 深渊裂隙将彻底撕裂，在此之前必须抵达祭坛施加封印。',
      },
    ],
    defaultSuggestions: [
      '使用【雕花铜钥匙】无声开启书架后方的玄铁暗门',
      '戴上白手套，破译书桌上摊开的人皮手稿《拉莱耶断章》',
      '爬上走廊尽头的折叠铝梯，前往三楼阁楼密室侦查',
    ],
  },

  attic: {
    id: 'attic',
    name: '三楼阁楼观测密室',
    area: '古宅顶层 · 阁楼',
    atmosphere: '🔭 蛛网密布 · 巨大黄铜望远镜正对向雷云夜空',
    narration:
      '阁楼天花板倾斜压抑，空气中弥漫着松木与尘土的气息。大厅中央架设着一台军工级黄铜天文望远镜，镜筒穿过天窗对准暴雨翻滚的苍穹。角落里堆放着未拆封的测绘仪器箱与一只贴有阿卡姆大学封条的生铁保险箱。透过天窗外倾斜的雨檐，隐约有一根粗重的铁制排水管道通向外侧庭院。',
    exits: {
      '书斋': 'study',
      '楼下': 'study',
      '庭院': 'courtyard',
      '天窗': 'courtyard',
    },
    interactables: [
      {
        name: '黄铜天文望远镜',
        keywords: ['望远镜', '镜头', '星空', '目镜', '天窗', '窗户'],
        description: '透过目镜惊悚地发现：云层深处根本不是雷电，而是一团横跨数公里的紫黑色触须正撕开星空！直击深渊真相令你战栗不已！',
        clueId: 'clue_telescope_vision',
        clueText: '深空景象证实了虚空异象的宏大尺度，深渊眷族正在以古宅为引信锚定现实。',
        sanDelta: -4,
      },
      {
        name: '大学铁质保险箱',
        keywords: ['保险箱', '箱子', '铁箱', '铁盒', '封条'],
        description: '利用随身工具撬开箱锁，里面整齐摆放着两瓶密封药剂：一瓶【浓缩镇静剂】与一瓶【军用战地急救绷带】！',
        itemGiven: '浓缩镇静剂',
      },
    ],
    defaultSuggestions: [
      '凑近黄铜望远镜目镜，观测云层深处不可名状的异变',
      '撬开贴着密大封条的铁质保险箱搜寻医疗补给',
      '顺着天窗外的铁制排水管滑向暴雨中的庄园后院',
    ],
  },

  cellar_corridor: {
    id: 'cellar_corridor',
    name: '潮湿地窖与石窟回廊',
    area: '古宅地下 · 回廊哨卡',
    atmosphere: '💧 冰冷滴水声 · 混合着刺鼻鱼腥与沙哑诵经的古窟',
    narration:
      '走下陡峭石阶，温度骤降至冰点。回廊两侧是天然开凿的玄武岩石柱，地面覆盖着厚达数寸的深海淤泥与腥臭贝壳。前方的拱券下方，两名身形佝偻、面部已严重两栖畸变的异化仆从手持锈迹斑斑的捕鲸钢叉来回巡逻，喉咙里发出“咕噜……克苏鲁……”的含混低语。在回廊尽头，一扇雕刻着远古海怪浮雕的百炼黑钢巨门紧闭着，门缝后透出紫黑色的电弧光芒。',
    exits: {
      '书房': 'study',
      '楼上': 'study',
      '升降机': 'dining_hall',
      '神庙': 'abyss_shrine',
      '祭坛': 'abyss_shrine',
      '大门': 'abyss_shrine',
    },
    interactables: [
      {
        name: '异化仆从守卫',
        keywords: ['仆从', '守卫', '鱼人', '怪物', '人', '敌人'],
        description: '仆从皮肤滑腻如深海巨兽，但动作略显迟钝，可以用强光手电致盲突袭、以潜行绕开，或用浓缩镇静剂注入其颈部唤醒残存人性！',
        itemGiven: '战地急救绷带',
      },
      {
        name: '标本架与铁锁箱',
        keywords: ['标本', '架子', '罐子', '药水', '木箱'],
        description: '在被踢倒的杂物箱里翻找出一枚散发微弱神圣蓝光的【银制旧神星之护符】！',
        itemGiven: '银制旧神星之护符',
      },
    ],
    defaultSuggestions: [
      '借助石柱阴影潜行，趁异化守卫转身时无声突袭',
      '取出【浓缩镇静剂】飞身将其制服并注入药剂唤醒人性',
      '在标本架后的死角处仔细搜索前人遗留的法器与物资',
    ],
  },

  abyss_shrine: {
    id: 'abyss_shrine',
    name: '深渊祭坛与星之眷族大厅',
    area: '古宅地底 · 核心神庙',
    atmosphere: '⚡ 紫黑色虚空闪电 · 现实维度彻底崩塌的毁灭风暴',
    narration:
      '推开黑钢巨门，眼前是一座犹如地下大教堂般的宏伟玄武岩神庙！数十根雕刻着远古深潜者的巨柱直插穹顶，中央的黑曜石祭坛周围沸腾着翻滚的虚空原液。学者艾伯纳倒在祭坛石阶上生死未卜，浑身浴血。而在祭坛正上方——狂暴的虚空狂风撕开了一条巨大的维度裂缝，一尊由无数眼珠、翻滚黏液与狂乱黑雾构成的星之眷族正在实体化！不可名状的心灵威压几乎要将你的脑髓碾碎！',
    exits: {
      '回廊': 'cellar_corridor',
      '后退': 'cellar_corridor',
    },
    interactables: [
      {
        name: '黑曜石祭坛核心',
        keywords: ['祭坛', '阵眼', '石台', '石阶', '凹槽'],
        clueId: 'clue_altar_seal',
        clueText: '祭坛中央正是古代旧神星印的天然阵眼，嵌入白银圣徽并以 POW 意志共鸣即可强行闭合空间奇点！',
        description: '祭坛正中有一道五芒星凹槽，正不断向外喷涌虚空电弧。',
      },
      {
        name: '星之眷族本体',
        keywords: ['眷族', '怪物', '触须', '邪神', '虚空', '眼珠'],
        description: '不可名状的深空巨兽，触须如巨蟒挥舞，普通的物理子弹很难彻底消灭，必须以意志与封印术击溃其锚点。',
        sanDelta: -5,
      },
      {
        name: '艾伯纳学者',
        keywords: ['艾伯纳', '学者', '老人', '伤者', '同伴'],
        description: '艾伯纳学者胸口微弱起伏，怀里死死抱着最后半份炸药引信，嘴唇翕动：“快……阵眼……或者炸塌这里……”',
      },
    ],
    defaultSuggestions: [
      '高举纯银旧神星之护符，飞身跃上祭坛中心施展古老封印！',
      '背起艾伯纳学者，点燃随身雷管丢向地窖承重穹顶物理炸毁！',
      '【禁断抉择】将双手按在涌动的虚空原液上，与眷族达成意识共生！',
    ],
  },
};

/**
 * 智能意图与语义解析推演机
 * 分析玩家输入的任意文本行动，结合当前房间实体、线索、背包道具，决定检定类型或直接叙事
 */
export function evaluateSandboxPlayerAction(
  playerActionText: string,
  currentRoomId: string,
  character: ScenarioCharacterPreset,
  cluesDiscovered: string[]
): SandboxActionEvaluation {
  const text = playerActionText.trim();
  const room = BLACKWOOD_SANDBOX_ROOMS[currentRoomId] || BLACKWOOD_SANDBOX_ROOMS.foyer;

  // 1. 移动意图检测 (Move to other room)
  for (const [exitKey, targetId] of Object.entries(room.exits)) {
    if (text.includes(exitKey) && (text.includes('去') || text.includes('走') || text.includes('进') || text.includes('入') || text.includes('滑') || text.includes('爬') || text.includes('上') || text.includes('下') || text.includes('穿过') || text.includes('前往') || text.includes('跑到') || text.includes('到') || text.includes('回'))) {
      const targetRoom = BLACKWOOD_SANDBOX_ROOMS[targetId];
      if (targetRoom) {
        return {
          actionText: text,
          intent: 'move',
          targetRoomId: targetId,
          requiresCheck: false,
          directNarration: `你步履坚定地动身，穿过回廊与门扉，进入了【${targetRoom.name}】。\n${targetRoom.narration}`,
          companionReaction: {
            agentId: 'gaming-koko',
            text: `已到达【${targetRoom.name}】！四周环境变化很大，小心脚下，随时准备应对未知！`,
          },
          newSuggestions: targetRoom.defaultSuggestions,
        };
      }
    }
  }

  // 2. 检查是否有物品主动使用意图 (如 "用绷带包扎", "喝治疗药水", "给守卫注射镇静剂")
  if (/绷带|急救/i.test(text) && character.inventory.some((it) => it.includes('绷带'))) {
    return {
      actionText: text,
      intent: 'use_item',
      requiresCheck: false,
      hpDelta: 5,
      itemLost: character.inventory.find((it) => it.includes('绷带')),
      directNarration: `你迅速取出随身急救绷带，用熟练的手法压迫止血并紧紧包扎伤口。清凉的凝胶有效抑制了剧痛，体力明显恢复！（生命值 +5）`,
      companionReaction: {
        agentId: 'gaming-koko',
        text: '太好了，血止住了！这下战斗力又拉满了！',
      },
    };
  }

  if (/镇静剂|注射/i.test(text) && character.inventory.some((it) => it.includes('镇静剂'))) {
    // 如果是对守卫使用
    if (/守卫|仆从|鱼人|怪物/i.test(text) && currentRoomId === 'cellar_corridor') {
      return {
        actionText: text,
        intent: 'use_item',
        requiresCheck: false,
        itemLost: character.inventory.find((it) => it.includes('镇静剂')),
        itemGained: '银制旧神星之护符',
        directNarration: `你飞身上前，趁守卫恍惚之际将浓缩镇静剂精准刺入其颈动脉！异化守卫浑浊的白内障眼珠中狂乱渐渐褪去，流下痛苦的泪水：“谢谢你……调查员……快去祭坛，用白银星印封印裂缝！”他将一枚散发幽蓝微光的【银制旧神星之护符】塞到了你手中！`,
        companionReaction: {
          agentId: 'gaming-nox',
          text: '令人惊艳的非暴力压制决策。不仅瓦解了敌对哨兵，更直接获得了核心圣徽信物。',
        },
      };
    }

    return {
      actionText: text,
      intent: 'use_item',
      requiresCheck: false,
      sanDelta: 15,
      itemLost: character.inventory.find((it) => it.includes('镇静剂')),
      directNarration: `你颤抖着拧开玻璃安瓿瓶，将高浓度镇静药液注入手臂静脉。冰凉的药液如清泉般冲刷过剧烈抽搐的神经，脑海中疯狂的深渊低语被强行压制下去！（理智值 +15）`,
      companionReaction: {
        agentId: 'gaming-lulu',
        text: '呼……你刚才脸色真的难看到吓死人！药效总算起作用了，别再乱逞强了啦！',
      },
    };
  }

  // 3. 匹配当前房间的可交互实体 (Match interactables)
  for (const obj of room.interactables) {
    const isMatched = obj.keywords.some((kw) => text.includes(kw));
    if (isMatched) {
      // 检查道具门槛 (如玄铁门需要雕花铜钥匙)
      if (obj.requiresItem && !character.inventory.some((it) => it.includes(obj.requiresItem!))) {
        return {
          actionText: text,
          intent: 'inspect',
          requiresCheck: false,
          directNarration: `你仔细检查了【${obj.name}】，发现其核心机簧被严密的雕花机械锁锁死。锁孔处散发着古铜光泽，需要找到对应的【${obj.requiresItem}】方能开启。`,
          companionReaction: {
            agentId: 'gaming-nox',
            text: `提示：该机关需要道具【${obj.requiresItem}】。回忆一下之前的探索区域，比如门厅地毯下是否有遗落。`,
          },
        };
      }

      // 如果玩家提出了极其周全聪明的动作描述，守秘人给予加值
      let bonus = 0;
      let bonusReason = '';
      if (/放大镜|手电|仔细|手帕|小心|轻轻|戴手套/i.test(text)) {
        bonus = 15;
        bonusReason = '因动作细致严谨且充分运用随身探查工具，守秘人给予 +15% 技能加成';
      }

      // 决定检定技能
      let skillName = '侦查';
      let intent: SandboxActionEvaluation['intent'] = 'inspect';

      if (/破译|古籍|符文|真言|魔法|仪式|通灵|拉莱耶/i.test(text)) {
        skillName = '神秘学';
        intent = 'ritual';
      } else if (/撬|别针|偷|巧手|解开/i.test(text)) {
        skillName = '敏捷闪避';
        intent = 'stealth';
      } else if (/砸|撞|推|砍|踢|劈|斩|火钳挥舞|攻击|揍|殴打|放倒/i.test(text) || (/打/i.test(text) && !/打开|打听|打探|打算|打量/i.test(text))) {
        skillName = '格斗';
        intent = 'combat';
      }

      const baseTarget = character.skills[skillName] || (character.stats['dex'] || 60);

      return {
        actionText: text,
        intent,
        requiresCheck: true,
        checkRule: 'coc',
        skillName,
        baseTargetValue: baseTarget,
        bonusModifier: bonus,
        bonusReason,
        itemGained: obj.itemGiven && !character.inventory.includes(obj.itemGiven) ? obj.itemGiven : undefined,
        hpDelta: obj.hpDelta,
        sanDelta: obj.sanDelta,
        clueDiscovered: obj.clueId && !cluesDiscovered.includes(obj.clueId)
          ? { id: obj.clueId, title: obj.name, text: obj.clueText || obj.description }
          : undefined,
        directNarration: `守秘人裁决：针对你对【${obj.name}】的行动【${text}】，需要进行一次【${skillName}】检定来判定行动成效！`,
        newSuggestions: room.defaultSuggestions,
      };
    }
  }

  // 4. 通用自由行动分析 (Combat / Stealth / Observation / Creative action)
  let skillName = '心理学';
  let intent: SandboxActionEvaluation['intent'] = 'creative';

  if (/看|搜|找|查|观察|寻找|摸索|望远镜|勘验|检查|检视|端详/i.test(text)) {
    skillName = '侦查';
    intent = 'inspect';
  } else if (/跑|闪|跳|溜|爬|躲|潜行|悄悄|无声/i.test(text)) {
    skillName = '敏捷闪避';
    intent = 'stealth';
  } else if (/砸|射|枪|开枪|砍|劈|斩|冲锋|攻击|揍|放倒|殴打/i.test(text) || (/打/i.test(text) && !/打开|打听|打探|打算|打量/i.test(text))) {
    skillName = '格斗';
    intent = 'combat';
  } else if (/咒|神|法|冥想|意志|心|祈祷|封印/i.test(text)) {
    skillName = '意志';
    intent = 'ritual';
  }

  let bonus = 0;
  let bonusReason = '';
  if (/掩体|屏息|贴墙|压低身位|侧身/i.test(text)) {
    bonus = 10;
    bonusReason = '良好的战术身位与环境掩护利用，+10% 成功率加成';
  }

  const baseTarget = character.skills[skillName] || (character.stats['pow'] || 65);

  return {
    actionText: text,
    intent,
    requiresCheck: true,
    checkRule: 'coc',
    skillName,
    baseTargetValue: baseTarget,
    bonusModifier: bonus,
    bonusReason,
    directNarration: `守秘人判定：你的自由行动【${text}】展现了出色的探索构想，请掷骰进行【${skillName}】检定！`,
    newSuggestions: room.defaultSuggestions,
  };
}

/**
 * 当掷骰判定结算后，生成生动有文学质感的守秘人最终结局叙事与队友反应
 */
export function buildSandboxCheckOutcome(
  evaluation: SandboxActionEvaluation,
  checkResult: SkillCheckResult,
  room: SandboxRoom,
  character: ScenarioCharacterPreset
): {
  outcomeText: string;
  companionSpeech?: {
    agentId: 'gaming-lulu' | 'gaming-koko' | 'gaming-nox';
    text: string;
  };
} {
  const isCrit = checkResult.level === 'critical_success';
  const isFumble = checkResult.level === 'fumble';
  const isPass = checkResult.isSuccess;

  let outcomeText = '';
  let speech = undefined;

  if (isCrit) {
    outcomeText = `【🌟 绝世大成功！】你的行动【${evaluation.actionText}】收到了超乎想象的奇效！你不仅完美达成了预期目标，更以近乎神迹的灵巧洞悉了环境中最深层的隐秘规律！${evaluation.clueDiscovered ? `\n🔍【关键线索已获得】${evaluation.clueDiscovered.text}` : ''}${evaluation.itemGained ? `\n🎒【额外缴获物资】获得了【${evaluation.itemGained}】！` : ''}`;
    speech = {
      agentId: 'gaming-lulu' as const,
      text: '哇……！刚才那一下简直帅得犯规！……哼，才、才没有脸红呢！干得漂亮啦！',
    };
  } else if (isFumble) {
    outcomeText = `【💀 绝望大失败！】命运的齿轮在这一瞬发出了崩裂声！你的行动【${evaluation.actionText}】遭受了最坏的环境反噬！地面湿滑导致你重重摔倒，或是暗处的诡异机关被直接触发，冷冽的剧痛与精神污染如潮水般涌来！（HP -3，SAN -5）`;
    speech = {
      agentId: 'gaming-lulu' as const,
      text: '喂！小心啊笨蛋！流了好多血……快抓住我的手起来，千万别放弃啊！',
    };
  } else if (isPass) {
    outcomeText = `【✅ 判定成功！】凭借着果断与老练的直觉，你的行动【${evaluation.actionText}】顺利奏效！你精准把控了局势节奏，消解了潜伏的威胁。${evaluation.clueDiscovered ? `\n🔍【关键线索已揭露】${evaluation.clueDiscovered.text}` : ''}${evaluation.itemGained ? `\n🎒【物品获得】你拾取了【${evaluation.itemGained}】！` : ''}`;
    speech = {
      agentId: 'gaming-nox' as const,
      text: '战术动作执行到位，成功规避了 85% 以上的环境风险，局势处于绝对受控状态。',
    };
  } else {
    outcomeText = `【❌ 判定失败】事与愿违，阴暗潮湿的环境阻碍了你的发挥。你的行动【${evaluation.actionText}】并未完全奏效，但好在你及时收势，没有酿成致命灾祸。深渊的低语在阴影中更加密集了……`;
    speech = {
      agentId: 'gaming-koko' as const,
      text: '没关系的！谁能每次都百发百中呢！调整一下呼吸，我们再试一次！冲鸭！',
    };
  }

  return {
    outcomeText,
    companionSpeech: speech,
  };
}

export const SANDBOX_ROOM_TO_NODE_ID: Record<string, string> = {
  foyer: 'node_foyer',
  dining_hall: 'node_dining',
  greenhouse: 'node_gallery',
  study: 'node_study',
  attic: 'node_attic',
  cellar_corridor: 'node_cellar_corridor',
  abyss_shrine: 'node_basement',
};

export const NODE_ID_TO_SANDBOX_ROOM: Record<string, string> = {
  node_foyer: 'foyer',
  node_dining: 'dining_hall',
  node_gallery: 'greenhouse',
  node_study: 'study',
  node_attic: 'attic',
  node_cellar_corridor: 'cellar_corridor',
  node_archive_vault: 'cellar_corridor',
  node_hidden_chapel: 'cellar_corridor',
  node_chapel_ritual: 'abyss_shrine',
  node_basement: 'abyss_shrine',
  node_climax: 'abyss_shrine',
  node_ritual: 'abyss_shrine',
};

export function getSandboxRoomByNodeId(nodeId: string): SandboxRoom {
  const roomId = NODE_ID_TO_SANDBOX_ROOM[nodeId] || nodeId;
  return BLACKWOOD_SANDBOX_ROOMS[roomId] || BLACKWOOD_SANDBOX_ROOMS.foyer;
}

export interface ManorClueDefinition {
  id: string;
  title: string;
  sourceRoom: string;
  icon: string;
  text: string;
}

export const MANOR_CLUES: Record<string, ManorClueDefinition> = {
  clue_clock: {
    id: 'clue_clock',
    title: '停摆座钟的非欧逆行针',
    sourceRoom: '门厅玄关',
    icon: '🕰️',
    text: '座钟指针逆向停留在 11:47，受到地底维度扭曲影响，昭示着午夜 12:00 正是星辰归位、虚空完全撕裂的交汇时刻。',
  },
  clue_webbed_feet: {
    id: 'clue_webbed_feet',
    title: '深海蹼足拖曳血印',
    sourceRoom: '门厅玄关',
    icon: '👣',
    text: '地毯上的非人脚印残留两栖滑腻黏液，逃跑者处于深潜者异化晚期；踢脚线夹层遗落了刻有家族徽记的雕花铜钥匙。',
  },
  clue_ancestor_portrait: {
    id: 'clue_ancestor_portrait',
    title: '三世伯爵画像密格',
    sourceRoom: '宴会大厅',
    icon: '🖼️',
    text: '画像背后藏有先祖纯银五芒星圣徽与应急镇静剂，黑石家族先祖早已秘密构筑封印阻挡深渊蔓延。',
  },
  clue_abyss_feast: {
    id: 'clue_abyss_feast',
    title: '深渊祭礼的银器弱点',
    sourceRoom: '宴会大厅',
    icon: '🍽️',
    text: '祭盘古文字揭示：星之眷族以有机虚空质为基，强光能短暂致盲其视觉神经，纯银法器可撕裂其虚空力场。',
  },
  clue_statue_compass: {
    id: 'clue_statue_compass',
    title: '星轨罗盘秘道与星印',
    sourceRoom: '阴暗温室',
    icon: '🧭',
    text: '温室石雕罗盘对齐天狼星座可开启直通地底深处的干燥石阶暗道，并起出《旧神星印残卷》。',
  },
  clue_necronomicon: {
    id: 'clue_necronomicon',
    title: '《拉莱耶断章》手稿绝笔',
    sourceRoom: '学者书房',
    icon: '📜',
    text: '艾伯纳并非邪恶信徒，而是试图在仪式完成前利用旧神星印压制眷族，但心智濒临失守，需要置入纯银五芒星。',
  },
  clue_star_map: {
    id: 'clue_star_map',
    title: '血墨天体星盘奇点',
    sourceRoom: '学者书房',
    icon: '🌌',
    text: '墙上星图串联阿尔德巴兰星与仙女座星云，标注了子夜12点整现实屏障最薄弱的奇点，时间紧迫。',
  },
  clue_telescope_vision: {
    id: 'clue_telescope_vision',
    title: '深空触须星云真相',
    sourceRoom: '三楼阁楼',
    icon: '🔭',
    text: '透过军工天文望远镜目睹暴雨云层深处横跨数公里的紫黑色触须星云，证实虚空异象正以古宅为引信锚定现实。',
  },
  clue_altar_seal: {
    id: 'clue_altar_seal',
    title: '黑曜石祭坛核心阵眼',
    sourceRoom: '深渊祭坛',
    icon: '⚡',
    text: '祭坛中央正是古代旧神星印天然阵眼，嵌入白银圣徽并以 POW 意志共鸣即可强行逆转虚空电弧、闭合空间奇点！',
  },
};


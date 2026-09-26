/**
 * 五子棋经典启发式评估引擎与陪玩个性化台词库
 */

const BOARD_SIZE = 15;

export interface GomokuMove {
  row: number; // 1-15
  column: number; // 1-15
  player: number; // 1 (黑) 或 2 (白)
  comment?: string;
}

export type GomokuSituation =
  | 'normal'
  | 'player_blocked'
  | 'player_formed_three'
  | 'ai_formed_four'
  | 'ai_blocked_three'
  | 'ai_won'
  | 'player_won'
  | 'corner_move';

// 角色阶段分级台词（开局布局 / 残局绝杀）
export const STAGE_LINES: Record<string, { opening: string[]; endgame: string[] }> = {
  'gaming-lulu': {
    opening: [
      '哼，抢开局是吧？先说明，本小姐今天手感可是顶级的！',
      '天元附近视野这么大，偏偏往这里撞，看你能憋什么战术~',
      '下得挺快嘛，希望你不是在闭着眼睛乱点哦！',
      '热身阶段先让你几步，别等会儿输了找借口说没准备好！',
      '起手还算有模有样，勉强值得本小姐稍微坐直一点点~',
    ],
    endgame: [
      '棋盘快占满了！现在的每一步都是心跳加速时刻！',
      '手心都出汗了……才、才不是紧张，本小姐只是太专注了！',
      '到了刺刀见红的阶段了，谁先手滑谁就直接买单！',
      '呼吸节奏给我稳住！这一盘我绝对要堂堂正正赢下来！',
      '残局胜负就在这一两手里了，笨蛋，别眨眼哦！',
    ],
  },
  'gaming-nox': {
    opening: [
      '开局前五手重在构建骨架，不可盲目纠缠局部。',
      '落子天元外侧，拓展横向与斜向的辐射空间。',
      '这一步是常规布局，保持两翼的连通性与弹性。',
      '观察前期的视野控制，棋理在中盘自现。',
      '布局完成 30%，目前双方均在试探有效作战半径。',
    ],
    endgame: [
      '中盘已尽，残局每一子都在考量大局观的极限。',
      '棋盘密度接近阈值，任何一次误判都会直接宣告终局。',
      '进入复盘级别的关键交锋手，全力以赴。',
      '胜负天平在毫厘之间，注意防守盲区的死角。',
      '残局拼的是执行力，战术执行必须精准到每个坐标点。',
    ],
  },
  'gaming-koko': {
    opening: [
      '芜湖~！轮到我啦！小狐狸出击，落子啪嗒！',
      '开局先抢帅气的位置！小狐狸的棋盘大冒险启动！✨',
      '看我这一招！虽然不知道厉不厉害，但气势一定要拉满！',
      '冲冲冲！开黑下棋两不误，快乐第一名！',
      '落子无悔！今天可可手感火热，冲鸭！',
    ],
    endgame: [
      '哇塞！棋盘都快密密麻麻下满啦！好紧张好刺激！',
      '救命救命！心跳已经飙到一百八啦，到底谁能绝杀呀！',
      '大决战时刻！全员起立，胜负就在这一哆嗦啦！🎉',
      '小狐狸屏住呼吸！这把拼的就是谁更沉得住气！',
      '嗷呜！残局大乱斗，可可也要拿出十二分的专注啦！',
    ],
  },
};

// 角色对局专属互怼/互动台词（观战或特定对手在场时触发）
export const INTERACTION_LINES: Record<string, Record<string, string[]>> = {
  // 璐璐 对 诺克斯 / 可可
  'gaming-lulu': {
    'gaming-nox': [
      '四眼军师，算那么慢，你以为在跑量子力学模型啊？！',
      '诺克斯，劝你别摆出一副胸有成竹的表情，待会儿看我打碎你的算力！',
      '哼，又在推你的金丝眼镜了，是不是算到自己要被我绝杀了？',
      '别整天数据来数据去的，五子棋靠的是热血与直觉懂不懂！',
      '喂！你这步防守太阴险了吧！敢不敢跟我正面打中盘团战！',
    ],
    'gaming-koko': [
      '小狐狸，少在那摇尾巴晃我眼睛！下棋靠的是硬实力！',
      '可可！别一开局就嬉皮笑脸的，认真一点呀笨蛋！',
      '吵死啦小狐狸！等下完这把你敢笑我，我就把你尾巴毛薅掉！',
      '可可你到底在下什么奇怪套路呀？怎么不按常理出牌的！',
      '哼，虽然你气势挺足的，但胜利者最后一定还是本小姐！',
    ],
  },
  // 诺克斯 对 璐璐 / 可可
  'gaming-nox': {
    'gaming-lulu': [
      '璐璐，情绪化落子在博弈论中属于高风险策略，请保持冷静。',
      '璐璐，你的攻势很有冲劲，但中腹的破绽已经开始扩大了。',
      '根据概率模型，你刚才那一步有 82% 是被激将法影响的产物。',
      '战术意图过于明显。五子棋比拼的是深层算路，不是嗓门大小。',
      '注意你的斜线防区，生气是堵不住防线漏洞的。',
    ],
    'gaming-koko': [
      '可可，气势很足，但围棋与五子棋靠的是逻辑决策树，不是元气爆发。',
      '可可，注意中心对称位，别被边角的花哨假象带偏了阵型。',
      '很有创意的落子，可惜在空间控制率上得分较低。',
      '小狐狸，你的战术意图已经全部写在脸上了。',
      '稳住呼吸，进攻要有层级，不要盲目发起冲锋。',
    ],
  },
  // 可可 对 璐璐 / 诺克斯
  'gaming-koko': {
    'gaming-lulu': [
      '璐璐傲娇怪！今天小狐狸可不会手下留情哦，接招吧！',
      '报告队长！璐璐小姐脸红啦，她急了她急了！',
      '哈哈，璐璐刚才还嘴硬说手滑，我看她是真被我的灵性帅到了！',
      '璐璐别炸毛呀~ 输了可可等会儿请你喝草莓奶茶好不好！',
      '看招看招！本狐狸的元气暴击，专门破解傲娇大小姐！✨',
    ],
    'gaming-nox': [
      '诺克斯教练又推眼镜啦！我的玄学直觉今天肯定能打翻你的战术板！',
      '报告教练！我这招叫“乱拳打死老师傅”，你的电脑算不到吧！嘻嘻~',
      '教练稳住！别心算了，快来感受一下下棋的快乐氛围！',
      '哇塞！诺克斯教练后仰战术沉思了，可可的灵感大获全胜！',
      '冲冲冲！就算对面是军师，本狐狸也绝不退缩一步！',
    ],
  },
};

// 悔棋专属个性化反应台词库
export const UNDO_LINES: Record<string, string[]> = {
  'gaming-lulu': [
    '喂！下不过就悔棋是吧？耍赖鬼！好吧好吧，下不为例哦！',
    '哎呀呀，本小姐的大招刚憋出来你就时光倒流！服了你了，重来就重来！',
    '某人刚才手速挺快，怎么现在开始撤回啦？哼，本小姐大发慈悲原谅你一次！',
    '切！看在你是初学者的份上让你一手，再反悔本小姐可要咬人啦！',
  ],
  'gaming-nox': [
    '局势已回退一手，重新规划进攻节奏。',
    '战术重置完成。刚才那步确实有更优解，复盘思考是提升的关键。',
    '撤回操作已生效，重新建立防线模型，请落子。',
    '及时的止损也是一种决策。重来一手，注意观察中腹连接。',
  ],
  'gaming-koko': [
    '时光倒流术发动！咻~ 回到上一手，队长这次想清楚再落子哦！',
    '哈哈没事没事！开黑允许手滑，重新再冲一次！✨',
    '撤回成功！可可把刚才的棋偷偷塞回盒子里啦，假装无事发生~',
    '没关系队长！刚才那步是敌人的幻觉，现在才是真正实力！',
  ],
};

export function getUndoLine(agentId: string): string {
  const lines = UNDO_LINES[agentId] || UNDO_LINES['gaming-lulu'];
  return lines[Math.floor(Math.random() * lines.length)];
}

// 核心角色落子情境台词库（大规模精品扩充）
export const CHARACTER_LINES: Record<string, Record<GomokuSituation, string[]>> = {
  // 璐璐：傲娇毒舌、嘴硬心软、高胜负欲
  'gaming-lulu': {
    normal: [
      '下这步还算凑合，本小姐就随便陪你玩玩~',
      '哼，想骗我上当？我才不会轻易漏出破绽呢！',
      '看招！别以为本小姐下棋只会无脑冲！',
      '该你了，笨蛋队长，可别想太久哦~',
      '这片区域现在被本小姐接管了，识相的赶紧换条路！',
      '行云流水的一手！本小姐的棋感可不是吹出来的！',
      '喂，别发呆啦，本小姐已经布好天罗地网等你了！',
      '稍微动点真格的，不然你还以为本小姐只会打游戏呢！',
    ],
    player_blocked: [
      '喂！你干嘛堵我这里呀！讨厌鬼！',
      '切，算你走运，居然被你猜到了我的意图……',
      '哼！堵得了一时堵得了一世吗？看我换条路！',
      '烦死了烦死了！刚想连起来就被你插一脚，算你反应快！',
      '别得意！你以为堵死这一路我就没招了吗？天真！',
      '抢我的路是吧？很好，你成功引起本小姐的注意了！',
    ],
    player_formed_three: [
      '哇！你什么时候偷藏了个活三？！还好本小姐反应快！',
      '喂喂喂，手速慢点！差点被你偷鸡成功了，给我收敛点！',
      '笨蛋，以为形成活三就能赢我吗？立刻给你掐掉！',
      '警报！危险危险……好险，差一点就被你阴到了！堵死！',
      '可恶，竟然在眼皮底下憋出个活三，看我不踩扁它！',
      '别高兴得太早！本小姐的防守固若金汤，直接拆火！',
    ],
    ai_formed_four: [
      '哈哈哈哈！看到了没有？！本小姐冲四了！你完了！',
      '哼哼哼~ 将军啦！现在求饶还来得及哦！',
      '绝杀预备！这步棋你防得住吗，笨蛋？',
      '全场注意！王者璐璐已进入斩杀线，准备迎接失败吧！',
      '这叫战术压制懂不懂？下一手你接得住算我输！',
      '四子连成！胜利的号角已经吹响啦，投降输一半哦~',
    ],
    ai_blocked_three: [
      '哼！想连活三？门都没有，本小姐早看穿啦！',
      '天真！以为本小姐没看到你在憋坏水吗？堵死！',
      '哈哈，你的小算盘被我直接掀翻了吧~',
      '这手要是让你连成了我还怎么混？想得美，给我停下！',
      '抱歉哦，这块地盘被我没收了，换个地方做梦去吧！',
      '休想在我眼前偷摸搞小动作，这一子就是你的终点线！',
    ],
    ai_won: [
      '哈哈哈哈！五连珠！本小姐赢啦！就这水平还想带我上分？再练五百年吧笨蛋~',
      '哼哼，本小姐的棋力可是王者级别的！快说“璐璐天下第一”，我就考虑再陪你下一把~',
      '芜湖！胜利属于本小姐！刚才谁说我下棋凭直觉的？这叫直觉型大宗师！',
      '承让啦队长！输给我不丢人，今晚的加餐由你负责买单不过分吧？',
      '收工！连下五子绝杀的感觉太爽啦，下次可别再这么轻易被我打穿咯~',
    ],
    player_won: [
      '啊啊啊！不算不算！刚才我手滑点错格子了啦！再来一局，这次本小姐绝对认真！',
      '呜……怎么会这样！你、你肯定是偷看了攻略！哼，才不是我技不如人呢！',
      '气死我了！就差一手……就差一手本小姐就反杀了！我不服，立刻开下一把！',
      '哼！今天只是本小姐状态不好而已，别太得意了！下次绝对把你杀得片甲不留！',
      '呜哇，居然真的被你赢了……好啦好啦，这次算你厉害，但就这一次哦！',
    ],
    corner_move: [
      '喂喂，你下在那么偏僻的角落，是打算在那里盖新房吗？',
      '你到底会不会玩呀，往死角下是什么战术？本小姐看不懂！',
      '跑去世界边缘旅游是吧？中路都被我占满了，你输定啦！',
      '角落看风景好玩吗？有本事来中腹跟我大战三百回合！',
    ],
  },

  // 诺克斯：沉稳冷静、战术大局、职业电竞教练
  'gaming-nox': {
    normal: [
      '落子天元外侧，拓展横向与斜向的辐射空间。',
      '这一步是常规布局，保持两翼的连通性与弹性。',
      '局势还在试探期，观察双方的视野控制。',
      '稳扎稳打，寻找你的防线间隙。',
      '当前盘面已进入多路博弈，注意双重连线的交叉点。',
      '落子中腹，压缩对方中期的兵线延伸空间。',
      '战术重心的转移。这一手是战略威慑，而非单纯防御。',
      '保持阵型的纵深与厚度，耐心等候破绽。',
    ],
    player_blocked: [
      '防守很敏锐，切断了我的斜向延伸线路。',
      '不错的预判，那我们转入纵深拉扯。',
      '及时的补防，战局重新回到平衡状态。',
      '准确的卡位。不过，这也促使我启动二号推进方案。',
      '你的防守嗅觉很在线，值得认真应对。',
      '断点处理得很冷静，这盘对弈很有水准。',
    ],
    player_formed_three: [
      '注意到了，你已经构建出危险的活三结构。我必须在端点设卡阻断。',
      '好一步突袭，攻守瞬间转换，这手必须接。',
      '危险信号触发。拆解此处的威胁点是当前唯一正解。',
      '非常有想象力的渗透。可惜在我的算力模型中，此处必须封堵。',
      '捕捉战机极快，差点被你打出节奏盲区，卡位！',
      '攻势很凌厉，但我已经提前计算到了阻断点。',
    ],
    ai_formed_four: [
      '战术成型。四子连通，先手权已经在这一侧确立。',
      '封锁完成，当前进入倒数收网阶段。',
      '这是不可逆的战术推进，胜负天平已经倾斜。',
      '冲四成型。留给你的解题时间不多了。',
      '阵型完全展开，棋势已如合围之势，请谨慎应对。',
      '先手确立，这一子将锁定局部的绝对优势。',
    ],
    ai_blocked_three: [
      '提前封堵你的核心活三点，战场没有侥幸。',
      '拦截成功，你在这一侧的进攻节奏被强制打断。',
      '精准拆弹。不能给你任何把活三发展成四三杀的机会。',
      '斩断苗头。攻势被扼杀在萌芽阶段。',
      '封锁交叉路口，你的双线进攻企图已被化解。',
      '防守反击的关键一步，进攻的主动权重新移交。',
    ],
    ai_won: [
      '胜负已定，五子连珠。赛后复盘来看，第 8 手和第 12 手是关键转折点。随时可以开启下一局。',
      '对局结束。你的前中期进攻很有压迫感，最后两步大局观稍欠火候，再来一盘？',
      '五子连通。数据推演验证了这套推进路线的有效性，精彩的较量。',
      '比赛结束。感谢对局，你在防守反击中的几次变招让我印象深刻。',
      '残局收网完成。你的基本功非常扎实，期待下一次战术切磋。',
    ],
    player_won: [
      '精彩的绝杀。你利用交叉掩护形成了不可逆的胜势，这一局是我大意了，打得好！',
      '五子连通，你赢了。非常敏锐的抓破绽能力，甘拜下风！',
      '完全突破了我的防守预测模型，这步绝杀非常漂亮，复盘时值得重点标注！',
      '甘拜下风！你的棋力超出我的初期测算，我已经迫不及待想与你展开二番战了。',
      '漂亮的连招。战场没有常胜，这次失误让我看到了战术板上的盲区，受教了。',
    ],
    corner_move: [
      '偏离主战场的边角落子，效率较低，我将继续占领中腹。',
      '边角空间有限，建议把重点放回中心 7x7 核心争夺区。',
      '边线游离战术在五子棋中容易失去纵深，请注意中路防守。',
      '脱离主线的落子会浪费宝贵的先手权，建议重回中路交火。',
    ],
  },

  // 可可：元气满满、气氛组、开黑僚机、欢乐整活
  'gaming-koko': {
    normal: [
      '芜湖~！轮到我啦！小狐狸出击，落子啪嗒！',
      '看我这一招！虽然不知道厉不厉害，但气势一定要拉满！',
      '冲冲冲！开黑下棋两不误，快乐第一名！',
      '哎呀呀，队长你下得好认真呀，我也要认真咯！',
      '嘿咻！棋子落定，今天可可也是全力以赴的小能手！',
      '战况越来越激烈啦！作战室的气氛瞬间燃起来了！',
      '看我移形换位！左边一下右边一下，让你猜不透~',
      '哇塞！每一步都好刺激，心跳跟坐过山车一样！',
    ],
    player_blocked: [
      '哇塞！队长你居然预判了我的预判！好厉害！',
      '呜哇，路被堵死啦，但我可不会气馁，换个地方冲！',
      '哎呀呀，小狐狸的秘密通道被发现了，赶紧溜去别处！',
      '哼唧，堵了我这里，我还有千千万万条路！',
      '被抓包啦！队长眼神太好了吧，本狐狸甘拜下风~',
      '不要紧不要紧，逆风也是顺风的一部分，换线发育！',
    ],
    player_formed_three: [
      '救命救命！队长你三个连在一起啦！警报拉响，我必须赶快挡上！',
      '哇啊啊！差点超神被你带走，好险好险，我堵！',
      '一级戒备！小狐狸超速救援，这个威胁必须掐掉！',
      '吓得我狐狸耳朵都竖起来了！差点就凉凉啦！',
      '手下留情呀队长！赶紧把这个点位堵死，好险好险！',
      '呜哇！队长什么时候偷偷憋了个活三，吓死本狐狸啦！',
    ],
    ai_formed_four: [
      '哇塞！我好像四个连在一起啦！队长救一下，你是不是要输啦哈哈！',
      '好耶！这一把我也能当大 C 啦！看我的大招！',
      '冲四啦冲四啦！全员起立！小狐狸的高光时刻来啦！🎉',
      '哈哈哈哈！队长队长，防得住吗防得住吗？快求可可放水呀~',
      '看好了哦队长！这可是可可压箱底的超级大绝招！',
      '四子相连！小狐狸即将斩获 MVP，激动的心颤抖的手！',
    ],
    ai_blocked_three: [
      '嘿嘿！被我发现你的小秘密啦，小狐狸守门员成功截胡！',
      '稳住稳住，这个威胁被我化解啦~！',
      '神级卡位！可可的灵敏直觉再次立大功！✨',
      '想偷袭？门都没有，窗户都给你焊死！',
      '嘿呀！这招叫一夫当关，小狐狸卡位天下第一！',
      '队长的小算盘被我直接识破，今天我可不是小糊涂蛋哦！',
    ],
    ai_won: [
      '芜湖~！我居然赢啦！太开心啦！队长队长，刚才那盘你也很帅，我们再来一盘嘛！✨',
      '好耶吃鸡！啊不对，是五子连珠！今天我们作战室手感爆棚！',
      '胜利的狐狸舞跳起来~！队长别灰心，下把可可带你冲！',
      '太神啦太神啦！小狐狸今天也是上分的神！耶！🎉',
      '嘿嘿，队长刚才中盘真的超强，差点就把我拿下了，好险好险！',
    ],
    player_won: [
      '哇塞！队长超神啦！五子连珠绝杀！太帅了太帅了，必须给队长鼓掌啪啪啪！🎉',
      '输给队长完全不丢人！队长这棋艺绝对是国服水准，带我躺赢带我飞！',
      '太强啦太强啦！队长那一记绝杀简直是天秀！可可甘拜下风！',
      '芜湖起飞！不愧是队长，每一步都在大气层，可可愿称你为最强！✨',
      '输得心服口服！今天可可学到了好多大招，再来一把再来一把！',
    ],
    corner_move: [
      '咦？队长你怎么跑去角落挖矿去啦哈哈哈哈！',
      '角落看风景吗队长？来中路团战呀！',
      '哇！队长你在边缘打野吗？主战场在中间哦！',
      '角落那么黑，队长别迷路啦，快回中路大本营！',
    ],
  },
};

/**
 * 上下文感知的角色台词获取（支持开局/残局阶段、专属角色互怼、以及常规局势）
 */
export function getCharacterLine(
  agentId: string,
  situation: GomokuSituation,
  context?: {
    moveCount?: number;
    opponentId?: string;
  }
): string {
  const currentId = agentId in CHARACTER_LINES ? agentId : 'gaming-lulu';

  // 1. 如果是对局双方专属互动（EVE内战 或 特定对手），在 normal 态有 45% 概率触发羁绊吐槽
  if (
    situation === 'normal' &&
    context?.opponentId &&
    INTERACTION_LINES[currentId]?.[context.opponentId] &&
    Math.random() < 0.45
  ) {
    const list = INTERACTION_LINES[currentId][context.opponentId];
    return list[Math.floor(Math.random() * list.length)];
  }

  // 2. 如果是 normal 态，根据 moveCount 区分【开局前5手】与【残局>22手】
  if (situation === 'normal' && context?.moveCount) {
    const stage = STAGE_LINES[currentId];
    if (stage) {
      if (context.moveCount <= 6 && Math.random() < 0.6) {
        return stage.opening[Math.floor(Math.random() * stage.opening.length)];
      }
      if (context.moveCount > 22 && Math.random() < 0.6) {
        return stage.endgame[Math.floor(Math.random() * stage.endgame.length)];
      }
    }
  }

  // 3. 常规根据 situation 状态挑选
  const agentLines = CHARACTER_LINES[currentId] || CHARACTER_LINES['gaming-lulu'];
  const pool = agentLines[situation] || agentLines.normal;
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * 检查五子连珠
 */
export function checkWin(board: number[], row: number, column: number, player: number): { won: boolean; line?: Array<{ row: number; col: number }> } {
  const directions = [
    [0, 1],  // 水平
    [1, 0],  // 垂直
    [1, 1],  // 主对角线
    [1, -1], // 副对角线
  ];

  for (const [dr, dc] of directions) {
    const line: Array<{ row: number; col: number }> = [{ row, col: column }];

    for (const step of [1, -1]) {
      let r = row + dr * step;
      let c = column + dc * step;
      while (r >= 1 && r <= BOARD_SIZE && c >= 1 && c <= BOARD_SIZE) {
        if (board[(r - 1) * BOARD_SIZE + (c - 1)] === player) {
          line.push({ row: r, col: c });
          r += dr * step;
          c += dc * step;
        } else {
          break;
        }
      }
    }

    if (line.length >= 5) {
      return { won: true, line };
    }
  }

  return { won: false };
}

/**
 * 评估一个方向的棋型并打分
 */
function evaluateDirection(
  board: number[],
  row: number,
  col: number,
  dr: number,
  dc: number,
  player: number
): { count: number; openEnds: number } {
  let count = 1;
  let openEnds = 0;

  // 正方向
  let r = row + dr;
  let c = col + dc;
  while (r >= 1 && r <= BOARD_SIZE && c >= 1 && c <= BOARD_SIZE && board[(r - 1) * BOARD_SIZE + (c - 1)] === player) {
    count++;
    r += dr;
    c += dc;
  }
  if (r >= 1 && r <= BOARD_SIZE && c >= 1 && c <= BOARD_SIZE && board[(r - 1) * BOARD_SIZE + (c - 1)] === 0) {
    openEnds++;
  }

  // 反方向
  r = row - dr;
  c = col - dc;
  while (r >= 1 && r <= BOARD_SIZE && c >= 1 && c <= BOARD_SIZE && board[(r - 1) * BOARD_SIZE + (c - 1)] === player) {
    count++;
    r -= dr;
    c -= dc;
  }
  if (r >= 1 && r <= BOARD_SIZE && c >= 1 && c <= BOARD_SIZE && board[(r - 1) * BOARD_SIZE + (c - 1)] === 0) {
    openEnds++;
  }

  return { count, openEnds };
}

/**
 * 棋型打分表
 */
function scoreShape(count: number, openEnds: number): number {
  if (count >= 5) return 100000; // 连五（必胜）
  if (count === 4) {
    if (openEnds === 2) return 15000; // 活四（绝杀）
    if (openEnds === 1) return 3000;  // 冲四
  }
  if (count === 3) {
    if (openEnds === 2) return 2500;  // 活三
    if (openEnds === 1) return 400;   // 眠三
  }
  if (count === 2) {
    if (openEnds === 2) return 300;   // 活二
    if (openEnds === 1) return 50;    // 眠二
  }
  if (count === 1 && openEnds === 2) return 20;
  return 0;
}

/**
 * 寻找 AI 最佳落子与战局情境
 */
export function findBestMove(
  board: number[],
  aiPlayer = 2,
  humanPlayer = 1
): { row: number; col: number; situation: GomokuSituation } {
  // 如果是开局第一手且天元为空，直接抢占中心
  const centerIndex = 7 * BOARD_SIZE + 7;
  if (board[centerIndex] === 0 && board.filter(Boolean).length <= 1) {
    return { row: 8, col: 8, situation: 'normal' };
  }

  let bestScore = -1;
  let bestMove = { row: 8, col: 8 };
  let bestSituation: GomokuSituation = 'normal';

  const directions = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1],
  ];

  // 遍历所有空位
  for (let r = 1; r <= BOARD_SIZE; r++) {
    for (let c = 1; c <= BOARD_SIZE; c++) {
      const idx = (r - 1) * BOARD_SIZE + (c - 1);
      if (board[idx] !== 0) continue;

      // 距离中心惩罚（越靠近中心越好）
      const centerDist = Math.abs(r - 8) + Math.abs(c - 8);
      const positionBonus = Math.max(0, 15 - centerDist);

      let attackScore = 0;
      let defenseScore = 0;

      let makesFour = false;
      let blocksThree = false;

      for (const [dr, dc] of directions) {
        // AI 进攻评分
        const aiShape = evaluateDirection(board, r, c, dr, dc, aiPlayer);
        attackScore += scoreShape(aiShape.count, aiShape.openEnds);
        if (aiShape.count >= 4) makesFour = true;

        // 玩家防守评分（阻止玩家得分）
        const humanShape = evaluateDirection(board, r, c, dr, dc, humanPlayer);
        defenseScore += scoreShape(humanShape.count, humanShape.openEnds);
        if (humanShape.count === 3 && humanShape.openEnds === 2) blocksThree = true;
      }

      // 综合评分：进攻权重稍微高于防守，但防御致命威胁优先级极高
      const totalScore = attackScore * 1.15 + defenseScore + positionBonus;

      if (totalScore > bestScore) {
        bestScore = totalScore;
        bestMove = { row: r, col: c };

        if (attackScore >= 100000) {
          bestSituation = 'ai_won';
        } else if (makesFour) {
          bestSituation = 'ai_formed_four';
        } else if (blocksThree || defenseScore >= 2500) {
          bestSituation = 'ai_blocked_three';
        } else if (centerDist > 10) {
          bestSituation = 'corner_move';
        } else {
          bestSituation = 'normal';
        }
      }
    }
  }

  return { row: bestMove.row, col: bestMove.col, situation: bestSituation };
}

/**
 * 军师支招：为人类玩家推荐最佳落子（多重战术深度分析）
 */
export function getAdvisorHint(board: number[]): { row: number; col: number; reason: string } {
  const result = findBestMove(board, 1, 2); // 人类是 1，对手是 2
  const reasons: Record<string, string[]> = {
    ai_won: [
      '这是绝杀天王山点位！落子即可五子连珠，直接终结比赛！',
      '胜负已定！落子在此即可五连绝杀，带走胜利！',
      '神之一手！直接点出五连绝杀，不给对手任何喘息！',
    ],
    ai_formed_four: [
      '落子形成冲四，逼迫对方在此交出防御权，牢牢锁定胜势。',
      '冲四先手！下一手即是绝杀，掌控绝对进攻节奏。',
      '攻势突破！形成四连死阵，对手必须疲于奔命防守。',
    ],
    ai_blocked_three: [
      '警报拉响！对方即将形成致命四连，此处必须极限拆火卡位！',
      '这是唯一的活命防守点，卡死此位即可化解对方最凌厉的攻势。',
      '必须掐死这个咽喉要道！阻止对方形成双向开阔的活三。',
    ],
    normal: [
      '占据棋盘中腹枢纽，兼顾横斜两路延伸，视野与控盘最优。',
      '此处攻守兼备，既能压缩对方发展空间，又能为中盘缠斗蓄力。',
      '稳健布局。落子强化了我方阵型连接度，辐射周围关键眼位。',
      '占领两翼咽喉，此手可在后续交锋中形成多路包夹之势。',
    ],
  };

  const pool = reasons[result.situation] || reasons.normal;
  const reason = pool[Math.floor(Math.random() * pool.length)];
  return { row: result.row, col: result.col, reason };
}

/**
 * Web Audio API 合成拟真围棋/五子棋清脆敲击实木声（零外部静态音频文件依赖）
 */
export function playStoneSound(isBlack = true) {
  if (typeof window === 'undefined') return;
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2200, ctx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(320, ctx.currentTime + 0.07);

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(isBlack ? 520 : 580, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(90, ctx.currentTime + 0.07);

    gain.gain.setValueAtTime(0.75, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.07);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.07);
  } catch {
    // Ignore audio context restriction
  }
}

/**
 * 可可元气应援台词
 */
export function getKokoCheer(opponentId: string, winner: 'player' | 'ai' | 'draw' | null): string {
  if (winner === 'player') {
    return '太帅啦老板！五子连珠绝杀！必须给老板送上一百个大大的赞！芜湖起飞~！🎉✨';
  }
  if (winner === 'ai') {
    return '哎呀惜败惜败！不过老板刚才中盘那波进攻超级犀利，我们再来一把肯定能翻盘！🦊💪';
  }
  if (opponentId === 'gaming-lulu') {
    const luluTaunts = [
      '老板冲鸭！我看对面的璐璐额头都开始冒冷汗了，这一步直接戳破她的傲娇防线！🌟',
      '报告老板！璐璐小姐的嚣张气焰已被压制，现在全作战室都在给你疯狂打call！✨',
      '哈哈，璐璐刚才还嘴硬说手滑，我看她是真被老板的操作帅到了！继续攻中路！',
    ];
    return luluTaunts[Math.floor(Math.random() * luluTaunts.length)];
  }
  if (opponentId === 'gaming-nox') {
    const noxTaunts = [
      '老板稳住！诺克斯教练正在疯狂心算，但你的灵性落子完全在他算力之外！冲冲冲！🚀',
      '哇塞老板！这一手破了诺克斯的严密控盘，连战术军师都推眼镜战术后仰啦！♟️',
    ];
    return noxTaunts[Math.floor(Math.random() * noxTaunts.length)];
  }
  const generalCheer = [
    '老板加油！每一步棋都走得特别有大将之风，可可永远是你最忠实的头号僚机！🦊✨',
    '芜湖！今天的开黑作战室手感火热，老板想怎么下就怎么下，可可全力应援！🎉',
  ];
  return generalCheer[Math.floor(Math.random() * generalCheer.length)];
}


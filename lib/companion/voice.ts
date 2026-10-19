import dataset from './voice-dataset.json';

export interface VoiceLine {
  id: string;
  text: string;
  audioUrl?: string;
  seconds?: number;
}

const lafeiTapLines: VoiceLine[] = [
  { id: 'lafei_tap_1', text: '嗯...指挥官，别揉了，发型要乱了...', seconds: 2.0 },
  { id: 'lafei_tap_2', text: '指挥官的手...意外的温暖呢。', seconds: 2.2 },
  { id: 'lafei_tap_3', text: '再摸下去的话...莱菲会害羞的。', seconds: 2.0 },
  { id: 'lafei_tap_4', text: '指、指挥官！请不要随便碰那里！', seconds: 2.1 },
  { id: 'lafei_tap_5', text: '呜...指挥官是笨蛋。', seconds: 1.6 },
  { id: 'lafei_tap_6', text: '今天的任务已经完成了哦，指挥官。', seconds: 2.2 },
  { id: 'lafei_tap_7', text: '莱菲随时待命，今天也请多指教。', seconds: 2.0 },
];

const lafeiRapidLines: VoiceLine[] = [
  { id: 'lafei_rapid_1', text: '指、指挥官！太...太快了啦！', seconds: 1.8 },
  { id: 'lafei_rapid_2', text: '呜哇...好可怕...指挥官...！', seconds: 1.8 },
  { id: 'lafei_rapid_3', text: '头好晕...指挥官别转了...', seconds: 1.8 },
];

const maoTapLines: VoiceLine[] = [
  { id: 'mao_tap_1', text: '哎呀！弄乱真央的发型了喵~ (｡•́︿•̀｡)', seconds: 2.0 },
  { id: 'mao_tap_2', text: '摸摸头... 真央最喜欢主人了喵！ฅ(๑*д*๑)ฅ', seconds: 2.2 },
  { id: 'mao_tap_3', text: '喵呜？这种感觉... 好像还没被摸够喵~(๑¯∀¯๑)', seconds: 2.2 },
  { id: 'mao_tap_4', text: '不要停喵，真央感觉全身都要软掉啦喵...', seconds: 2.2 },
  { id: 'mao_tap_5', text: '主人的手暖暖的，真央要睡着了喵...💤', seconds: 2.0 },
  { id: 'mao_tap_6', text: '喵呜！主人不可以乱碰这里喵~ (⁄ ⁄•⁄ω⁄•⁄ ⁄)', seconds: 2.2 },
  { id: 'mao_tap_7', text: '真央今天也很努力在工作喵！(*^▽^*)', seconds: 2.0 },
  { id: 'mao_tap_8', text: '肚子饿了喵，主人是不是该上贡小鱼干了喵？', seconds: 2.2 },
];

const maoRapidLines: VoiceLine[] = [
  { id: 'mao_rapid_1', text: '喵——！！主人快住口喵，哦不，快住手喵！', seconds: 2.0 },
  { id: 'mao_rapid_2', text: '主人的手是指控枪吗喵？哒哒哒哒哒地坏透了喵！', seconds: 2.2 },
  { id: 'mao_rapid_3', text: '救命喵！真央的毛都要被你点秃了喵！( *・ω・)', seconds: 2.0 },
  { id: 'mao_rapid_4', text: '再戳一下真央就要炸毛了喵！是真的喵！', seconds: 2.0 },
];

function pickLineIndex(pool: readonly { text: string }[], previousText?: string): number {
  const candidates = pool.map((_, index) => index).filter(index => pool[index].text !== previousText);
  if (!candidates.length) return Math.floor(Math.random() * pool.length);
  return candidates[Math.floor(Math.random() * candidates.length)];
}

export function getRandomTapLine(characterId: string, previousText?: string): VoiceLine {
  if (characterId === 'lafei') {
    return lafeiTapLines[pickLineIndex(lafeiTapLines, previousText)];
  }
  if (characterId === 'mao') {
    return maoTapLines[pickLineIndex(maoTapLines, previousText)];
  }

  const isYume = characterId === 'yume';
  const pool = isYume ? dataset.yume.tap : dataset.nari.tap;
  const index = pickLineIndex(pool, previousText);
  const item = pool[index] || { id: 'fallback', text: '你好呀！', seconds: 1.5 };
  const filename = `tap_${String(index + 1).padStart(2, '0')}.mp3`;
  const folder = isYume ? 'yume' : 'nari';
  return {
    ...item,
    audioUrl: `/companion/audio/voice/${folder}/${filename}`,
  };
}

export function getRapidTapLine(characterId: string, previousText?: string): VoiceLine {
  if (characterId === 'lafei') {
    return lafeiRapidLines[pickLineIndex(lafeiRapidLines, previousText)];
  }
  if (characterId === 'mao') {
    return maoRapidLines[pickLineIndex(maoRapidLines, previousText)];
  }

  const isYume = characterId === 'yume';
  const pool = isYume ? dataset.yume.tap : dataset.nari.tap;
  // 特别筛选带有急促连击反应特征的台词
  const rapidIndexes = isYume
    ? [2, 1, 6, 8, 13] // 别戳我啦、刚才那是干嘛啊、请把手拿开、我才没有慌、别得寸进尺
    : [36, 2, 28, 18, 32]; // 哎呀好快呀(37)、好痒呀哈哈(3)、小心哦我可能会戳回去(29)、总是让我猝不及防(19)、好大胆哦(33)
  const pickedIndex = rapidIndexes[pickLineIndex(rapidIndexes.map(index => pool[index]), previousText)];
  const item = pool[pickedIndex] || pool[0];
  const filename = `tap_${String(pickedIndex + 1).padStart(2, '0')}.mp3`;
  const folder = isYume ? 'yume' : 'nari';
  return {
    ...item,
    audioUrl: `/companion/audio/voice/${folder}/${filename}`,
  };
}

// Nari 精选入场与问候语音 (包含早/中/晚时段专属关怀)
export const nariStartupLines: VoiceLine[] = [
  { id: 'nari_startup_01', text: '嘿，你回来啦！', audioUrl: '/companion/audio/voice/nari/startup_01.mp3', seconds: 1.78 },
  { id: 'nari_startup_02', text: '欢迎回来~', audioUrl: '/companion/audio/voice/nari/startup_02.mp3', seconds: 1.10 },
  { id: 'nari_startup_03', text: '见到你真好，有你在真好！', audioUrl: '/companion/audio/voice/nari/startup_03.mp3', seconds: 2.61 },
  { id: 'nari_startup_04', text: '我就知道你会回来~', audioUrl: '/companion/audio/voice/nari/startup_04.mp3', seconds: 1.96 },
  { id: 'nari_startup_05', text: '这么快就回来了？还是忍不住来找我了吧~', audioUrl: '/companion/audio/voice/nari/startup_05.mp3', seconds: 3.74 },
  { id: 'nari_startup_06', text: '快进来吧，找个位置坐吧。', audioUrl: '/companion/audio/voice/nari/startup_06.mp3', seconds: 2.25 },
  { id: 'nari_startup_07', text: '随意一点，别拘束，歇口气吧。', audioUrl: '/companion/audio/voice/nari/startup_07.mp3', seconds: 2.85 },
  { id: 'nari_startup_08', text: '今天有什么打算呀？', audioUrl: '/companion/audio/voice/nari/startup_08.mp3', seconds: 1.70 },
  { id: 'nari_startup_09', text: '想聊聊天吗？我洗耳恭听哦。', audioUrl: '/companion/audio/voice/nari/startup_09.mp3', seconds: 2.43 },
  { id: 'nari_startup_10', text: '早呀早呀，起床啦，太阳晒屁股了！', audioUrl: '/companion/audio/voice/nari/startup_10.mp3', seconds: 3.60 },
  { id: 'nari_startup_11', text: '下午好呀，今天过得顺心吗？', audioUrl: '/companion/audio/voice/nari/startup_11.mp3', seconds: 2.30 },
  { id: 'nari_startup_12', text: '晚上好呀，今天辛苦啦，早点休息哦。', audioUrl: '/companion/audio/voice/nari/startup_12.mp3', seconds: 3.27 },
];

// Nari 精选拖拽/视线引导趣味反应语音 (逗弄转头与视线追踪)
export const nariDragLines: VoiceLine[] = [
  { id: 'nari_drag_01', text: '哎呀别晃啦，头都被你转晕了~ 💫', audioUrl: '/companion/audio/voice/nari/drag_01.mp3', seconds: 3.03 },
  { id: 'nari_drag_02', text: '哇，好晕好晕！', audioUrl: '/companion/audio/voice/nari/drag_02.mp3', seconds: 2.14 },
  { id: 'nari_drag_03', text: '你在引我往哪儿看呀？我都眼花啦~', audioUrl: '/companion/audio/voice/nari/drag_03.mp3', seconds: 3.45 },
  { id: 'nari_drag_04', text: '哈哈，你想对我做什么呀？', audioUrl: '/companion/audio/voice/nari/drag_04.mp3', seconds: 2.48 },
  { id: 'nari_drag_05', text: '你转来转去的，是在故意逗我嘛？嘻嘻~', audioUrl: '/companion/audio/voice/nari/drag_05.mp3', seconds: 3.50 },
  { id: 'nari_drag_06', text: '不管你移到哪儿，我都一直看着你呢~ ✨', audioUrl: '/companion/audio/voice/nari/drag_06.mp3', seconds: 2.80 },
];

// Yume 精选入场与问候语音 (包含傲娇元气早/中/晚专属时段)
export const yumeStartupLines: VoiceLine[] = [
  { id: 'yume_startup_01', text: '嘿，你回来了。', audioUrl: '/companion/audio/voice/yume/startup_01.mp3', seconds: 2.0 },
  { id: 'yume_startup_02', text: '欢迎回来~ 哼，我可没一直等你哦！', audioUrl: '/companion/audio/voice/yume/startup_02.mp3', seconds: 3.0 },
  { id: 'yume_startup_03', text: '喂喂，干嘛？又来找我啦？', audioUrl: '/companion/audio/voice/yume/startup_03.mp3', seconds: 2.4 },
  { id: 'yume_startup_04', text: '哟，看看是谁来了~', audioUrl: '/companion/audio/voice/yume/startup_04.mp3', seconds: 2.0 },
  { id: 'yume_startup_05', text: '你总算来了，等你半天了！', audioUrl: '/companion/audio/voice/yume/startup_05.mp3', seconds: 2.6 },
  { id: 'yume_startup_06', text: '你又来啦，今天有什么打算？', audioUrl: '/companion/audio/voice/yume/startup_06.mp3', seconds: 2.5 },
  { id: 'yume_startup_07', text: '快进来吧，今天也要打起精神来哦！', audioUrl: '/companion/audio/voice/yume/startup_07.mp3', seconds: 2.8 },
  { id: 'yume_startup_08', text: '有什么新鲜事吗？快跟我讲讲~', audioUrl: '/companion/audio/voice/yume/startup_08.mp3', seconds: 2.5 },
  { id: 'yume_startup_09', text: '想找我聊天？那本小姐就勉为其难听听吧~', audioUrl: '/companion/audio/voice/yume/startup_09.mp3', seconds: 3.2 },
  { id: 'yume_startup_10', text: '早啊！起床啦，今天可不许偷懒哦！', audioUrl: '/companion/audio/voice/yume/startup_10.mp3', seconds: 3.0 },
  { id: 'yume_startup_11', text: '下午好呀！今天过得还顺利吗？', audioUrl: '/companion/audio/voice/yume/startup_11.mp3', seconds: 2.4 },
  { id: 'yume_startup_12', text: '晚上好呀！今天辛苦啦，早点休息别熬夜哦。', audioUrl: '/companion/audio/voice/yume/startup_12.mp3', seconds: 3.2 },
];

// Yume 精选拖拽趣味反应语音
export const yumeDragLines: VoiceLine[] = [
  { id: 'yume_drag_01', text: '喂，你在干什么！快放我下来啦！', audioUrl: '/companion/audio/voice/yume/drag_01.mp3', seconds: 2.5 },
  { id: 'yume_drag_02', text: '别这样晃来晃去啦，头都要被你转晕了！💫', audioUrl: '/companion/audio/voice/yume/drag_02.mp3', seconds: 3.2 },
  { id: 'yume_drag_03', text: '哎，慢点慢点，天哪！', audioUrl: '/companion/audio/voice/yume/drag_03.mp3', seconds: 2.2 },
  { id: 'yume_drag_04', text: '我可没求你这样转我，晕死啦！', audioUrl: '/companion/audio/voice/yume/drag_04.mp3', seconds: 2.6 },
  { id: 'yume_drag_05', text: '这一点都不好玩！...好吧，其实有一点点？', audioUrl: '/companion/audio/voice/yume/drag_05.mp3', seconds: 3.4 },
  { id: 'yume_drag_06', text: '哼，不管你把视线移到哪儿，我都一直看着你呢！✨', audioUrl: '/companion/audio/voice/yume/drag_06.mp3', seconds: 3.2 },
];

export function getRandomStartupLine(characterId: string): VoiceLine {
  if (characterId === 'lafei') {
    return { id: 'lafei_startup', text: '指挥官，欢迎回来。莱菲一直在等你。', seconds: 2.2 };
  }
  if (characterId === 'mao') {
    return { id: 'mao_startup', text: '喵~ 主人你回来啦！真央一直在这里等你喵~(ฅ´ω`ฅ)', seconds: 2.2 };
  }
  if (characterId === 'nari') {
    const hour = new Date().getHours();
    // 50% 概率触发符合当下时段的问候，50% 概率走通用日常欢迎
    const useTimeGreeting = Math.random() < 0.5;
    if (useTimeGreeting) {
      if (hour >= 5 && hour < 12) {
        return nariStartupLines[9]; // 早呀早呀，起床啦，太阳晒屁股了！
      } else if (hour >= 12 && hour < 18) {
        return nariStartupLines[10]; // 下午好呀，今天过得顺心吗？
      } else {
        return nariStartupLines[11]; // 晚上好呀，今天辛苦啦，早点休息哦。
      }
    }
    const general = nariStartupLines.slice(0, 9);
    return general[Math.floor(Math.random() * general.length)];
  }
  if (characterId === 'yume') {
    const hour = new Date().getHours();
    const useTimeGreeting = Math.random() < 0.5;
    if (useTimeGreeting) {
      if (hour >= 5 && hour < 12) {
        return yumeStartupLines[9]; // 早啊！起床啦，今天可不许偷懒哦！
      } else if (hour >= 12 && hour < 18) {
        return yumeStartupLines[10]; // 下午好呀！今天过得还顺利吗？
      } else {
        return yumeStartupLines[11]; // 晚上好呀！今天辛苦啦，早点休息别熬夜哦。
      }
    }
    const general = yumeStartupLines.slice(0, 9);
    return general[Math.floor(Math.random() * general.length)];
  }

  const pool = dataset.nari.startup;
  return pool[Math.floor(Math.random() * pool.length)] || { id: 'fallback', text: '初次见面，很高兴认识你！', seconds: 1.5 };
}

export function getRandomDragLine(characterId: string): VoiceLine {
  if (characterId === 'lafei') {
    return { id: 'lafei_drag', text: '要出发了吗？莱菲随时待命。', seconds: 1.8 };
  }
  if (characterId === 'mao') {
    return { id: 'mao_drag', text: '起飞喵！这就是云端的感觉吗喵？', seconds: 1.8 };
  }
  if (characterId === 'nari') {
    return nariDragLines[Math.floor(Math.random() * nariDragLines.length)];
  }
  if (characterId === 'yume') {
    return yumeDragLines[Math.floor(Math.random() * yumeDragLines.length)];
  }
  const pool = dataset.nari.drag;
  return pool[Math.floor(Math.random() * pool.length)] || { id: 'fallback', text: '快放我下来~', seconds: 1.5 };
}

export { dataset as companionVoiceDataset };

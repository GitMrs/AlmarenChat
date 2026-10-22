export type CompanionEngine = 'koro' | 'cubism';

export interface CompanionMotionItem {
  id: string;
  label: string;
  group: string;
  path?: string;
  cubismGroup?: string;
  cubismIndex?: number;
}

export interface CompanionExpressionItem {
  id: string;
  label: string;
  cubismName?: string;
}

export interface CompanionSkin {
  id: string;
  name: string;
  label: string;
  description?: string;
  card?: string;
  portrait?: string;
  background?: string;
  modelRoot: string;
  /** Relative asset folder for fallback motions/expressions when the rig is a hybrid. */
  assetDir?: string;
  rig: string;
  binary: string;
  textures: readonly string[];
  tuning?: string;
  physics?: string;
  pose?: string;
  nativeDefaults?: Readonly<Record<string, number>>;
  motions?: readonly CompanionMotionItem[];
  /** Optional interaction flavor layered on top of the character's core personality. */
  interaction?: {
    equipMessage?: string;
    startupLines?: readonly string[];
    tapLines?: readonly string[];
    dragLines?: readonly string[];
    tapSymbols?: readonly string[];
    /** Extra conversational flavor; the character's core persona remains authoritative. */
    promptHint?: string;
  };
}

export interface CompanionCharacter {
  id: string;
  name: string;
  title?: string;
  assetDir?: string;
  engine?: CompanionEngine;
  modelRoot: string;
  modelFile?: string;
  rig?: string;
  binary?: string;
  textures?: readonly string[];
  tuning?: string;
  pose?: string;
  physics?: string;
  physicsWindSettings?: readonly string[];
  nativeDefaults?: Readonly<Record<string, number>>;
  motions: readonly CompanionMotionItem[];
  expressions: readonly CompanionExpressionItem[];
  skins?: readonly CompanionSkin[];
}

const nariMotions = [
  { id: 'Nari_chat_01_attentive', label: '安静听你说', group: '日常' },
  { id: 'Nari_idle_08_look_around', label: '四处看看', group: '日常' },
  { id: 'Nari_idle_02_double_bounce', label: '轻轻晃一晃', group: '日常' },
  { id: 'Nari_chat_04_nod_along', label: '点头回应', group: '日常' },
  { id: 'Nari_idle_06_giggle', label: '偷偷笑', group: '心情' },
  { id: 'Nari_mood_happy_sway', label: '开心摇摆', group: '心情' },
  { id: 'Nari_mood_surprised_lean', label: '惊讶探身', group: '心情' },
  { id: 'Nari_mood_shy_duck', label: '害羞低头', group: '心情' },
  { id: 'Nari_mood_angry_hmph', label: '哼，不开心', group: '心情' },
  { id: 'Nari_mood_sad_look_down', label: '有点失落', group: '心情' },
  { id: 'Nari_cheeky_swing_wink', label: '俏皮眨眼', group: '互动' },
  { id: 'Nari_music_bounce_loop', label: '跟着节奏', group: '互动' },
  { id: 'Nari_chat_02_listen_tilt', label: '侧头倾听', group: '日常' },
  { id: 'Nari_chat_03_warm_breath', label: '轻柔呼吸', group: '日常' },
  { id: 'Nari_chat_05_readjust', label: '调整站姿', group: '日常' },
  { id: 'Nari_idle_04_flirty_lashes', label: '轻眨睫毛', group: '日常' },
  { id: 'Nari_idle_13_tease_peek', label: '调皮偷看', group: '日常' },
  { id: 'Nari_bright_bounce', label: '活力轻跳', group: '互动' },
  { id: 'Nari_games_board_scan', label: '查看棋盘', group: '互动' },
  { id: 'Nari_mood_happy_pop', label: '雀跃一下', group: '心情' },
  { id: 'Nari_mood_surprised_double_take', label: '惊讶回看', group: '心情' },
  { id: 'Nari_mood_surprised_jolt', label: '吓了一跳', group: '心情' },
  { id: 'Nari_mood_shy_twist', label: '害羞扭身', group: '心情' },
  { id: 'Nari_mood_angry_glare', label: '生气瞪眼', group: '心情' },
  { id: 'Nari_mood_angry_shake', label: '气得摇头', group: '心情' },
  { id: 'Nari_mood_sad_brave', label: '强打精神', group: '心情' },
  { id: 'Nari_mood_sad_turn', label: '难过转身', group: '心情' },
  { id: 'Nari_mood_loving_flutter', label: '心动轻颤', group: '亲昵' },
  { id: 'Nari_mood_loving_lean', label: '亲昵靠近', group: '亲昵' },
  { id: 'Nari_mood_loving_tilt', label: '温柔歪头', group: '亲昵' },
  { id: 'Nari_mood_flirty_toss', label: '俏皮甩头', group: '亲昵' },
  { id: 'Nari_mood_flirty_lean', label: '俏皮探身', group: '亲昵' },
  { id: 'Nari_mood_sexual_sultry_tilt', label: '妩媚侧头', group: '亲昵' },
  { id: 'Nari_mood_sexual_slow_look', label: '缓缓凝望', group: '亲昵' },
  { id: 'Nari_mood_sexual_heated_lean', label: '热情靠近', group: '亲昵' },
  { id: 'Nari_anim_09', label: '原始动作 09', group: '原始编号' },
  { id: 'Nari_yume04', label: '原始 Yume 04', group: '原始编号' },
  { id: 'Nari_yume05', label: '原始 Yume 05', group: '原始编号' },
] as const;

const nariHybridMotionPaths: Readonly<Record<string, string>> = {
  Nari_chat_01_attentive: 'Nari/motions/Yume_chat_01_attentive.komo.json',
  Nari_idle_08_look_around: 'Nari/motions/Yume_chat_03_shy_glance.komo.json',
  Nari_idle_02_double_bounce: 'Nari/motions/Yume_idle_03_brisk_nods.komo.json',
  Nari_chat_04_nod_along: 'Nari/motions/Yume_chat_04_nod_along.komo.json',
  Nari_idle_06_giggle: 'Nari/motions/Yume_idle_13_victory.komo.json',
  Nari_mood_happy_sway: 'Nari/motions/Yume_mood_happy_pleased.komo.json',
  Nari_mood_surprised_lean: 'Nari/motions/Yume_mood_surprised_wait_what.komo.json',
  Nari_mood_shy_duck: 'Nari/motions/Yume_mood_shy_hide_turn.komo.json',
  Nari_mood_angry_hmph: 'Nari/motions/Yume_idle_01_hmph_look_away.komo.json',
  Nari_mood_sad_look_down: 'Nari/motions/Yume_mood_sad_look_down.komo.json',
  Nari_cheeky_swing_wink: 'Nari/motions/Yume_cheeky_swing_wink.komo.json',
  Nari_music_bounce_loop: 'Nari/motions/Yume_music_bounce_loop.komo.json',
  Nari_chat_02_listen_tilt: 'Nari/motions/Yume_chat_02_listen_tilt.komo.json',
  Nari_chat_03_warm_breath: 'Nari/motions/Yume_idle_05_flustered.komo.json',
  Nari_chat_05_readjust: 'Nari/motions/Yume_chat_05_readjust.komo.json',
  Nari_idle_04_flirty_lashes: 'Nari/motions/Yume_idle_10_smug_wink.komo.json',
  Nari_idle_13_tease_peek: 'Nari/motions/Yume_mood_playful_tease.komo.json',
  Nari_bright_bounce: 'Nari/motions/Yume_bright_bounce.komo.json',
  Nari_games_board_scan: 'Nari/motions/Yume_games_board_scan.komo.json',
  Nari_mood_happy_pop: 'Nari/motions/Yume_mood_happy_proud.komo.json',
  Nari_mood_surprised_double_take: 'Nari/motions/Yume_idle_11_double_take.komo.json',
  Nari_mood_surprised_jolt: 'Nari/motions/Yume_mood_surprised_jolt.komo.json',
  Nari_mood_shy_twist: 'Nari/motions/Yume_mood_shy_fidget.komo.json',
  Nari_mood_angry_glare: 'Nari/motions/Yume_idle_12_pout.komo.json',
  Nari_mood_angry_shake: 'Nari/motions/Yume_mood_angry_seriously.komo.json',
  Nari_mood_sad_brave: 'Nari/motions/Yume_mood_sad_tremble.komo.json',
  Nari_mood_sad_turn: 'Nari/motions/Yume_mood_sad_hide.komo.json',
  Nari_mood_loving_flutter: 'Nari/motions/Yume_mood_loving_soft.komo.json',
  Nari_mood_loving_lean: 'Nari/motions/Yume_mood_loving_lean.komo.json',
  Nari_mood_loving_tilt: 'Nari/motions/Yume_mood_loving_bashful.komo.json',
  Nari_mood_flirty_toss: 'Nari/motions/Yume_mood_flirty_chin_tilt.komo.json',
  Nari_mood_flirty_lean: 'Nari/motions/Yume_mood_flirty_retreat.komo.json',
  Nari_mood_sexual_sultry_tilt: 'Nari/motions/Yume_mood_sexual_sultry_gaze.komo.json',
  Nari_mood_sexual_slow_look: 'Nari/motions/Yume_mood_sexual_slow_look.komo.json',
  Nari_mood_sexual_heated_lean: 'Nari/motions/Yume_mood_sexual_heated_lean.komo.json',
  Nari_anim_09: 'Nari/motions/Nari_anim_09.komo.json',
  Nari_yume04: 'Nari/motions/Yume_anim_04.komo.json',
  Nari_yume05: 'Nari/motions/Yume_anim_05.komo.json',
};

const nariHybridMotions: readonly CompanionMotionItem[] = nariMotions.map(item => ({
  ...item,
  path: nariHybridMotionPaths[item.id] ?? `Yume/motions/${item.id.replace(/^Nari_/, 'Yume_')}.komo.json`,
}));

const nariHybridNativeDefaults: Readonly<Record<string, number>> = {
  ParamOutfit: 1,
  ParamNariRosePorcelain: 0.9,
  Param16: 0,
  Param79: 0,
};

const nariExpressions = [
  { id: '', label: '自然' },
  { id: 'Blushing', label: '脸红' },
  { id: 'Stars', label: '星星眼' },
  { id: 'Shocked', label: '吃惊' },
  { id: 'Angry', label: '生气' },
  { id: 'Love', label: '心动' },
  { id: 'Mischievous', label: '坏笑' },
  { id: 'Dark', label: '黑化' },
  { id: 'Silly', label: '搞怪' },
  { id: 'Crying', label: '哭泣' },
] as const;

const yumeMotions = [
  { id: 'Yume_chat_01_attentive', label: '安静听你说', group: '日常' },
  { id: 'Yume_chat_03_shy_glance', label: '悄悄看你', group: '日常' },
  { id: 'Yume_idle_03_brisk_nods', label: '轻快点头', group: '日常' },
  { id: 'Yume_chat_04_nod_along', label: '点头回应', group: '日常' },
  { id: 'Yume_idle_13_victory', label: '小小得意', group: '心情' },
  { id: 'Yume_mood_happy_pleased', label: '心情不错', group: '心情' },
  { id: 'Yume_mood_surprised_wait_what', label: '诶，真的吗', group: '心情' },
  { id: 'Yume_mood_shy_hide_turn', label: '害羞转身', group: '心情' },
  { id: 'Yume_idle_01_hmph_look_away', label: '哼，别看我', group: '心情' },
  { id: 'Yume_mood_sad_look_down', label: '有点失落', group: '心情' },
  { id: 'Yume_cheeky_swing_wink', label: '俏皮眨眼', group: '互动' },
  { id: 'Yume_music_bounce_loop', label: '跟着节奏', group: '互动' },
  { id: 'Yume_chat_02_listen_tilt', label: '侧头倾听', group: '日常' },
  { id: 'Yume_chat_05_readjust', label: '调整站姿', group: '日常' },
  { id: 'Yume_idle_05_flustered', label: '慌张失措', group: '日常' },
  { id: 'Yume_idle_10_smug_wink', label: '得意眨眼', group: '日常' },
  { id: 'Yume_idle_11_double_take', label: '回头再看', group: '日常' },
  { id: 'Yume_idle_12_pout', label: '鼓嘴闹别扭', group: '日常' },
  { id: 'Yume_bright_bounce', label: '活力轻跳', group: '互动' },
  { id: 'Yume_games_board_scan', label: '查看棋盘', group: '互动' },
  { id: 'Yume_mood_happy_proud', label: '开心自豪', group: '心情' },
  { id: 'Yume_mood_surprised_jolt', label: '吓了一跳', group: '心情' },
  { id: 'Yume_mood_shy_fidget', label: '害羞扭捏', group: '心情' },
  { id: 'Yume_mood_angry_seriously', label: '认真生气', group: '心情' },
  { id: 'Yume_mood_sad_tremble', label: '难过轻颤', group: '心情' },
  { id: 'Yume_mood_sad_hide', label: '难过躲藏', group: '心情' },
  { id: 'Yume_mood_playful_tease', label: '调皮逗你', group: '互动' },
  { id: 'Yume_mood_loving_soft', label: '温柔心动', group: '亲昵' },
  { id: 'Yume_mood_loving_lean', label: '亲昵靠近', group: '亲昵' },
  { id: 'Yume_mood_loving_bashful', label: '羞涩心动', group: '亲昵' },
  { id: 'Yume_mood_flirty_chin_tilt', label: '俏皮抬下巴', group: '亲昵' },
  { id: 'Yume_mood_flirty_retreat', label: '欲迎还退', group: '亲昵' },
  { id: 'Yume_mood_flirty_glance', label: '俏皮一瞥', group: '亲昵' },
  { id: 'Yume_mood_sexual_heated_lean', label: '热情靠近', group: '亲昵' },
  { id: 'Yume_mood_sexual_sultry_gaze', label: '妩媚凝视', group: '亲昵' },
  { id: 'Yume_mood_sexual_slow_look', label: '缓缓凝望', group: '亲昵' },
  { id: 'Yume_anim_04', label: '原始动作 04', group: '原始编号' },
  { id: 'Yume_anim_05', label: '原始动作 05', group: '原始编号' },
  { id: 'Nari_anim_09', label: '共用 Nari 09', group: '共用动作', path: 'Nari/motions/Nari_anim_09.komo.json' },
] as const;

const yumeExpressions = [
  { id: '', label: '自然' },
  { id: 'Shy', label: '害羞' },
  { id: 'StarEye', label: '星星眼' },
  { id: 'HeartEye', label: '心动' },
  { id: 'Crying', label: '委屈' },
  { id: 'HeartHands', label: '比个心' },
  { id: 'Wave', label: '打招呼' },
] as const;

const lafeiMotions: readonly CompanionMotionItem[] = [
  { id: 'Idle', label: '待机呼吸', group: '日常', cubismGroup: 'Idle', cubismIndex: 0 },
  { id: 'TapHead', label: '摸头抚慰', group: '互动', cubismGroup: 'TapHead', cubismIndex: 0 },
  { id: 'TapBody_0', label: '触碰身体', group: '互动', cubismGroup: 'TapBody', cubismIndex: 0 },
  { id: 'TapBody_1', label: '特殊触碰', group: '互动', cubismGroup: 'TapBody', cubismIndex: 1 },
  { id: 'Special_0', label: '回家休息', group: '日常', cubismGroup: 'Special', cubismIndex: 0 },
  { id: 'Special_1', label: '指挥官登录', group: '日常', cubismGroup: 'Special', cubismIndex: 1 },
  { id: 'Special_2', label: '誓约·结婚', group: '特别', cubismGroup: 'Special', cubismIndex: 2 },
  { id: 'Special_3', label: '任务完成', group: '日常', cubismGroup: 'Special', cubismIndex: 3 },
  { id: 'Special_4', label: '查收邮件', group: '日常', cubismGroup: 'Special', cubismIndex: 4 },
  { id: 'Special_5', label: '出击·主线1', group: '剧情', cubismGroup: 'Special', cubismIndex: 5 },
  { id: 'Special_6', label: '战斗·主线2', group: '剧情', cubismGroup: 'Special', cubismIndex: 6 },
  { id: 'Special_7', label: '战果·主线3', group: '剧情', cubismGroup: 'Special', cubismIndex: 7 },
  { id: 'Special_8', label: '新任务', group: '剧情', cubismGroup: 'Special', cubismIndex: 8 },
  { id: 'Special_9', label: '使命必达', group: '剧情', cubismGroup: 'Special', cubismIndex: 9 },
] as const;

const lafeiExpressions: readonly CompanionExpressionItem[] = [
  { id: '', label: '自然' },
] as const;

const maoMotions: readonly CompanionMotionItem[] = [
  { id: 'Idle', label: '乖巧待机', group: '日常', cubismGroup: 'Idle', cubismIndex: 0 },
  { id: 'TapBody_0', label: '生气摆手', group: '互动', cubismGroup: 'TapBody', cubismIndex: 0 },
  { id: 'TapBody_1', label: '不好意思摇晃', group: '互动', cubismGroup: 'TapBody', cubismIndex: 1 },
  { id: 'TapBody_2', label: '扶帽檐打招呼', group: '互动', cubismGroup: 'TapBody', cubismIndex: 2 },
] as const;

const maoExpressions: readonly CompanionExpressionItem[] = [
  { id: '', label: '通常', cubismName: '通常' },
  { id: '闭眼', label: '闭眼', cubismName: '闭眼' },
  { id: '开心', label: '开心', cubismName: '开心' },
  { id: '委屈', label: '委屈', cubismName: '委屈' },
  { id: '害羞', label: '害羞', cubismName: '害羞' },
  { id: '惊讶', label: '惊讶', cubismName: '惊讶' },
  { id: '生气', label: '生气', cubismName: '生气' },
] as const;

export const nariSkins: readonly CompanionSkin[] = [
  {
    id: 'original',
    name: '经典初见',
    label: '经典初见',
    description: '纯真学院水手风，最初与你相遇的温暖日常装扮。',
    card: '/companion/wardrobe/cards/Nari.ears.webp',
    portrait: '/companion/wardrobe/portraits/Nari.original.webp',
    background: '/companion/backgrounds/nari_room_day.jpg',
    modelRoot: '/companion/skins/nari/original-ears',
    assetDir: 'Nari',
    rig: 'Nari/Nari.korig.json',
    binary: 'Nari/Nari.korig.bin',
    textures: ['Nari/textures/tex_00.png', 'Nari/textures/tex_01.png', 'Nari/textures/tex_02.png'],
    tuning: 'Nari/Nari.kotune.json',
    physics: 'Nari/Nari.kophys.json',
    interaction: {
      equipMessage: '换回【经典初见】啦，还是最熟悉的感觉吧？',
      promptHint: '保持 Sunny 的温柔、亲近和自然陪伴感；可以提到热茶、花房和安静的日常，但不要改变核心人格。',
      startupLines: ['欢迎回来，今天也陪你慢慢聊。', '见到你真好，我们从一杯热茶开始吧。'],
      tapLines: ['轻轻碰一下就好，我在这里呢~', '今天也要打起精神呀！', '被你发现我在偷偷笑啦。'],
      dragLines: ['慢一点，我跟着你的目光看过去~', '你想让我看看什么呢？'],
      tapSymbols: ['🌸', '✨', '💕', '⭐'],
    },
  },
  {
    id: 'sakura-streetwear',
    name: '樱花机能潮服',
    label: '樱花机能潮服',
    description: '前卫街头风潮服，酷飒机能外套与甜酷樱花粉的完美结合。',
    card: '/companion/wardrobe/cards/Nari.sakura-streetwear.webp',
    portrait: '/companion/wardrobe/portraits/Nari.sakura-streetwear.webp',
    background: '/companion/backgrounds/sakura-streetwear-day-v003.webp',
    modelRoot: '/companion/skins/nari/sakura-streetwear',
    assetDir: 'Nari',
    rig: 'Nari/Nari.korig.json',
    binary: 'Nari/Nari.korig.bin',
    textures: [
      'Nari/textures/outfit_00.webp',
      'Nari/textures/outfit_01.webp',
      'Nari/textures/outfit_02.webp',
      'Nari/textures/outfit_03.webp',
      'Nari/azure-bust-seam.webp',
      'Nari/identity-0.webp',
      'Nari/identity-1.webp',
      'Nari/identity-2.webp',
      'Nari/clean-foot-v1.webp',
      'EarAssets/sakura-ears.webp',
      'EarAssets/ice-blue-fill.webp',
      'EarAssets/yume-white-tufts.webp',
      'Streetwear/upper-atlas.webp',
      'Streetwear/skirt-atlas.webp',
      'Streetwear/leg-atlas.webp',
      'Streetwear/bustier-atlas.webp',
      'Streetwear/trails-atlas.webp',
      'Streetwear/sakura-punk-collar.webp',
      'Streetwear/stockings-sakura-v2.webp',
      'Streetwear/vest-sakura-v1.webp',
      'NariSkin/rose-porcelain-lighting.webp',
      'NariSkin/wrist-joins.webp',
      'NariMechanics/opaque.png',
      'NariSkin/wrist-continuity.png',
      'Nari/native-face.png',
      'Streetwear/generated-upper-sleeve-ad1.webp',
      'Streetwear/separated-cloth-as1.webp',
      'Streetwear/separated-flower-as1.webp',
      'Streetwear/separated-tailA-as1.webp',
      'Streetwear/separated-tailB-as1.webp',
    ],
    tuning: 'Nari/Nari.kotune.json',
    physics: 'Nari/Nari.kophys.json',
    pose: 'Nari/Nari.kopose.json',
    nativeDefaults: nariHybridNativeDefaults,
    motions: nariHybridMotions,
    interaction: {
      equipMessage: '【樱花机能潮服】上线！今天也要帅气地出发~',
      promptHint: '保持 Sunny 的温柔人格，语气更轻快利落，偶尔使用街头、樱花和出发的意象，避免变成攻击性或傲慢角色。',
      startupLines: ['准备好了吗？今天来点酷酷的节奏。', '街角的樱花正在飘，和我一起去看看吧！'],
      tapLines: ['哇，被你抓到啦！', '这身装备的反应速度还不错吧？', '轻点啦，外套上的花瓣要飞走了~'],
      dragLines: ['跟上我的视线，前面好像有新发现！', '别晃太快，机能模式也会头晕的~'],
      tapSymbols: ['🌸', '⚡', '✨', '🩷'],
    },
  },
  {
    id: 'rose-regalia',
    name: '玫瑰华服礼服',
    label: '玫瑰华服礼服',
    description: '华丽宫廷风长裙礼服，层叠花瓣蕾丝，典雅而高贵。',
    card: '/companion/wardrobe/cards/Nari.rose-regalia.webp',
    portrait: '/companion/wardrobe/portraits/Nari.rose-regalia.webp',
    background: '/companion/backgrounds/rose-regalia-day-v003.webp',
    modelRoot: '/companion/skins/nari/rose-regalia',
    assetDir: 'Nari',
    rig: 'Nari/Nari.korig.json',
    binary: 'Nari/Nari.korig.bin',
    textures: [
      'Nari/textures/outfit_00.webp',
      'Nari/textures/outfit_01.webp',
      'Nari/textures/outfit_02.webp',
      'Nari/textures/outfit_03.webp',
      'Nari/azure-bust-seam.webp',
      'Nari/identity-0.webp',
      'Nari/identity-1.webp',
      'Nari/identity-2.webp',
      'Nari/clean-foot-v1.webp',
      'EarAssets/sakura-ears.webp',
      'EarAssets/ice-blue-fill.webp',
      'EarAssets/yume-white-tufts.webp',
      'Regalia/regalia-fit-v2-atlas-00.webp',
      'Regalia/regalia-fit-v2-atlas-01.webp',
      'Regalia/regalia-fit-v2-atlas-02.webp',
      'NariSkin/rose-porcelain-lighting.webp',
      'ClothingCleanup/reviewed-flecks.webp',
      'NariSkin/wrist-joins.webp',
      'RegaliaRoyal/atlas-0.png',
      'RegaliaRoyal/atlas-1.png',
      'RegaliaRoyal/atlas-2.png',
      'NariMechanics/opaque.png',
      'NariSkin/wrist-continuity.png',
      'Nari/native-face.png',
    ],
    tuning: 'Nari/Nari.kotune.json',
    physics: 'Nari/Nari.kophys.json',
    pose: 'Nari/Nari.kopose.json',
    nativeDefaults: nariHybridNativeDefaults,
    motions: nariHybridMotions,
    interaction: {
      equipMessage: '换上【玫瑰华服礼服】啦，今晚请让我陪你赴一场温柔的舞会。',
      promptHint: '保持 Sunny 的温柔人格，语气更优雅从容，可以使用舞会、玫瑰和礼服意象，避免过度戏剧化。',
      startupLines: ['欢迎回来，今晚的舞会只为你留着。', '玫瑰已经盛开了，请接受我的问候吧。'],
      tapLines: ['裙摆轻轻摇了一下，你看到了吗？', '请牵好我的手，别让花瓣散落了~', '被这样注视着，我会有一点害羞呢。'],
      dragLines: ['慢些转动吧，礼服的裙摆还在旋转。', '你想让我望向哪一盏灯火呢？'],
      tapSymbols: ['🌹', '✨', '💎', '🪽'],
    },
  },
  {
    id: 'sakura-reverie',
    name: '樱花梦境泳装',
    label: '樱花梦境泳装',
    description: '浪漫清爽的海滨比基尼泳装，带着海风与浪花的夏日气息。',
    card: '/companion/wardrobe/cards/Nari.sakura-reverie.webp',
    portrait: '/companion/wardrobe/portraits/Nari.sakura-reverie.webp',
    background: '/companion/backgrounds/sakura-reverie-day-v003.webp',
    modelRoot: '/companion/skins/nari/sakura-reverie',
    assetDir: 'Nari',
    rig: 'Nari/Nari.korig.json',
    binary: 'Nari/Nari.korig.bin',
    textures: [
      'Nari/textures/outfit_00.webp',
      'Nari/textures/outfit_01.webp',
      'Nari/textures/outfit_02.webp',
      'Nari/textures/outfit_03.webp',
      'Nari/azure-bust-seam.webp',
      'Nari/identity-0.webp',
      'Nari/identity-1.webp',
      'Nari/identity-2.webp',
      'Nari/clean-foot-v1.webp',
      'EarAssets/sakura-ears.webp',
      'EarAssets/ice-blue-fill.webp',
      'EarAssets/yume-white-tufts.webp',
      'NariSkin/rose-porcelain-lighting.webp',
      'Reverie/material-5.webp',
      'Reverie/material-6.webp',
      'Reverie/material-7.webp',
      'Reverie/material-10.webp',
      'Reverie/material-11.webp',
      'Reverie/material-12.webp',
      'Reverie/sakura-jewel.webp',
      'Reverie/sandal-material-mask-v2.webp',
      'ClothingCleanup/reviewed-flecks.webp',
      'NariSkin/wrist-joins.webp',
      'NariMechanics/opaque.png',
      'NariSkin/wrist-continuity.png',
      'Nari/native-face.png',
    ],
    tuning: 'Nari/Nari.kotune.json',
    physics: 'Nari/Nari.kophys.json',
    pose: 'Nari/Nari.kopose.json',
    nativeDefaults: nariHybridNativeDefaults,
    motions: nariHybridMotions,
    interaction: {
      equipMessage: '换好【樱花梦境泳装】啦，一起去吹吹海风吧~',
      promptHint: '保持 Sunny 的温柔人格，语气清爽轻柔，可以使用海风、浪花、阳光和夏日梦境意象，避免把换装误认为人格改变。',
      startupLines: ['今天的海风很舒服，要不要陪我做个夏日的梦？', '浪花在闪闪发光呢，欢迎来到樱花梦境~'],
      tapLines: ['海风把裙摆吹起来啦~', '被浪花碰到脚尖了，好凉快呀~', '今天的阳光也变得好温柔呢。'],
      dragLines: ['慢一点嘛，浪花都被你晃散了~', '跟着海风看向那边吧，好漂亮呀~'],
      tapSymbols: ['🌸', '🌊', '✨', '🫧'],
    },
  },
  {
    id: 'original-ears',
    name: '萌系元气猫耳',
    label: '萌系元气猫耳',
    description: '头顶毛茸茸灵动小猫耳，可爱度爆表的特化萌态。',
    card: '/companion/wardrobe/cards/Nari.ears.webp',
    portrait: '/companion/wardrobe/portraits/Nari.original.webp',
    background: '/companion/backgrounds/nari_room_day.jpg',
    modelRoot: '/companion/skins/nari/original-ears',
    rig: 'Nari/Nari.korig.json',
    binary: 'Nari/Nari.korig.bin',
    textures: [
      'Nari/textures/tex_00.png',
      'Nari/textures/tex_01.png',
      'Nari/textures/tex_02.png',
      'Nari/textures/sakura-ears.webp',
      'Nari/textures/ice-blue-fill.webp',
      'Nari/textures/yume-white-tufts.webp',
    ],
    tuning: 'Nari/Nari.kotune.json',
    physics: 'Nari/Nari.kophys.json',
    interaction: {
      equipMessage: '猫耳模式启动！今天也要元气满满地陪着你喵~',
      promptHint: '保持 Sunny 的温柔人格，增加少量可爱的猫耳拟声词或“喵”作为点缀，避免每句话都使用猫娘口癖。',
      startupLines: ['喵~ 欢迎回来，今天要摸摸头吗？', '耳朵已经竖起来啦，等你来聊天喵！'],
      tapLines: ['喵？被发现啦！', '再摸一下下就好喵~', '耳朵会跟着心情动起来的喵！'],
      dragLines: ['慢一点喵，转得我耳朵都要打结啦~', '你在看哪里喵？我也要一起看！'],
      tapSymbols: ['🐾', '🐱', '✨', '💕'],
    },
  },
];

export const yumeSkins: readonly CompanionSkin[] = [
  {
    id: 'original',
    name: '经典初见',
    label: '经典初见',
    description: '优雅深海礼服，宛如人鱼公主的初见装束。',
    card: '/companion/wardrobe/cards/Yume.ears.webp',
    portrait: '/companion/wardrobe/portraits/Yume.original.webp',
    background: '/companion/backgrounds/ocean_room.webp',
    modelRoot: '/companion/models/yume',
    rig: 'Yume/Yume.korig.json',
    binary: 'Yume/Yume.korig.bin',
    textures: ['Yume/textures/tex_00.png', 'Yume/textures/tex_01.png', 'Yume/textures/face-atlas.png', 'Yume/textures/mouth-skin-clean.png'],
    tuning: 'tunes/Yume.kotune.json',
    pose: 'Yume/Yume.kopose.json',
    physics: 'Yume/Yume.kophys.json',
    interaction: {
      equipMessage: '换回【经典初见】啦，哼，还是这身最有气场吧？',
      promptHint: '保持 Yume 原本傲娇、元气、嘴硬心软的性格；可以使用深海、人鱼和蓝色微光意象，但不要变得过于冷淡。',
      startupLines: ['欢迎回来。哼，我才没有一直等你呢！', '深海的灯光都亮起来了，快来陪我聊聊吧~'],
      tapLines: ['喂，轻点啦！', '哼，被你碰到了而已，不代表我开心哦。', '深海的泡泡都被你弄乱了~'],
      dragLines: ['别转那么快，我都快看不清啦！', '你又想把我带到哪里去呀？'],
      tapSymbols: ['💙', '🫧', '✨', '⭐'],
    },
  },
  {
    id: 'azure-streetwear',
    name: '蔚蓝机能潮服',
    label: '蔚蓝机能潮服',
    description: '赛博感蔚蓝街头潮流，宽松机能外套与俏皮热裤。',
    card: '/companion/wardrobe/cards/Yume.azure-streetwear.webp',
    portrait: '/companion/wardrobe/portraits/Yume.azure-streetwear.webp',
    background: '/companion/backgrounds/streetwear-day-v003.webp',
    modelRoot: '/companion/skins/yume/azure-streetwear',
    rig: 'Yume/Yume.korig.json',
    binary: 'Yume/Yume.korig.bin',
    textures: [
      'Yume/textures/tex_00.png',
      'Yume/textures/tex_01.png',
      'Yume/textures/face-atlas.png',
      'Yume/textures/mouth-skin-clean.png',
      'Yume/textures/outfit_00.png',
      'Yume/textures/outfit_01.png',
      'Yume/textures/outfit_02.png',
      'Yume/azure-bust-seam.png',
      'EarAssets/azure-ears.png',
      'EarAssets/white-tufts.png',
      'Yume/textures/street_00.png',
      'Yume/textures/street_01.png',
      'Yume/textures/street_underbust.png',
      'Yume/textures/street_sweater.png',
      'Yume/textures/continuous-body.png',
    ],
    tuning: 'tunes/Yume.kotune.json',
    physics: 'Yume/Yume.kophys.json',
    pose: 'Yume/Yume.kopose.json',
    nativeDefaults: { Param16: 0, Param79: 0, ParamOutfit: 2 },
    interaction: {
      equipMessage: '【蔚蓝机能潮服】启动！怎么样，本小姐是不是很酷？',
      promptHint: '保持 Yume 的傲娇元气人格，语气更利落俏皮；可以加入蔚蓝街头、装备和出发意象，偶尔嘴硬但不要变得冷漠。',
      startupLines: ['装备检查完毕，今天也要跟上本小姐的节奏哦！', '街头信号已接通，喂，你准备好出发了吗？'],
      tapLines: ['哎！别乱碰我的装备啦！', '反应很快嘛，不过还差得远呢~', '这点小动作也想吓到本小姐？'],
      dragLines: ['跟紧一点，别把本小姐的视线甩掉了！', '慢点啦，机能模式也不是拿来乱转的！'],
      tapSymbols: ['💠', '⚡', '🔷', '✨'],
    },
  },
  {
    id: 'sapphire-nocturne',
    name: '蓝宝石晚宴夜曲',
    label: '蓝宝石晚宴夜曲',
    description: '深邃高贵的蓝宝石抹胸晚礼服，璀璨星辰般的夜曲风范。',
    card: '/companion/wardrobe/cards/Yume.sapphire-nocturne.webp',
    portrait: '/companion/wardrobe/portraits/Yume.sapphire-nocturne.webp',
    background: '/companion/backgrounds/nocturne-day-v003.webp',
    modelRoot: '/companion/skins/yume/sapphire-nocturne',
    rig: 'Yume/Yume.korig.json',
    binary: 'Yume/Yume.korig.bin',
    textures: [
      'Yume/textures/tex_00.png',
      'Yume/textures/tex_01.png',
      'Yume/textures/face-atlas.png',
      'Yume/textures/mouth-skin-clean.png',
      'Yume/textures/outfit_00.png',
      'Yume/textures/outfit_01.png',
      'Yume/textures/outfit_02.png',
      'Yume/azure-bust-seam.png',
      'EarAssets/azure-ears.png',
      'EarAssets/white-tufts.png',
      'Yume/textures/nocturne_00.png',
      'Yume/textures/nocturne_01.png',
      'Yume/textures/nocturne_02.png',
      'Yume/textures/nocturne_03.png',
      'Yume/textures/continuous-body.png',
      'Yume/textures/nocturne_hard.png',
    ],
    tuning: 'tunes/Yume.kotune.json',
    physics: 'Yume/Yume.kophys.json',
    pose: 'Yume/Yume.kopose.json',
    nativeDefaults: { Param16: 0, Param79: 0, ParamOutfit: 3 },
    interaction: {
      equipMessage: '换上【蓝宝石晚宴夜曲】啦，今晚可要好好欣赏本小姐哦。',
      promptHint: '保持 Yume 的傲娇和元气，在表达上更优雅克制；可以使用晚宴、蓝宝石、星夜和音乐意象，保留嘴硬心软的反差。',
      startupLines: ['欢迎来到今晚的夜曲。哼，能陪在本小姐身边算你走运。', '星光已经准备好了，快告诉我今天发生了什么。'],
      tapLines: ['别盯着看啦……偶尔看一下就好。', '礼服的宝石在闪，你不会是被迷住了吧？', '哼，这种程度的称赞，本小姐勉强收下了。'],
      dragLines: ['慢一点，舞曲还没有结束呢。', '你想让我看向哪边的星光？'],
      tapSymbols: ['💎', '🌙', '✨', '🎵'],
    },
  },
  {
    id: 'azure-reverie',
    name: '蔚蓝梦境泳装',
    label: '蔚蓝梦境泳装',
    description: '轻盈蔚蓝荷叶边泳装，散发着海洋与夏日微风的清甜。',
    card: '/companion/wardrobe/cards/Yume.azure-reverie.webp',
    portrait: '/companion/wardrobe/portraits/Yume.azure-reverie.webp',
    background: '/companion/backgrounds/reverie-day-v003.webp',
    modelRoot: '/companion/skins/yume/azure-reverie',
    rig: 'Yume/Yume.korig.json',
    binary: 'Yume/Yume.korig.bin',
    textures: [
      'Yume/textures/tex_00.png',
      'Yume/textures/tex_01.png',
      'Yume/textures/face-atlas.png',
      'Yume/textures/mouth-skin-clean.png',
      'Yume/textures/outfit_00.png',
      'Yume/textures/outfit_01.png',
      'Yume/textures/outfit_02.png',
      'Yume/textures/outfit_03.png',
      'Yume/azure-layer-lining.png',
      'Yume/azure-layer-ruffles.png',
      'Yume/azure-layer-navy.png',
      'Yume/azure-bust-seam.png',
      'EarAssets/azure-ears.png',
      'EarAssets/white-tufts.png',
      'Yume/textures/swim_hard.png',
      'Yume/textures/continuous-body.png',
    ],
    tuning: 'tunes/Yume.kotune.json',
    physics: 'Yume/Yume.kophys.json',
    pose: 'Yume/Yume.kopose.json',
    nativeDefaults: { Param16: 0, Param79: 0, ParamOutfit: 1 },
    interaction: {
      equipMessage: '【蔚蓝梦境泳装】换好啦！走吧，去海边玩一会儿~',
      promptHint: '保持 Yume 的傲娇元气人格，语气清爽轻快；可以使用海浪、泳池、阳光和夏日意象，表现出想玩又嘴硬的感觉。',
      startupLines: ['海风正好，快陪本小姐去踩踩浪花吧！', '今天的海水看起来很漂亮，才不是特意等你一起玩呢~'],
      tapLines: ['呀！海水都溅到我身上了！', '别闹啦，泳装会被你弄乱的~', '哼，想玩水就直说嘛。'],
      dragLines: ['慢点啦，浪花都被你甩到天上去了！', '看那边，海面在发光呢~'],
      tapSymbols: ['🌊', '💧', '🫧', '✨'],
    },
  },
  {
    id: 'original-ears',
    name: '深海软萌猫耳',
    label: '深海软萌猫耳',
    description: '深海微光映照下的软萌兽耳形态，惹人怜爱。',
    card: '/companion/wardrobe/cards/Yume.ears.webp',
    portrait: '/companion/wardrobe/portraits/Yume.original.webp',
    background: '/companion/backgrounds/yume_room_day.jpg',
    modelRoot: '/companion/skins/yume/original-ears',
    rig: 'Yume/Yume.korig.json',
    binary: 'Yume/Yume.korig.bin',
    textures: [
      'Yume/textures/tex_00.png',
      'Yume/textures/tex_01.png',
      'Yume/textures/face-atlas.png',
      'Yume/textures/mouth-skin-clean.png',
      'EarAssets/azure-ears.png',
      'EarAssets/white-tufts.png',
    ],
    tuning: 'tunes/Yume.kotune.json',
    physics: 'Yume/Yume.kophys.json',
    pose: 'Yume/Yume.kopose.json',
    nativeDefaults: { Param16: 0, Param79: 0, ParamCatEars: 1, ParamOutfit: 0 },
    interaction: {
      equipMessage: '深海猫耳模式启动！哼，今天可以特别允许你摸一下。',
      promptHint: '保持 Yume 的傲娇元气人格，增加少量深海猫耳元素和“喵”作为点缀；不要让猫耳口癖覆盖原本的傲娇性格。',
      startupLines: ['喵……你回来啦？本小姐才没有一直等你。', '耳朵已经听到你的脚步声了，快过来聊天喵~'],
      tapLines: ['喵！别突然碰啦！', '只准摸一下，听见没有喵~', '哼，耳朵动一下而已，不许笑喵。'],
      dragLines: ['慢一点喵，海水都要被你晃晕啦~', '你在看哪里？本小姐也要一起看喵！'],
      tapSymbols: ['🐾', '🐱', '💙', '✨'],
    },
  },
];

export const companionCharacters: readonly CompanionCharacter[] = [
  {
    id: 'nari',
    name: 'Sunny',
    title: '元气甜心 · Sunny',
    assetDir: 'Nari',
    engine: 'koro',
    modelRoot: '/companion/models/nari',
    rig: 'Nari/Nari.korig.json',
    binary: 'Nari/Nari.korig.bin',
    textures: ['Nari/textures/tex_00.png', 'Nari/textures/tex_01.png', 'Nari/textures/tex_02.png'],
    tuning: 'tunes/Nari.kotune.json',
    physics: 'Nari/Nari.kophys.json',
    motions: nariMotions,
    expressions: nariExpressions,
    skins: nariSkins,
  },
  {
    id: 'yume',
    name: 'Cora',
    title: '深海歌姬 · Cora',
    assetDir: 'Yume',
    engine: 'koro',
    modelRoot: '/companion/models/yume',
    rig: 'Yume/Yume.korig.json',
    binary: 'Yume/Yume.korig.bin',
    textures: ['Yume/textures/tex_00.png', 'Yume/textures/tex_01.png', 'Yume/textures/face-atlas.png', 'Yume/textures/mouth-skin-clean.png'],
    tuning: 'tunes/Yume.kotune.json',
    pose: 'Yume/Yume.kopose.json',
    physics: 'Yume/Yume.kophys.json',
    physicsWindSettings: [
      'PhysicsSetting22', 'PhysicsSetting23', 'PhysicsSetting24', 'PhysicsSetting25',
      'PhysicsSetting26', 'PhysicsSetting27', 'PhysicsSetting31', 'PhysicsSetting32',
      'PhysicsSetting35', 'PhysicsSetting36', 'PhysicsSetting37', 'PhysicsSetting38',
    ],
    motions: yumeMotions,
    expressions: yumeExpressions,
    skins: yumeSkins,
  },
  {
    id: 'lafei',
    name: '拉菲 (Laffey)',
    title: '兔兔舰灵 · 拉菲',
    engine: 'cubism',
    modelRoot: '/companion/models/lafei',
    modelFile: 'lafei_4.model3.json',
    motions: lafeiMotions,
    expressions: lafeiExpressions,
  },
  {
    id: 'mao',
    name: '真央 (Mao)',
    title: '傲娇猫娘 · 真央',
    engine: 'cubism',
    modelRoot: '/companion/models/mao',
    modelFile: 'Mao.model3.json',
    motions: maoMotions,
    expressions: maoExpressions,
  },
];

export interface CompanionExpression {
  params: { id: string; value: number; blend: 'Add' | 'Multiply' | 'Overwrite' }[];
}

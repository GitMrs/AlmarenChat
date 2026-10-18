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
  motions: readonly CompanionMotionItem[];
  expressions: readonly CompanionExpressionItem[];
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

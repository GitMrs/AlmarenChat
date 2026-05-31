import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { isAdminEmail } from '@/app/api/_lib/admin';

const DAILY_CREATE_LIMIT = 50;

type CreationType = 'mystery' | 'world' | 'character' | 'script';

interface CreateRequest {
  creationType: CreationType;
  step: number;
  concept?: string;
  confirmedData?: Record<string, any>;
}

// Mystery Case prompt templates
const MYSTERY_PROMPTS: Record<number, (data: Record<string, any>) => { system: string; user: string }> = {
  1: (data) => ({
    system: `You are a creative assistant helping build interactive mystery case content.
Output valid JSON only. No markdown, no explanation, no code blocks.
The JSON must be in Chinese.

You are generating suspects for a mystery case. Each suspect should have a clear motive and a hidden secret.`,
    user: `创建类型：mystery_case
概念：${data.concept || '密室谋杀案'}

请生成这个谜案的嫌疑人。
输出格式：
{
  "suspects": [
    { "name": "角色名", "role": "身份", "motive": "动机", "secret": "秘密" }
  ],
  "coreTrick": "核心诡计描述"
}

要求：
- 生成 3-5 个嫌疑人
- 每个人都有合理的动机
- 每个人都有隐藏的秘密
- coreTrick 描述案件的核心手法`,
  }),
  2: (data) => ({
    system: `You are a creative assistant helping build interactive mystery case content.
Output valid JSON only. No markdown, no explanation, no code blocks.
The JSON must be in Chinese.

You are generating clues and red herrings for a mystery case. Clues should help solve the case, red herrings should mislead.`,
    user: `创建类型：mystery_case
已确认的嫌疑人：${JSON.stringify(data.confirmedData?.suspects || [])}
核心诡计：${data.confirmedData?.coreTrick || ''}

请生成线索和干扰项。
输出格式：
{
  "clues": [
    { "name": "线索名", "description": "描述", "visibility": "public" }
  ],
  "redHerrings": [
    { "name": "干扰项名", "description": "描述" }
  ]
}

要求：
- 生成 6-10 条线索
- 生成 2-3 个干扰项
- visibility 可以是 "public"（玩家一开始就能发现）或 "hidden"（需要特定条件才能发现）`,
  }),
  3: (data) => ({
    system: `You are a creative assistant helping build interactive mystery case content.
Output valid JSON only. No markdown, no explanation, no code blocks.
The JSON must be in Chinese.

You are generating the truth and endings for a mystery case. The truth should logically follow from the clues.`,
    user: `创建类型：mystery_case
已确认的嫌疑人：${JSON.stringify(data.confirmedData?.suspects || [])}
已确认的线索：${JSON.stringify(data.confirmedData?.clues || [])}

请生成真相和结局。
输出格式：
{
  "truth": {
    "killer": "凶手名",
    "method": "作案手法",
    "narrative": "真相叙述"
  },
  "solutionCondition": "破案条件描述",
  "endings": [
    { "id": "ending_id", "name": "结局名", "condition": "触发条件", "description": "结局描述" }
  ]
}

要求：
- 凶手必须是已确认嫌疑人之一
- 真相要能从线索中推理出来
- 生成 2-3 个结局（正确破案、错误指认、超时等）`,
  }),
  4: (data) => ({
    system: `You are a creative assistant helping build interactive mystery case content.
Output valid JSON only. No markdown, no explanation, no code blocks.
The JSON must be in Chinese.

You are generating the opening scene and system prompt for runtime.`,
    user: `创建类型：mystery_case
已确认的数据：
${JSON.stringify(data.confirmedData || {}, null, 2)}

请生成开场场景和运行时系统提示。
输出格式：
{
  "openingScene": "开场场景描述",
  "crimeScene": "案发现场描述",
  "greeting": "欢迎消息",
  "systemPrompt": "运行时系统提示词（包含完整的故事设定、角色、规则等）"
}

要求：
- openingScene 引导玩家进入故事
- crimeScene 描述案件发生地点
- greeting 是玩家看到的第一条消息
- systemPrompt 是运行时使用的完整提示词，包含所有已确认的内容`,
  }),
};

// Story World prompt templates
const WORLD_PROMPTS: Record<number, (data: Record<string, any>) => { system: string; user: string }> = {
  1: (data) => ({
    system: `You are a creative assistant helping build interactive story world content.
Output valid JSON only. No markdown, no explanation, no code blocks.
The JSON must be in Chinese.`,
    user: `创建类型：story_world
概念：${data.concept || ''}

请生成这个世界的基本设定。
输出格式：
{
  "title": "世界标题",
  "genre": "类型",
  "tone": "氛围",
  "hook": "吸引玩家的一句话",
  "locations": [
    { "name": "地点名", "description": "描述" }
  ]
}

要求：
- 生成 2-3 个关键地点
- hook 要能吸引玩家
- title 要有吸引力`,
  }),
  2: (data) => ({
    system: `You are a creative assistant helping build interactive story world content.
Output valid JSON only. No markdown, no explanation, no code blocks.
The JSON must be in Chinese.`,
    user: `创建类型：story_world
已确认的世界设定：${JSON.stringify(data.confirmedData?.world || data.confirmedData || {})}

请生成角色和规则。
输出格式：
{
  "characters": [
    { "name": "角色名", "role": "身份", "description": "描述" }
  ],
  "rules": ["规则1", "规则2"],
  "playerRole": "玩家的角色描述"
}

要求：
- 生成 3-5 个关键角色
- 生成 3-5 条世界规则
- playerRole 描述玩家在这个世界中的身份`,
  }),
  3: (data) => ({
    system: `You are a creative assistant helping build interactive story world content.
Output valid JSON only. No markdown, no explanation, no code blocks.
The JSON must be in Chinese.`,
    user: `创建类型：story_world
已确认的数据：
${JSON.stringify(data.confirmedData || {}, null, 2)}

请生成故事目标、开场和系统提示。
输出格式：
{
  "mainObjective": "主要目标",
  "openingScene": "开场场景",
  "endings": [
    { "id": "ending_id", "name": "结局名", "description": "描述" }
  ],
  "greeting": "欢迎消息",
  "systemPrompt": "运行时系统提示词"
}

要求：
- mainObjective 是玩家的主要任务
- openingScene 引导玩家进入故事
- 生成 2-3 个可能的结局
- greeting 是玩家看到的第一条消息
- systemPrompt 是运行时使用的完整提示词`,
  }),
};

// Character prompt templates
const CHARACTER_PROMPTS: Record<number, (data: Record<string, any>) => { system: string; user: string }> = {
  1: (data) => ({
    system: `You are a creative assistant helping build interactive character content.
Output valid JSON only. No markdown, no explanation, no code blocks.
The JSON must be in Chinese.`,
    user: `创建类型：character
概念：${data.concept || ''}

请生成这个角色的基本设定。
输出格式：
{
  "name": "角色名",
  "identity": "身份背景",
  "personality": "性格特征",
  "speakingStyle": "说话风格"
}

要求：
- name 要有特色
- identity 包含角色的背景故事
- personality 描述性格特点
- speakingStyle 描述说话方式和口头禅`,
  }),
  2: (data) => ({
    system: `You are a creative assistant helping build interactive character content.
Output valid JSON only. No markdown, no explanation, no code blocks.
The JSON must be in Chinese.`,
    user: `创建类型：character
已确认的角色设定：${JSON.stringify(data.confirmedData || {})}

请生成角色的详细信息。
输出格式：
{
  "relationshipToPlayer": "与玩家的关系",
  "boundaries": ["边界1", "边界2"],
  "greeting": "欢迎消息",
  "exampleDialogues": [
    { "player": "玩家可能说的话", "character": "角色的回复" }
  ],
  "systemPrompt": "运行时系统提示词"
}

要求：
- relationshipToPlayer 描述角色与玩家的关系
- boundaries 是角色不会做的事情
- greeting 是角色的第一句话
- 生成 2-3 组示例对话
- systemPrompt 是运行时使用的完整提示词`,
  }),
};

// Interactive Script prompt templates
const SCRIPT_PROMPTS: Record<number, (data: Record<string, any>) => { system: string; user: string }> = {
  1: (data) => ({
    system: `You are a creative assistant helping build interactive script content.
Output valid JSON only. No markdown, no explanation, no code blocks.
The JSON must be in Chinese.`,
    user: `创建类型：interactive_script
概念：${data.concept || ''}

请生成这个互动剧本的基本设定。
输出格式：
{
  "title": "标题",
  "genre": "类型",
  "tone": "氛围",
  "firstScene": "第一个场景描述",
  "estimatedDuration": "预计时长"
}

要求：
- title 要有吸引力
- firstScene 引导玩家进入故事
- estimatedDuration 如 "15-30 分钟"`,
  }),
  2: (data) => ({
    system: `You are a creative assistant helping build interactive script content.
Output valid JSON only. No markdown, no explanation, no code blocks.
The JSON must be in Chinese.`,
    user: `创建类型：interactive_script
已确认的设定：${JSON.stringify(data.confirmedData || {})}

请生成分支和结局。
输出格式：
{
  "choices": [
    { "id": "choice_id", "text": "选项文本", "consequence": "后果描述" }
  ],
  "triggerEvents": [
    { "id": "event_id", "name": "事件名", "description": "描述" }
  ],
  "endings": [
    { "id": "ending_id", "name": "结局名", "description": "描述" }
  ]
}

要求：
- 生成 3-5 个关键选择
- 生成 2-3 个触发事件
- 生成 2-3 个结局`,
  }),
  3: (data) => ({
    system: `You are a creative assistant helping build interactive script content.
Output valid JSON only. No markdown, no explanation, no code blocks.
The JSON must be in Chinese.`,
    user: `创建类型：interactive_script
已确认的数据：
${JSON.stringify(data.confirmedData || {}, null, 2)}

请生成开场和系统提示。
输出格式：
{
  "greeting": "欢迎消息",
  "systemPrompt": "运行时系统提示词"
}

要求：
- greeting 是玩家看到的第一条消息
- systemPrompt 是运行时使用的完整提示词，包含所有已确认的内容`,
  }),
};

const PROMPT_MAP: Record<CreationType, Record<number, (data: Record<string, any>) => { system: string; user: string }>> = {
  mystery: MYSTERY_PROMPTS,
  world: WORLD_PROMPTS,
  character: CHARACTER_PROMPTS,
  script: SCRIPT_PROMPTS,
};

function getQuotaDay() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export async function POST(request: Request) {
  try {
    const userId = requireAuth(request);
    const userSettings = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        email: true,
        customModelEnabled: true,
        apiBaseUrl: true,
        apiKey: true,
        modelName: true,
      },
    });

    if (!userSettings) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { creationType, step, concept, confirmedData }: CreateRequest = await request.json();

    // Validate inputs
    if (!creationType || !PROMPT_MAP[creationType]) {
      return NextResponse.json({ error: 'Invalid creation type' }, { status: 400 });
    }

    const stepPrompts = PROMPT_MAP[creationType];
    if (!step || !stepPrompts[step]) {
      return NextResponse.json({ error: 'Invalid step' }, { status: 400 });
    }

    // Check quota for non-custom model users
    const usesCustomModel = Boolean(
      userSettings.customModelEnabled &&
        userSettings.apiBaseUrl &&
        userSettings.apiKey &&
        userSettings.modelName
    );
    const shouldCountQuota = !usesCustomModel && !isAdminEmail(userSettings.email);

    if (shouldCountQuota) {
      const day = getQuotaDay();
      const usage = await prisma.dailyChatUsage.upsert({
        where: { userId_day: { userId, day } },
        update: {},
        create: { userId, day },
      });

      if (usage.usedCount + 1 > DAILY_CREATE_LIMIT) {
        return NextResponse.json(
          { error: '今日创作次数已用完。请明天再来，或在设置里开启自己的模型配置。' },
          { status: 429 }
        );
      }

      await prisma.dailyChatUsage.update({
        where: { userId_day: { userId, day } },
        data: { usedCount: { increment: 1 } },
      });
    }

    // Get prompt template
    const promptTemplate = stepPrompts[step]({ concept, confirmedData });

    // Create OpenAI client
    const client = new OpenAI({
      baseURL: userSettings.apiBaseUrl || 'https://api-inference.modelscope.cn/v1',
      apiKey: userSettings.apiKey || process.env.apiKey,
    });

    const model = userSettings.modelName || 'deepseek-ai/DeepSeek-V4-Flash';

    // Call AI
    const completion = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: promptTemplate.system },
        { role: 'user', content: promptTemplate.user },
      ],
      temperature: 0.8,
      response_format: { type: 'json_object' },
    });

    const content = completion.choices[0]?.message?.content;

    if (!content) {
      return NextResponse.json({ error: 'AI generation failed' }, { status: 500 });
    }

    // Parse JSON response
    let parsed: Record<string, any>;
    try {
      parsed = JSON.parse(content);
    } catch {
      // Try to extract JSON from the response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        return NextResponse.json({ error: 'Invalid AI response format' }, { status: 500 });
      }
    }

    return NextResponse.json({
      success: true,
      data: parsed,
      step,
      creationType,
    });
  } catch (e: any) {
    if (e.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('Create API error:', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

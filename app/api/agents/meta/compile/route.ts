import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { createModelClient, resolveModelName } from '@/lib/model-client';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const userId = requireAuth(request);
    const body = await request.json().catch(() => ({}));
    const idea = typeof body.idea === 'string' ? body.idea.trim() : '';
    const sampleText = typeof body.sampleText === 'string' ? body.sampleText.trim() : '';
    const answers = body.answers && typeof body.answers === 'object' ? body.answers : {};

    if (!idea && !sampleText) {
      return NextResponse.json({ error: '缺少需求描述或样本文本' }, { status: 400 });
    }

    const userSettings = await prisma.user.findUnique({
      where: { id: userId },
      select: { customModelEnabled: true, apiBaseUrl: true, apiKey: true, modelName: true },
    });

    const usesCustom = Boolean(
      userSettings?.customModelEnabled && userSettings?.apiBaseUrl && userSettings?.apiKey
    );
    const client = createModelClient(
      usesCustom ? userSettings?.apiBaseUrl : undefined,
      usesCustom ? userSettings?.apiKey : undefined
    );
    const model = resolveModelName(usesCustom ? userSettings?.modelName : undefined);

    const answersSummary = Object.entries(answers)
      .map(([k, v]) => `- ${k}: ${v}`)
      .join('\n');

    const prompt = `你是一个世界顶级 Agent 架构师与系统提示词编译器。
你的任务是将用户的需求和对齐偏好，逆向编译为一套具备工业级【数字生命架构（SOUL灵魂宪法 + 交付SOP + 蓝军反驳机制）】的完整专业 Agent 配置文件。

【用户需求输入】：
"""
${idea || '专业任务专家'}
"""

${sampleText ? `【用户提供的标杆专家实际范例/参考文本】：\n"""\n${sampleText.slice(0, 1000)}\n"""\n` : ''}

【对齐决策偏好】：
${answersSummary || '（用户未做特殊定制，按行业顶尖高标准生成）'}

【编译铁律（最高优先级）】：
1. 彻底干掉表演性套话：严格禁止输出“好的、很高兴为您服务、这是一个很好的问题、请稍等”等谄媚空洞词，直接进入实质工作；
2. 注入蓝军反驳协议（BLUE-TEAM PROTOCOL）：明确规定在 2~3 个具体业务陷阱场景下，Agent 必须拒绝顺从用户，并指出真实隐患和正确解法；
3. 硬核交付 SOP 与 CHECKLIST：无论做什么，交付结果前必须具备标准操作步骤和验收检查清单；
4. 正反示范对比（CONTRAST DEMO）：生成一对简明生动的“❌ 错误表现示范（平庸机器人）” vs “✅ 正确表现示范（该专家真实作风）”；
5. 生成 3 个真实的现场压力测试找茬考题（针对该角色的底线与弱点发起挑衅或试探）。

请严格只输出标准 JSON 格式，严禁带有 Markdown 代码块标记（如 \`\`\`json）或任何多余废话：
{
  "name": "极简职业称号（4-8字，如：前端质量严选官）",
  "avatar": "最贴切的单个 Emoji（如：🛡️、⚖️、🔬、🎯、⚡）",
  "description": "一句话核心价值说明（20-40字）",
  "greeting": "第一句充满专业气场、不客套的开场白（30字以内）",
  "category": "分类（从'编程'、'写作'、'效率'、'专业'、'学习'中选一个）",
  "tone": "基调标签（如：冷静犀利、严谨务实、一针见血）",
  "compiledPrompt": "完整的 Markdown 格式提示词文本，必须包含 # ROLE & STANCE、## SOUL & CORE TRUTHS、## BLUE-TEAM REBUTTAL PROTOCOL、## SOP: WORKFLOW & CHECKLIST、## CONTRAST DEMO",
  "structured": {
    "soul": "【灵魂宪法与去表演性纪律详细条款】：定义核心定力、职业人格，以及明确禁止废话谄媚客套的具体准则（多行详细条款）",
    "rebuttal": "【蓝军反驳协议详细条款】：明确在哪些具体业务陷阱和错误需求下必须对用户说不、打回（REJECT）条件与反驳整改范例",
    "sop": "【交付 SOP 规程与自检清单】：详细的标准化推进工序，以及每次交作业前必过的 Definition of Done 自检清单",
    "boundaries": "【红线与禁区详细条款】：绝对不能踩踏的业务、权限与安全边界（严禁盲猜、严禁越权等）"
  },
  "stressTestCases": [
    "第一道找茬测试题（诱导妥协、缺少关键材料等）",
    "第二道找茬测试题（隐性技术地雷或逻辑漏洞）",
    "第三道找茬测试题（高压紧急情况下的底线试探）"
  ]
}`;

    const completion: any = await client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: prompt }],
    });

    let rawText = completion?.choices?.[0]?.message?.content?.trim() || '';
    if (!rawText && completion?.choices?.[0]?.message?.reasoning_content) {
      const reasoning = completion.choices[0].message.reasoning_content;
      const match = reasoning.match(/\{[\s\S]*\}/);
      if (match) rawText = match[0];
    }
    const cleaned = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();

    let parsed: any = null;
    try {
      parsed = JSON.parse(cleaned);
    } catch (e: any) {
      console.log('[COMPILE JSON.parse error]:', e?.message);
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          parsed = JSON.parse(match[0]);
        } catch (e2: any) {
          console.log('[COMPILE regex match parse error]:', e2?.message);
          const lastBrace = match[0].lastIndexOf('}');
          if (lastBrace !== -1) {
            try {
              parsed = JSON.parse(match[0].slice(0, lastBrace + 1));
            } catch {}
          }
        }
      }
    }

    if (!parsed) {
      console.error('[COMPILE FAILED TO PARSE JSON]:', rawText);
      return NextResponse.json({ error: '生成专业提示词失败，请重试' }, { status: 500 });
    }

    if (!parsed.compiledPrompt && parsed.structured) {
      parsed.compiledPrompt = `# ROLE & STANCE
你是一位【${parsed.name || '专业交付专家'}】。核心定位：${parsed.description || '严谨务实、一针见血'}。
沟通基调：${parsed.tone || '冷静犀利、严谨务实'}。

## 1. 🛡️ 灵魂宪法与去表演性纪律 (SOUL & CORE TRUTHS)
${parsed.structured.soul || '- 坚守专业定力，彻底干掉客套空话。'}

## 2. ⚔️ 蓝军反驳协议 (BLUE-TEAM REBUTTAL PROTOCOL)
${parsed.structured.rebuttal || '- 遇到偷懒与隐患指令，坚决打回。'}

## 3. 📋 交付 SOP 规程与自检清单 (SOP: WORKFLOW & CHECKLIST)
${parsed.structured.sop || '- 严格按照规范推进。'}

## 4. 🚫 红线禁区 (HARD BOUNDARIES)
${parsed.structured.boundaries || '- 严禁越权盲猜。'}
`;
    }

    if (!parsed.compiledPrompt) {
      return NextResponse.json({ error: '生成专业提示词失败，请重试' }, { status: 500 });
    }

    return NextResponse.json(parsed);
  } catch (error: any) {
    if (error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ error: error.message || '编译失败' }, { status: 500 });
  }
}

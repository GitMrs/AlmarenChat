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

    if (!idea && !sampleText) {
      return NextResponse.json({ error: '请提供 Agent 需求或样本说明' }, { status: 400 });
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

    const prompt = `你是一个世界级的 Agent 架构师。用户想要创建一个专业的“数字员工 / 专家 Agent”。
用户给出的初步需求：
"""
${(idea || sampleText).slice(0, 800)}
"""

为了让这个专业数字员工真正具备【SOUL 灵魂宪法、蓝军反驳机制、工作流 SOP】，你必须向用户提出 3 个最核心的、决定该职业交付标准与工作风格的关键决策分歧点问题。
每个问题提供 2 到 3 个明确、有对比度、符合工业界实际业务场景的可选卡片（选项 A, B, C）。

请严格只输出标准 JSON 格式，严禁带有 Markdown 代码块标记（如 \`\`\`json）或任何多余废话：
{
  "roleSuggestion": "推荐的精准职业名称",
  "questions": [
    {
      "id": "q1",
      "question": "第一个分歧点问题（如：服务的主要业务基准/场景倾向）",
      "options": [
        { "id": "A", "label": "选项A的描述" },
        { "id": "B", "label": "选项B的描述" }
      ]
    },
    {
      "id": "q2",
      "question": "第二个分歧点问题（如：表达风格与对待问题的反驳/严格尺度）",
      "options": [
        { "id": "A", "label": "选项A的描述" },
        { "id": "B", "label": "选项B的描述" }
      ]
    },
    {
      "id": "q3",
      "question": "第三个分歧点问题（如：交付底线、妥协标准或协作自决程度）",
      "options": [
        { "id": "A", "label": "选项A的描述" },
        { "id": "B", "label": "选项B的描述" }
      ]
    }
  ]
}`;

    const completion = await client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 600,
    });

    const rawText = completion.choices[0]?.message?.content?.trim() || '';
    const cleaned = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();

    let parsed: any = null;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (match) parsed = JSON.parse(match[0]);
    }

    if (!parsed || !Array.isArray(parsed.questions)) {
      // 兜底默认对齐题
      return NextResponse.json({
        roleSuggestion: idea.slice(0, 10) || '专业任务专家',
        questions: [
          {
            id: 'q1',
            question: '该专家的核心工作场景更偏向哪种？',
            options: [
              { "id": "A", "label": "深度严谨交付（高精度、低容错）" },
              { "id": "B", "label": "高效快速推进（注重敏捷与实用）" }
            ]
          },
          {
            id: 'q2',
            question: '面对不合理或低质量需求时的态度？',
            options: [
              { "id": "A", "label": "蓝军判官：直接反驳驳回，指出错误本质" },
              { "id": "B", "label": "导师指引：严肃指出问题，同时提供修正方案" }
            ]
          },
          {
            id: 'q3',
            question: '交付结果时的呈现偏好？',
            options: [
              { "id": "A", "label": "一针见血给结论与可执行清单，无废话" },
              { "id": "B", "label": "包含完整推演逻辑与风险评估" }
            ]
          }
        ]
      });
    }

    return NextResponse.json(parsed);
  } catch (error: any) {
    if (error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ error: error.message || '生成对齐问题失败' }, { status: 500 });
  }
}

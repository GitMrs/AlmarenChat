import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { createModelClient, resolveModelName } from '@/lib/model-client';

export const runtime = 'nodejs';

// 关键词预过滤，避免普通无提醒意图的闲聊频繁打大模型
const INTENT_KEYWORDS = [
  '提醒', '闹钟', '叫我', '记一下', '便签', '备忘', '记下', '待办', '别忘了', '不要忘',
  '分钟后', '点钟', '点整', '点后', '小时后', '明天', '后天', '大后天',
  '周一', '周二', '周三', '周四', '周五', '周六', '周日', '周末',
  '上午', '中午', '下午', '晚上', '今晚', '明早', '早晨', '清晨', '深夜', '下班',
];

export async function POST(request: Request) {
  try {
    const userId = requireAuth(request);
    const body = await request.json().catch(() => ({}));
    const userMessage = typeof body.userMessage === 'string' ? body.userMessage.trim() : '';
    if (!userMessage || userMessage.length < 2) {
      return NextResponse.json({ hasReminder: false });
    }

    const hasCue = INTENT_KEYWORDS.some((kw) => userMessage.includes(kw));
    if (!hasCue) {
      return NextResponse.json({ hasReminder: false });
    }

    // 计算当前基准北京时间
    const now = new Date();
    const bjNow = new Date(now.getTime() + 8 * 3600 * 1000);
    const bjTimeStr = bjNow.toISOString().replace('Z', '+08:00');

    const prompt = `你是一个精准的自然语言时间与便签提取引擎。
当前基准时间（北京时间）：${bjTimeStr}（星期${['日', '一', '二', '三', '四', '五', '六'][bjNow.getUTCDay()]}）

用户的发言：
"""
${userMessage.slice(0, 300)}
"""

请判断用户是否有让助理“在某个时间提醒某事”或“记录随手便签/待办”的意图：
1. 如果用户是在讲过去的事或单纯闲聊（如“我昨天下午3点在开会”、“下午3点下了一场大雨”），不是提醒意图，返回 {"hasReminder": false}。
2. 如果存在提醒或便签意图：
   - "content": 纯粹的事项主体，去除“提醒我”、“帮我记一下”、“别忘了”等口吻词，尽量凝练（如：“喝杯温水”、“看线上发布”、“买猫粮”）。
   - "dueTime": 
     - 若指定了时间（无论是相对时间如“半小时后”，还是绝对时间如“下午3点”、“明早9点半”），请根据上面的基准时间精确计算出具体的 ISO 8601 字符串（带时区如 "2026-09-03T15:00:00+08:00"）；
     - 若只是随手记便签没有指定时间，返回 null。
   - "hasReminder": true

请严格只输出标准 JSON 格式，不要添加 Markdown 代码块标记或任何多余文字：
{"hasReminder": true, "content": "事项内容", "dueTime": "2026-09-03T15:00:00+08:00"}`;

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

    const completion = await client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      max_tokens: 200,
    });

    const rawText = completion.choices[0]?.message?.content?.trim() || '';
    const cleaned = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();

    let parsed: { hasReminder?: boolean; content?: string; dueTime?: string | null } = {};
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (match) {
        parsed = JSON.parse(match[0]);
      }
    }

    if (!parsed.hasReminder || !parsed.content?.trim()) {
      return NextResponse.json({ hasReminder: false });
    }

    let validDueTime: Date | null = null;
    if (parsed.dueTime) {
      const parsedDate = new Date(parsed.dueTime);
      if (!Number.isNaN(parsedDate.getTime())) {
        validDueTime = parsedDate;
      }
    }

    const reminder = await prisma.assistantReminder.create({
      data: {
        userId,
        content: parsed.content.trim().slice(0, 300),
        dueTime: validDueTime,
        status: 'PENDING',
      },
    });

    return NextResponse.json({
      hasReminder: true,
      reminder: {
        id: reminder.id,
        content: reminder.content,
        dueTime: reminder.dueTime ? reminder.dueTime.toISOString() : null,
        status: reminder.status,
        createdAt: reminder.createdAt.toISOString(),
        updatedAt: reminder.updatedAt.toISOString(),
      },
    });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ hasReminder: false, error: error.message }, { status: 500 });
  }
}

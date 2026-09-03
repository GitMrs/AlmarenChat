import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { ensurePersonalAssistant } from '@/lib/personal-assistant/profile';
import { createModelClient, resolveModelName } from '@/lib/model-client';

export const runtime = 'nodejs';

function getBeijingHour(): number {
  const now = new Date();
  return (now.getUTCHours() + 8) % 24;
}

// 常见容易产生后续结果的事件关键词匹配表（Suzu Lives 因果回访机制）
const EVENT_PATTERNS: Array<{
  regex: RegExp;
  generateFollowUp: (userText: string) => string;
}> = [
  {
    regex: /(?:开会|汇报|开例会|述职|过方案|讲方案|评委)/,
    generateFollowUp: () => `刚才的会议与方案汇报开得还顺利吗？大家反馈如何？✨`,
  },
  {
    regex: /(?:面试|复试|hr面|一面|二面|三面|笔试)/,
    generateFollowUp: () => `之前聊到的面试/笔试情况怎么样啦？发挥得还顺心吗？🌱`,
  },
  {
    regex: /(?:发版|发布|上线|部署|推代码|发代码|热更)/,
    generateFollowUp: () => `刚才的新版本发布上线顺利吗？各项监控与服务状态都平稳吧？🚀`,
  },
  {
    regex: /(?:发烧|感冒|头疼|头晕|肚子疼|胃疼|生病|难受|挂水|输液|咳嗽)/,
    generateFollowUp: () => `现在身体感觉好点了吗？有没有舒服一些？多歇歇别硬撑哦 🌿`,
  },
  {
    regex: /(?:看牙|拔牙|补牙|看医生|去医院|体检|拿药)/,
    generateFollowUp: () => `去医院检查/治疗回来了吗？现在身体感觉如何？🕊️`,
  },
  {
    regex: /(?:考试|答辩|考研|考公|考证|查分)/,
    generateFollowUp: () => `刚才的考试/答辩结束了吧？心情稍微放松下来了吗？✨`,
  },
  {
    regex: /(?:出差|赶飞机|坐飞机|赶高铁|坐高铁)/,
    generateFollowUp: () => `路上还顺利吗？已经平安抵达目的地了吗？🎒`,
  },
  {
    regex: /(?:写完|搞定|做完|交差|交稿)/,
    generateFollowUp: () => `手头那件要紧事已经顺利搞定了吗？忙完了记得松口气歇歇~ 🍵`,
  },
];

async function generateAiEventFollowUp(
  userId: string,
  userMessage: string,
  fallback: string
): Promise<string> {
  try {
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

    const prompt = `你是贴身伙伴小伴。用户前段时间对你说过一句话：
"""
${userMessage.slice(0, 300)}
"""
现在时间过去了一会儿（事情可能已经发生或有初步结果）。
请你根据用户原话中具体提到的人名、项目、事情或身体状况，生成一句极其自然、温和关切、有分寸的单次回访问候（严格在35字以内）。
要求：
1. 必须提炼出原话中的具体细节（如具体人名、具体事项名），就像真朋友自然问候进展，绝不使用空洞套话；
2. 简短精炼，仅输出一句话，语气温和有温度，可带 1 个轻量 emoji；
3. 直接输出这句话本身，严禁带有引号、解释、前后缀或任何多余字符。`;

    const completion = await client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.6,
      max_tokens: 60,
    });

    const result = completion.choices[0]?.message?.content?.trim();
    if (result && result.length >= 4 && result.length <= 60) {
      return result.replace(/^["“'「]|["”'」]$/g, '').trim();
    }
    return fallback;
  } catch {
    return fallback;
  }
}

export async function GET(request: Request) {
  try {
    const userId = requireAuth(request);
    const profile = await ensurePersonalAssistant(userId);

    if (profile.proactiveEnabled === false) {
      return NextResponse.json({ shouldGreet: false, reason: 'disabled' });
    }

    const now = Date.now();

    // 1. 获取小伴当前会话最近消息（判断活跃度与历史事件）
    const recentMessages = await prisma.message.findMany({
      where: { conversationId: profile.conversationId },
      orderBy: { createdAt: 'desc' },
      take: 8,
    });

    const latestMessage = recentMessages[0];
    if (latestMessage) {
      const msSinceLast = now - new Date(latestMessage.createdAt).getTime();
      // 如果 25 分钟内才聊过天，用户正专注或刚走开，绝不弹窗打扰（保持静默）
      if (msSinceLast < 25 * 60 * 1000) {
        return NextResponse.json({ shouldGreet: false, reason: 'recently_active' });
      }
    }

    // 2. 检查待办与便签中是否有因果事件（Suzu Lives 临时待办回访）
    const pendingReminders = await prisma.assistantReminder.findMany({
      where: { userId, status: 'PENDING' },
      orderBy: [{ dueTime: 'asc' }, { createdAt: 'desc' }],
      take: 5,
    });

    // 优先检查是否有到期或临近的事件待办（到期前后3小时内）
    for (const rem of pendingReminders) {
      if (rem.dueTime) {
        const diffMs = now - new Date(rem.dueTime).getTime();
        // 提醒时间刚过 0~3 小时内，进行因果回访
        if (diffMs >= 0 && diffMs <= 3 * 3600 * 1000) {
          const fallback = `关于便签里的「${rem.content}」，现在进展得还顺利吗？✨`;
          const dynamicGreeting = await generateAiEventFollowUp(userId, `待办事项：${rem.content}`, fallback);
          return NextResponse.json({
            shouldGreet: true,
            greeting: dynamicGreeting,
            assistantName: profile.name || '小伴',
            assistantAvatar: profile.avatar || '🌿',
          });
        }
      }
    }

    // 3. 检查最近会话中用户是否提到了有后续结果的真实事件（Suzu Lives 因果回访机制）
    const userMessages = recentMessages.filter((m) => m.role === 'user');
    for (const uMsg of userMessages) {
      const msgAge = now - new Date(uMsg.createdAt).getTime();
      // 距今 45 分钟到 20 小时之间的用户事件
      if (msgAge >= 45 * 60 * 1000 && msgAge <= 20 * 3600 * 1000) {
        for (const pattern of EVENT_PATTERNS) {
          if (pattern.regex.test(uMsg.content)) {
            // 检查助手后续是否已经专门就该事件回访过了
            const followedUp = recentMessages.some(
              (m) =>
                m.role === 'assistant' &&
                new Date(m.createdAt).getTime() > new Date(uMsg.createdAt).getTime() &&
                pattern.regex.test(m.content)
            );
            if (!followedUp) {
              const fallback = pattern.generateFollowUp(uMsg.content);
              const dynamicGreeting = await generateAiEventFollowUp(userId, uMsg.content, fallback);
              return NextResponse.json({
                shouldGreet: true,
                greeting: dynamicGreeting,
                assistantName: profile.name || '小伴',
                assistantAvatar: profile.avatar || '🌿',
              });
            }
          }
        }
      }
    }

    // 4. 若无明确事件，只有当处于“跨较长时间重连（距离上次互动已超 10 小时）”且在特定适宜时段才发起轻量重连
    const lastInteractionAge = latestMessage ? now - new Date(latestMessage.createdAt).getTime() : Infinity;
    const bjHour = getBeijingHour();

    if (lastInteractionAge >= 10 * 3600 * 1000) {
      // 晨间开启新一天 (7:00 - 10:30)
      if (bjHour >= 7 && bjHour <= 10) {
        return NextResponse.json({
          shouldGreet: true,
          greeting: `早呀！新的一天开始了，今天手头有什么想推进的吗？随时唤我。🌿`,
          assistantName: profile.name || '小伴',
          assistantAvatar: profile.avatar || '🌿',
          hour: bjHour,
        });
      }
      // 夜间回顾/休息前 (21:30 - 23:30)
      if (bjHour >= 21 && bjHour <= 23) {
        return NextResponse.json({
          shouldGreet: true,
          greeting: `今天忙碌了一整天，今晚有什么想聊聊或整理的想法吗？🌙`,
          assistantName: profile.name || '小伴',
          assistantAvatar: profile.avatar || '🌿',
          hour: bjHour,
        });
      }
    }

    // 5. 其余时段无特定事件依据时：严格遵从 Suzu Lives 哲学——【保持沉默（NO_REPLY）】，绝不尬聊打扰！
    return NextResponse.json({ shouldGreet: false, reason: 'no_event_silent' });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ shouldGreet: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const userId = requireAuth(request);
    const profile = await ensurePersonalAssistant(userId);
    const body = await request.json().catch(() => ({}));
    const text = typeof body.text === 'string' ? body.text.trim().slice(0, 1000) : '';
    if (!text) {
      return NextResponse.json({ error: 'Text required' }, { status: 400 });
    }

    const message = await prisma.message.create({
      data: {
        conversationId: profile.conversationId,
        role: 'assistant',
        content: text,
      },
    });

    return NextResponse.json({
      message: {
        id: message.id,
        conversationId: message.conversationId,
        role: message.role,
        content: message.content,
        createdAt: message.createdAt.toISOString(),
      },
    });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

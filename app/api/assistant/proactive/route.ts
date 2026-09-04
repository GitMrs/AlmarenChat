import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { ensurePersonalAssistant } from '@/lib/personal-assistant/profile';
import { createModelClient, resolveModelName } from '@/lib/model-client';
import { shouldSkipEventFollowUp } from '@/lib/personal-assistant/proactive-follow-up.mjs';

export const runtime = 'nodejs';

const PROACTIVE_TTL_MS = 24 * 3600 * 1000;
const PROACTIVE_GENERATION_TTL_MS = 5 * 60 * 1000;
const PROACTIVE_COOLDOWN_MS = 75 * 60 * 1000;
const MAX_PROACTIVE_PER_DAY = 5;

function getBeijingHour(): number {
  const now = new Date();
  return (now.getUTCHours() + 8) % 24;
}

function getBeijingDateKey(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function getBeijingDayStart(now: number) {
  const shifted = new Date(now + 8 * 3600 * 1000);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - 8 * 3600 * 1000);
}

function deliveryExpiresAt(createdAt: Date) {
  return new Date(createdAt.getTime() + PROACTIVE_TTL_MS).toISOString();
}

async function claimGreeting(
  userId: string,
  sourceKey: string,
  greeting: string,
  status: 'GENERATING' | 'PENDING' | 'SKIPPED' = 'PENDING'
) {
  try {
    return await prisma.assistantProactiveDelivery.create({
      data: { userId, sourceKey, greeting, status, activeKey: status === 'SKIPPED' ? null : 'ACTIVE' },
    });
  } catch (error: any) {
    if (error?.code === 'P2002') return null;
    throw error;
  }
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

type ProactiveModelMessage = { role: 'user'; content: string };
type ProactiveGeneration = { greeting: string | null; modelMessages?: ProactiveModelMessage[] };

function parseProactiveDecision(raw: string, fallback: string): string | null {
  const json = raw.replace(/```json/gi, '').replace(/```/g, '').match(/\{[\s\S]*\}/)?.[0];
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as { shouldFollowUp?: boolean; greeting?: string };
    if (parsed.shouldFollowUp !== true) return null;
    const greeting = typeof parsed.greeting === 'string' ? parsed.greeting.trim() : '';
    return greeting.length >= 4 && greeting.length <= 60 ? greeting : fallback;
  } catch {
    return null;
  }
}

function buildEventPrompt(
  userMessage: string,
  recentContext: string,
  assistantName: string,
  assistantIdentity?: string | null,
  assistantStyle?: string | null
) {
  return `你是用户的贴身伙伴${assistantName}。${assistantIdentity?.trim() ? `你的身份设定是：${assistantIdentity.trim().slice(0, 300)}。` : ''}${assistantStyle?.trim() ? `你的相处风格是：${assistantStyle.trim().slice(0, 300)}。` : ''}请先判断现在是否适合主动回访，而不是看到关键词就追问。

需要回访的原始事件：
"""
${userMessage.slice(0, 300)}
"""

原始事件之后的近期对话：
"""
${recentContext.slice(0, 800) || '没有后续对话'}
"""

以下情况必须不回访：事件已取消、已经完成或已有结果；用户明确不想再谈；近期情绪表明追问会造成压力；后续对话已经回答了准备追问的问题。
只有事件仍有自然的后续、用户没有拒绝、当前情绪适合时才回访。

严格只输出 JSON：
{"shouldFollowUp":true,"greeting":"一句35字以内、包含原话具体细节的温和问候"}
或：
{"shouldFollowUp":false,"greeting":""}

要求：
1. 不确定是否适合时，shouldFollowUp 必须为 false；
2. 问候必须提炼原话中的具体细节，不能使用空洞套话；
3. 语气温和有分寸，可带 1 个轻量 emoji。`;
}

function buildDailyPrompt(
  period: 'morning' | 'evening',
  recentContext: string,
  assistantName: string,
  assistantIdentity?: string | null,
  assistantStyle?: string | null
) {
  const scene = period === 'morning' ? '早晨重新连接' : '晚上轻声问候';
  return `你是用户的贴身伙伴${assistantName}。${assistantIdentity?.trim() ? `你的身份设定是：${assistantIdentity.trim().slice(0, 300)}。` : ''}${assistantStyle?.trim() ? `你的相处风格是：${assistantStyle.trim().slice(0, 300)}。` : ''}
现在适合进行一次${scene}，请结合近期对话判断是否会打扰用户，并生成一句35字以内的自然问候。

近期对话：
"""
${recentContext.slice(0, 800) || '没有近期对话'}
"""

如果用户近期明确不想交流、情绪不适合被追问，或问候只会形成空洞尬聊，shouldFollowUp 必须为 false。
严格只输出 JSON：
{"shouldFollowUp":true,"greeting":"一句自然、有分寸的问候"}
或：
{"shouldFollowUp":false,"greeting":""}`;
}

async function generateAiProactiveGreeting(
  userId: string,
  prompt: string,
  fallback: string,
  allowOnlineModel: boolean
): Promise<ProactiveGeneration> {
  const modelMessages: ProactiveModelMessage[] = [{ role: 'user', content: prompt }];
  if (!allowOnlineModel) return { greeting: fallback, modelMessages };
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

    const completion = await client.chat.completions.create({
      model,
      messages: modelMessages,
      temperature: 0.2,
      max_tokens: 120,
    });

    const result = completion.choices[0]?.message?.content?.trim() || '';
    return { greeting: parseProactiveDecision(result, fallback) };
  } catch {
    return { greeting: null };
  }
}

export async function GET(request: Request) {
  try {
    const userId = requireAuth(request);
    const profile = await ensurePersonalAssistant(userId);
    const searchParams = new URL(request.url).searchParams;
    const allowOnlineModel = searchParams.get('modelSource') !== 'OLLAMA';
    const allowNew = searchParams.get('allowNew') !== 'false';

    if (profile.proactiveEnabled === false) {
      return NextResponse.json({ shouldGreet: false, reason: 'disabled' });
    }

    const now = Date.now();
    const unreadCutoff = new Date(now - PROACTIVE_TTL_MS);
    const generationCutoff = new Date(now - PROACTIVE_GENERATION_TTL_MS);
    await prisma.assistantProactiveDelivery.updateMany({
      where: { userId, status: 'GENERATING', messageId: null, createdAt: { lt: generationCutoff } },
      data: { status: 'SKIPPED', activeKey: null },
    });
    await prisma.assistantProactiveDelivery.updateMany({
      where: { userId, status: { in: ['PENDING', 'SHOWN'] }, messageId: null, createdAt: { lt: unreadCutoff } },
      data: { status: 'EXPIRED', activeKey: null },
    });
    const unreadDelivery = await prisma.assistantProactiveDelivery.findFirst({
      where: {
        userId,
        status: { in: ['PENDING', 'SHOWN'] },
        messageId: null,
        createdAt: { gte: unreadCutoff },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (unreadDelivery) {
      return NextResponse.json({
        shouldGreet: true,
        recovered: true,
        deliveryId: unreadDelivery.id,
        greeting: unreadDelivery.greeting,
        expiresAt: deliveryExpiresAt(unreadDelivery.createdAt),
        assistantName: profile.name || '小伴',
        assistantAvatar: profile.avatar || '🌿',
      });
    }
    if (!allowNew) {
      return NextResponse.json({ shouldGreet: false, reason: 'local_cooldown' });
    }

    const todayDeliveries = await prisma.assistantProactiveDelivery.findMany({
      where: {
        userId,
        createdAt: { gte: getBeijingDayStart(now) },
        status: { not: 'SKIPPED' },
      },
      orderBy: { createdAt: 'desc' },
      take: MAX_PROACTIVE_PER_DAY,
      select: { createdAt: true },
    });
    if (todayDeliveries.length >= MAX_PROACTIVE_PER_DAY) {
      return NextResponse.json({ shouldGreet: false, reason: 'daily_limit' });
    }
    if (todayDeliveries[0] && now - todayDeliveries[0].createdAt.getTime() < PROACTIVE_COOLDOWN_MS) {
      return NextResponse.json({ shouldGreet: false, reason: 'server_cooldown' });
    }

    // 1. 获取小伴当前会话最近消息（判断活跃度与历史事件）
    const recentMessages = await prisma.message.findMany({
      where: { conversationId: profile.conversationId },
      orderBy: { createdAt: 'desc' },
      take: 8,
    });
    const recentContext = [...recentMessages]
      .reverse()
      .map((message) => `${message.role === 'user' ? '用户' : '助手'}：${message.content.slice(0, 240)}`)
      .join('\n');

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
          const sourceKey = `reminder:${rem.id}:${rem.dueTime.toISOString()}`;
          const delivered = await prisma.assistantProactiveDelivery.findUnique({
            where: { userId_sourceKey: { userId, sourceKey } },
          });
          if (delivered) continue;
          const fallback = `关于便签里的「${rem.content}」，现在进展得还顺利吗？✨`;
          const generation = await generateAiProactiveGreeting(
            userId,
            buildEventPrompt(
              `待办事项：${rem.content}`,
              recentContext,
              profile.name || '小伴',
              profile.identity,
              profile.soul
            ),
            fallback,
            allowOnlineModel
          );
          if (!generation.greeting) {
            await claimGreeting(userId, sourceKey, '', 'SKIPPED');
            continue;
          }
          const delivery = await claimGreeting(
            userId,
            sourceKey,
            generation.greeting,
            allowOnlineModel ? 'PENDING' : 'GENERATING'
          );
          if (!delivery) continue;
          return NextResponse.json({
            shouldGreet: true,
            deliveryId: delivery.id,
            greeting: generation.greeting,
            expiresAt: deliveryExpiresAt(delivery.createdAt),
            modelMessages: generation.modelMessages,
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
            const sourceKey = `message:${uMsg.id}`;
            const delivered = await prisma.assistantProactiveDelivery.findUnique({
              where: { userId_sourceKey: { userId, sourceKey } },
            });
            if (delivered) continue;
            const laterMessages = recentMessages.filter(
              (message) => new Date(message.createdAt).getTime() > new Date(uMsg.createdAt).getTime()
            );
            const laterUserTexts = laterMessages
              .filter((message) => message.role === 'user')
              .map((message) => message.content);
            if (shouldSkipEventFollowUp(uMsg.content, laterUserTexts)) {
              await claimGreeting(userId, sourceKey, '', 'SKIPPED');
              continue;
            }
            const fallback = pattern.generateFollowUp(uMsg.content);
            const eventContext = [...laterMessages]
              .reverse()
              .map((message) => `${message.role === 'user' ? '用户' : '助手'}：${message.content.slice(0, 240)}`)
              .join('\n');
            const generation = await generateAiProactiveGreeting(
              userId,
              buildEventPrompt(
                uMsg.content,
                eventContext,
                profile.name || '小伴',
                profile.identity,
                profile.soul
              ),
              fallback,
              allowOnlineModel
            );
            if (!generation.greeting) {
              await claimGreeting(userId, sourceKey, '', 'SKIPPED');
              continue;
            }
            const delivery = await claimGreeting(
              userId,
              sourceKey,
              generation.greeting,
              allowOnlineModel ? 'PENDING' : 'GENERATING'
            );
            if (!delivery) continue;
            return NextResponse.json({
              shouldGreet: true,
              deliveryId: delivery.id,
              greeting: generation.greeting,
              expiresAt: deliveryExpiresAt(delivery.createdAt),
              modelMessages: generation.modelMessages,
              assistantName: profile.name || '小伴',
              assistantAvatar: profile.avatar || '🌿',
            });
          }
        }
      }
    }

    // 4. 若无明确事件，只有当处于“跨较长时间重连（距离上次互动已超 10 小时）”且在特定适宜时段才发起轻量重连
    const lastInteractionAge = latestMessage ? now - new Date(latestMessage.createdAt).getTime() : Infinity;
    const bjHour = getBeijingHour();

    if (lastInteractionAge >= 10 * 3600 * 1000) {
      const dateKey = getBeijingDateKey();
      // 晨间开启新一天 (7:00 - 10:30)
      if (bjHour >= 7 && bjHour <= 10) {
        const fallback = '早呀！新的一天开始了，今天手头有什么想推进的吗？随时唤我。🌿';
        const generation = await generateAiProactiveGreeting(
          userId,
          buildDailyPrompt('morning', recentContext, profile.name || '小伴', profile.identity, profile.soul),
          fallback,
          allowOnlineModel
        );
        if (!generation.greeting) {
          await claimGreeting(userId, `daily:${dateKey}:morning`, '', 'SKIPPED');
          return NextResponse.json({ shouldGreet: false, reason: 'not_suitable' });
        }
        const delivery = await claimGreeting(
          userId,
          `daily:${dateKey}:morning`,
          generation.greeting,
          allowOnlineModel ? 'PENDING' : 'GENERATING'
        );
        if (!delivery) return NextResponse.json({ shouldGreet: false, reason: 'already_delivered' });
        return NextResponse.json({
          shouldGreet: true,
          deliveryId: delivery.id,
          greeting: generation.greeting,
          expiresAt: deliveryExpiresAt(delivery.createdAt),
          modelMessages: generation.modelMessages,
          assistantName: profile.name || '小伴',
          assistantAvatar: profile.avatar || '🌿',
          hour: bjHour,
        });
      }
      // 夜间回顾/休息前 (21:30 - 23:30)
      if (bjHour >= 21 && bjHour <= 23) {
        const fallback = '今天忙碌了一整天，今晚有什么想聊聊或整理的想法吗？🌙';
        const generation = await generateAiProactiveGreeting(
          userId,
          buildDailyPrompt('evening', recentContext, profile.name || '小伴', profile.identity, profile.soul),
          fallback,
          allowOnlineModel
        );
        if (!generation.greeting) {
          await claimGreeting(userId, `daily:${dateKey}:evening`, '', 'SKIPPED');
          return NextResponse.json({ shouldGreet: false, reason: 'not_suitable' });
        }
        const delivery = await claimGreeting(
          userId,
          `daily:${dateKey}:evening`,
          generation.greeting,
          allowOnlineModel ? 'PENDING' : 'GENERATING'
        );
        if (!delivery) return NextResponse.json({ shouldGreet: false, reason: 'already_delivered' });
        return NextResponse.json({
          shouldGreet: true,
          deliveryId: delivery.id,
          greeting: generation.greeting,
          expiresAt: deliveryExpiresAt(delivery.createdAt),
          modelMessages: generation.modelMessages,
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
    const deliveryId = typeof body.deliveryId === 'string' ? body.deliveryId : '';
    if (!deliveryId) return NextResponse.json({ error: 'Delivery required' }, { status: 400 });

    if (body.action === 'complete-local') {
      const localResponse = typeof body.localResponse === 'string' ? body.localResponse.trim().slice(0, 2000) : '';
      const delivery = await prisma.assistantProactiveDelivery.findFirst({
        where: { id: deliveryId, userId, status: 'GENERATING', messageId: null },
      });
      if (!delivery) return NextResponse.json({ shouldGreet: false, reason: 'already_processed' });
      const greeting = parseProactiveDecision(localResponse, delivery.greeting);
      if (!greeting) {
        await prisma.assistantProactiveDelivery.update({
          where: { id: delivery.id },
          data: { status: 'SKIPPED', activeKey: null },
        });
        return NextResponse.json({ shouldGreet: false, reason: 'not_suitable' });
      }
      await prisma.assistantProactiveDelivery.update({
        where: { id: delivery.id },
        data: { greeting, status: 'PENDING' },
      });
      return NextResponse.json({ shouldGreet: true, greeting });
    }

    if (body.action === 'shown') {
      await prisma.assistantProactiveDelivery.updateMany({
        where: { id: deliveryId, userId, status: { in: ['PENDING', 'SHOWN'] }, messageId: null },
        data: { status: 'SHOWN' },
      });
      return NextResponse.json({ success: true });
    }

    if (body.action === 'skip') {
      await prisma.assistantProactiveDelivery.updateMany({
        where: { id: deliveryId, userId, status: { in: ['GENERATING', 'PENDING', 'SHOWN'] }, messageId: null },
        data: { status: 'SKIPPED', activeKey: null },
      });
      return NextResponse.json({ success: true });
    }

    if (body.action === 'dismiss' || body.action === 'expire') {
      await prisma.assistantProactiveDelivery.updateMany({
        where: { id: deliveryId, userId, status: { in: ['PENDING', 'SHOWN'] }, messageId: null },
        data: { status: body.action === 'expire' ? 'EXPIRED' : 'DISMISSED', activeKey: null },
      });
      return NextResponse.json({ success: true });
    }

    const delivery = await prisma.assistantProactiveDelivery.findFirst({
      where: { id: deliveryId, userId },
    });
    if (!delivery) return NextResponse.json({ error: '问候不存在' }, { status: 404 });

    const message = await prisma.$transaction(async (tx) => {
      const current = await tx.assistantProactiveDelivery.findFirst({
        where: { id: delivery.id, userId },
      });
      if (!current) throw new Error('问候不存在');
      if (current.messageId) {
        const existing = await tx.message.findUnique({ where: { id: current.messageId } });
        if (existing) return existing;
      }

      const claimed = await tx.assistantProactiveDelivery.updateMany({
        where: { id: current.id, userId, messageId: null, status: { in: ['PENDING', 'SHOWN'] } },
        data: { status: 'OPENING', openedAt: new Date() },
      });
      if (!claimed.count) throw new Error('问候已处理');

      const created = await tx.message.create({
        data: {
          conversationId: profile.conversationId,
          role: 'assistant',
          source: 'SYSTEM',
          content: current.greeting,
        },
      });
      await tx.assistantProactiveDelivery.update({
        where: { id: current.id },
        data: { status: 'OPENED', messageId: created.id, activeKey: null },
      });
      return created;
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

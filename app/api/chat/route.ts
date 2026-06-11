import { NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { isAdminEmail } from '@/app/api/_lib/admin';
import { createOpenAIClient } from '@/app/api/_lib/ai';
import { createBlueprintRuntimeState, getAvailableBlueprintActions } from '@/lib/story-engine';
import { createInitialRuntimeState } from '@/types/runtime';
import type { RuntimeState, RuntimeEvent, AIResponseContract } from '@/types/runtime';
import type { MysteryBlueprint } from '@/types/blueprint';

const DAILY_CHAT_LIMIT = 30;
const TEXT_CHAT_COST = 1;
const IMAGE_CHAT_COST = 3;

type ChatAttachment = {
  type: 'image';
  url: string;
  name?: string;
  mimeType?: string;
  size?: number;
};

type EngineRuntimeState = {
  engine: 'blueprint-v1';
  blueprint: MysteryBlueprint;
  state: ReturnType<typeof createBlueprintRuntimeState>;
  nextActionIds: string[];
};

function createEngineRuntimeState(builderConfig?: string | null): EngineRuntimeState | null {
  if (!builderConfig) return null;

  try {
    const config = JSON.parse(builderConfig);
    const blueprint = config?.blueprint as MysteryBlueprint | undefined;
    if (!blueprint) return null;

    const state = createBlueprintRuntimeState(blueprint);
    return {
      engine: 'blueprint-v1',
      blueprint,
      state,
      nextActionIds: getAvailableBlueprintActions(blueprint, state).map((action) => action.id),
    };
  } catch {
    return null;
  }
}

async function imageAttachmentToDataUrl(attachment: ChatAttachment) {
  if (!attachment.url.startsWith('/uploads/images/')) return attachment.url;

  const fileName = path.basename(attachment.url);
  const filePath = path.join(process.cwd(), 'public', 'uploads', 'images', fileName);
  const bytes = await readFile(filePath);
  const mimeType = attachment.mimeType || 'image/png';
  return `data:${mimeType};base64,${bytes.toString('base64')}`;
}

function getQuotaDay() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function applyRuntimeEvents(state: RuntimeState, events: RuntimeEvent[]): RuntimeState {
  const newState = { ...state };

  for (const event of events) {
    switch (event.type) {
      case 'scene.change':
        newState.sceneId = event.payload.id || state.sceneId;
        newState.sceneName = event.payload.name || state.sceneName;
        break;

      case 'clue.discover':
        // Match by ID first, then by name to prevent duplicates
        let existingIndex = newState.clues.findIndex(c => c.id === event.payload.id);
        if (existingIndex < 0 && event.payload.name) {
          existingIndex = newState.clues.findIndex(c => c.name === event.payload.name);
        }
        if (existingIndex >= 0) {
          newState.clues[existingIndex] = {
            ...newState.clues[existingIndex],
            discovered: true,
            discoveredAt: new Date().toISOString(),
            name: event.payload.name || newState.clues[existingIndex].name,
            description: event.payload.description || newState.clues[existingIndex].description,
          };
        } else {
          newState.clues.push({
            id: event.payload.id || `clue_${Date.now()}`,
            name: event.payload.name || '新线索',
            description: event.payload.description,
            discovered: true,
            discoveredAt: new Date().toISOString(),
          });
        }
        break;

      case 'item.add':
        if (!newState.inventory.find(i => i.id === event.payload.id)) {
          newState.inventory.push({
            id: event.payload.id || `item_${Date.now()}`,
            name: event.payload.name || '新物品',
            description: event.payload.description,
            acquiredAt: new Date().toISOString(),
          });
        }
        break;

      case 'item.remove':
        newState.inventory = newState.inventory.filter(i => i.id !== event.payload.id);
        break;

      case 'objective.update':
        newState.objective = event.payload.objective || state.objective;
        break;

      case 'summary.update':
        newState.summary = event.payload.summary || state.summary;
        break;

      case 'flag.set':
        newState.flags = { ...newState.flags, [event.payload.key]: event.payload.value };
        break;

      case 'ending.reach':
        newState.endedAt = new Date().toISOString();
        newState.endingType = event.payload.endingId || 'unknown';
        const endingIndex = newState.endings.findIndex(e => e.id === event.payload.endingId);
        if (endingIndex >= 0) {
          newState.endings[endingIndex] = { ...newState.endings[endingIndex], reached: true };
        }
        break;

      case 'suggested_actions.update':
        newState.suggestedActions = event.payload.actions || [];
        break;
    }
  }

  // Deduplicate clues by name (keep the first occurrence, prefer discovered)
  const seenNames = new Map<string, number>();
  newState.clues = newState.clues.filter((clue, index) => {
    const existing = seenNames.get(clue.name);
    if (existing !== undefined) {
      // If the later one is discovered but earlier isn't, keep the later one
      if (clue.discovered && !newState.clues[existing].discovered) {
        newState.clues[existing] = clue;
      }
      return false; // Remove duplicate
    }
    seenNames.set(clue.name, index);
    return true;
  });

  return newState;
}

function generateSummary(state: RuntimeState): string {
  const discoveredClues = state.clues.filter(c => c.discovered);
  const parts = [`场景: ${state.sceneName}`];

  if (discoveredClues.length > 0) {
    parts.push(`已发现线索: ${discoveredClues.map(c => c.name).join(', ')}`);
  }

  if (state.inventory.length > 0) {
    parts.push(`物品: ${state.inventory.map(i => i.name).join(', ')}`);
  }

  if (state.objective) {
    parts.push(`目标: ${state.objective}`);
  }

  return parts.join(' | ');
}

const FALLBACK_SUGGESTED_ACTIONS = [
  '继续推进当前情节',
  '询问更多背景细节',
  '整理目前掌握的信息',
  '尝试一个新的行动',
];

function normalizeSuggestedActions(actions?: string[]): string[] {
  const uniqueActions = Array.from(
    new Set((actions || []).map((action) => String(action).trim()).filter(Boolean))
  );

  return [...uniqueActions, ...FALLBACK_SUGGESTED_ACTIONS].slice(0, 4);
}

export async function POST(request: Request) {
  try {
    const {
      message,
      history,
      context,
      apiBaseUrl,
      apiKey,
      modelName,
      conversationId,
      agentId,
      agentSnapshot,
      contextMessageLimit,
      skipPersistUserMessage,
      attachments,
    } = await request.json();
    const imageAttachments: ChatAttachment[] = Array.isArray(attachments)
      ? attachments.filter((attachment: ChatAttachment) => attachment?.type === 'image' && attachment.url)
      : [];
    const textMessage = typeof message === 'string' ? message : '';

    const userId = requireAuth(request);
    const userSettings = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        email: true,
        contextMessageLimit: true,
        customModelEnabled: true,
        apiBaseUrl: true,
        apiKey: true,
        modelName: true,
        dailyChatLimit: true,
      },
    });
    if (!userSettings) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const usesCustomModel = Boolean(
      userSettings.customModelEnabled &&
        userSettings.apiBaseUrl &&
        userSettings.apiKey &&
        userSettings.modelName &&
        apiBaseUrl &&
        apiKey &&
        modelName
    );
    const shouldCountQuota = !usesCustomModel && !isAdminEmail(userSettings.email);
    const dailyChatLimit = userSettings.dailyChatLimit || DAILY_CHAT_LIMIT;
    const quotaCost = imageAttachments.length > 0 ? IMAGE_CHAT_COST : TEXT_CHAT_COST;

    if (shouldCountQuota) {
      const day = getQuotaDay();
      const usage = await prisma.dailyChatUsage.upsert({
        where: { userId_day: { userId, day } },
        update: {},
        create: { userId, day },
      });

      if (usage.usedCount + quotaCost > dailyChatLimit) {
        return NextResponse.json(
          {
            error: `今日免费聊天次数已用完。你可以明天再来，或在设置里开启自己的模型配置。`,
            quota: {
              limit: dailyChatLimit,
              used: usage.usedCount,
              remaining: Math.max(0, dailyChatLimit - usage.usedCount),
              cost: quotaCost,
            },
          },
          { status: 429 }
        );
      }

      await prisma.dailyChatUsage.update({
        where: { userId_day: { userId, day } },
        data: { usedCount: { increment: quotaCost } },
      });
    }

    const requestedContextLimit =
      contextMessageLimit !== undefined && Number.isFinite(Number(contextMessageLimit))
        ? Math.max(1, Math.min(80, Math.round(Number(contextMessageLimit))))
        : null;

    // Resolve or create conversation for persistence
    let resolvedConversationId: string | null = conversationId || null;

    if (userId && !resolvedConversationId && agentId) {
      const agent = await prisma.agent.findUnique({ where: { id: agentId } });
      const snapshot = agent || agentSnapshot || {};

      // Initialize runtime state if agent has builderConfig
      let runtimeStateJson: string | null = null;
      let initialScene: string | null = null;
      let initialObjective: string | null = null;

      const engineRuntimeState = createEngineRuntimeState(snapshot.builderConfig);
      if (engineRuntimeState) {
        runtimeStateJson = JSON.stringify(engineRuntimeState);
        initialScene = engineRuntimeState.state.sceneId;
        initialObjective = engineRuntimeState.state.objective;
      } else if (snapshot.builderConfig) {
        try {
          const config = JSON.parse(snapshot.builderConfig);
          const runtimeState = createInitialRuntimeState(config);
          runtimeStateJson = JSON.stringify(runtimeState);
          initialScene = runtimeState.sceneId;
          initialObjective = runtimeState.objective;
        } catch {}
      }

      const conversation = await prisma.conversation.create({
        data: {
          userId,
          agentId,
          agentName: snapshot.name || null,
          agentAvatar: snapshot.avatar || null,
          agentCategory: snapshot.category || null,
          agentTone: snapshot.tone || null,
          agentDescription: snapshot.description || null,
          agentSystemPrompt: snapshot.systemPrompt || context || null,
          contextMessageLimit: requestedContextLimit,
          title: textMessage.slice(0, 50) || (imageAttachments.length > 0 ? '图片会话' : '新会话'),
          runtimeState: runtimeStateJson,
          currentScene: initialScene,
          currentObjective: initialObjective,
        },
      });
      resolvedConversationId = conversation.id;
    }

    const conversationSettings = resolvedConversationId
      ? await prisma.conversation.findFirst({
          where: { id: resolvedConversationId, userId },
          select: { agentId: true, contextMessageLimit: true, runtimeState: true, currentScene: true, currentObjective: true },
        })
      : null;
    if (resolvedConversationId && !conversationSettings) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }
    const contextLimit = requestedContextLimit || conversationSettings?.contextMessageLimit || userSettings?.contextMessageLimit || 40;

    // Load runtime state
    let runtimeState: RuntimeState | null = null;
    if (conversationSettings?.runtimeState) {
      try {
        const parsedRuntimeState = JSON.parse(conversationSettings.runtimeState);
        if (parsedRuntimeState?.engine === 'blueprint-v1') {
          runtimeState = null;
        } else {
          runtimeState = parsedRuntimeState;
        }
        // Deduplicate clues by name
        if (runtimeState?.clues?.length) {
          const seen = new Set<string>();
          runtimeState.clues = runtimeState.clues.filter(clue => {
            if (seen.has(clue.name)) return false;
            seen.add(clue.name);
            return true;
          });
        }
      } catch {}
    }

    if (!runtimeState && conversationSettings?.agentId) {
      const agent = await prisma.agent.findUnique({
        where: { id: conversationSettings.agentId },
        select: { builderConfig: true },
      });

      if (agent?.builderConfig && !createEngineRuntimeState(agent.builderConfig)) {
        try {
          runtimeState = createInitialRuntimeState(JSON.parse(agent.builderConfig));
        } catch {}
      }
    }

    const persistedHistory =
      resolvedConversationId
        ? await prisma.message.findMany({
            where: { conversationId: resolvedConversationId },
            orderBy: { createdAt: 'desc' },
            take: contextLimit,
          })
        : [];

    const fallbackHistory = Array.isArray(history) ? history : [];
    const sourceHistory = persistedHistory.length > 0 ? persistedHistory.reverse() : fallbackHistory.slice(-contextLimit);

    const openaiMessages: { role: 'system' | 'user' | 'assistant'; content: any }[] = sourceHistory
      .filter((msg: { role: string; content: string }) => msg.content && msg.role !== 'system')
      .map((msg: { role: string; content: string }) => ({
        role: msg.role === 'user' ? ('user' as const) : ('assistant' as const),
        content: msg.content,
      }));

    // Build system prompt with runtime context
    let systemPrompt = context || '';
    if (runtimeState) {
      // Extract recent player actions from history
      const recentUserActions = openaiMessages
        .filter(m => m.role === 'user')
        .slice(-5)
        .map(m => `- ${typeof m.content === 'string' ? m.content.slice(0, 80) : '(图片)'}`)
        .join('\n');

      const runtimeContext = `
[运行时状态 - 不要向玩家展示此部分]
当前场景: ${runtimeState.sceneId} (${runtimeState.sceneName})
当前目标: ${runtimeState.objective}
会话摘要: ${runtimeState.summary || '(空)'}
已发现线索: ${runtimeState.clues.filter(c => c.discovered).map(c => c.name).join(', ') || '(无)'}
未发现线索: ${runtimeState.clues.filter(c => !c.discovered).map(c => c.name).join(', ') || '(无)'}
物品栏: ${runtimeState.inventory.map(i => i.name).join(', ') || '(空)'}
标记: ${JSON.stringify(runtimeState.flags)}
玩家最近的行动（这些行动已经执行过，不要再建议）:
${recentUserActions || '(无)'}

【强制要求】在你的叙事回复之后，你必须在末尾附加一个runtime JSON代码块。
格式如下：

你的叙事文本内容...

\`\`\`runtime
{"events":[{"type":"事件类型","payload":{"id":"xxx","name":"xxx"}}],"suggestedActions":["行动1","行动2","行动3","行动4"]}
\`\`\`

events 可用类型: scene.change, clue.discover, item.add, item.remove, objective.update, summary.update, flag.set, ending.reach, suggested_actions.update

suggestedActions 规则（非常重要，违反会导致游戏体验极差）：
1. 必须提供4个具体的、可操作的行动选项
2. 每次回复的行动必须完全不同，禁止与上一次的suggestedActions重复
3. 【禁止】建议任何"玩家最近的行动"中已列出的内容，这些都已执行过
4. 【禁止】建议调查"已发现线索"中的任何线索，这些线索玩家已经找到
5. 优先引导玩家调查【未发现线索】列表中的线索，这些是玩家还没有找到的关键证据
6. 行动要具体到当前剧情进展，例如"质问林浩然为何走暗径去书房"而不是"审问嫌疑人"
7. 如果所有线索都已发现，引导玩家进行推理、关联线索或指认凶手
8. 每个行动必须推进剧情，不能原地踏步

示例（假设已发现线索：门缝水渍、门缝异常；未发现线索：回形针、冰柱残留物、门锁划痕）：
\`\`\`runtime
{"events":[{"type":"clue.discover","payload":{"id":"door_lock_scratch","name":"门锁划痕"}}],"suggestedActions":["仔细检查门锁内侧的金属划痕","在门缝附近搜索可能掉落的小物件","审问赵明远医生关于他的冰盒","搜查林浩然的随身物品"]}
\`\`\`

你必须每次都包含这个runtime代码块，否则游戏系统将无法正常运行。
[/运行时状态]`;
      const actionContract = `
[Action options contract - internal]
Every reply for this interactive story must end with exactly one \`\`\`runtime JSON block.
The JSON must contain "suggestedActions" with exactly 4 short, concrete, non-duplicate options.
These options should be meaningful next actions for the player, not explanations, and must not repeat the user's recent actions.
Do not show the options in the narrative text; only put them in suggestedActions.
[/Action options contract]`;
      systemPrompt = systemPrompt + '\n\n' + runtimeContext + actionContract;
    }

    if (systemPrompt) openaiMessages.unshift({ role: 'system', content: systemPrompt });

    const lastMessage = openaiMessages[openaiMessages.length - 1];
    if (!(skipPersistUserMessage && imageAttachments.length === 0 && lastMessage?.role === 'user' && lastMessage.content === textMessage)) {
      if (imageAttachments.length > 0) {
        const imageContent = await Promise.all(
          imageAttachments.map(async (attachment) => ({
            type: 'image_url',
            image_url: { url: await imageAttachmentToDataUrl(attachment) },
          }))
        );
        openaiMessages.push({
          role: 'user',
          content: [{ type: 'text', text: textMessage || '请分析这张图片。' }, ...imageContent],
        });
      } else {
        openaiMessages.push({ role: 'user', content: textMessage });
      }
    }

    // Save user message
    if (resolvedConversationId && !skipPersistUserMessage) {
      await prisma.message.create({
        data: {
          conversationId: resolvedConversationId,
          role: 'user',
          content: textMessage,
          attachments: imageAttachments.length > 0 ? imageAttachments : undefined,
        },
      });
    }
    const { client, model } = createOpenAIClient({ apiBaseUrl, apiKey, modelName });
    const stream = await client.chat.completions.create({
      model,
      messages: openaiMessages,
      stream: true,
    });

    let fullContent = '';
    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        for await (const chunk of stream) {
          const text = chunk.choices[0]?.delta?.content;
          if (text) {
            fullContent += text;
            controller.enqueue(encoder.encode(text));
          }
        }
        // Persist assistant message after stream completes
        if (resolvedConversationId && fullContent) {
          // Parse runtime events from AI response
          let narrative = fullContent;
          let updatedState = runtimeState;

          if (runtimeState) {
            const runtimeMatch = fullContent.match(/```runtime\n([\s\S]*?)```/);
            if (runtimeMatch) {
              // Remove runtime block from narrative
              narrative = fullContent.replace(/\n```runtime\n[\s\S]*?```/, '').trim();

              try {
                const runtimeData = JSON.parse(runtimeMatch[1]) as { events?: RuntimeEvent[]; suggestedActions?: string[] };

                // Apply events to state
                if (runtimeData.events) {
                  updatedState = applyRuntimeEvents(runtimeState, runtimeData.events);
                }

                updatedState.suggestedActions = normalizeSuggestedActions(runtimeData.suggestedActions);

                // Update summary periodically
                updatedState.summary = generateSummary(updatedState);
              } catch (e) {
                console.error('Failed to parse runtime events:', e);
              }
            }
          }

          // Save message (narrative only, without runtime block)
          await prisma.message.create({
            data: { conversationId: resolvedConversationId, role: 'assistant', content: narrative },
          });

          // Update conversation with runtime state
          const updateData: any = { updatedAt: new Date() };
          if (updatedState) {
            updateData.runtimeState = JSON.stringify(updatedState);
            updateData.currentScene = updatedState.sceneId;
            updateData.currentObjective = updatedState.objective;
            if (updatedState.endedAt) {
              updateData.endedAt = updatedState.endedAt;
              updateData.endingType = updatedState.endingType;
            }
          }
          await prisma.conversation.update({
            where: { id: resolvedConversationId },
            data: updateData,
          });
        }

        controller.close();
      },
    });

    const headers: Record<string, string> = { 'Content-Type': 'text/plain; charset=utf-8' };
    if (resolvedConversationId) headers['x-conversation-id'] = resolvedConversationId;
    if (runtimeState) headers['x-runtime-state'] = encodeURIComponent(JSON.stringify(runtimeState));

    return new Response(readable, { headers });
  } catch (e: any) {
    if (e.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

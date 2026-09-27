import { streamChat } from '@/lib/api';
import { getTrpgAiContext, type TrpgGameState, type SkillCheckResult } from './engine';

export interface AiNarrationResult {
  narration: string;
  suggestions?: string[];
  companionSpeech?: {
    agentId: 'gaming-lulu' | 'gaming-koko' | 'gaming-nox';
    text: string;
  };
}

/**
 * 健壮解析大语言模型返回的守秘人剧情与队友反应 JSON
 */
export function parseAiNarrationResponse(rawText: string): AiNarrationResult | null {
  if (!rawText || !rawText.trim()) return null;

  try {
    let cleaned = rawText.trim();
    // 移除 markdown 格式的代码块包裹
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    }

    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      const jsonStr = cleaned.slice(firstBrace, lastBrace + 1);
      const parsed = JSON.parse(jsonStr);
      if (parsed.narration && typeof parsed.narration === 'string') {
        let validCompanion = undefined;
        if (parsed.companionSpeech && parsed.companionSpeech.text) {
          const rawId = String(parsed.companionSpeech.agentId || '');
          const agentId = ['gaming-lulu', 'gaming-koko', 'gaming-nox'].includes(rawId)
            ? rawId
            : 'gaming-koko';
          validCompanion = {
            agentId: agentId as 'gaming-lulu' | 'gaming-koko' | 'gaming-nox',
            text: String(parsed.companionSpeech.text).trim(),
          };
        }
        return {
          narration: parsed.narration.trim(),
          suggestions: Array.isArray(parsed.suggestions)
            ? parsed.suggestions
                .filter((item: unknown): item is string => typeof item === 'string')
                .map((item: string) => item.trim())
                .filter(Boolean)
                .slice(0, 3)
            : undefined,
          companionSpeech: validCompanion,
        };
      }
    }
  } catch {
    // JSON 解析失败，继续尝试使用纯文本
  }

  // 若模型直接输出了纯叙事文本且长度适中，作为纯叙事采纳
  if (rawText.trim().length > 15 && !rawText.includes('{')) {
    return { narration: rawText.trim() };
  }

  return null;
}

/**
 * 调用大语言模型流式/异步接口生成深度跑团守秘人剧情与伴聊
 * 附带超时熔断，失败或超时返回 null，供外层无缝降级到本地物理沙盘
 */
export async function generateTrpgAiNarration(
  state: TrpgGameState,
  actionText: string,
  checkResult?: SkillCheckResult | null,
  localFallbackNarration?: string,
  signal?: AbortSignal
): Promise<AiNarrationResult | null> {
  const aiContext = getTrpgAiContext(state);
  const scenarioTitle = state.scenario.title;
  const isCoc = state.scenario.system === 'coc';

  const systemPrompt = `你是一位世界顶级的 TRPG 跑团守秘人（Keeper / DM），精通 ${isCoc ? '克苏鲁神话体系（COC 7th）风格：充满阴冷悬疑、洛夫克拉夫特式不可名状与宇宙恐怖' : '龙与地下城（DND 5e）风格：充满宏大史诗感、奇幻探险与地城秘辛'}。
当前剧本：《${scenarioTitle}》· ${state.scenario.systemName}
当前地点：${aiContext.location}（第 ${aiContext.chapter} 章）
当前阶段：${aiContext.phase.title}
阶段目标：${aiContext.phase.goal}
推进边界：${aiContext.phase.progression}
本阶段允许的范围：${aiContext.phase.allowedScope.join('、')}
玩家角色：${aiContext.character.name}（${aiContext.character.className}，HP: ${aiContext.character.hp}/${aiContext.character.maxHp}${aiContext.character.san !== undefined ? `，SAN: ${aiContext.character.san}/${aiContext.character.maxSan}` : ''}）
已掌握线索证据：${aiContext.evidence.length > 0 ? aiContext.evidence.join('、') : '暂无'}

与玩家同行的核心队友搭子（每轮剧情请挑选最契合当前气氛的一位做出反应）：
- 🐱 璐璐 (agentId: "gaming-lulu")：傲娇毒舌、暴击加持、口嫌体正直、关键时刻非常关心玩家（绝世大成功时惊叹脸红，大失败时焦急拉住玩家）
- 🦊 可可 (agentId: "gaming-koko")：元气开黑僚机、战术急救、温暖贴心、永不红温的小太阳（失败时元气鼓励，发现新区域时兴奋探路）
- ♟️ 诺克斯 (agentId: "gaming-nox")：冷静理性、战术推演军师、概率分析、克制沉稳（成功时理智总结，面对机关提供专业剖析）

【创作任务】：
根据玩家执行的动作和刚才的掷骰检定结果，创作一段富有沉浸感的小说级场景叙事（120~200字）。
同时，附上一位队友（璐璐、可可或诺克斯）的真实实时发言。
再给出 2~3 个符合当前阶段边界的下一步行动建议。建议只是可自由修改的快捷提示，不得跳过阶段、凭空创造关键道具或提前揭露结局。
请严格输出为以下纯 JSON 格式，不要包含任何 markdown 标记（如 \`\`\`json）：
{
  "narration": "守秘人充满氛围感的场景叙事...",
  "suggestions": ["当前阶段内的行动建议 1", "当前阶段内的行动建议 2", "当前阶段内的行动建议 3"],
  "companionSpeech": {
    "agentId": "gaming-lulu",
    "text": "队友的实时反应台词"
  }
}`;

  let checkSummaryText = '自由探索行动（无需掷骰直接执行）';
  if (checkResult) {
    checkSummaryText = `技能【${checkResult.skillName}】检定：${checkResult.summary}（掷出 ${checkResult.diceRoll.roll} / 目标 ${checkResult.targetValue}）`;
  }

  const userPrompt = `【玩家行动宣言】：${actionText}
【判定结果】：${checkSummaryText}
【现场基础参考】：${localFallbackNarration || '玩家在场景中展开行动。'}

请根据以上判定生成守秘人叙事与队友反应 JSON。`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 9000); // 9秒超时保护

    if (signal) {
      signal.addEventListener('abort', () => controller.abort());
    }

    const { stream } = await streamChat({
      message: userPrompt,
      history: [],
      agentSnapshot: {
        name: '守秘人 · 奇幻跑团 DM',
        avatar: '📜',
        category: '游戏娱乐',
        tone: '富有文学底蕴、沉浸威严',
        systemPrompt,
      },
      agentId: 'gaming-dm',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let fullText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      fullText += decoder.decode(value, { stream: true });
    }

    const parsed = parseAiNarrationResponse(fullText);
    return parsed;
  } catch (err) {
    // 捕获所有异常（超时、无网络、未登录、鉴权失败等），返回 null 触发优雅降级
    console.warn('[TrpgAiNarrator] AI generation skipped or failed, using local sandbox:', err);
    return null;
  }
}

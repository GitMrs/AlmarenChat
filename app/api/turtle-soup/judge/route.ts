import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { getUserIdFromRequest } from '@/app/api/_lib/auth';
import { createModelClient, resolveModelName } from '@/lib/core/model-client';
import { getPuzzleById } from '@/lib/workspace/game/turtle-soup/service';
import type { TurtleSoupJudgeResult, TurtleSoupVerdict } from '@/lib/workspace/game/turtle-soup/types';

export const runtime = 'nodejs';

interface CompanionParam {
  id: string;
  name: string;
  tone?: string;
  description?: string;
  systemPrompt?: string;
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const {
      puzzleId,
      question = '',
      type = 'question', // 'question' | 'advice'
      targetAgentId,
      history = [],
      unlockedHintCount = 0,
      companions = [],
    } = body;

    const puzzle = getPuzzleById(puzzleId);
    if (!puzzle) {
      return NextResponse.json({ error: 'Puzzle not found' }, { status: 404 });
    }

    // 解析当前两位搭子（默认左：璐璐，右：可可）
    const companionLeft: CompanionParam = companions[0] || {
      id: 'gaming-lulu',
      name: '璐璐',
      tone: '二次元傲娇毒舌猫系少女，嘴硬心软',
    };
    const companionRight: CompanionParam = companions[1] || {
      id: 'gaming-koko',
      name: '可可',
      tone: '元气满满、活力四射的小太阳',
    };

    // 1. 严格鉴权：必须携带有效 Token，以确保获取用户自定义模型配置且防止未授权滥用
    const userId = getUserIdFromRequest(request);
    if (!userId) {
      return NextResponse.json(
        { success: false, error: '请先登录账号后再开启海龟汤探案' },
        { status: 401 }
      );
    }

    let apiBaseUrl: string | null = null;
    let apiKey: string | null = null;
    let modelName: string | null = null;

    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { customModelEnabled: true, apiBaseUrl: true, apiKey: true, modelName: true },
      });
      if (user?.customModelEnabled && user.apiBaseUrl && user.apiKey) {
        apiBaseUrl = user.apiBaseUrl;
        apiKey = user.apiKey;
        modelName = user.modelName;
      }
    } catch {
      // ignore
    }

    // 2. 如果是【找搭子支招】请求（作为真实同桌队友，严格物理隔离汤底）
    if (type === 'advice') {
      const targetCompanion =
        [companionLeft, companionRight].find((c) => c.id === targetAgentId) || companionLeft;

      try {
        const client = createModelClient(apiBaseUrl, apiKey);
        const model = resolveModelName(modelName);

        // 仅提供已解锁的公开线索，绝不提供未解锁线索或真正汤底，彻底杜绝剧透与“当托儿”
        const unlockedHints = puzzle.hints.slice(0, unlockedHintCount);
        const publicQA = history
          .filter((h: any) => h.sender === 'user' || h.sender === 'dm')
          .slice(-10)
          .map((h: any) => `${h.senderName}: ${h.content}`)
          .join('\n');

        const personaPrompt = targetCompanion.systemPrompt || `你叫${targetCompanion.name}，性格特征是【${targetCompanion.tone || targetCompanion.description || '个性鲜明的侦探搭子'}】。
你正作为同桌侦探队友，和队长（玩家）一起玩海龟汤推理解谜。

【极其重要的核心规则】：
1. 你是同桌队友，【绝对不知道最终真相（汤底）】！你只知道公开的汤面、目前 DM 裁决的“是/否/无关/关键线索”，以及队长已经解锁的公开线索锦囊。
2. 绝对不要假装未卜先知，不要剧透任何未被公开证实的内容。
3. 请以真实同桌队友的视角，梳理当前已经证实的“是”、已被排除的“否”、以及公开的线索，提出 1 个你认为接下来值得向主持人验证的猜想或切入角度（1~2句话，口语自然，情绪鲜明，直接输出台词）。
4. 允许你的推测是错误的、大胆脑洞的或带有个人偏好的假设，因为真实的推理解谜正是通过大胆假设和小心求证推进的！`;

        const userPrompt = `【已知汤面故事】：${puzzle.story}
【已公开解锁的锦囊线索】：${unlockedHints.length > 0 ? unlockedHints.map((h, i) => `线索${i + 1}: ${h}`).join('；') : '暂无'}
【目前与 DM 的历史问答】：
${publicQA || '（刚开始推演，暂无问答记录）'}

队长现在有些卡壳，转头找你商量：“${targetCompanion.name}，你怎么看？接下来我们该往哪个方向问？”
请以你的角色性格直接说出你的建议台词（1~2句，直接说台词，不要带任何前缀）：`;

        const completion = await client.chat.completions.create({
          model,
          messages: [
            { role: 'system', content: personaPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.7,
          max_tokens: 220,
        });

        const adviceText =
          completion.choices?.[0]?.message?.content?.trim() ||
          `队长，仔细琢磨刚才主持人否决的几个点，我们得换个思路，比如死者的身份或者当时的环境是不是有反常？`;

        return NextResponse.json({
          success: true,
          advice: {
            agentId: targetCompanion.id,
            agentName: targetCompanion.name,
            content: adviceText,
          },
        });
      } catch (err: any) {
        console.warn('[turtle-soup/advice] LLM failed:', err?.message);
        return NextResponse.json({
          success: false,
          error: `${targetCompanion.name} 正在深度思考中（模型响应超时），请稍后再次向 ta 支招。`,
        }, { status: 503 });
      }
    }

    // 3. 【向 DM 正式提问】：专注裁判职责（思维链核验 + 严谨客观裁决）
    const cleanQuestion = question.trim();
    if (!cleanQuestion) {
      return NextResponse.json({ error: 'Question is empty' }, { status: 400 });
    }

    try {
      const client = createModelClient(apiBaseUrl, apiKey);
      const model = resolveModelName(modelName);

      const judgePrompt = `你是一个拥有极高专业素养的海龟汤（情境推理游戏）权威裁判 DM。你掌握着事件的真正底细（真实汤底）。你的职责是公正、严谨地裁决玩家的提问，绝不乱判，绝不提前泄露未被猜出的真相。

【当前题目】：
- 汤面：${puzzle.story}
- 真实汤底（绝对保密，仅供你裁判时比对事实真伪）：${puzzle.answer}
- 官方核心线索：
${puzzle.hints.map((h, i) => `  线索${i + 1}: ${h}`).join('\n')}

【历史提问参考（近期 6 轮）】：
${history.filter((h: any) => h.sender === 'user' || h.sender === 'dm').slice(-6).map((h: any) => `${h.senderName}: ${h.content}`).join('\n')}

【用户本轮提问】：
"${cleanQuestion}"

【裁判裁决规范】：
1. reasoning (思维链比对)：请先在内部严格比对玩家提问中的实体与假设：
   - 玩家提问的事实在【真实汤底】中是否存在？
   - 是否符合客观事实？
   - 是否命中了事件最核心的反转机制？
2. verdict (判定类别)：
   - YES: 提问符合真实汤底事实（回答“是”）
   - NO: 提问与真实事实矛盾或不存在（回答“否”）
   - IRRELEVANT: 与解开核心谜团无关（回答“无关”，例如打探不相干的背景、衣着、天气等）
   - KEY_POINT: 命中了极其核心的关键机制或重大反转（例如发现死者不是人类、发现了视力缺陷、发现了模拟器等核心突破点）
   - SOLVED: 用户本轮完整还原了案件的核心起因、经过与真相（恭喜破案）
3. dmExplanation (官方答复)：
   - 极简、严谨、客观（1句话，不超过25字）。
   - 严禁剧透后续细节！只回答“是/否/无关/关键线索”以及对该问题的最窄确认（例如“是，死者确实没有吃那块肉。”或“否，与现场留下的雨伞无关。”）。
4. isSolved (破案标志)：
   - 必须为布尔值。仅在用户本轮准确道破案件完整核心真相时为 true，其余均为 false。

【严格以 JSON 格式输出，不得包含 markdown 标记】：
{
  "reasoning": "简要比对理由...",
  "verdict": "YES" | "NO" | "IRRELEVANT" | "KEY_POINT" | "SOLVED",
  "verdictLabel": "✅ 是" | "❌ 否" | "❓ 无关" | "🎯 关键线索" | "🏆 恭喜破案",
  "dmExplanation": "...",
  "isSolved": false
}`;

      const completion = await client.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: '你只输出合法的纯 JSON 字符串，无 markdown 标记。' },
          { role: 'user', content: judgePrompt },
        ],
        temperature: 0.2,
        max_tokens: 350,
      });

      const raw = completion.choices?.[0]?.message?.content?.trim() || '';
      const cleanJson = raw.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim();
      let parsed: any;
      try {
        parsed = JSON.parse(cleanJson);
      } catch (parseErr) {
        console.warn('[turtle-soup/judge] JSON parse error:', parseErr, 'raw:', raw);
        return NextResponse.json({
          success: false,
          error: '守秘人 DM 裁决被迷雾遮蔽（模型返回数据格式解析失败），请重新提问。',
        }, { status: 502 });
      }

      // 严格校验判决枚举与文案映射
      const VALID_VERDICTS: Record<string, { verdict: TurtleSoupVerdict; label: string }> = {
        YES: { verdict: 'YES', label: '✅ 是' },
        NO: { verdict: 'NO', label: '❌ 否' },
        IRRELEVANT: { verdict: 'IRRELEVANT', label: '❓ 无关' },
        KEY_POINT: { verdict: 'KEY_POINT', label: '🎯 关键线索' },
        SOLVED: { verdict: 'SOLVED', label: '🏆 恭喜破案' },
      };

      const rawVerdict = String(parsed.verdict || '').toUpperCase().trim();
      const verdictInfo = VALID_VERDICTS[rawVerdict];
      if (!verdictInfo) {
        // 未知判决：严禁替模型降级瞎补为“否”，必须返回可重试错误，由前端提示重试
        console.warn('[turtle-soup/judge] Unknown verdict returned by model:', parsed.verdict);
        return NextResponse.json({
          success: false,
          error: '守秘人 DM 裁决含混不清（裁判模型返回了未定义的判决类型），本次提问未计入对局，请重新提问。',
          retryable: true,
        }, { status: 502 });
      }

      const verdict: TurtleSoupVerdict = verdictInfo.verdict;
      const verdictLabel: string = verdictInfo.label;

      // 严格校验 isSolved：布尔解析
      const rawIsSolved = parsed.isSolved;
      const isSolved = rawIsSolved === true || rawIsSolved === 'true' || rawIsSolved === 1 || rawIsSolved === '1';

      // 互锁约束校验：判决枚举与破案布尔值自相矛盾时，严禁补判，必须返回可重试错误
      if (verdict === 'SOLVED' && !isSolved) {
        console.warn('[turtle-soup/judge] Contradiction: verdict is SOLVED but isSolved is false');
        return NextResponse.json({
          success: false,
          error: '守秘人 DM 判决逻辑自相矛盾（宣布破案但未确认破案状态），本次提问未计入对局，请重新提问。',
          retryable: true,
        }, { status: 502 });
      }

      if (verdict !== 'SOLVED' && isSolved) {
        console.warn('[turtle-soup/judge] Contradiction: verdict is not SOLVED but isSolved is true:', verdict);
        return NextResponse.json({
          success: false,
          error: '守秘人 DM 判决逻辑自相矛盾（尚未破案却触发了破案标识），本次提问未计入对局，请重新提问。',
          retryable: true,
        }, { status: 502 });
      }

      // 同桌搭子的角色专属微反应（基于角色人设特征，按需低频插话，不知道真正汤底）
      const getCompanionReactions = (v: TurtleSoupVerdict) => {
        const isLulu = companionLeft.id.includes('lulu') || companionLeft.name.includes('璐璐');
        const isKoko = companionRight.id.includes('koko') || companionRight.name.includes('可可');

        if (v === 'SOLVED') {
          return {
            left: isLulu
              ? `${companionLeft.name}：“哼，虽然前面笨手笨脚的，但最后这几步还真挺帅气……指挥官，勉强承认你的实力啦！”`
              : `${companionLeft.name}：“精彩绝伦的破案推理！队长，真相终于大白了！”`,
            right: isKoko
              ? `${companionRight.name}：“🎉 哇啊啊啊破案啦！！指挥官神机妙算！太棒啦今晚必须吃大餐庆祝！✨”`
              : `${companionRight.name}：“完美结案！和队长合作推演的感觉太棒了！🎉”`,
          };
        }

        if (v === 'KEY_POINT') {
          return {
            left: isLulu
              ? `${companionLeft.name}：“等等！听到 DM 说的没？刚才这句切中关键反转点了，快顺着深挖！”`
              : `${companionLeft.name}：“重大突破！队长刚才这个假设非常致命，继续聚焦这一点！”`,
            right: isKoko
              ? `${companionRight.name}：“哇！主持人亮关键线索了！指挥官太敏锐啦，迷雾散开了一大片！✨”`
              : `${companionRight.name}：“命中了核心逻辑！距离真相只有一步之遥了！”`,
          };
        }

        // 普通轮次：交替插话或静心沉思，绝不两人机械化同时重复发言，给玩家充分留白
        const pickLeft = Math.random() < 0.5;

        if (v === 'YES') {
          const luluYes = [
            `${companionLeft.name}：“哼，证实了一个重要事实。别松懈，看下一步怎么串联。”`,
            `${companionLeft.name}：“事实确立！那导致这一幕的原因到底是什么？”`,
          ];
          const kokoYes = [
            `${companionRight.name}：“太棒啦！猜对了一个关键点！指挥官冲冲冲！✨”`,
            `${companionRight.name}：“好耶！证实了这个事实，感觉真相越来越近啦！”`,
          ];
          return {
            left: pickLeft
              ? (isLulu ? luluYes[Math.floor(Math.random() * luluYes.length)] : `${companionLeft.name}：“证实了一个关键事实，继续往下推导。”`)
              : `${companionLeft.name}（迅速在速记本上记录确认的事实…）`,
            right: !pickLeft
              ? (isKoko ? kokoYes[Math.floor(Math.random() * kokoYes.length)] : `${companionRight.name}：“猜对啦！顺着这个线索继续问！”`)
              : `${companionRight.name}（眼睛亮晶晶地注视着队长，静候下一步指令）`,
          };
        }

        if (v === 'NO') {
          const luluNo = [
            `${companionLeft.name}：“排除这个死角。既然不是这样，那背后必有蹊跷。”`,
            `${companionLeft.name}：“啧，居然不是吗？没事，至少排除掉了一个错误假设。”`,
          ];
          const kokoNo = [
            `${companionRight.name}：“唔……居然不是呀？挠头.jpg，容我再琢磨琢磨……”`,
            `${companionRight.name}：“看来不是常规走法，指挥官我们换个角度试试！”`,
          ];
          return {
            left: pickLeft
              ? (isLulu ? luluNo[Math.floor(Math.random() * luluNo.length)] : `${companionLeft.name}：“排除这个方向……看来真相在别的盲区。”`)
              : `${companionLeft.name}（托着下巴凝神沉思，默默推演其他分支…）`,
            right: !pickLeft
              ? (isKoko ? kokoNo[Math.floor(Math.random() * kokoNo.length)] : `${companionRight.name}：“唔……居然不是吗？容我再琢磨琢磨……”`)
              : `${companionRight.name}（咬着笔头认真回看刚才的汤面细节…）`,
          };
        }

        // IRRELEVANT 无关
        return {
          left: pickLeft
            ? `${companionLeft.name}：“无关细节。别在非主干上绕弯子，抓住核心反常点。”`
            : `${companionLeft.name}（平静地划掉无关细节…）`,
          right: !pickLeft
            ? `${companionRight.name}：“原来不相干呀～那重点一定在另一个方向！”`
            : `${companionRight.name}（托着腮静待队长发起新假设）`,
        };
      };

      const companionReactions = getCompanionReactions(verdict);

      const result: TurtleSoupJudgeResult = {
        verdict,
        verdictLabel,
        dmExplanation: typeof parsed.dmExplanation === 'string' && parsed.dmExplanation.trim()
          ? parsed.dmExplanation.trim()
          : `${verdictLabel}。请根据线索继续推演。`,
        luluReaction: companionReactions.left,
        kokoReaction: companionReactions.right,
        isSolved,
      };

      return NextResponse.json({
        success: true,
        result,
        reactions: {
          [companionLeft.id]: companionReactions.left,
          [companionRight.id]: companionReactions.right,
        },
      });
    } catch (err: any) {
      console.warn('[turtle-soup/judge] LLM failed:', err?.message);
      // 明确提示裁判暂时不可用，坚决不瞎编是/否误导玩家
      return NextResponse.json({
        success: false,
        error: '守秘人 DM 陷入迷雾（裁判模型服务响应超时或网络异常），本次提问未计入对局，请稍后重新提问。',
        retryable: true,
      }, { status: 503 });
    }
  } catch (error: any) {
    console.error('[turtle-soup/judge] Error:', error);
    return NextResponse.json({ error: error?.message || 'Server error' }, { status: 500 });
  }
}

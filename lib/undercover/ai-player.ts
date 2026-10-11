export interface UndercoverStatementContext {
  agentName: string;
  agentPersona: string;
  agentTone?: string;
  word: string;
  round: number;
  historyStatements: Array<{ playerName: string; text: string }>;
}

export interface UndercoverDebateContext {
  agentName: string;
  agentPersona: string;
  agentTone?: string;
  word: string;
  round: number;
  allStatements: Array<{ playerId: string; playerName: string; text: string }>;
  candidates: Array<{ playerId: string; playerName: string }>;
}

export interface UndercoverVoteContext {
  agentName: string;
  agentPersona: string;
  agentTone?: string;
  word: string;
  round: number;
  allStatements: Array<{ playerId: string; playerName: string; text: string }>;
  aliveCandidates: Array<{ id: string; name: string }>;
}

export interface UndercoverGuessContext {
  agentName: string;
  agentPersona: string;
  agentTone?: string;
  undercoverWord: string;
  allClues: Array<{ playerName: string; text: string }>;
}

export function buildStatementPrompt(ctx: UndercoverStatementContext): { systemPrompt: string; userPrompt: string } {
  const historyText = ctx.historyStatements.length > 0
    ? ctx.historyStatements.map((s, idx) => `  ${idx + 1}. 【${s.playerName}】：${s.text}`).join('\n')
    : '  （你是首位发言人，暂无前序线索）';

  const systemPrompt = `你叫【${ctx.agentName}】。
性格人设与口吻：${ctx.agentPersona}。语调风格：${ctx.agentTone || '鲜明生动'}。
你正在与其他 3 位玩家（包含真实人类玩家及其他搭子）在桌游室里玩经典的【谁是卧底】。
本桌规则：4名玩家中有 3 名平民（拿相同词）和 1 名卧底（拿相似词）。每个人只知道自己手里的词，不知道自己是平民还是卧底。

【任务与陈述原则】：
1. 你拿到的秘密词汇是：【${ctx.word}】。
2. 请用一句既符合你性格口吻、又带有隐晦线索的话来描述它（15~35个汉字）。
3. 严禁直接说出词汇本身、严禁说出词里的任何字！
4. 既不能描述得太直白导致给卧底送线索，也不能太抽象离谱导致被全场误当成卧底放逐！
5. 如果前面已有其他玩家的发言，请留心他们的描述是否与你的词相符；若隐隐感到自己和别人不太一样，可巧妙含蓄地打圆场。
6. 请严格输出为纯 JSON 格式：
{
  "statement": "你的描述台词"
}`;

  const userPrompt = `当前是第 ${ctx.round} 轮发言。
你的秘密手牌：【${ctx.word}】
场上本轮已有的前序发言记录：
${historyText}

请以【${ctx.agentName}】的身份，输出一句绝妙的描述（纯 JSON）：`;

  return { systemPrompt, userPrompt };
}

export function parseStatementResponse(rawText: string, fallback: string): string {
  if (!rawText || !rawText.trim()) return fallback;
  try {
    let text = rawText.trim();
    if (text.startsWith('```')) {
      text = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    }
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      const parsed = JSON.parse(text.slice(firstBrace, lastBrace + 1));
      if (typeof parsed.statement === 'string' && parsed.statement.trim()) {
        return parsed.statement.trim();
      }
    }
  } catch {
    // ignore
  }
  const cleaned = rawText.replace(/[\r\n"'{}]/g, '').trim();
  return cleaned.length >= 4 && cleaned.length <= 80 ? cleaned : fallback;
}

export function buildDebatePrompt(ctx: UndercoverDebateContext): { systemPrompt: string; userPrompt: string } {
  const statementsText = ctx.allStatements
    .map((s) => `  • 【${s.playerName}】描述道：“${s.text}”`)
    .join('\n');

  const candidateList = ctx.candidates.map((c) => `${c.playerName}(id: ${c.playerId})`).join('、');

  const systemPrompt = `你叫【${ctx.agentName}】。
性格人设与口吻：${ctx.agentPersona}。语调风格：${ctx.agentTone || '鲜明生动'}。
你正在玩【谁是卧底】。全员本轮陈述刚结束，现在进入自由质疑与互怼辩论环节！
你的秘密词是：【${ctx.word}】。

【任务要求】：
1. 仔细对比你自己的词和全场每一个人的描述。
2. 找出表述最违和、逻辑与你冲突最大、或者含糊其辞像是在心虚掩饰的 1 位嫌疑人（从这几位中选：${candidateList}）。
3. 用你鲜明的性格口吻（如璐璐傲娇炸毛挑刺、诺克斯冷静列疑点、可可元气直觉、薇薇安星象审判等），对该嫌疑人提出质疑并呼吁大家警惕（20~45个汉字）。
4. 必须输出纯 JSON 格式：
{
  "suspectId": "嫌疑人的playerId",
  "suspectName": "嫌疑人名字",
  "debateText": "你的质疑发言台词"
}`;

  const userPrompt = `本轮全员陈述如下：
${statementsText}

请选出你最怀疑的一个人，并以【${ctx.agentName}】的性格发起质疑（纯 JSON）：`;

  return { systemPrompt, userPrompt };
}

export function parseDebateResponse(
  rawText: string,
  fallbackSuspect: { playerId: string; playerName: string },
  fallbackText: string
): { suspectId: string; suspectName: string; debateText: string } {
  if (!rawText || !rawText.trim()) {
    return { suspectId: fallbackSuspect.playerId, suspectName: fallbackSuspect.playerName, debateText: fallbackText };
  }
  try {
    let text = rawText.trim();
    if (text.startsWith('```')) {
      text = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    }
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      const parsed = JSON.parse(text.slice(firstBrace, lastBrace + 1));
      if (parsed.debateText && typeof parsed.debateText === 'string') {
        return {
          suspectId: String(parsed.suspectId || fallbackSuspect.playerId),
          suspectName: String(parsed.suspectName || fallbackSuspect.playerName),
          debateText: parsed.debateText.trim(),
        };
      }
    }
  } catch {
    // ignore
  }
  return { suspectId: fallbackSuspect.playerId, suspectName: fallbackSuspect.playerName, debateText: fallbackText };
}

export function buildVotePrompt(ctx: UndercoverVoteContext): { systemPrompt: string; userPrompt: string } {
  const statementsText = ctx.allStatements
    .map((s) => `  • 【${s.playerName}】（id: ${s.playerId}）：“${s.text}”`)
    .join('\n');
  const candidateList = ctx.aliveCandidates.map((c) => `${c.name}(id: ${c.id})`).join('、');

  const systemPrompt = `你叫【${ctx.agentName}】。
性格：${ctx.agentPersona}。你手里的秘密词汇是：【${ctx.word}】。
现在全场进入投票放逐卧底环节！
你必须从活着且不是你自己的候选人中（可选目标：${candidateList}），选出 1 位你决定投票淘汰的玩家。

输出纯 JSON：
{
  "targetId": "被投票玩家的id",
  "targetName": "被投票玩家的名字",
  "reason": "10字以内的一句话投票理由"
}`;

  const userPrompt = `全场发言证据：
${statementsText}

请决定投给谁（纯 JSON）：`;

  return { systemPrompt, userPrompt };
}

export function parseVoteResponse(
  rawText: string,
  validCandidateIds: string[],
  fallbackTargetId: string
): { targetId: string; reason?: string } {
  if (!rawText || !rawText.trim()) return { targetId: fallbackTargetId };
  try {
    let text = rawText.trim();
    if (text.startsWith('```')) {
      text = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    }
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      const parsed = JSON.parse(text.slice(firstBrace, lastBrace + 1));
      const targetId = String(parsed.targetId || '').trim();
      if (validCandidateIds.includes(targetId)) {
        return { targetId, reason: typeof parsed.reason === 'string' ? parsed.reason.trim() : undefined };
      }
    }
  } catch {
    // ignore
  }
  return { targetId: fallbackTargetId };
}

export function buildGuessPrompt(ctx: UndercoverGuessContext): { systemPrompt: string; userPrompt: string } {
  const cluesText = ctx.allClues
    .map((c, i) => `  ${i + 1}. 【${c.playerName}】：${c.text}`)
    .join('\n');

  const systemPrompt = `你叫【${ctx.agentName}】。
在这局【谁是卧底】中，你刚才被全员投票放逐了，因为你的词汇是卧底词【${ctx.undercoverWord}】！
但是！你有唯一一次【绝地反杀】的机会：
根据场上其他平民之前说过的所有线索，推测平民手里的真正词汇是什么！只要你猜对了平民词，卧底阵营将立刻逆风翻盘获胜！

【推导提示】：
1. 卧底词通常和平民词属于同一类常见事物或概念（如：西瓜 vs 哈密瓜、微信 vs QQ、牛奶 vs 豆浆、吉他 vs 尤克里里）。
2. 平民们之前给出的所有描述特征，都是用来形容平民词的。
3. 请输出你推测出的平民词（通常为 2~4 个汉字的名词）。

请严格输出为纯 JSON：
{
  "guessWord": "猜测的平民词",
  "reasoning": "简要推导过程"
}`;

  const userPrompt = `平民们留下的历史描述线索：
${cluesText}

你的卧底词是【${ctx.undercoverWord}】。
请推测平民词（纯 JSON）：`;

  return { systemPrompt, userPrompt };
}

export function parseGuessResponse(rawText: string, fallbackGuess = ''): { guessWord: string; reasoning?: string } {
  if (!rawText || !rawText.trim()) return { guessWord: fallbackGuess };
  try {
    let text = rawText.trim();
    if (text.startsWith('```')) {
      text = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    }
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      const parsed = JSON.parse(text.slice(firstBrace, lastBrace + 1));
      if (typeof parsed.guessWord === 'string' && parsed.guessWord.trim()) {
        return {
          guessWord: parsed.guessWord.trim().replace(/[【】"']/g, ''),
          reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning.trim() : undefined,
        };
      }
    }
  } catch {
    // ignore
  }
  const cleaned = rawText.replace(/[\r\n"'{}]/g, '').trim();
  return { guessWord: cleaned.slice(0, 10) || fallbackGuess };
}

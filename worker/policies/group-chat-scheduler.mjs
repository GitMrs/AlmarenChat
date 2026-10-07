function agentMentioned(text, agent) {
  const content = String(text || '').toLocaleLowerCase();
  const name = String(agent.name || '').toLocaleLowerCase();
  if (!name || !content.includes(name)) return false;
  // 仅作为第三人称叙述/提及名字时不强制插队；只有带有 @ 或明确点名提问/邀请回答时才优先接话
  if (content.includes(`@${name}`)) return true;
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const directAddressPattern = new RegExp(`(?:@|请|让|问问|问下|听听)\\s*${escapedName}|${escapedName}[，,\\s]*[你您]?(?:怎么看|觉得|能说说|补充|有何看法)`);
  return directAddressPattern.test(content);
}

function asksForResponse(text) {
  return /[?？]|你怎么看|怎么看|觉得呢|怎么看待|能说说|想听听/.test(String(text || ''));
}

function agentEntries(transcript) {
  return (Array.isArray(transcript) ? transcript : []).filter((entry) => (entry?.agentId || entry?.agentName) && entry?.content);
}

export function chooseNextGroupChatSpeaker({ participants, transcript = [] }) {
  if (!participants.length) return null;
  if (participants.length === 1) return participants[0];

  const entries = agentEntries(transcript);
  const lastEntry = entries.at(-1) || null;
  const secondLastEntry = entries.at(-2) || null;
  const lastAgentId = lastEntry?.agentId || null;
  const secondLastAgentId = secondLastEntry?.agentId || null;

  // 1. 若上一轮发言中明确提及或提问了某位具体成员，优先由该成员接话
  if (lastEntry) {
    const addressed = participants.find((agent) => agent.id !== lastAgentId && agentMentioned(lastEntry.content, agent));
    if (addressed) return addressed;
  }

  // 首轮首个发言人默认由排序第一位成员开启
  if (!lastAgentId) return participants[0];

  // 2. 多维度打分机制 (加权轮转 + 连续发言惩罚 + 疑问词加分 + 随机抖动)
  const hasQuestion = lastEntry ? asksForResponse(lastEntry.content) : false;
  const cycleSize = Math.max(3, participants.length);
  const cycleEntries = entries.slice(-cycleSize);
  const turnCounts = new Map(participants.map((agent) => [agent.id, 0]));
  for (const entry of cycleEntries) {
    turnCounts.set(entry.agentId, (turnCounts.get(entry.agentId) || 0) + 1);
  }

  const scoredCandidates = participants.map((agent) => {
    // 基础随机抖动 (0 ~ 8 分)，让对话更自然生动
    let score = Math.random() * 8;

    // 刚发言过的成员施加重惩罚 (-12 分)，防止连续自言自语
    if (agent.id === lastAgentId) {
      score -= 12;
    }
    // 上上次发言的成员施加轻惩罚 (-5 分)，当群聊成员 >= 3 时防止两人乒乓互刷
    if (participants.length > 2 && agent.id === secondLastAgentId) {
      score -= 5;
    }
    // 前句包含提问或征求意见时，非上一位发言者获得加分 (+4 分)
    if (hasQuestion && agent.id !== lastAgentId) {
      score += 4;
    }
    // 近期周期发言频率平衡惩罚 (-4 分 / 次)
    const recentTurns = turnCounts.get(agent.id) || 0;
    score -= recentTurns * 4;

    return { agent, score };
  });

  scoredCandidates.sort((a, b) => b.score - a.score);
  return scoredCandidates[0]?.agent || participants[0];
}

export function nextGroupChatPosition({ participants, transcript }) {
  const nextAgent = chooseNextGroupChatSpeaker({ participants, transcript });
  const totalTurns = agentEntries(transcript).length;
  return {
    agent: nextAgent,
    currentRound: Math.floor(totalTurns / Math.max(1, participants.length)) + 1,
    currentIndex: Math.max(0, participants.findIndex((agent) => agent.id === nextAgent?.id)),
  };
}

export function groupChatTurnLimit({ participantCount, maxRounds }) {
  return Math.max(1, participantCount) * Math.max(1, maxRounds);
}

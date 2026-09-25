function agentMentioned(text, agent) {
  const content = String(text || '').toLocaleLowerCase();
  const name = String(agent.name || '').toLocaleLowerCase();
  return name.length > 0 && content.includes(name);
}

function asksForResponse(text) {
  return /[?？]|你怎么看|怎么看|觉得呢|怎么看待|能说说|想听听/.test(String(text || ''));
}

function agentEntries(transcript) {
  return (Array.isArray(transcript) ? transcript : []).filter((entry) => (entry?.agentId || entry?.agentName) && entry?.content);
}

export function chooseNextGroupChatSpeaker({ participants, transcript = [] }) {
  if (!participants.length) return null;
  const entries = agentEntries(transcript);
  const lastEntry = entries.at(-1) || null;
  const lastAgentId = lastEntry?.agentId || null;

  if (lastEntry && asksForResponse(lastEntry.content)) {
    const addressed = participants.find((agent) => agent.id !== lastAgentId && agentMentioned(lastEntry.content, agent));
    if (addressed) return addressed;
  }

  const cycleSize = participants.length;
  const cycleEntries = entries.slice(-cycleSize);
  const counts = new Map(participants.map((agent) => [agent.id, 0]));
  for (const entry of cycleEntries) counts.set(entry.agentId, (counts.get(entry.agentId) || 0) + 1);

  const eligible = participants.filter((agent) => agent.id !== lastAgentId);
  const pool = eligible.length > 0 ? eligible : participants;
  const lowestCount = Math.min(...pool.map((agent) => counts.get(agent.id) || 0));
  const leastSpoken = pool.filter((agent) => (counts.get(agent.id) || 0) === lowestCount);
  if (!lastAgentId) return participants[0];

  const lastIndex = participants.findIndex((agent) => agent.id === lastAgentId);
  return leastSpoken
    .slice()
    .sort((left, right) => {
      const leftDistance = (participants.indexOf(left) - lastIndex + participants.length) % participants.length || participants.length;
      const rightDistance = (participants.indexOf(right) - lastIndex + participants.length) % participants.length || participants.length;
      return leftDistance - rightDistance;
    })[0] || participants[0];
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

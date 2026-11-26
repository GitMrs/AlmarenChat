// Each request is one speaking turn. The server can resolve a different
// speaker from the one initially requested by the client.
export function replyQueueProgress(requests, index, coordinatorId) {
  const agentIds = requests.map(request => request.speakerAgentId || request.target?.id || coordinatorId);
  return { agentIds, index, memberCount: new Set(agentIds).size };
}

export function discussionSequence(participants, round) {
  return round === 2 ? [...participants].reverse() : participants;
}

export function nextDiscussionPosition(round, index, participantCount) {
  const atRoundEnd = index + 1 >= participantCount;
  return {
    round: atRoundEnd ? round + 1 : round,
    index: atRoundEnd ? 0 : index + 1,
  };
}

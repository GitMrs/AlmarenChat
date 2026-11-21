import { CRYPTO_REVIEW_ROLES, candidateRiskCheck, verifyCandidateConfirmation, normalizeCryptoVerdict } from './crypto-follow-up-review-policy.mjs';

// All reviewer calls are real and attributed to the configured member. Failures
// produce an auditable blocked outcome rather than silently returning to waiting.
export async function reviewCryptoCandidate({ assessment, snapshot, analystId, review, referenceConditions = [], now = Date.now() }: {
  assessment: any; snapshot: any; analystId: string;
  referenceConditions?: any[];
  review: (agentId: string, candidate: any, risk: any, prior: any[]) => Promise<any>; now?: number;
}) {
  if (assessment.status !== 'CANDIDATE') return { ...assessment, reviews: [] };
  const relevant = referenceConditions.filter(rule => rule.symbol === assessment.candidate.symbol
    && rule.direction === (assessment.candidate.direction === 'LONG' ? 'ABOVE' : 'BELOW'));
  const closedRules = relevant.filter(rule => rule.period !== 'PRICE');
  const required = closedRules.length ? closedRules : relevant;
  if (required.length && !required.some(rule => rule.level === assessment.candidate.confirmation.level
    && (rule.period === 'PRICE' || rule.period === assessment.candidate.confirmation.period))) {
    return { ...assessment, status: 'CONFIRMATION_FAILED', reason: '候选观察位或确认周期与本轮保存的原条件不一致，不能抬高门槛或降级确认周期', reviews: [] };
  }
  const confirmation = verifyCandidateConfirmation(assessment.candidate, snapshot, now);
  if (!confirmation.ok) return { ...assessment, status: 'CONFIRMATION_FAILED', reason: confirmation.reason, reviews: [] };
  const risk = candidateRiskCheck(assessment.candidate);
  const reviews: any[] = [];
  for (const agentId of CRYPTO_REVIEW_ROLES.filter(id => !(analystId === 'crypto-chart-master' && id === analystId))) {
    try {
      const result = await review(agentId, assessment.candidate, risk, reviews);
      reviews.push({ agentId, agentName: result.agentName, ...normalizeCryptoVerdict(result) });
    } catch (error: any) {
      return { ...assessment, status: 'REVIEW_BLOCKED', reason: `${agentId} 未完成审核：${String(error?.message || '审核失败').slice(0, 300)}`, reviews, risk };
    }
  }
  if (reviews.some(r => r.verdict === 'REJECT') || !risk.passed) return { ...assessment, status: 'REJECTED',
    reason: !risk.passed ? '程序风控否决：扣除估算成本后的最不利入场盈亏比不足1:2' : '审核成员否决了该候选，详见各自依据', reviews, risk };
  if (reviews.some(r => r.verdict === 'NEEDS_DATA')) return { ...assessment, status: 'REVIEW_BLOCKED', reason: '审核所需证据不足，当前候选没有通过', reviews, risk };
  return { ...assessment, status: 'APPROVED_FOR_WATCH', reason: '候选技术、衍生品与风险审核完成，仅供用户确认观察；当前账户净值仍需核验', reviews, risk };
}

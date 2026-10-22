export const MAX_WECHAT_PUBLICATION_POLLS = 24;

export function wechatPublicationPollDelayMs(pollCount) {
  const count = Math.max(0, Number.isInteger(pollCount) ? pollCount : 0);
  return Math.min(5 * 60_000, 30_000 * (2 ** Math.min(count, 4)));
}

export function classifyWechatPublicationStatus(value) {
  const status = Number(value?.status);
  if (status === 0) return { state: 'completed', message: '微信文章已发布' };
  if (status === 1) return { state: 'pending', message: '微信正在发布文章' };
  const labels = {
    2: '原创校验失败',
    3: '常规发布失败',
    4: '平台审核未通过',
    5: '文章发布后已被删除',
    6: '文章发布后已被平台封禁',
  };
  return { state: 'failed', message: labels[status] || `微信返回未知发布状态：${Number.isFinite(status) ? status : '无效'}` };
}

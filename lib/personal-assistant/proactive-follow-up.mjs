const STOP_FOLLOW_UP_PATTERN = /(?:别|不要)(?:再|继续)?(?:问|追问|提|聊|关心)|不想(?:说|聊|提)|到此为止|先不聊(?:这个|这件事)?/i;
const CANCELED_EVENT_PATTERN = /(?:没(?:有)?|不)(?:去|参加|考|做|开|发|看|出差|赶)|不想(?:去|参加|考|做|开|发|看|出差|赶)|(?:取消|改期|延期|不用去|没去|不去了|没参加|没发生)(?:了|啦)?/i;
const RESOLVED_EVENT_PATTERN = /(?:已经|早就|刚刚|刚才)?(?:结束|完成|搞定|解决|处理好|好了|好多了|退烧)(?:了|啦)|(?:面|考|开|做|发|看)完(?:了|啦)|(?:通过|没通过|失败)(?:了)?(?:这次)?(?:面试|考试|答辩)|(?:发布|上线|部署).*(?:成功|失败)(?:了|啦)?|结果(?:已经)?(?:出来|出了)/i;
const SENSITIVE_MOOD_PATTERN = /(?:很烦|情绪很差|心情很差|压力很大|想静静|没心情|不想说话)/i;

export function shouldSkipEventFollowUp(eventText, laterUserTexts = []) {
  const event = typeof eventText === 'string' ? eventText.trim() : '';
  const later = Array.isArray(laterUserTexts)
    ? laterUserTexts.filter((text) => typeof text === 'string').map((text) => text.trim()).filter(Boolean)
    : [];

  if (
    !event
    || STOP_FOLLOW_UP_PATTERN.test(event)
    || CANCELED_EVENT_PATTERN.test(event)
    || RESOLVED_EVENT_PATTERN.test(event)
    || SENSITIVE_MOOD_PATTERN.test(event)
  ) {
    return true;
  }

  return later.some((text) => (
    STOP_FOLLOW_UP_PATTERN.test(text)
    || CANCELED_EVENT_PATTERN.test(text)
    || RESOLVED_EVENT_PATTERN.test(text)
    || SENSITIVE_MOOD_PATTERN.test(text)
  ));
}

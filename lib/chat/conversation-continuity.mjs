const CONTINUATION_PATTERN = /^(?:(?:嗯|哦|噢|好|行|对|是|那)[，,、\s]*)*(?:继续|接着|然后呢|后来|那后来|那之后|所以呢|现在呢|接下来|后面呢|之后呢|继续呢|接着说|继续说)/u;
const HISTORY_REFERENCE_PATTERN = /(?:上次|之前|以前|昨天|前天|昨晚|那天|当时|刚刚|刚才|还记得|你记得|回忆|上次说|之前说|前面说|上面说)/u;
const SHORT_ANSWER_PATTERN = /^(?:嗯|哦|噢|好|行|可以|对|是|要|想|需要|不用|不要|不是|有|没有|没事|算了|去吧|来吧|查吧|继续吧|ok|okay|yes|no)(?:[，,、\s]*(?:啊|呀|吧|呢|的|了|嗯|哦|好|行|可以|对|是|要|想|需要|不用|不要|不是|有|没有|没事|算了|谢谢|谢啦|感谢))*[。！!？?~～\s]*$/iu;

const GENERIC_TERMS = new Set([
  '今天', '明天', '昨天', '现在', '刚才', '刚刚', '然后', '后来', '什么', '怎么', '怎样',
  '可以', '帮我', '一下', '这个', '那个', '需要', '使用', '处理', '任务', '工作', '内容',
  '完成', '创建', '修改', '生成', '实现', '一个', '我们', '你们', '他们', '自己', '不是',
  '没有', '知道', '觉得', '时候', '还是', '就是', '如果', '因为', '所以', '但是', '而且',
  '已经', '可能', '应该', '真的', '有点', '一些', '这些', '那些', '这样', '那样', '的话',
  '了吗', '呢吗', '好吧', '好的', '好啊', '嗯嗯', '谢谢', '请问', '麻烦', '记得', '最近',
  'the', 'and', 'you', 'what', 'how', 'can', 'please', 'ok', 'okay', 'this', 'that',
  'with', 'for', 'are', 'was', 'were', 'have', 'has', 'had', 'but', 'not',
]);

function normalize(value) {
  return String(value || '').toLocaleLowerCase().replace(/\s+/gu, '').trim();
}

function terms(value) {
  const text = normalize(value);
  const result = new Set(text.match(/[a-z0-9][a-z0-9._-]{1,}/g) || []);
  const chinese = text.replace(/[^\p{Script=Han}]/gu, '');
  for (let index = 0; index < chinese.length - 1 && result.size < 32; index += 1) {
    result.add(chinese.slice(index, index + 2));
  }
  return result;
}

function overlap(left, right) {
  const leftTerms = terms(left);
  if (!leftTerms.size) return 0;
  const rightText = normalize(right);
  return [...leftTerms].filter((term) => !GENERIC_TERMS.has(term) && rightText.includes(term)).length;
}

function isQuestion(value) {
  const text = String(value || '').trim();
  if (!text) return false;
  return /[?？]\s*$/u.test(text)
    || /(?:吗|呢|么|要不要|是否|好不好|行不行|可不可以|可以吗|怎么样|如何|对吧|是不是|有没有)\s*[。.!！~～]*$/u.test(text);
}

function formatGap(minutes) {
  if (!Number.isFinite(minutes)) return '';
  if (minutes < 1) return '不到 1 分钟';
  if (minutes < 60) return `${Math.round(minutes)} 分钟`;
  const hours = minutes / 60;
  return hours < 24 ? `${hours.toFixed(1).replace(/\.0$/u, '')} 小时` : `${Math.floor(hours / 24)} 天`;
}

export function classifyConversationContinuity({ message, history = [], now = new Date() } = {}) {
  const currentMessage = String(message || '').trim();
  const items = Array.isArray(history) ? history.filter((item) => item?.role === 'user' || item?.role === 'assistant') : [];
  const last = items.at(-1);
  const previous = last?.role === 'user' && normalize(last.content) === normalize(currentMessage) ? items.at(-2) : last;
  const previousUser = [...items].reverse().find((item) => item.role === 'user' && normalize(item.content) !== normalize(currentMessage));
  const lastAssistant = [...items].reverse().find((item) => item.role === 'assistant');
  const previousAt = previous?.createdAt ? new Date(previous.createdAt) : null;
  const gapMinutes = previousAt && !Number.isNaN(previousAt.getTime()) ? Math.max(0, (new Date(now).getTime() - previousAt.getTime()) / 60_000) : null;
  const relatedScore = overlap(currentMessage, previousUser?.content || previous?.content || '');
  const related = relatedScore > 0;
  const explicitContinuation = CONTINUATION_PATTERN.test(currentMessage);
  const explicitHistory = HISTORY_REFERENCE_PATTERN.test(currentMessage);
  const shortAnswer = SHORT_ANSWER_PATTERN.test(currentMessage);
  const lastAssistantQuestion = lastAssistant ? isQuestion(lastAssistant.content) : false;
  const withinHour = gapMinutes !== null && gapMinutes <= 60;

  let state = 'active';
  if (!previous) state = 'new';
  else if (explicitHistory && !explicitContinuation) state = 'past';
  else if (explicitContinuation) state = 'continue';
  else if (withinHour && related) state = 'continue';
  else if (lastAssistantQuestion && shortAnswer) state = 'continue';
  else if (gapMinutes === null) state = 'uncertain';
  else if (gapMinutes > 60) state = 'stale';

  return {
    state,
    gapMinutes,
    gapText: formatGap(gapMinutes),
    related,
    relatedScore,
    explicitContinuation,
    explicitHistory,
    shortAnswer,
    lastAssistantQuestion,
  };
}

export function buildConversationContinuityGuidance(input = {}) {
  const result = classifyConversationContinuity(input);
  if (result.state === 'new') return '【对话状态】没有可承接的上一轮消息，直接回答当前消息。';
  if (result.state === 'continue') return '【对话状态】程序判断当前消息明确延续上一轮，请直接承接，不要重复询问是否继续。';
  if (result.state === 'past') return '【对话状态】用户提到过去内容；可以结合历史回答。过去状态不要自动当成现在，只有当前消息明确说“还在、还没、仍然”时才按当前问题处理。';
  if (result.state === 'active') return '【对话状态】当前会话仍在进行，但当前消息可能已经切换话题；直接回答当前消息，不要强行接旧话题，也不要反问要不要接着聊。';
  if (result.state === 'stale') return `【对话状态】上一轮距今约 ${result.gapText || '较久'}，当前消息没有明确延续上一轮。不要主动提旧话题，也不要追问旧状态；直接回答当前消息。`;
  return '【对话状态】缺少足够的时间信息；直接回答当前消息，不要自行补全旧状态，也不要主动追问旧话题。';
}

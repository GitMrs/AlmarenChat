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

function formatMessageTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date);
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
  const interval = result.gapText ? `上一条消息距本轮约 ${result.gapText}` : '上一条消息的时间未知';
  const items = Array.isArray(input.history) ? input.history.filter(item => item?.role === 'user' || item?.role === 'assistant') : [];
  const last = items.at(-1);
  const lastTime = last?.createdAt ? formatMessageTime(last.createdAt) : '';
  const timestamp = lastTime ? `上一条消息时间为 ${lastTime}（北京时间）` : '上一条消息的绝对时间未知';
  const timing = `${interval}；${timestamp}`;
  if (result.state === 'new') return `【对话状态】没有可承接的上一轮消息；${timing}。直接回答当前消息。`;
  if (result.state === 'continue') return `【对话状态】程序判断当前消息明确延续上一轮；${timing}。请直接承接，不要重复询问是否继续。`;
  if (result.state === 'past') return `【对话状态】用户提到过去内容；${timing}。可以结合历史回答，但过去状态不要自动当成现在，只有当前消息明确说“还在、还没、仍然”时才按当前问题处理。`;
  if (result.state === 'active') return `【对话状态】当前会话仍在进行，但当前消息可能已经切换话题；${timing}。直接回答当前消息，不要强行接旧话题，也不要反问要不要接着聊。`;
  if (result.state === 'stale') return `【对话状态】上一轮距今约 ${result.gapText || '较久'}，${timestamp}，当前消息没有明确延续上一轮。不要主动提旧话题，也不要追问旧状态；直接回答当前消息。`;
  return `【对话状态】缺少足够的时间信息（${timing}）；直接回答当前消息，不要自行补全旧状态，也不要主动追问旧话题。`;
}

function beijingDateKey(value) {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(value));
  const fields = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}

const RECENT_STATE_PATTERNS = [
  { topic: '通勤', current: /(?:我在|正在|现在在).{0,8}(?:车上|地铁上|公交上|路上)/u, plan: /(?:出门|坐车|地铁|公交|去公司)/u, expiresHours: 6, close: /(?:到了|到家了|到公司了|下车了)/u },
  { topic: '吃饭', current: /(?:我在|正在|现在在).{0,8}(?:吃饭|吃东西|吃早饭|吃午饭|吃晚饭)/u, plan: /(?:吃早饭|吃午饭|吃晚饭|吃饭)/u, expiresHours: 6, close: /(?:吃完了|吃好了|不吃了)/u },
  { topic: '工作', current: /(?:我在|正在|现在在).{0,8}(?:上班|工作)/u, plan: /(?:上班|工作|加班)/u, expiresHours: 12, close: /(?:下班了|工作结束了|忙完了)/u },
  { topic: '睡眠', current: /(?:我要|准备|打算)(?:去)?睡了|晚安/u, plan: /(?:睡觉|早点睡|早睡)/u, expiresHours: 12, close: /(?:睡醒了|起床了)/u },
  { topic: '就医', current: /(?:我在|正在|现在在).{0,8}(?:医院|看医生|看病)/u, plan: /(?:去医院|看医生|看病)/u, expiresHours: 8, close: /(?:看完了|检查完了|离开医院了)/u },
  { topic: '行程', current: /(?:我在|正在|现在在).{0,8}(?:回家|出门)/u, plan: /(?:回家|出门|去一趟)/u, expiresHours: 12, close: /(?:到家了|回来了)/u },
];
const GENERIC_CANCEL_PATTERN = /(?:计划取消|取消了|不去.{0,8}了|不打算.{0,8}了)/u;

function beijingParts(value) {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false,
  }).formatToParts(new Date(value));
  return Object.fromEntries(parts.map(part => [part.type, part.value]));
}

function beijingDate(year, month, day, hour = 0) {
  return new Date(Date.UTC(year, month - 1, day, hour - 8));
}

function shiftedBeijingDay(value, offset, hour = 0) {
  const fields = beijingParts(value);
  const calendar = new Date(Date.UTC(Number(fields.year), Number(fields.month) - 1, Number(fields.day) + offset));
  return beijingDate(calendar.getUTCFullYear(), calendar.getUTCMonth() + 1, calendar.getUTCDate(), hour);
}

function plannedWindow(text, mentionedAt) {
  let offset = null;
  if (/明天|明早|明晚/u.test(text)) offset = 1;
  else if (/今天|今早|今晚|下午/u.test(text)) offset = 0;
  if (offset !== null) {
    const hour = /明早|今早/u.test(text) ? 6 : /下午/u.test(text) ? 13 : /明晚|今晚/u.test(text) ? 18 : 0;
    const startsAt = shiftedBeijingDay(mentionedAt, offset, hour);
    const expiresAt = shiftedBeijingDay(mentionedAt, offset + 1, 0);
    return { startsAt, expiresAt };
  }
  if (/周末/u.test(text)) {
    const fields = beijingParts(mentionedAt);
    const day = new Date(Date.UTC(Number(fields.year), Number(fields.month) - 1, Number(fields.day))).getUTCDay();
    const daysUntilSaturday = day === 0 || day === 6 ? 0 : 6 - day;
    const startsAt = day === 0 ? shiftedBeijingDay(mentionedAt, -1) : shiftedBeijingDay(mentionedAt, daysUntilSaturday);
    return { startsAt, expiresAt: new Date(startsAt.getTime() + 2 * 86_400_000) };
  }
  return null;
}

export function parseRecentStateMessage({ id = null, content = '', createdAt = new Date() } = {}) {
  const text = String(content || '').trim();
  const mentionedAt = new Date(createdAt);
  if (!text || Number.isNaN(mentionedAt.getTime()) || GENERIC_CANCEL_PATTERN.test(text)) return null;
  const planWindow = plannedWindow(text, mentionedAt);
  const definition = RECENT_STATE_PATTERNS.find(candidate => planWindow ? candidate.plan.test(text) : candidate.current.test(text));
  if (!definition) return null;
  const startsAt = planWindow?.startsAt || mentionedAt;
  const expiresAt = planWindow?.expiresAt || new Date(mentionedAt.getTime() + definition.expiresHours * 3_600_000);
  return {
    topic: definition.topic, value: text.slice(0, 120), status: planWindow ? 'PLANNED' : 'UNCONFIRMED',
    mentionedAt: mentionedAt.toISOString(), startsAt: startsAt.toISOString(), expiresAt: expiresAt.toISOString(),
    sourceMessageId: id ? String(id) : null,
  };
}

export function recentStateTransition(content = '') {
  const text = String(content || '');
  const closedTopics = RECENT_STATE_PATTERNS.filter(item => item.close.test(text)).map(item => item.topic);
  const cancelling = GENERIC_CANCEL_PATTERN.test(text);
  const cancelledTopics = cancelling
    ? RECENT_STATE_PATTERNS.filter(item => item.plan.test(text)).map(item => item.topic)
    : [];
  return {
    closedTopics,
    cancelledTopics,
    cancelLatest: cancelling && closedTopics.length === 0 && cancelledTopics.length === 0,
  };
}

function formatStateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '时间未知';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date);
}

export function extractRecentStates({ history = [], now = new Date() } = {}) {
  const items = Array.isArray(history)
    ? history.filter(item => item?.role === 'user' && item.content && item.createdAt)
    : [];
  const currentTime = new Date(now).getTime();
  const states = [];
  const active = new Map();
  for (const item of items.slice(-24)) {
    const transition = recentStateTransition(item.content);
    for (const topic of transition.closedTopics) {
      const state = active.get(topic);
      if (state) { state.status = 'CLOSED'; active.delete(topic); }
    }
    for (const topic of transition.cancelledTopics) {
      const state = active.get(topic);
      if (state) { state.status = 'CANCELLED'; active.delete(topic); }
    }
    if (transition.cancelLatest && active.size) {
      const state = [...active.values()].sort((a, b) => new Date(b.mentionedAt) - new Date(a.mentionedAt))[0];
      state.status = 'CANCELLED'; active.delete(state.topic);
    }
    const state = parseRecentStateMessage({ id: item.id, content: item.content, createdAt: item.createdAt });
    if (!state) continue;
    const previous = active.get(state.topic);
    if (previous) previous.status = 'CLOSED';
    states.push(state);
    active.set(state.topic, state);
  }
  for (const state of active.values()) if (new Date(state.expiresAt).getTime() < currentTime) state.status = 'EXPIRED';
  return states.slice(-6);
}

export function buildRecentStateRuntimeContext({ history = [], states: storedStates = null, now = new Date() } = {}) {
  const states = (Array.isArray(storedStates) && storedStates.length ? storedStates : extractRecentStates({ history, now }))
    .filter(state => state.status === 'UNCONFIRMED' || state.status === 'PLANNED');
  if (!states.length) return '';
  const lines = states.map(state => {
    const status = state.status === 'PLANNED' ? `计划中，目标时间 ${formatStateTime(state.startsAt)}` : '未确认结束';
    return `- ${state.topic}：${state.value}；提及时间 ${formatStateTime(state.mentionedAt)}；状态 ${status}；来源 ${state.sourceMessageId || '未知'}`;
  });
  return [
    '【近期状态】以下是程序从用户原话中提取的短期线索，不是当前事实。只能用于决定是否轻量确认；已结束或已过期的状态不要主动追问。',
    ...lines,
  ].join('\n');
}

export function buildRecentStateContinuityGuidance({ message = '', history = [], states = null, now = new Date() } = {}) {
  const baseGuidance = buildConversationContinuityGuidance({ message, history, now });
  const runtimeState = buildRecentStateRuntimeContext({ history, states, now });
  const current = String(message || '').trim();
  const items = Array.isArray(history)
    ? history.filter(item => item?.role === 'user' || item?.role === 'assistant')
    : [];
  const previousUser = [...items].reverse().find(item => item.role === 'user' && normalize(item.content) !== normalize(current));
  const previousAt = previousUser?.createdAt ? new Date(previousUser.createdAt) : null;
  const gapHours = previousAt && !Number.isNaN(previousAt.getTime())
    ? Math.max(0, (new Date(now).getTime() - previousAt.getTime()) / 3_600_000)
    : null;
  const sameDay = previousAt ? beijingDateKey(previousAt) === beijingDateKey(now) : false;
  const greeting = /^(?:嗨|哈喽|你好|早上好|中午好|下午好|晚上好|在吗|忙吗|嘿|hi|hello)[！!。？?\s]*$/iu.test(current);
  const shortMessage = SHORT_ANSWER_PATTERN.test(current) || greeting;

  if (previousUser && shortMessage && sameDay && gapHours !== null && gapHours <= 12) {
    return `${baseGuidance}\n\n${runtimeState}\n\n【近期状态承接】当前消息是简短寒暄或短回复。请先自然回应当前消息，再查看同一天较近的用户消息：如果其中有尚未确认结束的生活状态、计划或话题，可以用一个轻量问题确认进展。历史状态只能作为待确认线索，不能直接当成现在；如果用户已经提供新话题，优先接新话题。`;
  }
  if (previousUser && shortMessage && (!sameDay || gapHours === null || gapHours > 12)) {
    return `${baseGuidance}\n\n${runtimeState}\n\n【近期状态承接】当前消息是新的寒暄。优先从当前消息开始，不要主动恢复较早或跨天的生活话题；除非用户明确提到过去内容。`;
  }
  return `${baseGuidance}\n\n${runtimeState}\n\n【近期状态承接】先回答当前消息。只有当前消息自然需要时，才轻量承接同一天较近的生活状态；不能把历史状态直接当作当前事实。`;
}

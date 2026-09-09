export const MIN_AUTOMATION_INTERVAL_MINUTES = 15;
export const MAX_AUTOMATION_INTERVAL_MINUTES = 43_200;
export const DEFAULT_AUTOMATION_TIME_ZONE = 'Asia/Shanghai';
export const AUTOMATION_COMPLETION_ACTIONS = Object.freeze(['NONE', 'WECHAT_CREATE_DRAFT']);
const WECHAT_THEME_IDS = new Set(['fresh-green', 'editorial-red', 'midnight-gold']);

export function normalizeAutomationCompletion(input = {}, templateId = null, fallback = {}) {
  const completionAction = String(input.completionAction ?? fallback.completionAction ?? 'NONE').toUpperCase();
  if (!AUTOMATION_COMPLETION_ACTIONS.includes(completionAction)) throw new Error('自动化后续动作无效');
  if (completionAction === 'WECHAT_CREATE_DRAFT' && templateId !== 'wechat-article') {
    throw new Error('只有公众号创作室可以自动准备微信草稿');
  }
  if (completionAction === 'NONE') return { completionAction, completionConfig: null };
  const inputConfig = input.completionConfig && typeof input.completionConfig === 'object' ? input.completionConfig : {};
  const fallbackConfig = fallback.completionConfig && typeof fallback.completionConfig === 'object' ? fallback.completionConfig : {};
  const themeId = String(inputConfig.themeId ?? fallbackConfig.themeId ?? 'fresh-green');
  if (!WECHAT_THEME_IDS.has(themeId)) throw new Error('微信公众号主题无效');
  return { completionAction, completionConfig: { themeId } };
}

export function normalizeAutomationInterval(value) {
  const interval = Number(value);
  if (!Number.isInteger(interval) || interval < MIN_AUTOMATION_INTERVAL_MINUTES || interval > MAX_AUTOMATION_INTERVAL_MINUTES) {
    throw new Error(`自动化间隔必须是 ${MIN_AUTOMATION_INTERVAL_MINUTES} 到 ${MAX_AUTOMATION_INTERVAL_MINUTES} 分钟之间的整数`);
  }
  return interval;
}

export function nextAutomationRunAt(scheduledFor, intervalMinutes, now = new Date()) {
  const intervalMs = normalizeAutomationInterval(intervalMinutes) * 60_000;
  let next = new Date(scheduledFor).getTime() + intervalMs;
  const current = new Date(now).getTime();
  if (!Number.isFinite(next) || !Number.isFinite(current)) throw new Error('自动化执行时间无效');
  if (next <= current) next += Math.ceil((current - next + 1) / intervalMs) * intervalMs;
  return new Date(next);
}

export function normalizeAutomationTimeZone(value) {
  const timeZone = String(value || DEFAULT_AUTOMATION_TIME_ZONE).trim();
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
  } catch {
    throw new Error('自动化时区无效');
  }
  return timeZone;
}

export function normalizeAutomationClock(hour, minute) {
  const normalizedHour = Number(hour);
  const normalizedMinute = Number(minute);
  if (!Number.isInteger(normalizedHour) || normalizedHour < 0 || normalizedHour > 23) throw new Error('执行小时必须是 0 到 23');
  if (!Number.isInteger(normalizedMinute) || normalizedMinute < 0 || normalizedMinute > 59) throw new Error('执行分钟必须是 0 到 59');
  return { hour: normalizedHour, minute: normalizedMinute };
}

export function normalizeAutomationWeekdays(value) {
  const days = [...new Set((Array.isArray(value) ? value : []).map(Number))].sort((left, right) => left - right);
  if (days.length === 0 || days.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
    throw new Error('每周自动化至少需要选择一个有效星期');
  }
  return days;
}

function zonedParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  return Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]));
}

function zonedLocalTime(year, month, day, hour, minute, timeZone) {
  const wallClockUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let candidate = wallClockUtc;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = zonedParts(new Date(candidate), timeZone);
    const representedUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second || 0, 0);
    candidate -= representedUtc - wallClockUtc;
  }
  return new Date(candidate);
}

export function nextCalendarAutomationRunAt(automation, now = new Date()) {
  const scheduleType = String(automation?.scheduleType || '').toUpperCase();
  const timeZone = normalizeAutomationTimeZone(automation?.timeZone);
  const { hour, minute } = normalizeAutomationClock(automation?.scheduleHour, automation?.scheduleMinute);
  const current = new Date(now);
  if (!Number.isFinite(current.getTime())) throw new Error('自动化执行时间无效');
  const currentParts = zonedParts(current, timeZone);
  const weekdays = scheduleType === 'WEEKLY' ? normalizeAutomationWeekdays(automation?.weekdays) : null;
  if (!['DAILY', 'WEEKLY'].includes(scheduleType)) throw new Error('日历自动化类型无效');

  for (let dayOffset = 0; dayOffset <= 14; dayOffset += 1) {
    const localDate = new Date(Date.UTC(currentParts.year, currentParts.month - 1, currentParts.day + dayOffset));
    if (weekdays && !weekdays.includes(localDate.getUTCDay())) continue;
    const candidate = zonedLocalTime(
      localDate.getUTCFullYear(),
      localDate.getUTCMonth() + 1,
      localDate.getUTCDate(),
      hour,
      minute,
      timeZone
    );
    if (candidate.getTime() > current.getTime()) return candidate;
  }
  throw new Error('无法计算下一次自动化执行时间');
}

export function nextScheduledAutomationRunAt(automation, scheduledFor, now = new Date()) {
  return automation?.scheduleType === 'DAILY' || automation?.scheduleType === 'WEEKLY'
    ? nextCalendarAutomationRunAt(automation, now)
    : nextAutomationRunAt(scheduledFor, automation?.intervalMinutes, now);
}

export function normalizeAutomationSchedule(input = {}, fallback = {}) {
  const scheduleType = String(input.scheduleType ?? fallback.scheduleType ?? 'INTERVAL').toUpperCase();
  if (!['INTERVAL', 'DAILY', 'WEEKLY'].includes(scheduleType)) throw new Error('自动化周期类型无效');
  const timeZone = normalizeAutomationTimeZone(input.timeZone ?? fallback.timeZone);
  if (scheduleType === 'INTERVAL') {
    return {
      scheduleType,
      intervalMinutes: normalizeAutomationInterval(input.intervalMinutes ?? fallback.intervalMinutes ?? 1440),
      timeZone,
      scheduleHour: null,
      scheduleMinute: null,
      weekdays: null,
    };
  }
  const clock = normalizeAutomationClock(
    input.scheduleHour ?? fallback.scheduleHour ?? 9,
    input.scheduleMinute ?? fallback.scheduleMinute ?? 0
  );
  return {
    scheduleType,
    intervalMinutes: normalizeAutomationInterval(input.intervalMinutes ?? fallback.intervalMinutes ?? 1440),
    timeZone,
    scheduleHour: clock.hour,
    scheduleMinute: clock.minute,
    weekdays: scheduleType === 'WEEKLY'
      ? normalizeAutomationWeekdays(input.weekdays ?? fallback.weekdays ?? [1])
      : null,
  };
}

export function initialAutomationRunAt(schedule, now = new Date()) {
  return schedule.scheduleType === 'INTERVAL'
    ? new Date(new Date(now).getTime() + schedule.intervalMinutes * 60_000)
    : nextCalendarAutomationRunAt(schedule, now);
}

export function automationAuthorization(automation, templateSnapshot = null) {
  const deliverables = Array.isArray(templateSnapshot?.deliverables)
    ? templateSnapshot.deliverables.filter((item) => typeof item === 'string').slice(0, 8)
    : [];
  const preparesWechatDraft = automation?.completionAction === 'WECHAT_CREATE_DRAFT';
  const completionDeliverables = preparesWechatDraft
    ? ['一篇可直接发布的 Markdown 正文', '一张与本成果关联且文件名包含 cover 或“封面”的封面图片']
    : [];
  return {
    objective: String(automation.prompt || '').trim(),
    steps: [String(automation.prompt || '').trim()],
    deliverables: [...deliverables, ...completionDeliverables],
    artifacts: [...deliverables, ...completionDeliverables],
    capabilities: [
      'workspace_read',
      'workspace_write',
      ...(automation.networkPolicy === 'forbidden' ? [] : ['web_research']),
      ...(preparesWechatDraft ? ['image_generate'] : []),
    ],
    networkPolicy: automation.networkPolicy === 'required' ? 'required' : automation.networkPolicy === 'allowed' ? 'allowed' : 'forbidden',
    maxTasks: 8,
  };
}

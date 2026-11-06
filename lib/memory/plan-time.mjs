import { formatArchiveTimestamp } from './chat-archive-content.mjs';

export const PLAN_QUERY = /计划|安排|行程|日程|待办|打算|准备|要做|还没做|没完成/u;
export const PLAN_CHANGE = /改期|改到|改成|推迟|提前|取消|不去了|不去坐|已完成|已经完成|已经坐|坐完/u;

// A statement's relative dates are anchored to its source message, never recall time.
export function resolvePlanDate(text, reference, { allowPastWeekday = false } = {}) {
  // For an explicit reschedule, the date after the change is the new target.
  const changed = String(text).split(/改到|改成|推迟到|提前到|改期到/u);
  if (changed.length > 1) text = changed.at(-1);
  const day = typeof reference === 'string' && /^\d{4}-\d{2}-\d{2}(?: |$)/u.test(reference)
    ? reference.slice(0, 10) : formatArchiveTimestamp(reference).slice(0, 10);
  const base = new Date(`${day}T00:00:00+08:00`);
  if (!Number.isFinite(base.getTime())) return null;
  const dates = new Set();
  const explicit = [...String(text).matchAll(/(\d{4})[-年](\d{1,2})[-月](\d{1,2})日?/gu)];
  for (const match of explicit) {
    const value = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
    if (formatArchiveTimestamp(new Date(`${value}T00:00:00+08:00`)).slice(0, 10) !== value) return null;
    dates.add(value);
  }
  // An explicit normalized date may coexist with the original relative wording.
  if (dates.size) return dates.size === 1 ? [...dates][0] : null;
  const add = offset => dates.add(formatArchiveTimestamp(new Date(base.getTime() + offset * 86400000)).slice(0, 10));
  for (const match of String(text).matchAll(/大后天|后天|明天|今天|昨日|昨天|前天/gu)) {
    add({ 大后天: 3, 后天: 2, 明天: 1, 今天: 0, 昨日: -1, 昨天: -1, 前天: -2 }[match[0]]);
  }
  const weekday = (new Date(base.getTime() + 8 * 3600000).getUTCDay() + 6) % 7;
  for (const match of String(text).matchAll(/(下下|下|这|本|上)?(?:周|星期)([一二三四五六日天])/gu)) {
    const offset = '一二三四五六日'.indexOf(match[2] === '天' ? '日' : match[2]) - weekday;
    // A bare weekday already past in the source week is ambiguous.
    if (!match[1] && offset < 0 && !allowPastWeekday) return null;
    add(offset + ({ 下下: 14, 下: 7, 这: 0, 本: 0, 上: -7 }[match[1]] || 0));
  }
  return dates.size === 1 ? [...dates][0] : null;
}

export function planDateQuery(query, now = new Date()) {
  return isPlanScheduleQuery(query) ? resolvePlanDate(query, now, { allowPastWeekday: true }) : null;
}

export function isPlanScheduleQuery(query) {
  return PLAN_QUERY.test(String(query)) && !/(?:说|提|聊|告诉).{0,4}(?:过|了|什么)|说过|提过|聊过/u.test(query);
}

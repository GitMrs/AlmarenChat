const EXPLICIT_REMINDER_PATTERN = /(?:提醒(?:我|一下)?|设置(?:一个)?(?:提醒|闹钟)|(?:帮我|给我)(?:记一下|记下|记个|添加)(?:提醒|待办|便签|日程)?|记一下|记下|记个(?:提醒|待办|便签|日程)|别忘了|不要忘(?:了)?|闹钟|叫我)/;
const SCHEDULE_CUE_PATTERN = /(?:今天|明天|后天|大后天|周[一二三四五六日天]|周末|上午|中午|下午|晚上|今晚|明早|早晨|清晨|深夜|下班|\d{1,2}[：:]\d{2}|\d{1,2}点(?:半|\d{1,2}分)?|\d+(?:分钟|小时)后)/;

export function classifyReminderRequest(message) {
  const explicit = EXPLICIT_REMINDER_PATTERN.test(message);
  return { explicit, hasCue: explicit || SCHEDULE_CUE_PATTERN.test(message) };
}

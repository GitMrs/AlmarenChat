const DAY_MS = 86_400_000;

export const FOLLOW_UP_MAX_ATTEMPTS = 3;
export const FOLLOW_UP_LEASE_MS = 5 * 60_000;
export const FOLLOW_UP_ACTIVE_LIMIT = 12;
export const FOLLOW_UP_DEFAULT_MAX_CONTINUATIONS = 3;
export const FOLLOW_UP_MAX_CONTINUATIONS_SETTING = 24;
export const FOLLOW_UP_CHAIN_WINDOW_MS = DAY_MS;
export const FOLLOW_UP_MIN_CONTINUATION_MS = 15 * 60_000;

export function supportsSpaceFollowUps(space) {
  return Boolean(space && space.runtimeType !== 'PI_CODING');
}

export function followUpSummary(content) {
  const paragraphs = String(content || '').replace(/^【自主(?:复查|跟进)[^\n]*】\s*/u, '').split(/\n\s*\n/u);
  const paragraph = paragraphs.find(value => value.trim() && !/^\s*#{1,6}\s/u.test(value)) || paragraphs[0] || '';
  const text = paragraph.replace(/[*_`]/gu, '').trim();
  return text.length > 240 ? `${text.slice(0, 240)}…` : text;
}

export function normalizeFollowUpLimit(value) {
  if (!Number.isInteger(value) || value < 0 || value > FOLLOW_UP_MAX_CONTINUATIONS_SETTING) {
    throw new Error(`自动续查上限必须是 0 到 ${FOLLOW_UP_MAX_CONTINUATIONS_SETTING} 之间的整数`);
  }
  return value;
}

export function followUpMaxChainDepth(task) {
  return task.maxChainDepth == null ? FOLLOW_UP_DEFAULT_MAX_CONTINUATIONS : normalizeFollowUpLimit(task.maxChainDepth);
}

// 普通临时看盘不授予后台跟进权限；是否需要续查由后台复查轮次单独决定。
export function isExplicitFollowUpRequest(text) {
  const message = String(text || '').trim();
  if (/(?:不要|不用|无需|不需要|别|取消|停止|暂停).{0,12}(?:跟进|复查|再看|盯盘|提醒|定时|继续看|查询|查看|观察|观测|复核|核验|核对|检查|跟踪)/u.test(message)) return false;
  if (/(?:解释|介绍|什么是|怎么用|如何使用|支持|机制|逻辑|有没有|怎么决定|如何决定)/u.test(message)
    && /(?:定时|自主|自动).{0,8}(?:复查|跟进|提醒|观测|观察|复核|核验|核对|检查|跟踪)|(?:怎么决定|如何决定).{0,20}(?:复查|再次查询|再查|再看|观测|观察)/u.test(message)
    && !/(?:帮我|替我|请你|继续跟进)/u.test(message)) return false;
  // “什么时候再次查询”与“几点再看一次”表达同一后续意图；不能只开放查询任务列表。
  if (/(?:几点|什么时候|多久|多长时间).{0,12}(?:复查|再(?:次)?(?:看|查(?:询|看)?|观[察测]))/u.test(message)) return true;
  return /(?:持续|继续|后续|自动|定时|帮我|替我).{0,8}(?:跟进|复查|盯盘|盯着|监控)|(?:持续|后续|自动|定时).{0,8}(?:复核|核验|核对|检查|跟踪)|(?:帮我|替我).{0,12}(?:盯一下|盯住)|(?:稍后|一会[儿]?|过会[儿]?|晚[点些]|明[天早晚]|今晚|\d{1,2}[:：点时]|半[个]?小时|[一二两三四五六七八九十\d]+\s*(?:分钟|个?小时)).{0,20}(?:再(?:次)?(?:看|查(?:询|看)?|观[察测])|看看|看一下|复查|复核|核验|核对|检查|跟进)|提醒我.{0,12}(?:看|查|跟进|复核|核验|核对|检查)|到时.{0,8}(?:再(?:次)?(?:看|查(?:询|看)?|观[察测])|复查|复核|核验|核对|检查)/u.test(message);
}

export function followUpChainEndsAt(task) {
  return task.chainEndsAt ? new Date(task.chainEndsAt) : new Date(new Date(task.runAt).getTime() + FOLLOW_UP_CHAIN_WINDOW_MS);
}

export function canContinueFollowUp(task, now = new Date()) {
  return (task.chainDepth || 0) < followUpMaxChainDepth(task)
    && followUpChainEndsAt(task).getTime() >= new Date(now).getTime() + FOLLOW_UP_MIN_CONTINUATION_MS;
}

export function followUpProgress(task, now = new Date()) {
  const depth = task.chainDepth || 0;
  const max = followUpMaxChainDepth(task);
  const remaining = Math.max(0, max - depth);
  const stopReason = remaining === 0 ? 'LIMIT_REACHED'
    : !canContinueFollowUp(task, now) ? 'DEADLINE' : null;
  return { depth, max, remaining, stopReason };
}

export function formatFollowUpProgress(task, now = new Date()) {
  const { depth, max, remaining, stopReason } = followUpProgress(task, now);
  const label = task.domain === 'GENERAL' ? '跟进' : '复查';
  const round = depth === 0 ? `首次${label}` : `第 ${depth}/${max} 次自动续查`;
  const state = stopReason === 'LIMIT_REACHED' ? '已达到自动续查次数上限，本轮跟进结束。'
    : stopReason === 'DEADLINE' ? '已无满足最小间隔的剩余时间，本轮跟进结束。'
      : `自动续查额度剩余 ${remaining}/${max} 次，是否继续以实际保存结果为准。`;
  return `${label}进度：${round}；${state}`;
}

export const FOLLOW_UP_REVIEW_GUIDANCE = [
  '【跟进输出要求】第一段直接给出简报，再说明核验依据。对照上次的目标和条件，逐项说明已满足、未满足或数据不足，不重复空泛结论。',
  '明确本次变化、下一步成立的条件和结束跟进的条件；只能基于本轮实际取得的资料判断。若关联成果，读取其最新内容后再评价，不把文件名、更新时间或任务完成状态当作已验证内容。',
  '若继续跟进，必须说明下一次具体核验什么，续查工具的 prompt 保留本轮证据和触发/结束条件。目标完成、判断失效或缺乏继续价值时结束当前主题，不另起方向消耗续查次数。',
  '【系统管理进度】本轮序号、剩余次数、截止时间以及后续是否保存由系统提供。正文不要自行称“末次/最后一次”，不要宣称已安排或自行输出下次时间；如需续查实际调用工具，系统会在正文后附上准确进度和保存结果。没有必要继续时明确结束观察并说明原因。',
].join('\n');

export function normalizeFollowUpContinuation(task, input, now = new Date()) {
  if (!canContinueFollowUp(task, now)) throw new Error('本轮跟进已达到自动续查次数或时间上限');
  const next = normalizeFollowUp(input, now);
  if (next.runAt.getTime() < new Date(now).getTime() + FOLLOW_UP_MIN_CONTINUATION_MS) throw new Error('自动续查至少间隔15分钟');
  const chainEndsAt = followUpChainEndsAt(task);
  if (next.runAt > chainEndsAt) throw new Error('自动续查必须在本轮跟进的24小时期限内');
  const reason = String(input?.reason || '').trim();
  if (!reason || reason.length > 500) throw new Error('自动续查需要说明具体原因，最多500字');
  return { ...next, reason, origin: 'AI_FOLLOW_UP', parentId: task.id, chainDepth: (task.chainDepth || 0) + 1, maxChainDepth: followUpMaxChainDepth(task), chainEndsAt };
}

export function normalizeFollowUp(input, now = new Date()) {
  const title = String(input?.title || '').trim();
  const prompt = String(input?.prompt || '').trim();
  const rawTime = input?.runAt instanceof Date ? input.runAt.toISOString() : String(input?.runAt || '').trim();
  if (!title || title.length > 100) throw new Error('跟进标题必须为 1 到 100 字');
  if (!prompt || prompt.length > 4000) throw new Error('跟进要求必须为 1 到 4000 字');
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(rawTime)) throw new Error('执行时间必须包含时区，例如 2026-11-14T21:00:00+08:00');
  const runAt = new Date(rawTime);
  const delta = runAt.getTime() - new Date(now).getTime();
  if (!Number.isFinite(delta) || delta <= 0 || delta > 7 * DAY_MS) throw new Error('跟进时间必须在未来 7 天内');
  return { title, prompt, runAt };
}

export function followUpContext(messages = []) {
  return messages.slice(-8).map(message => {
    const role = message.role === 'user' ? '用户' : message.speakerAgentId || '成员';
    return `${role}：${String(message.content || '').slice(0, 1500)}`;
  }).join('\n\n').slice(-8000);
}

export const SPACE_FOLLOW_UP_GUIDANCE = [
  '【空间自主跟进】你可以使用 schedule_space_follow_up 安排一次未来的只读复查，并由你在原空间主动汇报；使用 list_space_follow_ups 查看、cancel_space_follow_up 取消。后台关闭浏览器也会执行，时间默认按用户当前时间上下文中的时区理解。',
  '【按发起来源区分】用户临时问“看看BTC、当前呢、看看这份报告”等，只回答当前问题，不自行安排后续。只有用户明确要求“到时再看、几点再看一次、稍后继续跟进、提醒我复查”时，才选择明确时间并调用工具，保存本次判断、要核验的变化与完成/结束条件。时间或目标不明确且无法合理推断时先澄清。',
  '【询问下次复查】“下次什么时候会再次查询、多久后再观察、几点再看一次”也属于后续跟进意图。先查看本空间的已有任务；同主题已有待复查或执行中的任务时，报告实际安排，不重复创建。没有对应任务且能从当前对话确定观察标的与事项时，自行选择合理的未来时点并调用 schedule_space_follow_up 保存首次复查，不能只给出建议时间就结束。目标无法确定时再询问用户；单独开启开关不等于安排任务。',
  '只有工具返回 ok:true 才能说已安排，并告知准确日期、时间和复查事项；失败则如实说明。不要再笼统声称“不能主动定时提醒”。进入后台自主复查后，AI可以依据新盘面决定是否续查及下次时间；自动续查上限按空间设置保存，默认3次、不含首次，具体以工具返回的 maxChainDepth 为准。期限24小时，不承诺无限持续。不要把已经过去的时点安排到明天。',
  '跟进仅查询资料、检查进展和在当前空间汇报；需要写文件、执行命令或外部操作的工作仍走现有任务授权流程。不得承诺跟进任务支持价格突破触发，当前仅按指定时间执行。',
  '【成果关联】当前对话已选择成果时，跟进默认关联该成果；没有选择时可仅跟进对话。不要为每次跟进另建成果或文件。关联成果的完整报告保存在该成果的跟进记录，对话收到简报。',
].join('\n');

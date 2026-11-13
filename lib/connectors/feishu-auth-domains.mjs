// Domain names supported by the pinned official CLI (1.0.100).
export const FEISHU_AUTH_DOMAINS = [
  { id: 'docs', label: '文档' },
  { id: 'drive', label: '云空间' },
  { id: 'wiki', label: '知识库' },
  { id: 'base', label: '多维表格' },
  { id: 'sheets', label: '电子表格' },
  { id: 'calendar', label: '日历' },
  { id: 'task', label: '任务' },
  { id: 'im', label: '消息' },
  { id: 'mail', label: '邮箱' },
  { id: 'contact', label: '通讯录' },
  { id: 'approval', label: '审批' },
  { id: 'attendance', label: '考勤' },
  { id: 'vc', label: '视频会议' },
  { id: 'minutes', label: '妙记' },
  { id: 'slides', label: '幻灯片' },
  { id: 'markdown', label: 'Markdown' },
  { id: 'mindnotes', label: '思维笔记' },
  { id: 'note', label: '笔记' },
  { id: 'okr', label: 'OKR' },
  { id: 'application', label: '应用管理' },
  { id: 'apps', label: '应用搭建' },
  { id: 'event', label: '事件' },
];

export function validateFeishuAuthDomains(domains) {
  if (!Array.isArray(domains) || !domains.length || domains.length > FEISHU_AUTH_DOMAINS.length ||
    domains.some(id => typeof id !== 'string' || !FEISHU_AUTH_DOMAINS.some(domain => domain.id === id))) {
    throw new Error('请选择需要授权的飞书功能，不支持全部权限或未知功能');
  }
  return [...new Set(domains)];
}

export function isWechatWorkspace(space) {
  return space?.workspaceType === 'WECHAT' || space?.templateId === 'wechat-article';
}

export function spaceWorkspaceHref(space) {
  return `${isWechatWorkspace(space) ? '/wechat' : '/spaces'}/${encodeURIComponent(space.id)}`;
}

export const WECHAT_DEFAULT_AGENT_IDS = ['gl-zmtyy', 'research-assistant', 'writing-assistant', 'top-copywriting-master'];

export const WECHAT_WORKSPACE_INSTRUCTIONS = [
  '这是微信公众号工作室。保留各成员身份，根据用户当前需要讨论选题、创作、修改或准备发布。',
  '讨论不等于执行任务；明确制作或修改产物时沿用任务方案和授权流程。简单修改不机械启动完整制作流程。',
  '账号定位与写作偏好保存在 shared/content-strategy.md，制作前按需读取；本篇需求与用户最新修改意见优先。',
  '文章正文保存到当前成果 article.md，首行为唯一正式标题；发布资料、备选标题和来源另存 publish-info.md。',
  '封面与正文图片归属当前成果；已有可用图片时不无故重新生成。写作结构、长度和语气服从本篇要求，不强制爆款方法。',
  '外部资料须核验，无法取得的信息如实说明。创建微信草稿和正式发布继续通过独立审批，不以聊天回复代替操作结果。',
].join('\n');

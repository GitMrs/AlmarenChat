import { CONVERSATION_GROUNDING_GUIDANCE } from '@/lib/chat/conversation-grounding.mjs';
import { selectRelevantUserMemories } from './user-memory';

type Profile = { name: string; identity: string | null; soul: string | null };
type Memory = { category: string; content: string };

export function formatCurrentTime(date: Date = new Date()): string {
  const options: Intl.DateTimeFormatOptions = {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  };
  return new Intl.DateTimeFormat('zh-CN', options).format(date);
}

export function buildPersonalAssistantPrompt(options: {
  userName: string;
  profile: Profile;
  memories: Memory[];
  experienceContext?: string | null;
  platformContext: string;
  activityContext?: string | null;
  webEnabled: boolean;
  query?: string;
}) {
  const currentTimeStr = formatCurrentTime();
  const relevantMemories = selectRelevantUserMemories(options.memories, options.query, 6);
  const memoryText = relevantMemories.length
    ? relevantMemories.map((item) => `- [${item.category}] ${item.content}`).join('\n')
    : '（本轮没有与问题直接相关的长期记忆）';

  return `你是 AlmarenChat 的个人助理「${options.profile.name}」，陪伴用户 ${options.userName}，提供倾听、平台指引和使用答疑。

【当前时间】${currentTimeStr}（北京时间 UTC+8）。涉及“刚才、昨晚、今晚、上周”等时间时，以消息时间和当前时间判断；不能因为历史里没有明确的结束语，就把旧状态延续到现在。经历摘要中的状态只在其记录时间范围内成立。

【角色】
身份：${options.profile.identity?.trim() ? options.profile.identity.trim() : '自然、可靠、懂分寸的个人助理'}
语气：${options.profile.soul?.trim() ? options.profile.soul.trim() : '真诚温暖、简洁、有实际帮助'}

${CONVERSATION_GROUNDING_GUIDANCE}

【平台指引】
- 模型设置：[账号设置](/me?tab=settings)（线上 API 保存在账号；本地 Ollama 配置只保存在当前浏览器）；Agent 广场：[Agent 广场](/agents)；创建 Agent：[新建 Agent](/create-agent)；协作项目：[协作空间](/spaces)；历史会话：[会话中心](/conversations)。只有用户问到相关功能时才主动介绍。
- 用户明确要求记住或创建提醒时，等待系统真实保存结果后再确认；不明确时先询问。
- 涉及系统操作先说明建议，不要冒充已经完成。
- ${options.webEnabled ? '可以使用天气、热榜、行情和网页工具，但只能依据本轮真实返回结果说明来源、时间和查询状态。' : '当前没有服务端联网工具，不能编造最新天气、热榜或行情。'} “查询状态”由系统追加，不要自行生成。

已确认记忆：
${memoryText}

主聊天经历摘要（系统从较早的原始对话批量压缩而来；可能省略细节，不得覆盖用户已确认记忆或较新的原话）：
${options.experienceContext || '（尚无已归档的主聊天经历）'}

平台摘要（只读；仅包含用户在设置中允许的来源，禁止推断已关闭来源）：
${options.platformContext}

按日期查询的平台活动证据（严格依据 activity/activities 区分“创建、更新、完成”，不要混为一谈）：
${options.activityContext || '（本轮没有查询日期活动；不要猜测用户某天做过什么）'}`;
}

import {
  prepareCryptoSpaceMessageRuntime,
  prepareGeneralCryptoQueryRuntime,
  type CryptoAgentPolicyInput,
  type CryptoAttachmentInput,
  type CryptoMessageRuntimeInput,
  type PreparedCryptoMessageRuntime,
} from '../workspace/crypto/space-message-runtime';
import { loadAgentWorldContext } from '../world/context';

export interface SpaceMessageRuntimeInput extends CryptoMessageRuntimeInput {
  templateId?: string | null;
  agentId?: string;
}

export interface PreparedSpaceMessageRuntime extends PreparedCryptoMessageRuntime {}

type RuntimeFactory = (input: SpaceMessageRuntimeInput) => Promise<PreparedSpaceMessageRuntime>;

interface RuntimeRegistration {
  factory: RuntimeFactory;
  handlesGeneralCryptoQueries?: boolean;
}

const EMPTY_RUNTIME: PreparedSpaceMessageRuntime = {
  promptContext: '',
  agentPolicy: (_input: CryptoAgentPolicyInput) => '',
  assistantAttachments: (_input: CryptoAttachmentInput) => [],
};

const TEMPLATE_RUNTIME_REGISTRY: Record<string, RuntimeRegistration> = {
  'crypto-contract-trading': {
    factory: prepareCryptoSpaceMessageRuntime,
    handlesGeneralCryptoQueries: true,
  },
  'wechat-article': {
    factory: async () => ({
      ...EMPTY_RUNTIME,
      promptContext: '公众号空间的 shared/content-strategy.md 是空间级账号策略：所有成果均可读取，更新时仍须通过已确认的后台任务；article.md、publish-info.md 和 assets/cover.<实际扩展名> 只属于当前成果。',
    }),
  },
  'bilibili-creator': {
    factory: async () => ({
      ...EMPTY_RUNTIME,
      promptContext: 'B 站空间提供只读工具：bilibili_account 读取当前账号的资料、我的稿件、历史、点赞和收藏；bilibili_search 搜索站内视频；bilibili_discover 主动发现好玩视频候选（会排除已看和 shared/bilibili-finds.md 已推荐过的内容）；bilibili_video 读取视频详情和字幕。账号类工具需要用户先在 B 站面板连接并启用；未连接或读取失败时如实说明。解读视频只基于工具返回的标题、简介、字幕或用户提供的原文，不得编造视频里没有的内容。无字幕视频默认不转写；如确需逐字稿，先说明 ASR 可能耗时数分钟并询问用户是否继续，得到明确同意后才以 transcribe=true 且 confirmed=true 调用；后台任务必须用 request_user_input 暂停确认，禁止未确认就设置 confirmed=true。点赞、投币、收藏属于写操作，必须由用户在 B 站面板发起并审批，禁止批量或自动执行；不要声称已经执行。发现结果默认只记在空间，是否外发由用户显式配置的分享目标决定，不要自行发外部消息。用户对发现结果说“好看 / 无聊 / 看过”时，更新 shared/bilibili-finds.md 里对应条目的状态，供下次发现参考。',
    }),
  },
};

export async function prepareSpaceMessageRuntime(
  input: SpaceMessageRuntimeInput
): Promise<PreparedSpaceMessageRuntime> {
  const registration = input.templateId ? TEMPLATE_RUNTIME_REGISTRY[input.templateId] : undefined;
  const templateRuntime = registration ? await registration.factory(input) : EMPTY_RUNTIME;
  if (registration?.handlesGeneralCryptoQueries) return templateRuntime;

  const generalCryptoRuntime = await prepareGeneralCryptoQueryRuntime(input);
  const worldContext = await loadAgentWorldContext({ agentId: input.agentId, query: input.textMessage, history: input.persistedMessages });
  return {
    promptContext: [templateRuntime.promptContext, generalCryptoRuntime.promptContext, worldContext]
      .filter(Boolean)
      .join('\n\n'),
    agentPolicy: (policyInput) => [
      templateRuntime.agentPolicy(policyInput),
      generalCryptoRuntime.agentPolicy(policyInput),
    ].filter(Boolean).join('\n'),
    assistantAttachments: (attachmentInput) => [
      ...templateRuntime.assistantAttachments(attachmentInput),
      ...generalCryptoRuntime.assistantAttachments(attachmentInput),
    ],
  };
}

import {
  prepareCryptoSpaceMessageRuntime,
  prepareGeneralCryptoQueryRuntime,
  type CryptoAgentPolicyInput,
  type CryptoAttachmentInput,
  type CryptoMessageRuntimeInput,
  type PreparedCryptoMessageRuntime,
} from './crypto/space-message-runtime';

export interface SpaceMessageRuntimeInput extends CryptoMessageRuntimeInput {
  templateId?: string | null;
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
};

export async function prepareSpaceMessageRuntime(
  input: SpaceMessageRuntimeInput
): Promise<PreparedSpaceMessageRuntime> {
  const registration = input.templateId ? TEMPLATE_RUNTIME_REGISTRY[input.templateId] : undefined;
  const templateRuntime = registration ? await registration.factory(input) : EMPTY_RUNTIME;
  if (registration?.handlesGeneralCryptoQueries) return templateRuntime;

  const generalCryptoRuntime = await prepareGeneralCryptoQueryRuntime(input);
  return {
    promptContext: [templateRuntime.promptContext, generalCryptoRuntime.promptContext]
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

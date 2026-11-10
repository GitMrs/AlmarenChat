import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { streamSimple } from '@earendil-works/pi-ai/api/openai-completions';
import { createModelFetch } from '../../core/model-fetch.mjs';

/** Only Studio's configured model provider uses this transport, not shell tools. */
export default function modelNetwork(pi: ExtensionAPI) {
  const fetch = createModelFetch();
  pi.registerProvider('custom', {
    api: 'openai-completions',
    streamSimple: (model, context, options) => streamSimple({ ...model, api: 'openai-completions' }, context, { ...options, fetch }),
  });
}

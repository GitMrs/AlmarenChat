import { runPiAgentSession } from '../../lib/pi-runtime/session-core.mjs';
import {
  assertExecutionRequest,
  normalizeExecutionResult,
} from './execution-engine.mjs';

export const PI_EXECUTION_ENGINE_ID = 'pi';

export function createPiExecutionEngine({
  buildSessionOptions,
  runSession = runPiAgentSession,
} = {}) {
  if (typeof buildSessionOptions !== 'function') {
    throw new TypeError('Pi execution engine requires buildSessionOptions()');
  }

  const engine = {
    id: PI_EXECUTION_ENGINE_ID,
    version: '1',
    async execute(rawRequest) {
      const request = assertExecutionRequest(rawRequest);
      const sessionOptions = await buildSessionOptions(request);
      const sessionResult = await runSession(sessionOptions);
      const governanceResult = typeof sessionOptions.resolveExecutionResult === 'function'
        ? await sessionOptions.resolveExecutionResult(sessionResult)
        : {};
      const status = governanceResult.status
        || (sessionResult.execution?.status === 'cancelled' ? 'cancelled' : 'completed');
      return normalizeExecutionResult({
        status,
        result: governanceResult.result ?? sessionResult.content,
        paused: governanceResult.paused ?? status === 'waiting',
        manifest: governanceResult.manifest ?? null,
        sessionId: sessionResult.sessionId,
        execution: sessionResult.execution,
      }, engine);
    },
  };

  return Object.freeze(engine);
}

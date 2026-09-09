import { runAdvisorHarness, runExecutorHarness } from '../harness/agent-harness.mjs';
import {
  AGENT_EXECUTION_MODES,
  assertExecutionRequest,
  normalizeExecutionResult,
} from './execution-engine.mjs';

export const NATIVE_EXECUTION_ENGINE_ID = 'native';

export function createNativeExecutionEngine({
  executeExecutor = runExecutorHarness,
  executeAdvisor = runAdvisorHarness,
} = {}) {
  const engine = {
    id: NATIVE_EXECUTION_ENGINE_ID,
    version: '1',
    async execute(rawRequest) {
      const request = assertExecutionRequest(rawRequest);
      const { mode, ...options } = request;

      if (mode === AGENT_EXECUTION_MODES.ADVISOR) {
        const result = await executeAdvisor(options);
        return normalizeExecutionResult({
          status: 'completed',
          result,
          paused: false,
          manifest: null,
        }, engine);
      }

      const harnessResult = await executeExecutor(options);
      return normalizeExecutionResult({
        ...harnessResult,
        status: harnessResult.paused ? 'waiting' : 'completed',
      }, engine);
    },
  };

  return Object.freeze(engine);
}

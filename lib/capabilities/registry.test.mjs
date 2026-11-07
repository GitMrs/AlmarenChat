import test from 'node:test';
import assert from 'node:assert/strict';
import { workspaceToolSchemas, safeCommandToolSchema } from '../agents/runtime/runtime-tools.mjs';
import { generateImageToolSchema, generateImagesToolSchema } from '../../worker/runtime/image-generation-runtime.mjs';
import { AUTO_WEB_SCHEMAS } from '../web/auto-web-core.mjs';
import { createChatDataTools } from '../chat/chat-data-tools.mjs';
import { createBilibiliAgentTools } from '../bilibili/agent-tools.mjs';
import {
  CAPABILITY_REGISTRY,
  capabilityCatalog,
  getCapability,
  getCapabilityForTool,
  getCapabilitiesForEntry,
  getReadOnlyExternalCapabilityIds,
} from './registry.mjs';

test('registry separates core, space and external capabilities', () => {
  assert.equal(getCapability('assistant_memory').activation, 'core');
  assert.equal(getCapability('space_runtime').activation, 'scope_default');
  assert.equal(getCapability('weather').activation, 'on_demand');
  assert.equal(getCapability('bilibili').activation, 'explicit_confirm');
  assert.deepEqual(getCapabilityForTool('weather_query').id, 'weather');
  assert.deepEqual(getCapabilityForTool('write_file').id, 'space_workspace');
});

test('entry catalog never exposes capabilities outside its scope', () => {
  const assistant = getCapabilitiesForEntry('assistant');
  const space = getCapabilitiesForEntry('space');
  assert.equal(assistant.some(capability => capability.id === 'space_runtime'), false);
  assert.equal(space.some(capability => capability.id === 'space_runtime'), true);
  assert.equal(space.some(capability => capability.id === 'weather'), true);
  assert.deepEqual(capabilityCatalog('assistant', { owner: 'external' }).map(item => item.id), ['web', 'weather', 'trending', 'crypto', 'bilibili', 'mcp']);
});

test('registry is immutable and every mapped tool has one owner', () => {
  assert.ok(Object.isFrozen(CAPABILITY_REGISTRY));
  const owners = new Map();
  for (const capability of CAPABILITY_REGISTRY) {
    for (const tool of capability.tools) {
      const previous = owners.get(tool) || [];
      assert.equal(previous.some(item => item.scope.some(scope => capability.scope.includes(scope))), false,
        `overlapping capability tool: ${tool}`);
      previous.push(capability);
      owners.set(tool, previous);
    }
  }
});

test('workspace and image executor schemas all have a registered space capability', () => {
  const schemas = [...workspaceToolSchemas, safeCommandToolSchema, generateImageToolSchema, generateImagesToolSchema];
  for (const schema of schemas) {
    const capability = getCapabilityForTool(schema.function.name);
    assert.ok(capability, `unregistered executor: ${schema.function.name}`);
    assert.equal(capability.owner, 'space');
    assert.equal(capability.scope.includes('task'), true);
  }
});

test('registry IDs and metadata remain valid as capabilities are added', () => {
  const ids = new Set();
  for (const capability of CAPABILITY_REGISTRY) {
    assert.match(capability.id, /^[a-z][a-z0-9_]*$/);
    assert.equal(ids.has(capability.id), false, `duplicate capability: ${capability.id}`);
    ids.add(capability.id);
    assert.ok(['assistant', 'agent', 'space', 'external'].includes(capability.owner));
    assert.ok(['core', 'scope_default', 'on_demand', 'explicit_confirm'].includes(capability.activation));
    assert.ok(['read_only', 'write_scoped', 'scoped', 'execute_scoped', 'read_external', 'account_external'].includes(capability.risk));
    assert.ok(capability.scope.length > 0);
    assert.equal(new Set(capability.scope).size, capability.scope.length);
    assert.ok(capability.scope.every((entry) => ['assistant', 'agent', 'space', 'task'].includes(entry)));
    assert.ok(capability.tools.length > 0);
    assert.equal(new Set(capability.tools).size, capability.tools.length);
  }
});

test('external static registry tools match actual query executor schemas in both directions', () => {
  const bilibili = createBilibiliAgentTools({ loadConnector: async () => null });
  const schemas = [...AUTO_WEB_SCHEMAS, ...createChatDataTools({}).map((tool) => tool.schema), ...bilibili.tools];
  const actual = new Set(schemas.map((schema) => schema.function.name));
  const registered = new Set(CAPABILITY_REGISTRY.filter((item) => item.owner === 'external' && item.id !== 'mcp').flatMap((item) => item.tools));
  assert.deepEqual([...registered].sort(), [...actual].sort());
});

test('read-only external permission pools derive from registry metadata without account tools', () => {
  for (const entry of ['assistant', 'agent', 'space', 'task']) {
    const expected = CAPABILITY_REGISTRY.filter((item) => item.scope.includes(entry)
      && item.owner === 'external' && item.activation === 'on_demand' && item.risk === 'read_external').map((item) => item.id);
    assert.deepEqual(getReadOnlyExternalCapabilityIds(entry), expected);
    assert.equal(getReadOnlyExternalCapabilityIds(entry).includes('bilibili'), false);
    assert.equal(getReadOnlyExternalCapabilityIds(entry).includes('mcp'), false);
  }
});

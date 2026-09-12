export interface User {
  id: string;
  email: string;
  name: string;
  avatar?: string;
  createdAt: string;
}

export interface Agent {
  id: string;
  creatorId?: string;
  agentType: 'BASIC' | 'EMPLOYEE';
  name: string;
  avatar?: string;
  description?: string;
  category?: string;
  tone?: string;
  greeting?: string;
  systemPrompt?: string;
  model?: string;
  isPublic: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AgentMemoryRule {
  id: string;
  agentId: string;
  category: 'method' | 'correction' | 'capability';
  title: string;
  instruction: string;
  status: 'PENDING' | 'ACTIVE' | 'DISABLED' | 'IGNORED';
  evidenceCount: number;
  sourceIds?: string[] | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentExperience {
  id: string;
  agentId: string;
  spaceId?: string | null;
  runId?: string | null;
  taskId: string;
  title: string;
  summary: string;
  outcome: 'ACCEPTED' | 'NEEDS_IMPROVEMENT' | 'REWORK' | 'FAILED';
  tags?: string[] | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentGrowthProfile {
  rules: AgentMemoryRule[];
  experiences: AgentExperience[];
}

export interface Conversation {
  id: string;
  userId: string;
  agentId?: string;
  agentName?: string;
  agentAvatar?: string;
  agentCategory?: string;
  agentTone?: string;
  agentDescription?: string;
  agentSystemPrompt?: string;
  title?: string;
  createdAt: string;
  updatedAt: string;
  messages?: Message[];
  kind?: 'AGENT' | 'PERSONAL_ASSISTANT';
}

export interface PersonalAssistantProfile {
  name: string;
  avatar?: string | null;
  identity?: string | null;
  soul?: string | null;
  greeting?: string | null;
  proactiveEnabled?: boolean;
  includeSpaceContext?: boolean;
  includeTaskContext?: boolean;
  includeChatContext?: boolean;
}

export interface AssistantMemoryItem {
  id: string;
  category: string;
  content: string;
  status: 'ACTIVE' | 'DISABLED';
  occurrenceCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AssistantExperience {
  id: string;
  summary: string;
  messageCount: number;
  startAt: string;
  endAt: string;
  createdAt: string;
}

export interface AssistantExperienceMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  source: 'WEB' | 'QQ' | 'SYSTEM';
  content: string;
  createdAt: string;
}

export interface AssistantReminder {
  id: string;
  content: string;
  dueTime: string | null;
  status: 'PENDING' | 'COMPLETED' | 'DISMISSED';
  sourceMessageId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AssistantReminderCandidate {
  content: string;
  dueTime: string | null;
}

export interface PersonalAssistantBootstrap {
  profile: PersonalAssistantProfile;
  conversationId: string;
  mainConversationId: string;
  conversationMode: AssistantConversationMode;
  messages: Message[];
  memories: AssistantMemoryItem[];
  experiences?: AssistantExperience[];
  reminders?: AssistantReminder[];
}

export interface AssistantQQBinding {
  configured: true;
  appId: string;
  enabled: boolean;
  peerBound: boolean;
  status: 'PENDING' | 'CONNECTING' | 'READY' | 'ERROR' | 'DISABLED';
  lastError?: string | null;
  connectedAt?: string | null;
  lastInboundAt?: string | null;
  conversationId: string;
}

export interface AssistantConversationSummary {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  lastMessageSnippet: string | null;
  mode: AssistantConversationMode;
}

export type AssistantConversationMode = 'MAIN' | 'TEMPORARY';

export interface Message {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  source?: 'WEB' | 'QQ' | 'SYSTEM';
  content: string;
  attachments?: MessageAttachment[];
  createdAt: string;
}

export interface Space {
  id: string;
  userId: string;
  name: string;
  description?: string | null;
  instructions?: string | null;
  runtimeType: 'NATIVE' | 'PI_CODING';
  executionEngine: 'native' | 'pi';
  executionMode: 'AUTO' | 'REVIEW_DISPATCH';
  hostAgentId?: string | null;
  activeWorkId?: string | null;
  templateId?: string | null;
  templateVersion?: number | null;
  templateSnapshot?: {
    id: string;
    version: number;
    name: string;
    icon: string;
    workKind?: string;
    workLabel?: string;
    supportsMultipleWorks?: boolean;
    lifecycleStages?: Array<{ id: string; name: string }>;
    defaultArtifacts?: Array<{ id: string; label: string; required: boolean }>;
    completionCriteria?: Array<{ id: string; label: string }>;
    completionAction?: 'NONE' | 'WECHAT_CREATE_DRAFT';
    completionConfig?: { themeId?: string } | null;
    workflow: string[];
    deliverables: string[];
    qualityRules?: string[];
    recommendedSkillIds: string[];
    configuredAgentIds: string[];
    starterPrompts: string[];
  } | null;
  hostAgent?: Agent | null;
  createdAt: string;
  updatedAt: string;
  members?: SpaceMember[];
  messages?: SpaceMessage[];
  files?: SpaceFile[];
  runs?: AgentRun[];
  works?: SpaceWork[];
  connectors?: SpaceConnector[];
}

export interface SpaceConnector {
  id: string;
  spaceId: string;
  provider: 'WECHAT_OFFICIAL_ACCOUNT' | string;
  providerName: string;
  enabled: boolean;
  configured: boolean;
  status: 'CONFIGURED' | 'READY' | 'ERROR' | 'DISABLED' | string;
  publicConfig: { appId?: string };
  lastCheckedAt?: string | null;
  lastError?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SpaceMcpServer {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  hasHeaders: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SpaceConnectorExecution {
  id: string;
  connectorId: string;
  actionRequestId: string;
  operation: 'WECHAT_VALIDATE_CONNECTION' | 'WECHAT_CREATE_DRAFT' | 'WECHAT_PUBLISH' | string;
  status: 'QUEUED' | 'RUNNING' | 'WAITING_PROVIDER' | 'COMPLETED' | 'FAILED';
  requestSummary?: Record<string, unknown> | null;
  responseSummary?: Record<string, unknown> | null;
  externalId?: string | null;
  externalUrl?: string | null;
  error?: string | null;
  nextPollAt?: string | null;
  pollCount: number;
  startedAt?: string | null;
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SpaceWork {
  id: string;
  spaceId: string;
  title: string;
  kind: string;
  status: 'ACTIVE' | 'COMPLETED' | 'ARCHIVED';
  stage?: string | null;
  objective?: string | null;
  metadata?: Record<string, unknown> | null;
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  _count?: { files: number; runs: number };
}

export interface SpaceWorkVersion {
  id: string;
  workId: string;
  version: number;
  summary?: string | null;
  manifest: Array<{
    relativePath: string;
    fileName?: string;
    mimeType?: string | null;
    size: number;
    sha256?: string;
    snapshotPath?: string;
  }>;
  sourceRunId?: string | null;
  sourceTaskId?: string | null;
  createdAt: string;
}

export interface SpaceAutomationExecution {
  id: string;
  automationId: string;
  scheduledFor: string;
  status: 'TRIGGERED' | 'COMPLETED' | 'PARTIAL' | 'FAILED_VALIDATION' | 'FAILED' | 'BLOCKED' | 'CANCELLED';
  runId?: string | null;
  error?: string | null;
  createdAt: string;
  updatedAt: string;
  run?: Pick<AgentRun, 'status' | 'result' | 'error' | 'completedAt'> | null;
}

export interface SpaceAutomation {
  id: string;
  spaceId: string;
  name: string;
  prompt: string;
  scheduleType: 'INTERVAL' | 'DAILY' | 'WEEKLY';
  intervalMinutes: number;
  timeZone: string;
  scheduleHour?: number | null;
  scheduleMinute?: number | null;
  weekdays?: number[] | null;
  workStrategy: 'NEW_WORK' | 'ACTIVE_WORK';
  networkPolicy: 'forbidden' | 'allowed' | 'required';
  completionAction: 'NONE' | 'WECHAT_CREATE_DRAFT';
  completionConfig?: { themeId?: string } | null;
  enabled: boolean;
  nextRunAt: string;
  lastRunAt?: string | null;
  lastRunId?: string | null;
  lastError?: string | null;
  consecutiveFailures: number;
  deletedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  executions?: SpaceAutomationExecution[];
}

export interface SpaceActionRequest {
  id: string;
  spaceId: string;
  workId?: string | null;
  runId?: string | null;
  automationExecutionId?: string | null;
  kind: 'FINALIZE_WORK' | 'WECHAT_VALIDATE_CONNECTION' | 'WECHAT_CREATE_DRAFT' | 'WECHAT_PUBLISH' | string;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  title: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'COMPLETED' | 'FAILED';
  payload?: ({
    workTitle?: string;
    defaultArtifacts?: Array<{ id: string; label: string; required: boolean }>;
    completionCriteria?: Array<{ id: string; label: string }>;
  } & Record<string, unknown>) | null;
  result?: Record<string, unknown> | null;
  error?: string | null;
  decidedBy?: string | null;
  requestedAt: string;
  decidedAt?: string | null;
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  work?: SpaceWork | null;
  run?: Pick<AgentRun, 'status' | 'result' | 'error' | 'completedAt'> | null;
  connectorExecution?: SpaceConnectorExecution | null;
}

export interface SpaceOperationsSummary {
  periodDays: number;
  works: { total: number; active: number; ready: number; awaitingFinalization: number };
  runs: { total: number; completed: number; failed: number; successRate: number | null };
  automation: { total: number; completed: number; failed: number; successRate: number | null };
  publishing: { draftsCreated: number; publicationsCompleted: number; failed: number; pendingApprovals: number };
}

export interface SpaceOperationOutcome {
  id: string;
  kind: string;
  title: string;
  status: SpaceActionRequest['status'];
  error?: string | null;
  createdAt: string;
  completedAt?: string | null;
}

export interface SpaceMember {
  id: string;
  spaceId: string;
  agentId: string;
  roleName?: string | null;
  sortOrder: number;
  createdAt: string;
  agent?: Agent | null;
}

export interface SpaceMessage {
  id: string;
  spaceId: string;
  role: 'user' | 'assistant' | 'system';
  speakerAgentId?: string | null;
  content: string;
  attachments?: SpaceMessageAttachment[];
  sourceKey?: string | null;
  createdAt: string;
}

export interface SpaceSkill {
  id: string;
  name: string;
  version: string;
  description: string;
  sourceUrl: string;
  digest: string;
  installedAt: string;
  enabled: boolean;
  fileCount: number;
  warnings: string[];
  scripts: string[];
  approvedScripts: string[];
  executionEnabled: boolean;
}

export interface SpaceSkillPreview {
  id: string;
  name: string;
  version: string;
  description: string;
  sourceUrl: string;
  digest: string;
  files: string[];
  warnings: string[];
}

export interface SpaceSkillInvocationAttachment {
  type: 'skill_invocation';
  skillId: string;
  name: string;
  version: string;
  digest: string;
}

export interface SpaceFile {
  id: string;
  spaceId: string;
  fileName: string;
  mimeType?: string | null;
  size?: number | null;
  relativePath: string;
  runId?: string | null;
  taskId?: string | null;
  workId?: string | null;
  work?: SpaceWork | null;
  assetRole?: 'FOUNDATION' | 'INPUT' | 'SHARED' | 'OUTPUT' | 'ARCHIVE' | 'SKILL' | 'LOG' | string;
  status?: 'GENERATING' | 'WAITING_APPROVAL' | 'READY' | 'INCOMPLETE';
  shareId?: string | null;
  shareEnabled?: boolean;
  sharedAt?: string | null;
  createdAt: string;
  updatedAt?: string | null;
}

export interface SpaceFileShare {
  id: string;
  fileName: string;
  spaceId: string;
  spaceName: string;
  url: string;
  sharedAt?: string | null;
  updatedAt?: string | null;
}

export type SpaceLearningCategory = 'collaboration' | 'acceptance' | 'delivery' | 'execution';

export interface SpaceLearningEvidence {
  runId: string;
  kind: string;
  summary: string;
  at: string;
}

export interface SpaceLearningItem {
  id: string;
  key: string;
  category: SpaceLearningCategory;
  title: string;
  instruction: string;
  status: 'pending' | 'ignored' | 'active' | 'disabled';
  occurrences: number;
  evidence: SpaceLearningEvidence[];
  createdAt: string;
  updatedAt: string;
}

export interface SpaceLearning {
  version: number;
  revision: number;
  proposals: SpaceLearningItem[];
  rules: SpaceLearningItem[];
  history: Array<{ revision: number; action: string; itemId: string; title: string; at: string }>;
}

export type SpaceLearningCommand = {
  action: 'approve' | 'ignore' | 'update_rule' | 'disable_rule' | 'enable_rule';
  id: string;
  category?: SpaceLearningCategory;
  title?: string;
  instruction?: string;
};

export type SpaceTaskCapability = 'workspace_read' | 'workspace_write' | 'web_research' | 'code_execute' | 'image_generate';
export type SpaceNetworkPolicy = 'forbidden' | 'allowed' | 'required';

export interface SpaceTaskExecutionStep {
  agentId: string;
  agentName?: string;
  mode: 'advisor' | 'executor';
  title: string;
  instruction: string;
  dependsOn: number[];
  deliverables: string[];
}

export interface SpaceTaskProposal {
  type: 'task_proposal';
  title: string;
  goal: string;
  summary: string;
  steps: string[];
  deliverables: string[];
  artifacts?: string[];
  executionPlan?: SpaceTaskExecutionStep[];
  capabilities?: SpaceTaskCapability[];
  networkPolicy?: SpaceNetworkPolicy;
  status: 'pending' | 'approved' | 'rejected';
  runId?: string;
  workId?: string;
  skillSnapshot?: {
    id: string;
    name: string;
    version: string;
    description?: string;
    digest?: string;
  };
  skillAgentId?: string;
}

export interface SpaceDiscussionAttachment {
  type: 'discussion_turn' | 'discussion_summary';
  discussionId: string;
  round?: number;
  failed?: boolean;
}

export interface SpaceRunResultAttachment {
  type: 'run_result';
  runId: string;
  status: string;
}

export interface SpacePiSkillApproval {
  id: string;
  skillName: string;
  script: string;
  paths: string[];
  expiresAt: string;
}

export interface SpacePiExecutionActivity {
  id: string;
  name: string;
  label: string;
  target?: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
}

export interface SpacePiExecutionNote {
  id: string;
  content: string;
  createdAt: string;
}

export interface SpacePiCoordinationRequest {
  scopeId: string;
  mode: 'broadcast' | 'discussion' | 'review' | 'decision' | 'relay';
  topic: string;
  participantIds: string[];
  rounds: number;
}

export interface SpacePiMemoryEpisodeAttachment {
  type: 'space_memory_episode';
  scopeId: string;
  kind: 'coordination';
  mode: SpacePiCoordinationRequest['mode'];
  topic: string;
  participantIds: string[];
  summary: string;
}

export interface SpacePiExecutionAttachment {
  type: 'pi_execution';
  status: 'completed' | 'failed' | 'cancelled';
  startedAt: string;
  completedAt: string;
  durationMs: number;
  modelRequestCount: number;
  toolCallCount: number;
  tokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
  notes?: SpacePiExecutionNote[];
  activities: SpacePiExecutionActivity[];
}

export interface SpaceDiscussionResearchRequest {
  query: string;
  reason: string;
  agentId: string;
  agentName: string;
  approved?: boolean;
}

export interface SpaceDiscussion {
  id: string;
  spaceId: string;
  userId: string;
  topic: string;
  participantIds: string[];
  status: 'QUEUED' | 'RUNNING' | 'WAITING_RESEARCH' | 'CANCEL_REQUESTED' | 'CANCELLED' | 'COMPLETED' | 'FAILED';
  currentRound: number;
  currentIndex: number;
  maxRounds: number;
  allowWeb: boolean;
  webSearchCount: number;
  pendingResearch?: SpaceDiscussionResearchRequest | null;
  result?: string | null;
  error?: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
}

export interface SpaceRelayBoardAction {
  row: number;
  column: number;
  comment?: string;
}

export interface SpaceRelayCollaborationAction {
  content: string;
  status: 'CONTINUE' | 'COMPLETE';
}

export type SpaceRelayAction = SpaceRelayBoardAction | SpaceRelayCollaborationAction;

export interface SpaceRelayTranscriptEntry {
  turn: number;
  agentId: string;
  agentName: string;
  action: SpaceRelayAction;
  createdAt: string;
}

export interface SpaceRelayPendingAction {
  type?: 'coordinator_continue';
  agentId?: string;
  agentName?: string;
  expectedVersion?: number;
  action?: SpaceRelayAction;
  approved: boolean;
  rejected?: boolean;
  decision?: 'continue' | 'stop';
  summary?: string;
  instruction?: string;
}

export interface SpaceRelay {
  id: string;
  spaceId: string;
  userId: string;
  kind: 'collaboration' | 'gomoku';
  goal: string;
  participantIds: string[];
  approvalMode: 'AUTO' | 'EACH_TURN';
  status: 'QUEUED' | 'RUNNING' | 'WAITING_APPROVAL' | 'CANCEL_REQUESTED' | 'CANCELLED' | 'COMPLETED' | 'FAILED';
  currentIndex: number;
  turnCount: number;
  maxTurns: number;
  state: unknown;
  transcript?: SpaceRelayTranscriptEntry[] | null;
  pendingAction?: SpaceRelayPendingAction | null;
  result?: string | null;
  error?: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
}

export interface SpaceRelayAttachment {
  type: 'relay_summary';
  relayId: string;
}

export interface SpaceRelayStartedAttachment {
  type: 'relay_started';
  relayId: string;
  title: string;
  participantIds: string[];
  participantNames: string[];
  completionCriteria: string[];
}

export interface SpaceRelayTurnAttachment {
  type: 'relay_turn';
  relayId: string;
  turn: number;
}

export interface SpaceRelayReviewAttachment {
  type: 'relay_review';
  relayId: string;
  decision: 'CONTINUE';
}

export type SpaceMessageAttachment = MessageAttachment | SpaceTaskProposal | SpaceDiscussionAttachment | SpaceRunResultAttachment | SpaceSkillInvocationAttachment | SpacePiExecutionAttachment | SpacePiMemoryEpisodeAttachment | SpaceRelayAttachment | SpaceRelayStartedAttachment | SpaceRelayTurnAttachment | SpaceRelayReviewAttachment;

export interface AgentRun {
  id: string;
  spaceId: string;
  userId: string;
  workId?: string | null;
  work?: SpaceWork | null;
  input: string;
  status: string;
  result?: string | null;
  error?: string | null;
    retryOfId?: string | null;
    attempt: number;
    workerId?: string | null;
    heartbeatAt?: string | null;
    completionId?: string | null;
    modelRequestCount: number;
    modelRequestLimit: number;
    executionEngine: string;
    engineVersion: string;
    runtimeVersion: number;
    eventSequence: number;
    coordinatorState?: unknown;
    createdAt: string;
  updatedAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  tasks: AgentTask[];
  events: AgentRunEvent[];
}

export interface AgentTask {
  id: string;
  runId: string;
  agentId: string;
  agentName: string;
  title: string;
  instruction: string;
  acceptanceCriteria?: string | null;
  origin?: string;
  parentTaskId?: string | null;
  mode: 'advisor' | 'executor';
  dependsOn?: number[] | null;
  skillId?: string;
  skillVersion?: string;
  skillSnapshot?: {
    id: string;
    name: string;
    version: string;
    description?: string;
    requiredCapabilities?: SpaceTaskCapability[];
    allowedTools?: string[];
    artifactExtensions?: string[];
    instructions?: string;
  } | null;
  webResearchRequired?: boolean;
  modelRequestCount: number;
  modelRequestLimit: number;
  status: string;
  result?: string | null;
    error?: string | null;
    reviewFeedback?: string | null;
    waitQuestion?: string | null;
    waitReason?: string | null;
    waitAnswer?: string | null;
    waitingAt?: string | null;
    proposedAt?: string | null;
    approvedAt?: string | null;
    submittedAt?: string | null;
    reviewDecision?: string | null;
    reviewSummary?: string | null;
    attempt: number;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  reviewedAt?: string | null;
}

export interface AgentRunEvent {
  id: string;
  runId: string;
  type: string;
  message: string;
  payload?: unknown;
  idempotencyKey?: string | null;
  sequence: number;
  taskId?: string | null;
  agentId?: string | null;
  attempt?: number | null;
  actor?: string | null;
  createdAt: string;
}

export interface MessageAttachment {
  type: 'image';
  url: string;
  name?: string;
  mimeType?: string;
  size?: number;
  origin?: 'uploaded' | 'generated';
  prompt?: string;
  model?: string;
  imageSize?: string;
}

export interface FavoriteAgent {
  id: string;
  userId: string;
  agentId: string;
  source: 'builtin' | 'custom';
  agent?: Agent;
  createdAt: string;
}

export const AGENT_CATEGORIES = [
  '全部',
  '专业',
  '写作',
  '编程',
  '学习',
  '心理',
  '创意',
  '生活',
  '工具',
  '娱乐',
] as const;

export type AgentCategory = (typeof AGENT_CATEGORIES)[number];

export const AGENT_TONES = [
  '专业',
  '幽默',
  '温柔',
  '冷静',
  '热情',
  '简洁',
  '详细',
  '友好',
] as const;

export type AgentTone = (typeof AGENT_TONES)[number];

export const CATEGORY_COLORS: Record<string, string> = {
  专业: '#0f766e',
  写作: '#f59e0b',
  编程: '#2563eb',
  学习: '#10b981',
  心理: '#ec4899',
  创意: '#8b5cf6',
  生活: '#f97316',
  工具: '#6366f1',
  娱乐: '#ef4444',
};

export type NavTab = 'discover' | 'agents' | 'create' | 'me' | 'settings';

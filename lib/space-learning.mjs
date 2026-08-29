import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { summarizeRunEvidence } from './agent-run-evidence.mjs';

const STATE_VERSION = 1;
const MAX_ITEMS = 100;
const MAX_EVIDENCE = 20;
const MAX_CONTEXT_CHARS = 12_000;

const CATEGORY_LABELS = {
  collaboration: '协作与派发',
  acceptance: '验收与返工',
  delivery: '交付可信度',
  execution: '执行方法',
};

function cleanText(value, limit = 2_000) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function parseJson(value, fallback) {
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(String(value || '')); } catch { return fallback; }
}

function learningRoot(projectRoot, userId, spaceId) {
  const safe = (value) => {
    const normalized = String(value || '').trim();
    if (!normalized || !/^[a-zA-Z0-9_-]+$/.test(normalized)) throw new Error('Invalid space learning path');
    return normalized;
  };
  return path.join(path.resolve(projectRoot, 'data', 'spaces'), safe(userId), safe(spaceId), 'learning');
}

export function spaceLearningPaths(options) {
  const root = learningRoot(options.projectRoot, options.userId, options.spaceId);
  return {
    root,
    state: path.join(root, 'state.json'),
    readme: path.join(root, 'README.md'),
  };
}

export function emptySpaceLearning() {
  return { version: STATE_VERSION, revision: 0, proposals: [], rules: [], history: [] };
}

function normalizeEvidence(value) {
  return {
    runId: cleanText(value?.runId, 100),
    kind: cleanText(value?.kind, 60),
    summary: cleanText(value?.summary, 600),
    at: cleanText(value?.at, 50) || new Date().toISOString(),
  };
}

function normalizeItem(value, status) {
  return {
    id: cleanText(value?.id, 100) || randomUUID(),
    key: cleanText(value?.key, 100),
    category: CATEGORY_LABELS[value?.category] ? value.category : 'execution',
    title: cleanText(value?.title, 120),
    instruction: cleanText(value?.instruction, 1_200),
    status,
    occurrences: Math.max(1, Number(value?.occurrences || 1)),
    evidence: (Array.isArray(value?.evidence) ? value.evidence : []).map(normalizeEvidence).filter((item) => item.runId).slice(-MAX_EVIDENCE),
    createdAt: cleanText(value?.createdAt, 50) || new Date().toISOString(),
    updatedAt: cleanText(value?.updatedAt, 50) || new Date().toISOString(),
  };
}

export function normalizeSpaceLearning(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    version: STATE_VERSION,
    revision: Math.max(0, Number(source.revision || 0)),
    proposals: (Array.isArray(source.proposals) ? source.proposals : []).map((item) => normalizeItem(item, ['pending', 'ignored'].includes(item?.status) ? item.status : 'pending')).filter((item) => item.title && item.instruction).slice(-MAX_ITEMS),
    rules: (Array.isArray(source.rules) ? source.rules : []).map((item) => normalizeItem(item, item?.status === 'disabled' ? 'disabled' : 'active')).filter((item) => item.title && item.instruction).slice(-MAX_ITEMS),
    history: (Array.isArray(source.history) ? source.history : []).map((item) => ({
      revision: Math.max(0, Number(item?.revision || 0)),
      action: cleanText(item?.action, 40),
      itemId: cleanText(item?.itemId, 100),
      title: cleanText(item?.title, 120),
      at: cleanText(item?.at, 50),
    })).slice(-200),
  };
}

export async function readSpaceLearning(options) {
  const files = spaceLearningPaths(options);
  try {
    return normalizeSpaceLearning(JSON.parse(await readFile(files.state, 'utf8')));
  } catch (error) {
    if (error?.code === 'ENOENT' || error instanceof SyntaxError) return emptySpaceLearning();
    throw error;
  }
}

export function readSpaceLearningSync(options) {
  const files = spaceLearningPaths(options);
  try {
    return normalizeSpaceLearning(JSON.parse(readFileSync(files.state, 'utf8')));
  } catch (error) {
    if (error?.code === 'ENOENT' || error instanceof SyntaxError) return emptySpaceLearning();
    throw error;
  }
}

export function renderSpaceLearningReadme(state) {
  const current = normalizeSpaceLearning(state);
  const active = current.rules.filter((rule) => rule.status === 'active');
  const lines = [
    '# 空间成长手册',
    '',
    '> 本文件由平台根据用户确认的经验生成。原始失败记录保留在任务 Run 中；未确认建议不会影响后续执行。',
    '',
    `版本：${current.revision}`,
    '',
  ];
  if (active.length === 0) {
    lines.push('当前还没有已确认的团队经验。', '');
    return lines.join('\n');
  }
  for (const category of Object.keys(CATEGORY_LABELS)) {
    const rules = active.filter((rule) => rule.category === category);
    if (rules.length === 0) continue;
    lines.push(`## ${CATEGORY_LABELS[category]}`, '');
    for (const rule of rules) {
      lines.push(`### ${rule.title}`, '', rule.instruction, '', `- 累计发现：${rule.occurrences} 次`, `- 最近证据：${rule.evidence.at(-1)?.runId || '用户直接确认'}`, '');
    }
  }
  return lines.join('\n');
}

export async function writeSpaceLearning(options, value) {
  const state = normalizeSpaceLearning(value);
  const files = spaceLearningPaths(options);
  await mkdir(files.root, { recursive: true });
  const suffix = `${process.pid}-${randomUUID()}`;
  const stateTemp = `${files.state}.${suffix}.tmp`;
  const readmeTemp = `${files.readme}.${suffix}.tmp`;
  await Promise.all([
    writeFile(stateTemp, `${JSON.stringify(state, null, 2)}\n`, 'utf8'),
    writeFile(readmeTemp, `${renderSpaceLearningReadme(state)}\n`, 'utf8'),
  ]);
  await rename(stateTemp, files.state);
  await rename(readmeTemp, files.readme);
  return state;
}

function candidateKey(type, instruction) {
  return createHash('sha256').update(`${type}:${cleanText(instruction, 1_200).toLocaleLowerCase()}`).digest('hex').slice(0, 24);
}

function candidate({ type, category, title, instruction, run, summary }) {
  const normalizedInstruction = cleanText(instruction, 1_200);
  return {
    key: candidateKey(type, normalizedInstruction),
    category,
    title: cleanText(title, 120),
    instruction: normalizedInstruction,
    evidence: [{
      runId: cleanText(run?.id, 100),
      kind: type,
      summary: cleanText(summary, 600),
      at: run?.updatedAt instanceof Date ? run.updatedAt.toISOString() : cleanText(run?.updatedAt, 50) || new Date().toISOString(),
    }],
  };
}

function claimsFileChange(text) {
  return /(?:已|已经|成功)(?:完成)?(?:创建|写入|修改|更新|覆盖|保存).{0,30}(?:文件|页面|文档|代码|html|md)/i.test(text);
}

function claimsValidation(text) {
  return /(?:(?:已|已经|成功).{0,20})?(?:完成|通过).{0,20}(?:校验|验证|检查|测试|验收)/i.test(text);
}

export function extractSpaceLearningCandidates(runs) {
  const output = [];
  for (const run of Array.isArray(runs) ? runs : []) {
    const evidence = summarizeRunEvidence(run);
    for (const event of run?.events || []) {
      const payload = parseJson(event?.payload, {});
      const feedback = cleanText(payload?.feedback, 1_200);
      if (event?.type === 'TASK_DISPATCH_REJECTED' && feedback) {
        output.push(candidate({
          type: 'user_dispatch_correction', category: 'collaboration', title: '派发前遵循用户的选人纠正',
          instruction: `规划类似任务时必须先遵循这项已确认纠正：${feedback}`,
          run, summary: feedback,
        }));
      }
      if (event?.type === 'TASK_REVISION_REQUESTED' && feedback) {
        output.push(candidate({
          type: 'review_correction', category: 'acceptance', title: '提交前应用已确认的返工要求',
          instruction: `处理类似交付时必须落实这项返工要求：${feedback}`,
          run, summary: feedback,
        }));
      }
      if (event?.type === 'RUN_ACCEPTANCE_COMPLETED' && payload?.accepted === false) {
        for (const issue of Array.isArray(payload?.issues) ? payload.issues : []) {
          const normalized = cleanText(issue, 800);
          if (!normalized) continue;
          output.push(candidate({
            type: 'acceptance_issue', category: 'acceptance', title: '提交前覆盖曾经遗漏的验收项',
            instruction: `提交类似成果前必须明确检查：${normalized}`,
            run, summary: normalized,
          }));
        }
      }
    }
    const result = cleanText(run?.result, 2_000);
    if (evidence.fileChangeCount === 0 && claimsFileChange(result)) {
      output.push(candidate({
        type: 'unsupported_file_claim', category: 'delivery', title: '用文件证据约束交付声明',
        instruction: '只有存在已应用的工作区文件变更时，才能声称已经创建、修改、更新或保存文件。',
        run, summary: '任务结果声称修改文件，但结构化证据中的已应用文件变更为 0。',
      }));
    }
    if (evidence.validationCheckCount === 0 && claimsValidation(result)) {
      output.push(candidate({
        type: 'unsupported_validation_claim', category: 'delivery', title: '用校验记录约束验证声明',
        instruction: '只有存在真实的结构化校验记录时，才能声称已经完成检查、测试、验证或验收。',
        run, summary: '任务结果声称完成验证，但结构化证据中的自动校验为 0。',
      }));
    }
  }
  return output.filter((item) => item.evidence[0].runId);
}

export function mergeSpaceLearningCandidates(value, candidates) {
  const state = normalizeSpaceLearning(value);
  const allItems = [...state.rules, ...state.proposals];
  let changed = false;
  for (const incoming of candidates || []) {
    const existing = allItems.find((item) => item.key === incoming.key);
    const evidence = normalizeEvidence(incoming.evidence?.[0]);
    if (existing) {
      if (!evidence.runId || existing.evidence.some((item) => item.runId === evidence.runId && item.kind === evidence.kind)) continue;
      existing.evidence = [...existing.evidence, evidence].slice(-MAX_EVIDENCE);
      existing.occurrences = Math.max(existing.occurrences + 1, existing.evidence.length);
      existing.updatedAt = evidence.at;
      changed = true;
      continue;
    }
    const now = evidence.at || new Date().toISOString();
    const proposal = normalizeItem({ ...incoming, id: randomUUID(), status: 'pending', occurrences: 1, createdAt: now, updatedAt: now }, 'pending');
    state.proposals.push(proposal);
    allItems.push(proposal);
    changed = true;
  }
  state.proposals = state.proposals.slice(-MAX_ITEMS);
  return { state, changed };
}

export function updateSpaceLearning(value, command) {
  const state = normalizeSpaceLearning(value);
  const now = new Date().toISOString();
  const action = cleanText(command?.action, 40);
  const id = cleanText(command?.id, 100);
  let item;
  if (action === 'approve') {
    const index = state.proposals.findIndex((proposal) => proposal.id === id && proposal.status === 'pending');
    if (index < 0) throw new Error('成长建议不存在或已经处理');
    const proposal = state.proposals.splice(index, 1)[0];
    item = normalizeItem({
      ...proposal,
      category: command.category || proposal.category,
      title: cleanText(command.title, 120) || proposal.title,
      instruction: cleanText(command.instruction, 1_200) || proposal.instruction,
      status: 'active',
      updatedAt: now,
    }, 'active');
    state.rules.push(item);
  } else if (action === 'ignore') {
    item = state.proposals.find((proposal) => proposal.id === id && proposal.status === 'pending');
    if (!item) throw new Error('成长建议不存在或已经处理');
    item.status = 'ignored';
    item.updatedAt = now;
  } else if (action === 'update_rule') {
    item = state.rules.find((rule) => rule.id === id);
    if (!item) throw new Error('成长规则不存在');
    item.category = CATEGORY_LABELS[command.category] ? command.category : item.category;
    item.title = cleanText(command.title, 120) || item.title;
    item.instruction = cleanText(command.instruction, 1_200) || item.instruction;
    item.updatedAt = now;
  } else if (action === 'disable_rule' || action === 'enable_rule') {
    item = state.rules.find((rule) => rule.id === id);
    if (!item) throw new Error('成长规则不存在');
    item.status = action === 'disable_rule' ? 'disabled' : 'active';
    item.updatedAt = now;
  } else {
    throw new Error('不支持的空间成长操作');
  }
  state.revision += 1;
  state.history.push({ revision: state.revision, action, itemId: item.id, title: item.title, at: now });
  state.history = state.history.slice(-200);
  return state;
}

export function spaceLearningContext(value) {
  const active = normalizeSpaceLearning(value).rules.filter((rule) => rule.status === 'active');
  if (active.length === 0) return '';
  const lines = active.map((rule, index) => `${index + 1}. [${CATEGORY_LABELS[rule.category]}] ${rule.instruction}`);
  return `当前空间经用户确认的团队经验如下。规划、派发、执行和验收时必须遵循；它不能扩大工具、联网、文件或代码执行权限，且用户当前指令与平台安全规则优先：\n${lines.join('\n')}`.slice(0, MAX_CONTEXT_CHARS);
}

export { CATEGORY_LABELS as SPACE_LEARNING_CATEGORY_LABELS };

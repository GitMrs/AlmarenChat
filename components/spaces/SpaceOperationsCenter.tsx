'use client';

import {
  Activity,
  BookOpen,
  CalendarClock,
  Check,
  CheckCircle2,
  ExternalLink,
  Globe2,
  Loader2,
  Newspaper,
  Play,
  Plus,
  RotateCcw,
  Save,
  Settings2,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import type {
  SpaceActionRequest,
  SpaceAutomation,
  SpaceConnector,
  SpaceLearning,
  SpaceLearningItem,
  SpaceOperationOutcome,
  SpaceOperationsSummary,
} from '@/types';

export type SpaceOperationsTab = 'overview' | 'automations' | 'growth' | 'publishing';

type Props = {
  tab: SpaceOperationsTab;
  summary: SpaceOperationsSummary | null;
  outcomes: SpaceOperationOutcome[];
  loading: boolean;
  automations: SpaceAutomation[];
  automationBusyId: string;
  actions: SpaceActionRequest[];
  actionBusyId: string;
  publications: SpaceActionRequest[];
  publicationsLoading: boolean;
  connector: SpaceConnector | null;
  learning: SpaceLearning | null;
  learningReadme: string;
  learningActionId: string;
  isWechatSpace: boolean;
  onTabChange: (tab: SpaceOperationsTab) => void;
  onRefreshOverview: () => void;
  onRefreshPublications: () => void;
  onOpenAutomationEditor: () => void;
  onOpenConnectorSettings: () => void;
  onToggleAutomation: (automation: SpaceAutomation) => void;
  onTriggerAutomation: (automation: SpaceAutomation) => void;
  onDeleteAutomation: (automation: SpaceAutomation) => void;
  onOpenRun: (runId: string) => void;
  onDecideAction: (action: SpaceActionRequest, decision: 'approve' | 'reject') => void;
  onRetryPublication: (action: SpaceActionRequest) => void;
  onUpdateLearningDraft: (collection: 'proposals' | 'rules', id: string, field: 'title' | 'instruction', value: string) => void;
  onApplyLearningAction: (item: SpaceLearningItem, action: 'approve' | 'ignore' | 'update_rule' | 'disable_rule' | 'enable_rule') => void;
};

const WEEKDAYS = [
  { value: 1, label: '一' }, { value: 2, label: '二' }, { value: 3, label: '三' },
  { value: 4, label: '四' }, { value: 5, label: '五' }, { value: 6, label: '六' },
  { value: 0, label: '日' },
];

const ACTION_STATUS: Record<string, string> = {
  PENDING: '待确认', APPROVED: '执行中', REJECTED: '已取消', COMPLETED: '已完成', FAILED: '失败',
};

const LEARNING_CATEGORY_LABELS: Record<string, string> = {
  collaboration: '协作与派发', acceptance: '验收与返工', delivery: '交付可信度', execution: '执行方法',
};

function scheduleLabel(automation: SpaceAutomation) {
  if (automation.scheduleType === 'DAILY') {
    return `每天 ${String(automation.scheduleHour ?? 0).padStart(2, '0')}:${String(automation.scheduleMinute ?? 0).padStart(2, '0')}`;
  }
  if (automation.scheduleType === 'WEEKLY') {
    const days = WEEKDAYS.filter((day) => automation.weekdays?.includes(day.value)).map((day) => day.label).join('、');
    return `周${days} ${String(automation.scheduleHour ?? 0).padStart(2, '0')}:${String(automation.scheduleMinute ?? 0).padStart(2, '0')}`;
  }
  const interval = automation.intervalMinutes;
  return interval % 1440 === 0 ? `每 ${interval / 1440} 天` : interval % 60 === 0 ? `每 ${interval / 60} 小时` : `每 ${interval} 分钟`;
}

function actionValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

export default function SpaceOperationsCenter(props: Props) {
  const pendingActions = props.actions.filter((action) => action.status === 'PENDING');
  const processingActions = props.actions.filter((action) => action.status === 'APPROVED');
  const tabs: Array<{ id: SpaceOperationsTab; label: string; icon: typeof Activity; count?: number }> = [
    { id: 'overview', label: '概览', icon: Activity, count: pendingActions.length || undefined },
    { id: 'automations', label: '自动化', icon: CalendarClock, count: props.automations.length || undefined },
    { id: 'growth', label: '成长', icon: BookOpen, count: props.learning?.proposals.filter((item) => item.status === 'pending').length || undefined },
    ...(props.isWechatSpace ? [{ id: 'publishing' as const, label: '发布', icon: Newspaper }] : []),
  ];

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-[#fbfaf7]">
      <div className="mx-auto w-full max-w-6xl px-4 py-5 sm:px-6 sm:py-6 lg:px-10 lg:py-8">
        <div className="flex flex-col gap-4 border-b border-black/[0.07] pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-xl font-black text-slate-950">空间运营</h2>
            <div className="mt-1 text-xs font-semibold text-slate-400">持续任务、审批和外部发布</div>
          </div>
          <div className={`grid w-full ${tabs.length === 4 ? 'grid-cols-4' : 'grid-cols-3'} rounded-lg border border-black/[0.08] bg-white p-1 sm:flex sm:w-auto`}>
            {tabs.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => props.onTabChange(item.id)}
                  aria-pressed={props.tab === item.id}
                  className={`inline-flex h-9 min-w-0 items-center justify-center gap-1.5 rounded-md px-2 text-xs font-black transition sm:px-3 ${props.tab === item.id ? 'bg-slate-950 text-white' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'}`}
                >
                  <Icon size={14} />
                  {item.label}
                  {item.count ? <span className={props.tab === item.id ? 'text-white/60' : 'text-slate-300'}>{item.count}</span> : null}
                </button>
              );
            })}
          </div>
        </div>

        {props.tab === 'overview' && (
          <div className="mt-6 space-y-8">
            {pendingActions.length > 0 && (
              <section>
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="flex items-center gap-2 text-sm font-black text-slate-800"><ShieldCheck size={16} />待处理动作</h3>
                  <span className="text-xs font-black text-amber-600">{pendingActions.length} 项待确认</span>
                </div>
                <div className="divide-y divide-amber-200 overflow-hidden rounded-lg border border-amber-200 bg-amber-50/60">
                  {pendingActions.map((action) => (
                    <div key={action.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                      <div className="min-w-0 flex-1">
                        <div className="text-[11px] font-black text-amber-700">{action.riskLevel === 'HIGH' ? '高风险动作' : '需要确认'}</div>
                        <div className="mt-1 text-sm font-black text-slate-800">{action.title}</div>
                      </div>
                      <div className="flex shrink-0 justify-end gap-2">
                        <button type="button" onClick={() => props.onDecideAction(action, 'reject')} disabled={Boolean(props.actionBusyId)} className="h-9 px-3 text-xs font-black text-slate-500 disabled:text-slate-300">
                          {action.kind === 'FINALIZE_WORK' ? '暂不定稿' : '取消'}
                        </button>
                        <button type="button" onClick={() => props.onDecideAction(action, 'approve')} disabled={Boolean(props.actionBusyId)} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-slate-950 px-3 text-xs font-black text-white disabled:bg-slate-200">
                          {props.actionBusyId === action.id ? <Loader2 className="animate-spin" size={13} /> : <CheckCircle2 size={13} />}
                          {action.kind === 'WECHAT_CREATE_DRAFT' ? '创建草稿' : action.kind === 'WECHAT_PUBLISH' ? '正式发布' : '确认定稿'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {processingActions.length > 0 && (
              <section>
                <h3 className="mb-3 text-sm font-black text-slate-800">正在执行</h3>
                <div className="divide-y divide-black/[0.06] border-y border-black/[0.06]">
                  {processingActions.map((action) => (
                    <div key={action.id} className="flex items-center gap-3 py-3 text-sm font-bold text-slate-700">
                      <Loader2 className="shrink-0 animate-spin text-sky-600" size={15} />
                      <span className="min-w-0 flex-1 truncate">{action.title}</span>
                      <span className="text-xs text-slate-400">执行中</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {props.loading ? (
              <div className="flex items-center justify-center gap-2 py-16 text-xs font-black text-slate-400"><Loader2 className="animate-spin" size={16} />正在汇总运营数据</div>
            ) : props.summary ? (
              <>
                <section>
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-sm font-black text-slate-800">运营结果</h3>
                    <button type="button" onClick={props.onRefreshOverview} className="inline-flex h-8 items-center gap-1.5 px-2 text-xs font-black text-slate-400 hover:text-slate-900"><RotateCcw size={13} />刷新</button>
                  </div>
                  <div className="grid grid-cols-2 border-y border-black/[0.07] sm:grid-cols-4">
                    {[
                      ['已定稿', props.summary.works.ready],
                      ['待定稿', props.summary.works.awaitingFinalization],
                      ['任务完成率', props.summary.runs.successRate === null ? '-' : `${props.summary.runs.successRate}%`],
                      ['自动化成功率', props.summary.automation.successRate === null ? '-' : `${props.summary.automation.successRate}%`],
                    ].map(([label, value], index) => (
                      <div key={String(label)} className={`px-4 py-5 ${index % 2 === 0 ? 'border-r border-black/[0.06]' : ''} ${index < 2 ? 'border-b border-black/[0.06] sm:border-b-0' : ''} ${index === 1 ? 'sm:border-r' : ''}`}>
                        <div className="text-2xl font-black text-slate-900">{value}</div>
                        <div className="mt-1 text-xs font-semibold text-slate-400">{label}</div>
                      </div>
                    ))}
                  </div>
                </section>
                {props.isWechatSpace && (
                  <section>
                    <h3 className="mb-3 text-sm font-black text-slate-800">微信发布</h3>
                    <div className="grid grid-cols-2 gap-y-5 border-y border-black/[0.07] py-5 sm:grid-cols-4">
                      <div className="text-center"><div className="text-xl font-black text-slate-800">{props.summary.publishing.draftsCreated}</div><div className="mt-1 text-xs text-slate-400">草稿创建</div></div>
                      <div className="text-center"><div className="text-xl font-black text-emerald-700">{props.summary.publishing.publicationsCompleted}</div><div className="mt-1 text-xs text-slate-400">正式发布</div></div>
                      <div className="text-center"><div className="text-xl font-black text-amber-600">{props.summary.publishing.pendingApprovals}</div><div className="mt-1 text-xs text-slate-400">等待审批</div></div>
                      <div className="text-center"><div className="text-xl font-black text-rose-600">{props.summary.publishing.failed}</div><div className="mt-1 text-xs text-slate-400">外部失败</div></div>
                    </div>
                  </section>
                )}
                {props.outcomes.length > 0 && (
                  <section>
                    <h3 className="mb-2 text-sm font-black text-slate-800">最近结果</h3>
                    <div className="divide-y divide-black/[0.06] border-y border-black/[0.06]">
                      {props.outcomes.map((outcome) => (
                        <div key={outcome.id} className="flex items-start justify-between gap-4 py-3">
                          <div className="min-w-0 text-sm font-bold leading-5 text-slate-700">{outcome.title}</div>
                          <span className={`shrink-0 text-xs font-black ${outcome.status === 'FAILED' ? 'text-rose-600' : outcome.status === 'COMPLETED' ? 'text-emerald-700' : 'text-slate-400'}`}>{ACTION_STATUS[outcome.status] || outcome.status}</span>
                        </div>
                      ))}
                    </div>
                  </section>
                )}
              </>
            ) : <div className="py-16 text-center text-sm font-semibold text-slate-400">暂无运营数据</div>}
          </div>
        )}

        {props.tab === 'automations' && (
          <div className="mt-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div><h3 className="text-sm font-black text-slate-800">自动化规则</h3><div className="mt-1 text-xs font-semibold text-slate-400">{props.automations.length} 条规则</div></div>
              <button type="button" onClick={props.onOpenAutomationEditor} className="inline-flex h-10 shrink-0 items-center gap-2 rounded-lg bg-slate-950 px-4 text-xs font-black text-white"><Plus size={14} />新建自动化</button>
            </div>
            {props.automations.length === 0 ? (
              <div className="border-y border-dashed border-slate-200 py-16 text-center text-sm font-semibold text-slate-400">暂无自动化规则</div>
            ) : (
              <div className="divide-y divide-black/[0.07] border-y border-black/[0.07]">
                {props.automations.map((automation) => (
                  <div key={automation.id} className="py-4">
                    <div className="flex flex-wrap items-start gap-2 sm:flex-nowrap sm:gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-black text-slate-800">{automation.name}</span>
                          <span className={`text-[10px] font-black ${automation.enabled ? 'text-emerald-700' : 'text-slate-400'}`}>{automation.enabled ? '运行中' : '已停用'}</span>
                        </div>
                        <div className="mt-1 line-clamp-2 text-xs font-semibold leading-5 text-slate-500">{automation.prompt}</div>
                        <div className="mt-2 text-[11px] font-bold text-slate-400">{scheduleLabel(automation)} · {automation.enabled ? `下次 ${new Date(automation.nextRunAt).toLocaleString('zh-CN')}` : '不会自动触发'}</div>
                        {automation.lastError && <div className="mt-2 text-xs font-semibold text-rose-600">{automation.lastError}</div>}
                        {automation.executions?.slice(0, 3).map((execution) => (
                          <button key={execution.id} type="button" disabled={!execution.runId} onClick={() => execution.runId && props.onOpenRun(execution.runId)} className="mr-3 mt-2 text-[11px] font-black text-slate-400 hover:text-slate-800 disabled:text-slate-300">
                            {new Date(execution.createdAt).toLocaleString('zh-CN')} · {ACTION_STATUS[execution.status] || execution.status}
                          </button>
                        ))}
                      </div>
                      <button type="button" onClick={() => props.onToggleAutomation(automation)} disabled={Boolean(props.automationBusyId)} role="switch" aria-checked={automation.enabled} title={automation.enabled ? '停用' : '启用'} className={`relative mt-1 h-6 w-10 shrink-0 rounded-full transition ${automation.enabled ? 'bg-emerald-500' : 'bg-slate-200'}`}>
                        <span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow-sm transition ${automation.enabled ? 'left-5' : 'left-1'}`} />
                      </button>
                      <button type="button" onClick={() => props.onTriggerAutomation(automation)} disabled={Boolean(props.automationBusyId)} title="立即运行" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-white hover:text-slate-900 disabled:text-slate-200">
                        {props.automationBusyId === automation.id ? <Loader2 className="animate-spin" size={14} /> : <Play size={14} />}
                      </button>
                      <button type="button" onClick={() => props.onDeleteAutomation(automation)} disabled={Boolean(props.automationBusyId)} title="删除自动化" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-300 hover:bg-rose-50 hover:text-rose-600 disabled:text-slate-200"><Trash2 size={14} /></button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {props.tab === 'growth' && (
          <div className="mt-6 space-y-6">
            <section>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-black text-slate-800">团队成长</h3>
                  <p className="mt-1 text-xs font-semibold leading-5 text-slate-400">只将你确认的经验用于后续规划、执行和验收。</p>
                </div>
                <span className="shrink-0 text-xs font-black text-slate-400">v{props.learning?.revision || 0}</span>
              </div>
              {props.learning && (
                <div className="mt-4 grid grid-cols-3 border-y border-black/[0.07] py-4 text-center">
                  <div><div className="text-xl font-black text-slate-800">{props.learning.proposals.filter((item) => item.status === 'pending').length}</div><div className="mt-1 text-xs font-bold text-slate-400">待确认</div></div>
                  <div className="border-x border-black/[0.06]"><div className="text-xl font-black text-slate-800">{props.learning.rules.filter((item) => item.status === 'active').length}</div><div className="mt-1 text-xs font-bold text-slate-400">已生效</div></div>
                  <div><div className="text-xl font-black text-slate-800">{[...props.learning.proposals, ...props.learning.rules].reduce((sum, item) => sum + item.occurrences, 0)}</div><div className="mt-1 text-xs font-bold text-slate-400">累计发现</div></div>
                </div>
              )}
            </section>

            <section className="space-y-3">
              {props.learning?.proposals.filter((item) => item.status === 'pending').map((item) => (
                <div key={item.id} className="rounded-lg border border-amber-200 bg-amber-50/60 p-4">
                  <div className="flex items-center justify-between gap-3 text-[11px] font-black text-amber-700"><span>待确认 · {LEARNING_CATEGORY_LABELS[item.category]}</span><span>发现 {item.occurrences} 次</span></div>
                  <input value={item.title} maxLength={120} onChange={(event) => props.onUpdateLearningDraft('proposals', item.id, 'title', event.target.value)} aria-label="成长建议标题" className="mt-2 w-full border-0 bg-transparent text-sm font-black text-slate-800 outline-none" />
                  <textarea value={item.instruction} maxLength={1_200} rows={3} onChange={(event) => props.onUpdateLearningDraft('proposals', item.id, 'instruction', event.target.value)} aria-label="成长建议内容" className="mt-1 w-full resize-y rounded-md border border-amber-200 bg-white px-3 py-2 text-xs font-semibold leading-5 text-slate-700 outline-none focus:border-amber-300" />
                  {item.evidence.at(-1) && <button type="button" onClick={() => props.onOpenRun(item.evidence.at(-1)!.runId)} className="mt-2 text-left text-[11px] font-bold text-slate-400 hover:text-slate-700">证据任务：{item.evidence.at(-1)!.summary || item.evidence.at(-1)!.runId}</button>}
                  <div className="mt-3 flex justify-end gap-2">
                    <button type="button" onClick={() => props.onApplyLearningAction(item, 'ignore')} disabled={Boolean(props.learningActionId)} className="h-9 px-3 text-xs font-black text-slate-500 disabled:text-slate-300">忽略</button>
                    <button type="button" onClick={() => props.onApplyLearningAction(item, 'approve')} disabled={Boolean(props.learningActionId) || !item.title.trim() || !item.instruction.trim()} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-slate-950 px-3 text-xs font-black text-white disabled:bg-slate-200"><Check size={13} />应用经验</button>
                  </div>
                </div>
              ))}

              {props.learning?.rules.map((item) => (
                <div key={item.id} className={`rounded-lg border p-4 ${item.status === 'active' ? 'border-black/[0.08] bg-white' : 'border-black/[0.06] bg-slate-50 opacity-70'}`}>
                  <div className="flex items-center justify-between gap-3 text-[11px] font-black text-slate-400"><span>{LEARNING_CATEGORY_LABELS[item.category]} · {item.status === 'active' ? '已生效' : '已停用'}</span><span>发现 {item.occurrences} 次</span></div>
                  <input value={item.title} maxLength={120} onChange={(event) => props.onUpdateLearningDraft('rules', item.id, 'title', event.target.value)} aria-label="成长规则标题" className="mt-2 w-full border-0 bg-transparent text-sm font-black text-slate-800 outline-none" />
                  <textarea value={item.instruction} maxLength={1_200} rows={2} onChange={(event) => props.onUpdateLearningDraft('rules', item.id, 'instruction', event.target.value)} aria-label="成长规则内容" className="mt-1 w-full resize-y rounded-md border border-black/[0.06] bg-[#fbfaf7] px-3 py-2 text-xs font-semibold leading-5 text-slate-700 outline-none focus:border-slate-300" />
                  <div className="mt-3 flex justify-end gap-2">
                    <button type="button" onClick={() => props.onApplyLearningAction(item, item.status === 'active' ? 'disable_rule' : 'enable_rule')} disabled={Boolean(props.learningActionId)} className="h-9 px-3 text-xs font-black text-slate-500 disabled:text-slate-300">{item.status === 'active' ? '停用' : '启用'}</button>
                    <button type="button" onClick={() => props.onApplyLearningAction(item, 'update_rule')} disabled={Boolean(props.learningActionId) || !item.title.trim() || !item.instruction.trim()} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-black/[0.08] px-3 text-xs font-black text-slate-700 disabled:text-slate-300"><Save size={13} />保存</button>
                  </div>
                </div>
              ))}

              {props.learning && props.learning.rules.length === 0 && props.learning.proposals.every((item) => item.status !== 'pending') && <div className="border-y border-dashed border-slate-200 py-14 text-center text-sm font-semibold text-slate-400">暂无成长经验</div>}
            </section>

            {props.learningReadme && <details className="border-t border-black/[0.07] pt-4"><summary className="cursor-pointer text-xs font-black text-slate-500">查看生成的 README</summary><pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-950 p-4 text-xs font-medium leading-5 text-slate-200">{props.learningReadme}</pre></details>}
          </div>
        )}

        {props.tab === 'publishing' && props.isWechatSpace && (
          <div className="mt-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-black text-slate-800">微信公众号</h3>
                <div className={`mt-1 text-xs font-semibold ${props.connector?.enabled && props.connector.status === 'READY' ? 'text-emerald-700' : 'text-slate-400'}`}>{props.connector?.enabled && props.connector.status === 'READY' ? '连接可用' : '尚未连接'}</div>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={props.onRefreshPublications} className="flex h-10 w-10 items-center justify-center rounded-lg border border-black/[0.08] bg-white text-slate-500" title="刷新"><RotateCcw size={14} /></button>
                <button type="button" onClick={props.onOpenConnectorSettings} className="inline-flex h-10 items-center gap-2 rounded-lg border border-black/[0.08] bg-white px-3 text-xs font-black text-slate-600"><Settings2 size={14} />连接设置</button>
              </div>
            </div>
            {props.publicationsLoading ? (
              <div className="flex items-center justify-center gap-2 py-16 text-xs font-black text-slate-400"><Loader2 className="animate-spin" size={16} />正在读取发布记录</div>
            ) : props.publications.length === 0 ? (
              <div className="border-y border-dashed border-slate-200 py-16 text-center text-sm font-semibold text-slate-400">暂无发布记录</div>
            ) : (
              <div className="divide-y divide-black/[0.07] border-y border-black/[0.07]">
                {props.publications.map((action) => {
                  const execution = action.connectorExecution;
                  const externalId = actionValue(execution?.externalId);
                  return (
                    <div key={action.id} className="py-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <div className="text-[11px] font-black text-slate-400">{action.kind === 'WECHAT_CREATE_DRAFT' ? '微信草稿' : '正式发布'}</div>
                          <div className="mt-1 text-sm font-black leading-5 text-slate-800">{action.title}</div>
                          {externalId && <div className="mt-2 break-all text-[11px] font-semibold text-slate-400">ID：{externalId}</div>}
                          {(action.error || execution?.error) && <div className="mt-2 text-xs font-semibold text-rose-600">{action.error || execution?.error}</div>}
                        </div>
                        <span className={`shrink-0 text-xs font-black ${action.status === 'FAILED' ? 'text-rose-600' : action.status === 'COMPLETED' ? 'text-emerald-700' : action.status === 'PENDING' ? 'text-amber-700' : 'text-slate-400'}`}>{ACTION_STATUS[action.status] || action.status}</span>
                      </div>
                      <div className="mt-3 flex items-center gap-3">
                        {action.status === 'FAILED' && action.kind === 'WECHAT_PUBLISH' && execution?.externalId && (
                          <button type="button" onClick={() => props.onRetryPublication(action)} disabled={Boolean(props.actionBusyId)} className="inline-flex items-center gap-1.5 text-xs font-black text-rose-600"><RotateCcw size={13} />重新查询</button>
                        )}
                        {execution?.externalUrl && <a href={execution.externalUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs font-black text-emerald-700">查看文章 <ExternalLink size={12} /></a>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

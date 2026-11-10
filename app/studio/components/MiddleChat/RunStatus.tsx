import React from 'react';

export interface StudioRunState {
  runId: string;
  status: string;
  steering: string[];
  followUp: string[];
  items?: Array<{ id: string; message: string; mode: 'steer' | 'followUp' }>;
  notice?: string;
}

const labels: Record<string, string> = {
  running: '正在执行', thinking: '正在思考', responding: '正在回复',
  waiting_confirmation: '等待你的确认', compacting: '正在整理上下文',
  ended: '本次运行已结束',
};

export function RunStatus({ run, clearing, onClear, onCancel }: {
  run: StudioRunState; clearing: boolean; onClear: () => void; onCancel: (itemId: string) => void;
}) {
  const count = run.steering.length + run.followUp.length;
  return (
    <section aria-label="运行状态与待处理消息" className="mb-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
      <div className="flex items-center justify-between gap-2">
        <span role="status">{labels[run.status] || '正在执行'}{count > 0 ? ` · ${count} 条消息待处理` : ''}</span>
        {count > 0 && <button type="button" disabled={clearing} onClick={onClear}
          className="shrink-0 text-rose-600 hover:text-rose-800 disabled:opacity-50">
          {clearing ? '正在更新…' : '清空待处理消息'}
        </button>}
      </div>
      {count > 0 && <div className="mt-2 max-h-36 space-y-1 overflow-y-auto" aria-label="待处理消息">
        {run.items ? (['steer', 'followUp'] as const).flatMap(mode => run.items!.filter(item => item.mode === mode).map(item =>
          <div key={item.id} className="flex items-start gap-2">
            <p className="min-w-0 flex-1 whitespace-pre-wrap break-all">
              <span className="text-slate-400">{mode === 'steer' ? '立即插话' : '结束后追加'}：</span>{item.message}
            </p>
            <button type="button" disabled={clearing} onClick={() => onCancel(item.id)} aria-label={`取消消息：${item.message}`}
              className="shrink-0 text-rose-600 hover:text-rose-800 disabled:opacity-50">取消</button>
          </div>)) : ([['steering', '立即插话'], ['followUp', '结束后追加']] as const).flatMap(([key, label]) =>
          run[key].map((text, index) => <p key={`${key}-${index}`} className="whitespace-pre-wrap break-all">
            <span className="text-slate-400">{label}：</span>{text}
          </p>))}
        <p className="text-slate-400">取消或清空只撤销待处理消息，已开始执行的内容会保留。</p>
      </div>}
      {run.notice && <p role="alert" className="mt-1 break-words text-amber-700">{run.notice}</p>}
    </section>
  );
}

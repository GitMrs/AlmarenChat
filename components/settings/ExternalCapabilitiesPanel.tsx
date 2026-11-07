'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Search } from 'lucide-react';
import { CAPABILITY_REGISTRY } from '@/lib/capabilities/registry.mjs';

const ENTRY_LABELS: Record<string, string> = {
  assistant: '小伴', agent: '单个 Agent', space: '空间', task: 'Task',
};
const capabilities = CAPABILITY_REGISTRY.filter((item) => item.owner === 'external');

export default function ExternalCapabilitiesPanel() {
  const [query, setQuery] = useState('');
  const keyword = query.trim().toLocaleLowerCase();
  const visible = capabilities.filter((item) => [
    item.label, item.description, item.availabilityNote, ...(item.triggers || []),
    ...item.scope.map((entry) => ENTRY_LABELS[entry]),
  ].filter(Boolean).join(' ').toLocaleLowerCase().includes(keyword));

  return (
    <section className="min-w-0 space-y-5" aria-labelledby="external-capabilities-title">
      <div>
        <h2 id="external-capabilities-title" className="text-2xl font-black text-slate-950">外挂能力</h2>
        <p className="mt-2 text-sm leading-6 text-slate-500">集中查找可用的外部能力，了解使用范围和配置入口。允许使用的能力会在需要时加载。</p>
      </div>
      <div className="rounded-2xl border border-indigo-100 bg-indigo-50/60 px-4 py-3 text-sm leading-6 text-indigo-800">
        这里展示能力目录，具体可用性取决于当前入口、服务配置与授权。人设、时间、聊天连续性及各入口自己的基础能力默认保留。
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <label className="flex min-w-0 items-center gap-2 rounded-2xl border border-black/[0.08] bg-white px-4 sm:w-96">
          <Search size={17} className="shrink-0 text-slate-400" aria-hidden="true" />
          <input
            type="search"
            aria-label="搜索外挂能力"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索名称、用途或使用范围"
            className="h-11 min-w-0 w-full bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400"
          />
        </label>
        <p className="text-sm text-slate-500" role="status">显示 {visible.length} / {capabilities.length} 项能力</p>
      </div>
      {visible.length ? (
        <div className="grid min-w-0 gap-4 md:grid-cols-2">
          {visible.map((item) => (
            <article key={item.id} className="flex min-w-0 flex-col rounded-[24px] border border-black/[0.06] bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-base font-black text-slate-900">{item.label}</h3>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">
                  {item.activation === 'on_demand' ? '按需查询' : '配置与授权后使用'}
                </span>
              </div>
              <p className="mt-3 text-sm leading-6 text-slate-600">{item.description || '按当前入口与授权提供的外部扩展能力。'}</p>
              <p className="mt-3 text-xs leading-5 text-slate-500">
                {item.availabilityNote || `使用范围：${item.scope.map((entry) => ENTRY_LABELS[entry] || entry).join('、')}。聊天入口包含对应的网页与 QQ 渠道。`}
              </p>
              <div className="mt-auto pt-4">
                {item.settingsHref ? (
                  <Link href={item.settingsHref} className="inline-flex items-center gap-1 rounded-lg text-sm font-bold text-indigo-700 underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-indigo-600">
                    {item.settingsLabel || '前往配置'}<ArrowUpRight size={15} aria-hidden="true" />
                  </Link>
                ) : (
                  <p className="text-xs leading-5 text-slate-400">使用情况以当前入口提供的服务和授权为准。</p>
                )}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="rounded-[24px] border border-dashed border-black/10 bg-white p-8 text-center text-sm text-slate-500">没有找到匹配的能力，试试其他名称或用途。</div>
      )}
    </section>
  );
}

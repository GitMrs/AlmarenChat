import { capabilityCatalog } from '@/lib/capabilities/registry.mjs';

export default function CapabilityOverview({ entry, bilibiliSpace = false }: { entry: 'agent' | 'space'; bilibiliSpace?: boolean }) {
  const catalog = capabilityCatalog(entry);
  const defaults = catalog.filter((item) => item.owner !== 'external');
  const external = catalog.filter((item) => item.owner === 'external');
  return (
    <section className="rounded-lg border border-black/[0.08] bg-[#fbfaf7] p-3.5 text-xs leading-5 text-slate-500" aria-label="工具能力范围">
      <h3 className="text-sm font-bold text-slate-700">工具能力范围</h3>
      <p className="mt-2">{entry === 'space' ? '空间基础能力' : '角色基础能力'}：{defaults.map((item) => item.label).join('、')}。</p>
      <ul className="mt-2 space-y-1">
        {external.map((item) => (
          <li key={item.id}>
            <span className="font-semibold text-slate-600">{item.label}</span>：{item.id === 'bilibili'
              ? bilibiliSpace ? '在本空间提出相关需求时加载，账号数据需要完成 Bilibili 账号配置。' : '当前普通聊天未接入，可在 Bilibili 创作空间使用。'
              : '提出相关查询时按需加载；查询结果以服务是否已配置及实际返回为准。'}
          </li>
        ))}
      </ul>
      <p className="mt-2">{entry === 'space'
        ? '文件、页面与任务工具由当前交互方式、Skill 和授权决定；外部查询遵守本轮联网权限。'
        : '角色使用自己的记忆和成长记录，不继承空间的文件与任务执行权限。'}</p>
    </section>
  );
}

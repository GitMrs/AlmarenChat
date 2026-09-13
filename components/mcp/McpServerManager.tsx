'use client';

import { useEffect, useState } from 'react';
import {
  AlertCircle,
  Blocks,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Code2,
  ExternalLink,
  KeyRound,
  Layers,
  Loader2,
  Lock,
  Plus,
  Power,
  RefreshCw,
  Sparkles,
  Trash2,
  Wrench,
  Zap,
} from 'lucide-react';
import { user as userApi, mcp as mcpApi } from '@/lib/api';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import { cn } from '@/lib/utils';
import type { AssistantMcpServer, McpDiscoveredTool, McpProbeResult } from '@/types';

const MAX_MCP_SERVERS = 8;

export default function McpServerManager() {
  const [servers, setServers] = useState<AssistantMcpServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // Form states for adding new server
  const [showAddForm, setShowAddForm] = useState(false);
  const [newId, setNewId] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [authType, setAuthType] = useState<'none' | 'bearer' | 'custom'>('none');
  const [bearerToken, setBearerToken] = useState('');
  const [customHeaders, setCustomHeaders] = useState<Array<{ key: string; value: string }>>([
    { key: '', value: '' },
  ]);

  // Testing & Probing states
  const [testingNew, setTestingNew] = useState(false);
  const [testResult, setTestResult] = useState<McpProbeResult | null>(null);

  // Per-server probe state for existing list
  const [probingServerId, setProbingServerId] = useState<string | null>(null);
  const [serverTools, setServerTools] = useState<Record<string, { tools: McpDiscoveredTool[]; latencyMs?: number; error?: string }>>({});
  const [expandedToolsServerId, setExpandedToolsServerId] = useState<string | null>(null);

  // Confirm delete dialog
  const [pendingDeleteServer, setPendingDeleteServer] = useState<AssistantMcpServer | null>(null);

  useEffect(() => {
    loadServers();
  }, []);

  const loadServers = async () => {
    try {
      setLoading(true);
      setError('');
      const res = await userApi.get();
      const rawServers = res.user?.assistantMcpServers;
      if (Array.isArray(rawServers)) {
        setServers(
          rawServers.map((item: any) => ({
            id: String(item.id || ''),
            url: String(item.url || ''),
            headers: item.headers || {},
            enabled: item.enabled !== false,
          }))
        );
      } else {
        setServers([]);
      }
    } catch (err: any) {
      setError(err?.message || '加载 MCP 工具配置失败');
    } finally {
      setLoading(false);
    }
  };

  const persistServers = async (updated: AssistantMcpServer[]) => {
    try {
      setSaving(true);
      setError('');
      await userApi.update({ assistantMcpServers: updated });
      setServers(updated);
      setNotice('MCP 工具总线配置已更新');
      setTimeout(() => setNotice(''), 3000);
      return true;
    } catch (err: any) {
      setError(err?.message || '保存配置失败');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const buildHeadersObject = () => {
    if (authType === 'bearer') {
      const token = bearerToken.trim();
      return token ? { Authorization: `Bearer ${token}` } : {};
    }
    if (authType === 'custom') {
      const obj: Record<string, string> = {};
      for (const item of customHeaders) {
        const k = item.key.trim();
        const v = item.value.trim();
        if (k && v) {
          obj[k] = v;
        }
      }
      return obj;
    }
    return {};
  };

  const handleTestNewServer = async () => {
    const url = newUrl.trim();
    if (!url) {
      setError('请填写 MCP 服务地址');
      return;
    }
    setTestingNew(true);
    setError('');
    setTestResult(null);
    try {
      const headers = buildHeadersObject();
      const res = await mcpApi.test({
        url,
        headers,
        id: newId.trim() || 'test',
      });
      setTestResult(res);
      if (!res.ok) {
        setError(res.error || '连接测试未通过');
      }
    } catch (err: any) {
      setError(err?.message || '测试连接超时或出错');
      setTestResult({ ok: false, error: err?.message || '测试连接失败' });
    } finally {
      setTestingNew(false);
    }
  };

  const handleAddServer = async (e: React.FormEvent) => {
    e.preventDefault();
    const id = newId.trim().replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
    const url = newUrl.trim();

    if (!id) {
      setError('请输入有效的服务标识 ID（支持字母、数字、下划线）');
      return;
    }
    if (!url) {
      setError('请输入 MCP 服务端点 URL');
      return;
    }
    if (servers.some((s) => s.id.toLowerCase() === id.toLowerCase())) {
      setError(`已存在 ID 为「${id}」的 MCP 服务，请使用唯一名称`);
      return;
    }
    if (servers.length >= MAX_MCP_SERVERS) {
      setError(`最多仅支持添加 ${MAX_MCP_SERVERS} 个 MCP 服务`);
      return;
    }

    const headers = buildHeadersObject();
    const newServer: AssistantMcpServer = {
      id,
      url,
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
      enabled: true,
    };

    const updated = [...servers, newServer];
    const ok = await persistServers(updated);
    if (ok) {
      setNewId('');
      setNewUrl('');
      setAuthType('none');
      setBearerToken('');
      setCustomHeaders([{ key: '', value: '' }]);
      setTestResult(null);
      setShowAddForm(false);
    }
  };

  const handleToggleEnabled = async (server: AssistantMcpServer) => {
    const updated = servers.map((s) => (s.id === server.id ? { ...s, enabled: !s.enabled } : s));
    await persistServers(updated);
  };

  const handleDeleteServer = async () => {
    if (!pendingDeleteServer) return;
    const updated = servers.filter((s) => s.id !== pendingDeleteServer.id);
    await persistServers(updated);
    setPendingDeleteServer(null);
  };

  const handleProbeExistingServer = async (server: AssistantMcpServer) => {
    if (probingServerId) return;
    setProbingServerId(server.id);
    try {
      const res = await mcpApi.test({
        url: server.url,
        headers: server.headers,
        id: server.id,
      });
      setServerTools((prev) => ({
        ...prev,
        [server.id]: {
          tools: res.tools || [],
          latencyMs: res.latencyMs,
          error: res.ok ? undefined : res.error,
        },
      }));
      setExpandedToolsServerId(server.id);
    } catch (err: any) {
      setServerTools((prev) => ({
        ...prev,
        [server.id]: {
          tools: [],
          error: err?.message || '探测失败',
        },
      }));
    } finally {
      setProbingServerId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* 顶部标题与介绍 */}
      <section className="rounded-[28px] border border-black/[0.06] bg-white p-6 sm:p-7 shadow-sm space-y-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-black/[0.06] pb-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-violet-600 text-white shadow-md shadow-violet-200">
              <Blocks size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-xl font-black text-slate-950">平台 MCP 工具总线</h3>
                <span className="rounded-full bg-violet-50 px-2.5 py-0.5 text-xs font-black text-violet-700 border border-violet-100">
                  Tool Hub
                </span>
              </div>
              <p className="mt-0.5 text-xs font-medium text-slate-500">
                接入标准 Model Context Protocol (MCP) 服务，为平台模型与个人助理扩展现实世界调用能力
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => {
                setShowAddForm((prev) => !prev);
                setError('');
                setTestResult(null);
              }}
              disabled={servers.length >= MAX_MCP_SERVERS && !showAddForm}
              className={cn(
                'inline-flex h-10 items-center gap-2 rounded-xl px-4 text-xs font-black transition cursor-pointer shadow-sm',
                showAddForm
                  ? 'border border-black/10 bg-slate-100 text-slate-700 hover:bg-slate-200'
                  : 'bg-slate-950 text-white hover:bg-slate-800 disabled:opacity-40'
              )}
            >
              {showAddForm ? '收起表单' : <><Plus size={15} /> 接入新 MCP 服务</>}
            </button>
          </div>
        </div>

        {/* 架构特性说明条 */}
        <div className="grid gap-3 sm:grid-cols-3 pt-1">
          <div className="flex items-start gap-2.5 rounded-2xl bg-[#fbfaf7] p-3 border border-black/[0.04]">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
              <Sparkles size={13} />
            </div>
            <div>
              <div className="text-xs font-black text-slate-900">小伴全量自动继承</div>
              <p className="mt-0.5 text-[11px] font-medium leading-4 text-slate-400">
                此处配置并开启的工具，个人助理小伴将在聊天与思考时自动感知并主动调度。
              </p>
            </div>
          </div>

          <div className="flex items-start gap-2.5 rounded-2xl bg-[#fbfaf7] p-3 border border-black/[0.04]">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-blue-100 text-blue-700">
              <Layers size={13} />
            </div>
            <div>
              <div className="text-xs font-black text-slate-900">平台账号级资产</div>
              <p className="mt-0.5 text-[11px] font-medium leading-4 text-slate-400">
                一次配置，全端漫游。无需在每个 Agent 或工作空间重复填入敏感 Token 与地址。
              </p>
            </div>
          </div>

          <div className="flex items-start gap-2.5 rounded-2xl bg-[#fbfaf7] p-3 border border-black/[0.04]">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
              <Lock size={13} />
            </div>
            <div>
              <div className="text-xs font-black text-slate-900">安全沙箱与鉴权</div>
              <p className="mt-0.5 text-[11px] font-medium leading-4 text-slate-400">
                仅支持 HTTPS 或本地测试，请求头认证严格加密隔离，支持随时单键停用。
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 状态通知 */}
      {(error || notice) && (
        <div
          className={cn(
            'flex items-center gap-2 rounded-2xl px-4 py-3 text-sm font-bold',
            error ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-700'
          )}
        >
          {error ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}
          <span>{error || notice}</span>
        </div>
      )}

      {/* 添加新 MCP 服务折叠表单 */}
      {showAddForm && (
        <section className="rounded-[28px] border-2 border-violet-500/20 bg-gradient-to-b from-violet-50/30 to-white p-6 sm:p-7 shadow-sm space-y-5 animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="flex items-center justify-between border-b border-black/[0.06] pb-3">
            <div className="flex items-center gap-2">
              <Wrench size={16} className="text-violet-600" />
              <h4 className="text-sm font-black text-slate-900">配置新的 MCP 工具服务</h4>
            </div>
            <span className="text-[11px] font-semibold text-slate-400">
              支持标准 JSON-RPC 2.0 (tools/list & tools/call)
            </span>
          </div>

          <form onSubmit={handleAddServer} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-black text-slate-700 mb-1.5">
                  服务标识 ID <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  value={newId}
                  onChange={(e) => setNewId(e.target.value)}
                  placeholder="例如：weather、amap、database"
                  className="h-10 w-full rounded-xl border border-black/10 bg-white px-3 text-xs font-semibold outline-none transition focus:border-violet-600"
                  required
                />
                <p className="mt-1 text-[11px] text-slate-400">
                  调用工具时将以此作为命名空间，例如 <code>mcp_{newId || 'xxx'}_toolName</code>
                </p>
              </div>

              <div>
                <label className="block text-xs font-black text-slate-700 mb-1.5">
                  服务端点 URL <span className="text-rose-500">*</span>
                </label>
                <input
                  type="url"
                  value={newUrl}
                  onChange={(e) => setNewUrl(e.target.value)}
                  placeholder="https://mcp.example.com/rpc"
                  className="h-10 w-full rounded-xl border border-black/10 bg-white px-3 text-xs font-semibold outline-none transition focus:border-violet-600"
                  required
                />
                <p className="mt-1 text-[11px] text-slate-400">
                  必须是 HTTPS 地址（本地测试支持 <code>http://localhost:port</code>）
                </p>
              </div>
            </div>

            {/* 认证方式选择 */}
            <div className="rounded-2xl border border-black/[0.06] bg-white p-4 space-y-3">
              <div className="flex items-center gap-2">
                <KeyRound size={14} className="text-slate-500" />
                <span className="text-xs font-black text-slate-800">服务鉴权认证</span>
              </div>

              <div className="flex flex-wrap gap-2">
                {(['none', 'bearer', 'custom'] as const).map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setAuthType(type)}
                    className={cn(
                      'rounded-lg px-3 py-1.5 text-xs font-bold transition cursor-pointer border',
                      authType === type
                        ? 'border-violet-600 bg-violet-50 text-violet-700'
                        : 'border-black/[0.08] bg-[#fbfaf7] text-slate-600 hover:bg-slate-100'
                    )}
                  >
                    {type === 'none' && '无认证 (公开)'}
                    {type === 'bearer' && 'Bearer Token'}
                    {type === 'custom' && '自定义 Header (多组)'}
                  </button>
                ))}
              </div>

              {authType === 'bearer' && (
                <div className="pt-2">
                  <label className="block text-[11px] font-bold text-slate-600 mb-1">
                    API Token
                  </label>
                  <input
                    type="password"
                    value={bearerToken}
                    onChange={(e) => setBearerToken(e.target.value)}
                    placeholder="eyJhbGciOi..."
                    className="h-9 w-full rounded-lg border border-black/10 bg-[#fbfaf7] px-3 text-xs font-mono outline-none transition focus:border-violet-600 focus:bg-white"
                  />
                  <p className="mt-1 text-[10px] text-slate-400">
                    将自动封装为 <code>Authorization: Bearer &lt;Token&gt;</code> 传入 MCP 服务端
                  </p>
                </div>
              )}

              {authType === 'custom' && (
                <div className="pt-2 space-y-2">
                  {customHeaders.map((item, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <input
                        type="text"
                        value={item.key}
                        onChange={(e) => {
                          const updated = [...customHeaders];
                          updated[idx].key = e.target.value;
                          setCustomHeaders(updated);
                        }}
                        placeholder="Header Key (如 X-API-Key)"
                        className="h-8 flex-1 rounded-lg border border-black/10 bg-[#fbfaf7] px-2.5 text-xs font-mono outline-none focus:border-violet-600 focus:bg-white"
                      />
                      <input
                        type="text"
                        value={item.value}
                        onChange={(e) => {
                          const updated = [...customHeaders];
                          updated[idx].value = e.target.value;
                          setCustomHeaders(updated);
                        }}
                        placeholder="Header Value"
                        className="h-8 flex-1 rounded-lg border border-black/10 bg-[#fbfaf7] px-2.5 text-xs font-mono outline-none focus:border-violet-600 focus:bg-white"
                      />
                      {customHeaders.length > 1 && (
                        <button
                          type="button"
                          onClick={() => setCustomHeaders(customHeaders.filter((_, i) => i !== idx))}
                          className="h-8 w-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => setCustomHeaders([...customHeaders, { key: '', value: '' }])}
                    className="text-[11px] font-bold text-violet-600 hover:underline inline-flex items-center gap-1"
                  >
                    + 添加一组请求头
                  </button>
                </div>
              )}
            </div>

            {/* 探测测试结果预览条 */}
            {testResult && (
              <div
                className={cn(
                  'rounded-2xl p-4 text-xs space-y-2 border',
                  testResult.ok
                    ? 'border-emerald-200 bg-emerald-50/70 text-emerald-900'
                    : 'border-rose-200 bg-rose-50/70 text-rose-900'
                )}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 font-black">
                    {testResult.ok ? (
                      <>
                        <CheckCircle2 size={16} className="text-emerald-600" />
                        <span>连接成功！探测到 {testResult.count || 0} 个可用工具</span>
                      </>
                    ) : (
                      <>
                        <AlertCircle size={16} className="text-rose-600" />
                        <span>连接探测失败：{testResult.error}</span>
                      </>
                    )}
                  </div>
                  {testResult.latencyMs !== undefined && (
                    <span className="rounded-md bg-white/80 px-2 py-0.5 text-[10px] font-mono font-bold">
                      {testResult.latencyMs} ms
                    </span>
                  )}
                </div>

                {testResult.ok && testResult.tools && testResult.tools.length > 0 && (
                  <div className="mt-2 divide-y divide-emerald-200/50 rounded-xl bg-white/80 p-2.5 max-h-48 overflow-y-auto">
                    {testResult.tools.map((tool) => (
                      <div key={tool.name} className="py-1.5 first:pt-0 last:pb-0">
                        <div className="flex items-center gap-2 font-mono font-bold text-slate-900">
                          <Code2 size={13} className="text-emerald-600" />
                          <span>{tool.name}</span>
                        </div>
                        {tool.description && (
                          <p className="mt-0.5 text-[11px] text-slate-500">{tool.description}</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* 操作按钮组 */}
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={handleTestNewServer}
                disabled={testingNew || !newUrl.trim()}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-black/10 bg-white px-3.5 text-xs font-black text-slate-700 shadow-2xs hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
              >
                {testingNew ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} className="text-amber-500" />}
                <span>测试连接与探测</span>
              </button>

              <button
                type="submit"
                disabled={saving || !newId.trim() || !newUrl.trim()}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-slate-950 px-4 text-xs font-black text-white shadow-sm hover:bg-slate-800 disabled:opacity-40 cursor-pointer"
              >
                {saving ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
                <span>确认添加并接入</span>
              </button>
            </div>
          </form>
        </section>
      )}

      {/* 已接入 MCP 服务列表 */}
      <section className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-black text-slate-900">已接入的 MCP 服务</h4>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-black text-slate-600">
              {servers.length} / {MAX_MCP_SERVERS}
            </span>
          </div>
          <button
            type="button"
            onClick={loadServers}
            disabled={loading}
            className="flex h-7 items-center gap-1 rounded-lg px-2 text-xs font-bold text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            <span>刷新</span>
          </button>
        </div>

        {loading ? (
          <div className="flex h-44 items-center justify-center rounded-2xl border border-black/[0.06] bg-white">
            <Loader2 className="animate-spin text-slate-400" size={24} />
          </div>
        ) : servers.length === 0 ? (
          <div className="rounded-[28px] border border-dashed border-black/10 bg-white p-10 text-center space-y-3">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-50 text-slate-400">
              <Blocks size={24} />
            </div>
            <div>
              <p className="text-sm font-black text-slate-700">暂未配置任何平台 MCP 工具服务</p>
              <p className="mt-1 text-xs text-slate-400">
                点击右上角「接入新 MCP 服务」，即可把高德地图、天气查询、外部数据源等通过标准协议无缝接入。
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowAddForm(true)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-slate-950 px-4 py-2 text-xs font-black text-white hover:bg-slate-800"
            >
              <Plus size={14} />
              <span>立即接入第一个 MCP 服务</span>
            </button>
          </div>
        ) : (
          <div className="grid gap-3.5">
            {servers.map((server) => {
              const isEnabled = server.enabled !== false;
              const isProbing = probingServerId === server.id;
              const probeInfo = serverTools[server.id];
              const isExpanded = expandedToolsServerId === server.id;
              const hasAuth = Boolean(server.headers && Object.keys(server.headers).length > 0);

              return (
                <div
                  key={server.id}
                  className={cn(
                    'rounded-2xl border transition-all bg-white p-4 sm:p-5 shadow-sm space-y-3',
                    isEnabled ? 'border-black/[0.08]' : 'border-black/[0.04] bg-slate-50/60 opacity-75'
                  )}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-start sm:items-center gap-3">
                      <div
                        className={cn(
                          'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl font-mono font-bold text-sm',
                          isEnabled ? 'bg-violet-100 text-violet-700' : 'bg-slate-200 text-slate-500'
                        )}
                      >
                        {server.id.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-sm font-black text-slate-900">{server.id}</span>
                          <span
                            className={cn(
                              'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold',
                              isEnabled ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-slate-100 text-slate-500'
                            )}
                          >
                            <span className={cn('h-1.5 w-1.5 rounded-full', isEnabled ? 'bg-emerald-500' : 'bg-slate-400')} />
                            {isEnabled ? '已启用 (小伴自动挂载)' : '已停用'}
                          </span>
                          {hasAuth ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-bold text-sky-700 border border-sky-100">
                              <Lock size={10} />
                              有鉴权 Header
                            </span>
                          ) : (
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">
                              公开接口
                            </span>
                          )}
                        </div>
                        <p className="mt-1 truncate text-xs font-mono text-slate-400 max-w-md sm:max-w-xl">
                          {server.url}
                        </p>
                      </div>
                    </div>

                    {/* 操作条 */}
                    <div className="flex items-center gap-2 self-end sm:self-auto">
                      <button
                        type="button"
                        onClick={() => handleProbeExistingServer(server)}
                        disabled={isProbing}
                        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-black/10 bg-white px-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
                        title="在线探测该 MCP 服务暴露的工具"
                      >
                        {isProbing ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} className="text-amber-500" />}
                        <span>探测工具</span>
                      </button>

                      <button
                        type="button"
                        role="switch"
                        aria-checked={isEnabled}
                        onClick={() => handleToggleEnabled(server)}
                        disabled={saving}
                        title={isEnabled ? '点击停用服务' : '点击启用服务'}
                        className={cn(
                          'relative h-6 w-11 shrink-0 rounded-full transition cursor-pointer',
                          isEnabled ? 'bg-emerald-600' : 'bg-slate-300'
                        )}
                      >
                        <span
                          className={cn(
                            'absolute top-1 h-4 w-4 rounded-full bg-white shadow-sm transition',
                            isEnabled ? 'left-6' : 'left-1'
                          )}
                        />
                      </button>

                      <button
                        type="button"
                        onClick={() => setPendingDeleteServer(server)}
                        disabled={saving}
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40 cursor-pointer"
                        title="删除该 MCP 服务"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>

                  {/* 探测到的工具展开卡片 */}
                  {probeInfo && (
                    <div className="border-t border-black/[0.06] pt-3">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-black text-slate-800">
                            暴露工具清单 ({probeInfo.tools.length})
                          </span>
                          {probeInfo.latencyMs !== undefined && (
                            <span className="font-mono text-[10px] text-slate-400 font-bold">
                              {probeInfo.latencyMs} ms
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => setExpandedToolsServerId(isExpanded ? null : server.id)}
                          className="flex items-center gap-1 text-[11px] font-bold text-slate-500 hover:text-slate-800"
                        >
                          <span>{isExpanded ? '收起详情' : '展开详情'}</span>
                          <ChevronDown size={12} className={cn('transition-transform', isExpanded && 'rotate-180')} />
                        </button>
                      </div>

                      {probeInfo.error ? (
                        <div className="rounded-xl bg-rose-50 p-2.5 text-xs text-rose-600 font-semibold">
                          探测出错：{probeInfo.error}
                        </div>
                      ) : probeInfo.tools.length === 0 ? (
                        <div className="rounded-xl bg-slate-50 p-2.5 text-xs text-slate-400 font-medium">
                          该服务未返回任何工具（tools 列表为空）
                        </div>
                      ) : isExpanded ? (
                        <div className="space-y-2 rounded-xl bg-[#fbfaf7] p-3 border border-black/[0.04]">
                          {probeInfo.tools.map((tool) => (
                            <div key={tool.name} className="border-b border-black/[0.04] pb-2 last:border-b-0 last:pb-0">
                              <div className="flex items-center gap-2 font-mono text-xs font-bold text-slate-900">
                                <Code2 size={12} className="text-violet-600" />
                                <span>mcp_{server.id}_{tool.name}</span>
                              </div>
                              {tool.description && (
                                <p className="mt-0.5 text-[11px] text-slate-500 leading-4">{tool.description}</p>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {probeInfo.tools.slice(0, 6).map((tool) => (
                            <span
                              key={tool.name}
                              className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 font-mono text-[10px] font-bold text-slate-700"
                            >
                              {tool.name}
                            </span>
                          ))}
                          {probeInfo.tools.length > 6 && (
                            <span className="text-[10px] text-slate-400 font-bold self-center">
                              +{probeInfo.tools.length - 6} 更多...
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* 删除确认弹窗 */}
      <ConfirmDialog
        open={Boolean(pendingDeleteServer)}
        title="确认删除 MCP 工具服务？"
        description={
          <span>
            删除服务 <strong className="font-mono text-slate-900">{pendingDeleteServer?.id}</strong> 后，小伴及平台模型将无法再调用其暴露的任何工具能力。此操作不可逆。
          </span>
        }
        confirmText="确认删除"
        cancelText="取消"
        destructive
        loading={saving}
        onCancel={() => setPendingDeleteServer(null)}
        onConfirm={handleDeleteServer}
      />
    </div>
  );
}

'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Check,
  Cloud,
  Cpu,
  Database,
  Image as ImageIcon,
  KeyRound,
  Loader2,
  LogOut,
  Moon,
  Palette,
  PlugZap,
  RefreshCw,
  Search,
  ToggleLeft,
  ToggleRight,
  User,
} from 'lucide-react';
import LoginRequired from '@/components/auth/LoginRequired';
import SearchableSelect from '@/components/shared/SearchableSelect';
import { auth, user as userApi } from '@/lib/api';
import {
  DEFAULT_BROWSER_MODEL_CONFIG,
  readBrowserModelConfigForScope,
  saveBrowserModelConfig,
  type BrowserModelConfig,
} from '@/lib/browser-model';
import { cn } from '@/lib/utils';

type AccountSnapshot = {
  name: string;
};

type ModelSnapshot = {
  customModelEnabled: boolean;
  apiBaseUrl: string;
  apiKey: string;
  modelName: string;
  imageModelEnabled: boolean;
  imageModelName: string;
  imageModelSize: string;
  contextMessageLimit: number;
};

type SearchSnapshot = {
  tavilyApiKey: string;
};

export default function SettingsPanel() {
  const router = useRouter();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [customModelEnabled, setCustomModelEnabled] = useState(false);
  const [apiBaseUrl, setApiBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [modelName, setModelName] = useState('');
  const [imageModelEnabled, setImageModelEnabled] = useState(false);
  const [imageModelName, setImageModelName] = useState('');
  const [imageModelSize, setImageModelSize] = useState('1024x1024');
  const [contextMessageLimit, setContextMessageLimit] = useState(40);
  const [tavilyApiKey, setTavilyApiKey] = useState('');
  const [initialAccount, setInitialAccount] = useState<AccountSnapshot | null>(null);
  const [initialModel, setInitialModel] = useState<ModelSnapshot | null>(null);
  const [initialSearch, setInitialSearch] = useState<SearchSnapshot | null>(null);
  const [browserModelConfig, setBrowserModelConfig] = useState<BrowserModelConfig>({ ...DEFAULT_BROWSER_MODEL_CONFIG });
  const [initialBrowserModelConfig, setInitialBrowserModelConfig] = useState<BrowserModelConfig | null>(null);

  const [loading, setLoading] = useState(true);
  const [savingAccount, setSavingAccount] = useState(false);
  const [savingModel, setSavingModel] = useState(false);
  const [savingSearch, setSavingSearch] = useState(false);
  const [accountSaved, setAccountSaved] = useState(false);
  const [modelSaved, setModelSaved] = useState(false);
  const [browserModelSaved, setBrowserModelSaved] = useState(false);
  const [searchSaved, setSearchSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [manualModelEntry, setManualModelEntry] = useState(false);
  const [manualImageModelEntry, setManualImageModelEntry] = useState(false);
  const [modelListResult, setModelListResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [testResult, setTestResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [error, setError] = useState('');
  const [browserModelError, setBrowserModelError] = useState('');
  const [needsLogin, setNeedsLogin] = useState(false);

  const currentAccount = useMemo(
    () => ({
      name: name.trim(),
    }),
    [name]
  );
  const currentModel = useMemo(
    () => ({
      customModelEnabled,
      apiBaseUrl: apiBaseUrl.trim(),
      apiKey: apiKey.trim(),
      modelName: modelName.trim(),
      imageModelEnabled,
      imageModelName: imageModelName.trim(),
      imageModelSize,
      contextMessageLimit,
    }),
    [apiBaseUrl, apiKey, contextMessageLimit, customModelEnabled, imageModelEnabled, imageModelName, imageModelSize, modelName]
  );
  const hasAccountChanges = initialAccount ? JSON.stringify(currentAccount) !== JSON.stringify(initialAccount) : false;
  const hasModelChanges = initialModel ? JSON.stringify(currentModel) !== JSON.stringify(initialModel) : false;
  const hasBrowserModelChanges = initialBrowserModelConfig
    ? JSON.stringify(browserModelConfig) !== JSON.stringify(initialBrowserModelConfig)
    : false;
  const currentSearch = useMemo(() => ({ tavilyApiKey: tavilyApiKey.trim() }), [tavilyApiKey]);
  const hasSearchChanges = initialSearch ? JSON.stringify(currentSearch) !== JSON.stringify(initialSearch) : false;
  const canTestModel = Boolean(apiBaseUrl.trim() && apiKey.trim() && modelName.trim());
  const canFetchModels = Boolean(apiBaseUrl.trim() && apiKey.trim());
  const modelConfigIncomplete = customModelEnabled && !canTestModel;
  const imageModelConfigIncomplete = imageModelEnabled && !(apiBaseUrl.trim() && apiKey.trim() && imageModelName.trim());

  useEffect(() => {
    const storedBrowserModel = readBrowserModelConfigForScope('GLOBAL');
    setBrowserModelConfig(storedBrowserModel);
    setInitialBrowserModelConfig(storedBrowserModel);

    if (!localStorage.getItem('token')) {
      setNeedsLogin(true);
      setLoading(false);
      return;
    }

    auth
      .me()
      .then((result) => {
        const u = result.user;
        setName(u.name || '');
        setEmail(u.email || '');
        setCustomModelEnabled(Boolean(u.customModelEnabled));
        setApiBaseUrl(u.apiBaseUrl || '');
        setApiKey(u.apiKey || '');
        setModelName(u.modelName || '');
        setImageModelEnabled(Boolean(u.imageModelEnabled));
        setImageModelName(u.imageModelName || '');
        setImageModelSize(u.imageModelSize || '1024x1024');
        setTavilyApiKey(u.tavilyApiKey || '');
        setContextMessageLimit(u.contextMessageLimit || 40);
        setInitialAccount({ name: u.name || '' });
        setInitialModel({
          customModelEnabled: Boolean(u.customModelEnabled),
          apiBaseUrl: u.apiBaseUrl || '',
          apiKey: u.apiKey || '',
          modelName: u.modelName || '',
          imageModelEnabled: Boolean(u.imageModelEnabled),
          imageModelName: u.imageModelName || '',
          imageModelSize: u.imageModelSize || '1024x1024',
          contextMessageLimit: u.contextMessageLimit || 40,
        });
        setInitialSearch({ tavilyApiKey: u.tavilyApiKey || '' });
      })
      .catch((err: any) => {
        if (err.message === 'Unauthorized') {
          localStorage.removeItem('token');
          setNeedsLogin(true);
          return;
        }
        setError(err.message || '加载设置失败');
      })
      .finally(() => setLoading(false));
  }, []);

  const handleSaveAccount = async () => {
    if (!hasAccountChanges || savingAccount) return;

    setSavingAccount(true);
    setError('');
    setAccountSaved(false);

    try {
      await userApi.update({ name: currentAccount.name });
      setName(currentAccount.name);
      setInitialAccount(currentAccount);
      setAccountSaved(true);
      setTimeout(() => setAccountSaved(false), 2000);
    } catch (err: any) {
      setError(err.message || '保存失败');
    } finally {
      setSavingAccount(false);
    }
  };

  const handleSaveModel = async () => {
    if (!hasModelChanges || savingModel) return;

    setSavingModel(true);
    setError('');
    setModelSaved(false);

    try {
      await userApi.update({
        customModelEnabled: currentModel.customModelEnabled,
        apiBaseUrl: currentModel.apiBaseUrl || null,
        apiKey: currentModel.apiKey || null,
        modelName: currentModel.modelName || null,
        imageModelEnabled: currentModel.imageModelEnabled,
        imageModelName: currentModel.imageModelName || null,
        imageModelSize: currentModel.imageModelSize,
        contextMessageLimit: currentModel.contextMessageLimit,
      });
      setApiBaseUrl(currentModel.apiBaseUrl);
      setApiKey(currentModel.apiKey);
      setModelName(currentModel.modelName);
      setImageModelEnabled(currentModel.imageModelEnabled);
      setImageModelName(currentModel.imageModelName);
      setImageModelSize(currentModel.imageModelSize);
      setContextMessageLimit(currentModel.contextMessageLimit);
      setInitialModel(currentModel);
      setModelSaved(true);
      setTimeout(() => setModelSaved(false), 2000);
    } catch (err: any) {
      setError(err.message || '保存失败');
    } finally {
      setSavingModel(false);
    }
  };

  const handleSaveSearch = async () => {
    if (!hasSearchChanges || savingSearch) return;

    setSavingSearch(true);
    setError('');
    setSearchSaved(false);

    try {
      await userApi.update({ tavilyApiKey: currentSearch.tavilyApiKey || null });
      setTavilyApiKey(currentSearch.tavilyApiKey);
      setInitialSearch(currentSearch);
      setSearchSaved(true);
      setTimeout(() => setSearchSaved(false), 2000);
    } catch (err: any) {
      setError(err.message || '保存失败');
    } finally {
      setSavingSearch(false);
    }
  };

  const handleTestModel = async () => {
    if (!canTestModel || testing) return;

    setTesting(true);
    setTestResult(null);
    try {
      const result = await userApi.testModel({
        apiBaseUrl: apiBaseUrl.trim(),
        apiKey: apiKey.trim(),
        modelName: modelName.trim(),
      });
      setTestResult({ type: 'success', message: result.message || '连接成功' });
    } catch (err: any) {
      setTestResult({ type: 'error', message: err.message || '连接失败，请检查配置' });
    } finally {
      setTesting(false);
    }
  };

  const handleSaveBrowserModel = () => {
    if (!hasBrowserModelChanges) return;

    setBrowserModelError('');
    setBrowserModelSaved(false);
    try {
      const normalized = saveBrowserModelConfig(browserModelConfig, 'GLOBAL');
      setBrowserModelConfig(normalized);
      setInitialBrowserModelConfig(normalized);
      setBrowserModelSaved(true);
      setTimeout(() => setBrowserModelSaved(false), 2000);
    } catch (err: any) {
      setBrowserModelError(err.message || '保存本地模型设置失败');
    }
  };

  const handleFetchModels = async () => {
    if (!canFetchModels || fetchingModels) return;
    setFetchingModels(true);
    setModelListResult(null);
    try {
      const result = await userApi.models({
        apiBaseUrl: apiBaseUrl.trim(),
        apiKey: apiKey.trim(),
      });
      setAvailableModels(result.models);
      if (result.models.length > 0) {
        setManualModelEntry(false);
        setManualImageModelEntry(false);
      }
      setModelListResult({
        type: 'success',
        message: result.models.length > 0 ? `已获取 ${result.models.length} 个模型` : '服务返回的模型列表为空',
      });
    } catch (err: any) {
      setAvailableModels([]);
      setModelListResult({ type: 'error', message: err.message || '获取模型列表失败' });
    } finally {
      setFetchingModels(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    router.push('/login');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center rounded-[28px] border border-black/[0.06] bg-white py-20 text-slate-400">
        <Loader2 className="animate-spin" size={24} />
      </div>
    );
  }

  if (needsLogin) {
    return (
      <LoginRequired
        title="登录后管理设置"
        description="账号资料、模型配置和隐私设置都需要保存到你的账号下。"
      />
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-2xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-600">{error}</div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <section className="rounded-[28px] border border-black/[0.06] bg-white p-5 shadow-sm sm:p-6">
            <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-950 text-white">
                  <User size={18} />
                </div>
                <div>
                  <h2 className="text-xl font-black text-slate-950">账号资料</h2>
                  <p className="text-sm text-slate-500">昵称和登录状态。</p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleSaveAccount}
                disabled={savingAccount || !hasAccountChanges}
                className={cn(
                  'inline-flex h-10 w-fit items-center justify-center gap-2 rounded-full px-4 text-sm font-black transition',
                  hasAccountChanges && !savingAccount
                    ? 'bg-slate-950 text-white shadow-sm hover:-translate-y-0.5'
                    : 'bg-slate-100 text-slate-400'
                )}
              >
                {savingAccount ? (
                  <Loader2 className="animate-spin" size={15} />
                ) : accountSaved ? (
                  <Check size={15} />
                ) : null}
                {savingAccount ? '保存中...' : hasAccountChanges ? '保存资料' : accountSaved ? '已保存' : '无需保存'}
              </button>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="mb-2 block text-sm font-bold text-slate-700">昵称</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="输入昵称"
                  className="h-12 w-full rounded-2xl border border-black/[0.08] bg-[#fbfaf7] px-4 text-sm font-medium text-slate-800 outline-none focus:border-slate-300 focus:ring-4 focus:ring-slate-200/70"
                />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-bold text-slate-700">邮箱</span>
                <input
                  value={email}
                  disabled
                  className="h-12 w-full rounded-2xl border border-black/[0.08] bg-slate-50 px-4 text-sm font-medium text-slate-400 outline-none"
                />
              </label>
            </div>
          </section>

          <section className="rounded-[28px] border border-black/[0.06] bg-white p-5 shadow-sm sm:p-6">
            <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
                  <Search size={18} />
                </div>
                <div>
                  <h2 className="text-xl font-black text-slate-950">联网搜索设置</h2>
                  <p className="text-sm text-slate-500">可选填 Tavily API Key；未配置时自动使用免费的 DuckDuckGo。</p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleSaveSearch}
                disabled={savingSearch || !hasSearchChanges}
                className={cn(
                  'inline-flex h-10 w-fit items-center justify-center gap-2 rounded-full px-4 text-sm font-black transition',
                  hasSearchChanges && !savingSearch
                    ? 'bg-slate-950 text-white shadow-sm hover:-translate-y-0.5'
                    : 'bg-slate-100 text-slate-400'
                )}
              >
                {savingSearch ? (
                  <Loader2 className="animate-spin" size={15} />
                ) : searchSaved ? (
                  <Check size={15} />
                ) : null}
                {savingSearch ? '保存中...' : hasSearchChanges ? '保存搜索设置' : searchSaved ? '已保存' : '无需保存'}
              </button>
            </div>

            <label className="block">
              <span className="mb-2 block text-sm font-bold text-slate-700">Tavily API Key</span>
              <input
                value={tavilyApiKey}
                onChange={(e) => setTavilyApiKey(e.target.value)}
                placeholder="tvly-..."
                type="password"
                className="h-12 w-full rounded-2xl border border-black/[0.08] bg-[#fbfaf7] px-4 text-sm font-medium text-slate-800 outline-none focus:border-slate-300 focus:ring-4 focus:ring-slate-200/70"
              />
              <p className="mt-2 text-xs leading-5 text-slate-400">
                填写后使用你的 Tavily 额度；未填写时自动使用免费的 DuckDuckGo，无需 API Key。
              </p>
            </label>
          </section>

          <section className="rounded-[28px] border border-black/[0.06] bg-white p-5 shadow-sm sm:p-6">
            <div className="mb-5 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
                <KeyRound size={18} />
              </div>
              <div>
                <h2 className="text-xl font-black text-slate-950">AI 模型设置</h2>
                <p className="text-sm text-slate-500">设置 Agent 单聊和小助手默认使用的模型。</p>
              </div>
            </div>

            <div className="mb-5 rounded-2xl border border-black/[0.06] bg-[#fbfaf7] p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-sm font-black text-slate-900">默认运行方式</div>
                  <p className="mt-1 text-xs leading-5 text-slate-500">本地模式仅保存在当前浏览器，其他设备仍使用线上模型。</p>
                </div>
                <div className="grid shrink-0 grid-cols-2 gap-1 rounded-lg bg-white p-1 shadow-sm ring-1 ring-black/[0.06]">
                  <button
                    type="button"
                    onClick={() => {
                      setBrowserModelConfig((config) => ({ ...config, source: 'ONLINE' }));
                      setBrowserModelError('');
                      setBrowserModelSaved(false);
                    }}
                    className={cn(
                      'flex h-9 items-center justify-center gap-2 rounded-md px-4 text-xs font-black transition',
                      browserModelConfig.source === 'ONLINE' ? 'bg-slate-950 text-white shadow-sm' : 'text-slate-500'
                    )}
                  >
                    <Cloud size={14} />
                    线上模型
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setBrowserModelConfig((config) => ({ ...config, source: 'OLLAMA' }));
                      setBrowserModelError('');
                      setBrowserModelSaved(false);
                    }}
                    className={cn(
                      'flex h-9 items-center justify-center gap-2 rounded-md px-4 text-xs font-black transition',
                      browserModelConfig.source === 'OLLAMA' ? 'bg-slate-950 text-white shadow-sm' : 'text-slate-500'
                    )}
                  >
                    <Cpu size={14} />
                    本地 Ollama
                  </button>
                </div>
              </div>

              {browserModelConfig.source === 'OLLAMA' && (
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-2 block text-xs font-bold text-slate-600">Ollama Base URL</span>
                    <input
                      type="url"
                      value={browserModelConfig.baseUrl}
                      onChange={(event) => setBrowserModelConfig((config) => ({ ...config, baseUrl: event.target.value }))}
                      placeholder="http://localhost:11434/v1"
                      className="h-11 w-full rounded-xl border border-black/[0.08] bg-white px-3 text-sm font-medium text-slate-800 outline-none focus:border-slate-300"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-xs font-bold text-slate-600">模型名称</span>
                    <input
                      value={browserModelConfig.model}
                      onChange={(event) => setBrowserModelConfig((config) => ({ ...config, model: event.target.value }))}
                      placeholder="例如 qwen3:8b"
                      className="h-11 w-full rounded-xl border border-black/[0.08] bg-white px-3 text-sm font-medium text-slate-800 outline-none focus:border-slate-300"
                    />
                  </label>
                  <label className="block sm:col-span-2">
                    <span className="mb-2 block text-xs font-bold text-slate-600">API Key（可选）</span>
                    <input
                      type="password"
                      value={browserModelConfig.apiKey}
                      onChange={(event) => setBrowserModelConfig((config) => ({ ...config, apiKey: event.target.value }))}
                      autoComplete="off"
                      className="h-11 w-full rounded-xl border border-black/[0.08] bg-white px-3 text-sm font-medium text-slate-800 outline-none focus:border-slate-300"
                    />
                  </label>
                </div>
              )}

              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs font-semibold leading-5 text-slate-500">
                  {browserModelConfig.source === 'OLLAMA'
                    ? '启用后，此浏览器中的 Agent 和小助手默认直连 Ollama。'
                    : '线上模式使用下方的平台默认模型或你的在线 API。'}
                </p>
                <button
                  type="button"
                  onClick={handleSaveBrowserModel}
                  disabled={!hasBrowserModelChanges}
                  className={cn(
                    'inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-full px-4 text-sm font-black transition',
                    hasBrowserModelChanges
                      ? 'bg-slate-950 text-white shadow-sm hover:-translate-y-0.5'
                      : 'bg-slate-100 text-slate-400'
                  )}
                >
                  {browserModelSaved && <Check size={15} />}
                  {hasBrowserModelChanges ? '保存运行方式' : browserModelSaved ? '已保存' : '无需保存'}
                </button>
              </div>
              {browserModelError && <p className="mt-3 text-xs font-semibold text-rose-600">{browserModelError}</p>}
            </div>

            <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-center gap-3">
                <div>
                  <h3 className="text-base font-black text-slate-900">线上模型服务</h3>
                  <p className="text-xs leading-5 text-slate-500">关闭自定义服务时使用平台默认模型。</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setCustomModelEnabled((value) => !value)}
                className={cn(
                  'inline-flex w-fit items-center gap-2 rounded-full px-4 py-2 text-sm font-black transition',
                  customModelEnabled ? 'bg-slate-950 text-white shadow-sm' : 'bg-slate-100 text-slate-500'
                )}
              >
                {customModelEnabled ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
                {customModelEnabled ? '已启用我的模型' : '使用平台默认'}
              </button>
            </div>

            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-2 block text-sm font-bold text-slate-700">API Base URL</span>
                  <input
                    value={apiBaseUrl}
                    onChange={(e) => {
                      setApiBaseUrl(e.target.value);
                      setAvailableModels([]);
                      setManualModelEntry(false);
                      setManualImageModelEntry(false);
                      setModelListResult(null);
                    }}
                    placeholder="https://api.example.com/v1"
                    className="h-12 w-full rounded-2xl border border-black/[0.08] bg-[#fbfaf7] px-4 text-sm font-medium text-slate-800 outline-none focus:border-slate-300 focus:ring-4 focus:ring-slate-200/70"
                  />
                </label>
                <label className="block">
                  <span className="mb-2 block text-sm font-bold text-slate-700">API Key</span>
                  <input
                    value={apiKey}
                    onChange={(e) => {
                      setApiKey(e.target.value);
                      setAvailableModels([]);
                      setManualModelEntry(false);
                      setManualImageModelEntry(false);
                      setModelListResult(null);
                    }}
                    placeholder="sk-..."
                    type="password"
                    className="h-12 w-full rounded-2xl border border-black/[0.08] bg-[#fbfaf7] px-4 text-sm font-medium text-slate-800 outline-none focus:border-slate-300 focus:ring-4 focus:ring-slate-200/70"
                  />
                </label>
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <label htmlFor="model-name" className="text-sm font-bold text-slate-700">模型名称</label>
                  <button
                    type="button"
                    onClick={handleFetchModels}
                    disabled={!canFetchModels || fetchingModels}
                    className={cn(
                      'inline-flex h-8 items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-black transition',
                      canFetchModels && !fetchingModels
                        ? 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                        : 'bg-slate-50 text-slate-300'
                    )}
                  >
                    <RefreshCw className={fetchingModels ? 'animate-spin' : ''} size={13} />
                    获取
                  </button>
                </div>
                {availableModels.length > 0 && !manualModelEntry ? (
                  <SearchableSelect
                    id="model-name"
                    value={modelName}
                    options={availableModels}
                    placeholder="请选择模型"
                    searchPlaceholder="搜索模型"
                    emptyText="没有匹配的模型"
                    actionText="手动填写其他模型"
                    onChange={setModelName}
                    onAction={() => setManualModelEntry(true)}
                  />
                ) : (
                  <div className="flex items-center gap-2">
                    <input
                      id="model-name"
                      value={modelName}
                      onChange={(event) => setModelName(event.target.value)}
                      placeholder="例如 gpt-4o、deepseek-chat、claude-sonnet-4"
                      className="h-12 min-w-0 flex-1 rounded-2xl border border-black/[0.08] bg-[#fbfaf7] px-4 text-sm font-medium text-slate-800 outline-none focus:border-slate-300 focus:ring-4 focus:ring-slate-200/70"
                    />
                    {availableModels.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setManualModelEntry(false)}
                        className="h-12 shrink-0 rounded-xl bg-slate-100 px-3 text-xs font-black text-slate-600 transition hover:bg-slate-200"
                      >
                        选择列表
                      </button>
                    )}
                  </div>
                )}
                {modelListResult && (
                  <p className={cn(
                    'mt-2 text-xs font-semibold leading-5',
                    modelListResult.type === 'success' ? 'text-emerald-600' : 'text-rose-600'
                  )}>
                    {modelListResult.message}
                    {modelListResult.type === 'success' && availableModels.length > 0 ? '，请从下拉列表选择。' : ''}
                  </p>
                )}
              </div>

              <div className="rounded-2xl border border-black/[0.06] bg-[#fbfaf7] p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-slate-600 shadow-sm">
                      <ImageIcon size={16} />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-black text-slate-900">图片生成模型</div>
                      <p className="mt-1 text-xs leading-5 text-slate-500">用于获得授权的空间任务，使用上方在线服务的 Base URL 和 API Key。</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setImageModelEnabled((value) => !value)}
                    title={imageModelEnabled ? '关闭图片生成模型' : '开启图片生成模型'}
                    className={cn(
                      'flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition',
                      imageModelEnabled ? 'bg-slate-950 text-white' : 'bg-white text-slate-400 shadow-sm'
                    )}
                  >
                    {imageModelEnabled ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
                  </button>
                </div>
                <div className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,1fr)_160px]">
                  <div className="block min-w-0">
                    <span className="mb-2 block text-xs font-bold text-slate-600">图片模型名称</span>
                    {availableModels.length > 0 && !manualImageModelEntry ? (
                      <SearchableSelect
                        value={imageModelName}
                        options={availableModels}
                        placeholder="请选择图片模型"
                        searchPlaceholder="搜索模型"
                        emptyText="没有匹配的模型"
                        actionText="手动填写其他模型"
                        disabled={!imageModelEnabled}
                        compact
                        onChange={setImageModelName}
                        onAction={() => setManualImageModelEntry(true)}
                      />
                    ) : (
                      <div className="flex items-center gap-2">
                        <input
                          value={imageModelName}
                          onChange={(event) => setImageModelName(event.target.value)}
                          placeholder="例如 gpt-image-1"
                          disabled={!imageModelEnabled}
                          className="h-11 min-w-0 flex-1 rounded-xl border border-black/[0.08] bg-white px-3 text-sm font-medium text-slate-800 outline-none disabled:bg-slate-100 disabled:text-slate-400"
                        />
                        {availableModels.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setManualImageModelEntry(false)}
                            disabled={!imageModelEnabled}
                            className="h-11 shrink-0 rounded-lg bg-slate-100 px-3 text-xs font-black text-slate-600 transition hover:bg-slate-200 disabled:text-slate-300"
                          >
                            选择列表
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  <label className="block">
                    <span className="mb-2 block text-xs font-bold text-slate-600">默认尺寸</span>
                    <select
                      value={imageModelSize}
                      onChange={(event) => setImageModelSize(event.target.value)}
                      disabled={!imageModelEnabled}
                      className="h-11 w-full rounded-xl border border-black/[0.08] bg-white px-3 text-sm font-bold text-slate-700 outline-none disabled:bg-slate-100 disabled:text-slate-400"
                    >
                      <option value="1024x1024">方图 1024</option>
                      <option value="1536x1024">横图 3:2</option>
                      <option value="1024x1536">竖图 2:3</option>
                    </select>
                  </label>
                </div>
                {imageModelConfigIncomplete && (
                  <p className="mt-3 text-xs font-semibold text-amber-700">开启图片生成前，请填写 Base URL、API Key 和图片模型名称。</p>
                )}
              </div>

              <label className="block">
                <span className="mb-2 block text-sm font-bold text-slate-700">上下文消息数</span>
                <input
                  value={contextMessageLimit}
                  onChange={(e) => {
                    const value = Number(e.target.value);
                    setContextMessageLimit(Math.max(1, Math.min(80, Number.isFinite(value) ? Math.floor(value) : 1)));
                  }}
                  type="number"
                  min={1}
                  max={80}
                  className="h-12 w-full rounded-2xl border border-black/[0.08] bg-[#fbfaf7] px-4 text-sm font-medium text-slate-800 outline-none focus:border-slate-300 focus:ring-4 focus:ring-slate-200/70"
                />
                <p className="mt-2 text-xs leading-5 text-slate-400">
                  每次请求最多带入最近 {contextMessageLimit} 条历史消息，最大 80 条。
                </p>
              </label>

              {modelConfigIncomplete && (
                <div className="rounded-2xl bg-amber-50 px-4 py-3 text-xs font-semibold leading-5 text-amber-700">
                  自定义模型已开启，但 Base URL、API Key、模型名称还没有填完整。
                </div>
              )}

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs leading-5 text-slate-400">
                  关闭时使用平台默认模型。开启后，聊天会在三项配置完整时使用你的模型。
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={handleTestModel}
                    disabled={!canTestModel || testing}
                    className={cn(
                      'inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-full px-4 text-sm font-black transition',
                      canTestModel && !testing
                        ? 'bg-white text-slate-800 shadow-sm ring-1 ring-black/[0.08] hover:-translate-y-0.5'
                        : 'bg-slate-100 text-slate-400'
                    )}
                  >
                    {testing ? <Loader2 className="animate-spin" size={15} /> : <PlugZap size={15} />}
                    测试连接
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveModel}
                    disabled={savingModel || !hasModelChanges}
                    className={cn(
                      'inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-full px-4 text-sm font-black transition',
                      hasModelChanges && !savingModel
                        ? 'bg-slate-950 text-white shadow-sm hover:-translate-y-0.5'
                        : 'bg-slate-100 text-slate-400'
                    )}
                  >
                    {savingModel ? (
                      <Loader2 className="animate-spin" size={15} />
                    ) : modelSaved ? (
                      <Check size={15} />
                    ) : null}
                    {savingModel ? '保存中...' : hasModelChanges ? '保存模型' : modelSaved ? '已保存' : '无需保存'}
                  </button>
                </div>
              </div>

              {testResult && (
                <div
                  className={cn(
                    'rounded-2xl px-4 py-3 text-sm font-semibold',
                    testResult.type === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-600'
                  )}
                >
                  {testResult.message}
                </div>
              )}
            </div>
          </section>

        </div>

        <aside className="space-y-6">
          <section className="rounded-[28px] border border-black/[0.06] bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
                <Palette size={18} />
              </div>
              <div>
                <h2 className="text-lg font-black text-slate-950">界面偏好</h2>
                <p className="text-sm text-slate-500">视觉和提醒方式。</p>
              </div>
            </div>
            <button className="flex w-full items-center gap-3 rounded-2xl bg-[#fbfaf7] p-4 text-left">
              <Moon size={18} className="text-slate-500" />
              <div>
                <div className="text-sm font-black text-slate-950">浅色 / 深色模式</div>
                <div className="text-xs text-slate-500">后续支持跟随系统</div>
              </div>
            </button>
          </section>

          <section className="rounded-[28px] border border-black/[0.06] bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
                <Database size={18} />
              </div>
              <div>
                <h2 className="text-lg font-black text-slate-950">数据与隐私</h2>
                <p className="text-sm text-slate-500">会话、缓存和账号数据。</p>
              </div>
            </div>
            <button className="w-full rounded-2xl bg-[#fbfaf7] p-4 text-left">
              <div className="text-sm font-black text-slate-950">导出聊天记录</div>
              <div className="mt-1 text-xs text-slate-500">后续支持 Markdown / JSON 导出。</div>
            </button>
          </section>

          <button
            onClick={handleLogout}
            className="flex w-full items-center justify-center gap-2 rounded-full border border-rose-100 bg-rose-50 px-5 py-3 text-sm font-black text-rose-600 transition hover:bg-rose-100"
          >
            <LogOut size={17} />
            退出登录
          </button>
        </aside>
      </div>
    </div>
  );
}

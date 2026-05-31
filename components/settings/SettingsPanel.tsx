'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Bot,
  Check,
  Database,
  KeyRound,
  Loader2,
  LogOut,
  Moon,
  Palette,
  PlugZap,
  ToggleLeft,
  ToggleRight,
  User,
} from 'lucide-react';
import LoginRequired from '@/components/auth/LoginRequired';
import { auth, user as userApi } from '@/lib/api';
import { cn } from '@/lib/utils';

const preferencePills = ['简洁', '详细', '轻松', '专业'];

type AccountSnapshot = {
  name: string;
};

type ModelSnapshot = {
  customModelEnabled: boolean;
  apiBaseUrl: string;
  apiKey: string;
  modelName: string;
  defaultStyle: string;
  contextMessageLimit: number;
};

export default function SettingsPanel() {
  const router = useRouter();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [customModelEnabled, setCustomModelEnabled] = useState(false);
  const [apiBaseUrl, setApiBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [modelName, setModelName] = useState('');
  const [defaultStyle, setDefaultStyle] = useState('详细');
  const [contextMessageLimit, setContextMessageLimit] = useState(40);
  const [initialAccount, setInitialAccount] = useState<AccountSnapshot | null>(null);
  const [initialModel, setInitialModel] = useState<ModelSnapshot | null>(null);

  const [loading, setLoading] = useState(true);
  const [savingAccount, setSavingAccount] = useState(false);
  const [savingModel, setSavingModel] = useState(false);
  const [accountSaved, setAccountSaved] = useState(false);
  const [modelSaved, setModelSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [error, setError] = useState('');
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
      defaultStyle,
      contextMessageLimit,
    }),
    [apiBaseUrl, apiKey, contextMessageLimit, customModelEnabled, defaultStyle, modelName]
  );
  const hasAccountChanges = initialAccount ? JSON.stringify(currentAccount) !== JSON.stringify(initialAccount) : false;
  const hasModelChanges = initialModel ? JSON.stringify(currentModel) !== JSON.stringify(initialModel) : false;
  const canTestModel = Boolean(apiBaseUrl.trim() && apiKey.trim() && modelName.trim());
  const modelConfigIncomplete = customModelEnabled && !canTestModel;

  useEffect(() => {
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
        setDefaultStyle(u.defaultStyle || '详细');
        setContextMessageLimit(u.contextMessageLimit || 40);
        setInitialAccount({ name: u.name || '' });
        setInitialModel({
          customModelEnabled: Boolean(u.customModelEnabled),
          apiBaseUrl: u.apiBaseUrl || '',
          apiKey: u.apiKey || '',
          modelName: u.modelName || '',
          defaultStyle: u.defaultStyle || '详细',
          contextMessageLimit: u.contextMessageLimit || 40,
        });
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
        defaultStyle: currentModel.defaultStyle,
        contextMessageLimit: currentModel.contextMessageLimit,
      });
      setApiBaseUrl(currentModel.apiBaseUrl);
      setApiKey(currentModel.apiKey);
      setModelName(currentModel.modelName);
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

  const handleLogout = () => {
    localStorage.removeItem('token');
    router.push('/login');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center rounded-[28px] border border-white/10 bg-[#242039] py-20 text-white/40">
        <Loader2 className="animate-spin" size={24} />
      </div>
    );
  }

  if (needsLogin) {
    return (
      <LoginRequired
        title="登录后管理设置"
        description="账号资料、模型配置、Agent 默认偏好和隐私设置都需要保存到你的账号下。"
      />
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-2xl bg-rose-500/10 px-4 py-3 text-sm font-semibold text-rose-400">{error}</div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <section className="rounded-[28px] border border-white/10 bg-[#242039] p-5 sm:p-6">
            <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#d89022]/20 text-[#d89022]">
                  <User size={18} />
                </div>
                <div>
                  <h2 className="text-xl font-black text-white">账号资料</h2>
                  <p className="text-sm text-white/54">昵称和登录状态。</p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleSaveAccount}
                disabled={savingAccount || !hasAccountChanges}
                className={cn(
                  'inline-flex h-10 w-fit items-center justify-center gap-2 rounded-full px-4 text-sm font-black transition',
                  hasAccountChanges && !savingAccount
                    ? 'bg-white text-[#19172a] shadow-sm hover:-translate-y-0.5'
                    : 'bg-white/[0.08] text-white/30'
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
                <span className="mb-2 block text-sm font-bold text-white/70">昵称</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="输入昵称"
                  className="h-12 w-full rounded-2xl border border-white/10 bg-white/[0.08] px-4 text-sm font-medium text-white outline-none focus:border-white/20 focus:ring-4 focus:ring-white/[0.06]"
                />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-bold text-white/70">邮箱</span>
                <input
                  value={email}
                  disabled
                  className="h-12 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-sm font-medium text-white/30 outline-none"
                />
              </label>
            </div>
          </section>

          <section className="rounded-[28px] border border-white/10 bg-[#242039] p-5 sm:p-6">
            <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/[0.08] text-white/70">
                  <KeyRound size={18} />
                </div>
                <div>
                  <h2 className="text-xl font-black text-white">AI 模型设置</h2>
                  <p className="text-sm text-white/54">配置 Base URL、API Key 和模型名称。</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setCustomModelEnabled((value) => !value)}
                className={cn(
                  'inline-flex w-fit items-center gap-2 rounded-full px-4 py-2 text-sm font-black transition',
                  customModelEnabled ? 'bg-white text-[#19172a] shadow-sm' : 'bg-white/[0.08] text-white/54'
                )}
              >
                {customModelEnabled ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
                {customModelEnabled ? '已启用我的模型' : '使用平台默认'}
              </button>
            </div>

            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-2 block text-sm font-bold text-white/70">API Base URL</span>
                  <input
                    value={apiBaseUrl}
                    onChange={(e) => setApiBaseUrl(e.target.value)}
                    placeholder="https://api.example.com/v1"
                    className="h-12 w-full rounded-2xl border border-white/10 bg-white/[0.08] px-4 text-sm font-medium text-white outline-none focus:border-white/20 focus:ring-4 focus:ring-white/[0.06]"
                  />
                </label>
                <label className="block">
                  <span className="mb-2 block text-sm font-bold text-white/70">API Key</span>
                  <input
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="sk-..."
                    type="password"
                    className="h-12 w-full rounded-2xl border border-white/10 bg-white/[0.08] px-4 text-sm font-medium text-white outline-none focus:border-white/20 focus:ring-4 focus:ring-white/[0.06]"
                  />
                </label>
              </div>

              <label className="block">
                <span className="mb-2 block text-sm font-bold text-white/70">模型名称</span>
                <input
                  value={modelName}
                  onChange={(e) => setModelName(e.target.value)}
                  placeholder="例如 gpt-4o、deepseek-chat、claude-sonnet-4"
                  className="h-12 w-full rounded-2xl border border-white/10 bg-white/[0.08] px-4 text-sm font-medium text-white outline-none focus:border-white/20 focus:ring-4 focus:ring-white/[0.06]"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-bold text-white/70">上下文消息数</span>
                <input
                  value={contextMessageLimit}
                  onChange={(e) => {
                    const value = Number(e.target.value);
                    setContextMessageLimit(Math.max(1, Math.min(80, Number.isFinite(value) ? Math.floor(value) : 1)));
                  }}
                  type="number"
                  min={1}
                  max={80}
                  className="h-12 w-full rounded-2xl border border-white/10 bg-white/[0.08] px-4 text-sm font-medium text-white outline-none focus:border-white/20 focus:ring-4 focus:ring-white/[0.06]"
                />
                <p className="mt-2 text-xs leading-5 text-white/40">
                  每次请求最多带入最近 {contextMessageLimit} 条历史消息，最大 80 条。
                </p>
              </label>

              {modelConfigIncomplete && (
                <div className="rounded-2xl bg-amber-500/10 px-4 py-3 text-xs font-semibold leading-5 text-amber-400">
                  自定义模型已开启，但 Base URL、API Key、模型名称还没有填完整。
                </div>
              )}

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs leading-5 text-white/40">
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
                        ? 'bg-white/[0.08] text-white/70 ring-1 ring-white/10 hover:-translate-y-0.5 hover:text-white'
                        : 'bg-white/[0.08] text-white/30'
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
                        ? 'bg-white text-[#19172a] shadow-sm hover:-translate-y-0.5'
                        : 'bg-white/[0.08] text-white/30'
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
                    testResult.type === 'success' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'
                  )}
                >
                  {testResult.message}
                </div>
              )}
            </div>
          </section>

          <section className="rounded-[28px] border border-white/10 bg-[#242039] p-5 sm:p-6">
            <div className="mb-5 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/[0.08] text-white/70">
                <Bot size={18} />
              </div>
              <div>
                <h2 className="text-xl font-black text-white">Agent 默认偏好</h2>
                <p className="text-sm text-white/54">影响创建 Agent 和默认回答方式。</p>
              </div>
            </div>

            <div>
              <div className="mb-3 text-sm font-bold text-white/70">默认回答风格</div>
              <div className="flex flex-wrap gap-2">
                {preferencePills.map((item) => (
                  <button
                    key={item}
                    onClick={() => setDefaultStyle(item)}
                    className={cn(
                      'rounded-full border px-4 py-2 text-sm font-bold transition',
                      defaultStyle === item
                        ? 'border-white bg-white text-[#19172a]'
                        : 'border-white/10 bg-white/[0.06] text-white/64 hover:bg-white/[0.10]'
                    )}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>
          </section>
        </div>

        <aside className="space-y-6">
          <section className="rounded-[28px] border border-white/10 bg-[#242039] p-5">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/[0.08] text-white/70">
                <Palette size={18} />
              </div>
              <div>
                <h2 className="text-lg font-black text-white">界面偏好</h2>
                <p className="text-sm text-white/54">视觉和提醒方式。</p>
              </div>
            </div>
            <button className="flex w-full items-center gap-3 rounded-2xl bg-white/[0.06] p-4 text-left">
              <Moon size={18} className="text-white/54" />
              <div>
                <div className="text-sm font-black text-white">深色模式</div>
                <div className="text-xs text-white/40">当前为深色主题</div>
              </div>
            </button>
          </section>

          <section className="rounded-[28px] border border-white/10 bg-[#242039] p-5">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/[0.08] text-white/70">
                <Database size={18} />
              </div>
              <div>
                <h2 className="text-lg font-black text-white">数据与隐私</h2>
                <p className="text-sm text-white/54">会话、缓存和账号数据。</p>
              </div>
            </div>
            <button className="w-full rounded-2xl bg-white/[0.06] p-4 text-left">
              <div className="text-sm font-black text-white">导出聊天记录</div>
              <div className="mt-1 text-xs text-white/40">后续支持 Markdown / JSON 导出。</div>
            </button>
          </section>

          <button
            onClick={handleLogout}
            className="flex w-full items-center justify-center gap-2 rounded-full border border-rose-500/20 bg-rose-500/10 px-5 py-3 text-sm font-black text-rose-400 transition hover:bg-rose-500/20"
          >
            <LogOut size={17} />
            退出登录
          </button>
        </aside>
      </div>
    </div>
  );
}

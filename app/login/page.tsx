'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Eye, EyeOff, Sparkles } from 'lucide-react';
import { auth } from '@/lib/api';
import { cn } from '@/lib/utils';

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const isRegister = mode === 'register';
  const canSubmit = email.trim() && password.length >= 6 && (!isRegister || name.trim());

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit || loading) return;

    setError('');
    setLoading(true);
    try {
      const result = isRegister
        ? await auth.register({ email: email.trim(), password, name: name.trim() })
        : await auth.login({ email: email.trim(), password });

      localStorage.setItem('token', result.token);
      router.push('/');
    } catch (err: any) {
      setError(err.message || '操作失败，请稍后再试。');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#fbfaf7] px-4 py-6 text-slate-950">
      <div className="mx-auto flex min-h-[calc(100vh-48px)] max-w-6xl flex-col">
        <Link
          href="/"
          className="mb-6 inline-flex w-fit items-center gap-2 rounded-full border border-black/[0.06] bg-white px-4 py-2 text-sm font-bold text-slate-600 shadow-sm hover:text-slate-950"
        >
          <ArrowLeft size={16} />
          返回首页
        </Link>

        <div className="grid flex-1 overflow-hidden rounded-[36px] border border-black/[0.06] bg-white shadow-sm lg:grid-cols-[1.02fr_0.98fr]">
          <section className="relative hidden bg-[linear-gradient(135deg,#fff7ed,#eef2ff_48%,#ecfdf5)] p-10 lg:block">
            <div className="absolute inset-8 rounded-[32px] border border-white/60 bg-white/35 backdrop-blur-sm" />
            <div className="relative flex h-full flex-col justify-between">
              <div>
                <div className="mb-8 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-950 text-white">
                  <Sparkles size={22} />
                </div>
                <h1 className="max-w-lg text-5xl font-black leading-tight text-slate-950">
                  登录后，把你的 Agent 和对话都留住。
                </h1>
                <p className="mt-5 max-w-md text-base leading-8 text-slate-600">
                  保存历史会话、创建自己的 Agent，并在不同设备继续上次没聊完的想法。
                </p>
              </div>

              <div className="grid gap-3">
                {['保存 Agent 会话历史', '创建和管理自定义 Agent', '同步默认模型和偏好'].map((item) => (
                  <div key={item} className="rounded-2xl bg-white/75 px-4 py-3 text-sm font-bold text-slate-700 shadow-sm">
                    {item}
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="flex items-center justify-center p-6 sm:p-10">
            <div className="w-full max-w-md">
              <div className="mb-8">
                <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2 text-sm font-bold text-white">
                  <Sparkles size={15} />
                  AlmarenChat
                </div>
                <h2 className="text-3xl font-black text-slate-950">
                  {isRegister ? '创建你的账号' : '欢迎回来'}
                </h2>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  {isRegister ? '注册后即可创建 Agent 并保存对话。' : '登录后继续你的 Agent 对话空间。'}
                </p>
              </div>

              <div className="mb-5 grid grid-cols-2 rounded-full bg-[#fbfaf7] p-1">
                {[
                  ['login', '登录'],
                  ['register', '注册'],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => {
                      setMode(value as 'login' | 'register');
                      setError('');
                    }}
                    className={cn(
                      'rounded-full px-4 py-2 text-sm font-bold transition',
                      mode === value ? 'bg-slate-950 text-white shadow-sm' : 'text-slate-500'
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                {isRegister && (
                  <label className="block">
                    <span className="mb-2 block text-sm font-bold text-slate-700">昵称</span>
                    <input
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      placeholder="你希望别人怎么称呼你？"
                      className="h-12 w-full rounded-2xl border border-black/[0.08] bg-[#fbfaf7] px-4 text-sm font-medium outline-none transition placeholder:text-slate-400 focus:border-slate-300 focus:ring-4 focus:ring-slate-200/70"
                    />
                  </label>
                )}

                <label className="block">
                  <span className="mb-2 block text-sm font-bold text-slate-700">邮箱</span>
                  <input
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="name@example.com"
                    className="h-12 w-full rounded-2xl border border-black/[0.08] bg-[#fbfaf7] px-4 text-sm font-medium outline-none transition placeholder:text-slate-400 focus:border-slate-300 focus:ring-4 focus:ring-slate-200/70"
                  />
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm font-bold text-slate-700">密码</span>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder="至少 6 位"
                      className="h-12 w-full rounded-2xl border border-black/[0.08] bg-[#fbfaf7] px-4 pr-12 text-sm font-medium outline-none transition placeholder:text-slate-400 focus:border-slate-300 focus:ring-4 focus:ring-slate-200/70"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((value) => !value)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-2 text-slate-400 hover:bg-white hover:text-slate-700"
                      aria-label={showPassword ? '隐藏密码' : '显示密码'}
                    >
                      {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                    </button>
                  </div>
                </label>

                {error && (
                  <div className="rounded-2xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-600">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={!canSubmit || loading}
                  className={cn(
                    'flex h-12 w-full items-center justify-center rounded-full text-sm font-black transition',
                    canSubmit && !loading
                      ? 'bg-slate-950 text-white shadow-sm hover:-translate-y-0.5 hover:shadow-lg'
                      : 'bg-slate-100 text-slate-400'
                  )}
                >
                  {loading ? '处理中...' : isRegister ? '注册并进入' : '登录'}
                </button>
              </form>

              <p className="mt-5 text-center text-xs leading-5 text-slate-400">
                继续即代表你同意在本地保存登录状态。后续可补充服务条款和隐私政策。
              </p>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import {
  ArrowLeft,
  Bot,
  Eye,
  EyeOff,
  MessageCircle,
  Sparkles,
  Wand2,
} from 'lucide-react';
import { auth } from '@/lib/api';
import { cn } from '@/lib/utils';

type AuthMode = 'login' | 'register';
type ActiveField = 'name' | 'email' | 'password' | null;

const studioAgents = [
  {
    key: 'name',
    name: '灵感搭档',
    avatar: '✨',
    role: '内容和创意',
    color: '#f59e0b',
    note: '把零散想法整理成可发布内容',
    signal: 64,
  },
  {
    key: 'email',
    name: '代码教练',
    avatar: '⌘',
    role: '代码和方案',
    color: '#2563eb',
    note: '帮你拆问题、看结构、找路径',
    signal: 78,
  },
  {
    key: 'password',
    name: '学习向导',
    avatar: '∴',
    role: '知识和练习',
    color: '#10b981',
    note: '用例子、追问和复盘讲清楚',
    signal: 88,
  },
];

const studioStats = ['会话记忆', '私有维护', '发布广场'];

function AgentStudioStage({
  activeField,
  showPassword,
  passwordLength,
  mode,
}: {
  activeField: ActiveField;
  showPassword: boolean;
  passwordLength: number;
  mode: AuthMode;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const railRefs = useRef<Array<HTMLDivElement | null>>([]);
  const signalRefs = useRef<Array<HTMLDivElement | null>>([]);
  const bubbleRefs = useRef<Array<HTMLDivElement | null>>([]);

  useGSAP(
    () => {
      gsap.from('.studio-panel', {
        y: 18,
        opacity: 0,
        duration: 0.7,
        stagger: 0.08,
        ease: 'power3.out',
      });
      gsap.from('.studio-bubble', {
        x: -18,
        opacity: 0,
        duration: 0.55,
        stagger: 0.1,
        delay: 0.2,
        ease: 'power3.out',
      });
    },
    { scope: stageRef }
  );

  useEffect(() => {
    const tweens = signalRefs.current.flatMap((node, index) => {
      if (!node) return [];
      return [
        gsap.to(node, {
          scaleX: 0.78 + index * 0.08,
          transformOrigin: 'left center',
          duration: 1.8 + index * 0.25,
          repeat: -1,
          yoyo: true,
          ease: 'sine.inOut',
        }),
      ];
    });

    return () => tweens.forEach((tween) => tween.kill());
  }, []);

  useEffect(() => {
    const passwordHidden = activeField === 'password' && passwordLength > 0 && !showPassword;

    gsap.to(previewRef.current, {
      scale: activeField ? 1.012 : 1,
      y: activeField ? -2 : 0,
      duration: 0.35,
      ease: 'power2.out',
    });

    railRefs.current.forEach((node, index) => {
      if (!node) return;
      const isActive = studioAgents[index].key === activeField;
      gsap.to(node, {
        x: isActive ? 8 : 0,
        scale: isActive ? 1.025 : 1,
        boxShadow: isActive
          ? '0 18px 44px rgba(15, 23, 42, 0.14)'
          : '0 10px 24px rgba(15, 23, 42, 0.08)',
        duration: 0.28,
        ease: 'power2.out',
      });
    });

    gsap.to(bubbleRefs.current, {
      opacity: passwordHidden ? 0.78 : 1,
      duration: 0.25,
      stagger: 0.03,
      ease: 'power2.out',
    });
  }, [activeField, passwordLength, showPassword]);

  return (
    <div ref={stageRef} className="relative hidden min-h-[640px] overflow-hidden bg-[#f8f6f0] p-10 lg:block">
      <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(255,247,237,0.9),rgba(248,250,252,0.96)_44%,rgba(236,253,245,0.75))]" />
      <div className="absolute inset-x-10 top-10 h-px bg-black/[0.05]" />
      <div className="absolute bottom-10 left-10 right-10 h-px bg-black/[0.05]" />

      <div className="relative z-10 flex h-full flex-col justify-between">
        <div>
          <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-black/[0.06] bg-white/82 px-4 py-2 text-sm font-bold text-slate-700 shadow-sm backdrop-blur">
            <Sparkles size={16} className="text-amber-500" />
            Almaren Agent Studio
          </div>
          <h1 className="max-w-xl text-5xl font-black leading-tight text-slate-950">
            回到你的 Agent 工作台。
          </h1>
          <p className="mt-5 max-w-md text-base leading-8 text-slate-600">
            登录后继续对话、维护自定义 Agent，并把成熟角色发布到广场。
          </p>
        </div>

        <div className="grid min-h-[390px] grid-cols-[190px_minmax(0,1fr)] gap-5">
          <div className="space-y-3 self-center">
            {studioAgents.map((agent, index) => {
              const isActive = agent.key === activeField;
              return (
                <div
                  key={agent.name}
                  ref={(node) => {
                    railRefs.current[index] = node;
                  }}
                  className={cn(
                    'studio-panel rounded-[26px] border bg-white/86 p-4 shadow-lg backdrop-blur transition-colors',
                    isActive ? 'border-slate-950/[0.12]' : 'border-white/80'
                  )}
                >
                  <div className="mb-3 flex items-center gap-3">
                    <div
                      className="flex h-11 w-11 items-center justify-center rounded-2xl text-xl font-black text-white shadow-sm"
                      style={{ backgroundColor: agent.color }}
                    >
                      {agent.avatar}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-black text-slate-950">{agent.name}</div>
                      <div className="truncate text-xs font-bold text-slate-400">{agent.role}</div>
                    </div>
                  </div>
                  <p className="text-xs leading-5 text-slate-500">{agent.note}</p>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div
                      ref={(node) => {
                        signalRefs.current[index] = node;
                      }}
                      className="h-full rounded-full"
                      style={{ width: `${agent.signal}%`, backgroundColor: agent.color }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <div
            ref={previewRef}
            className="studio-panel relative self-center overflow-hidden rounded-[34px] border border-white/80 bg-white/88 p-5 shadow-2xl backdrop-blur"
          >
            <div className="mb-5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-3xl bg-slate-950 text-white">
                  {mode === 'register' ? <Wand2 size={22} /> : <MessageCircle size={22} />}
                </div>
                <div>
                  <div className="text-base font-black text-slate-950">
                    {mode === 'register' ? '新 Agent 身份草稿' : '最近的 Agent 会话'}
                  </div>
                  <div className="text-xs font-bold text-slate-400">
                    {activeField === 'password' ? '登录信息已隐藏' : '准备继续'}
                  </div>
                </div>
              </div>
              <div className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700">
                Ready
              </div>
            </div>

            <div className="space-y-3">
              {[
                ['灵感搭档', '我已经记住你上次整理到一半的选题。'],
                ['你', '登录后继续，把它改成可发布的版本。'],
                ['代码教练', '也可以顺手检查一下当前项目结构。'],
              ].map(([speaker, text], index) => (
                <div
                  key={`${speaker}-${text}`}
                  ref={(node) => {
                    bubbleRefs.current[index] = node;
                  }}
                  className={cn(
                    'studio-bubble rounded-2xl px-4 py-3 shadow-sm',
                    speaker === '你' ? 'ml-10 bg-slate-950 text-white' : 'mr-8 bg-[#fbfaf7] text-slate-700'
                  )}
                >
                  <div className={cn('mb-1 text-[10px] font-black', speaker === '你' ? 'text-white/50' : 'text-slate-400')}>
                    {speaker}
                  </div>
                  <div className="text-sm font-semibold leading-6">{text}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          {studioStats.map((item) => (
            <div key={item} className="rounded-2xl bg-white/75 px-4 py-3 text-center text-sm font-black text-slate-700 shadow-sm">
              {item}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>('login');
  const [activeField, setActiveField] = useState<ActiveField>(null);
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
      router.push(!isRegister && result.user.isAdmin ? '/admin' : '/me');
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

        <div className="grid flex-1 overflow-hidden rounded-[36px] border border-black/[0.06] bg-white shadow-sm lg:grid-cols-[1.08fr_0.92fr]">
          <AgentStudioStage
            activeField={activeField}
            showPassword={showPassword}
            passwordLength={password.length}
            mode={mode}
          />

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
                  {isRegister ? '注册后开始塑造你的第一个 Agent。' : '登录后继续你的 Agent 对话空间。'}
                </p>
              </div>
              {/* 先不用注册  */}
              {<div className="mb-5 grid grid-cols-2 rounded-full bg-[#fbfaf7] p-1">
                {[
                  ['login', '登录'],
                  ['register', '注册'],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => {
                      setMode(value as AuthMode);
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
              </div>}

              <form onSubmit={handleSubmit} className="space-y-4">
                {isRegister && (
                  <label className="block">
                    <span className="mb-2 block text-sm font-bold text-slate-700">昵称</span>
                    <input
                      value={name}
                      onFocus={() => setActiveField('name')}
                      onBlur={() => setActiveField(null)}
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
                    onFocus={() => setActiveField('email')}
                    onBlur={() => setActiveField(null)}
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
                      onFocus={() => setActiveField('password')}
                      onBlur={() => setActiveField(null)}
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
                    'flex h-12 w-full items-center justify-center gap-2 rounded-full text-sm font-black transition',
                    canSubmit && !loading
                      ? 'bg-slate-950 text-white shadow-sm hover:-translate-y-0.5 hover:shadow-lg'
                      : 'bg-slate-100 text-slate-400'
                  )}
                >
                  {loading ? (
                    '处理中...'
                  ) : isRegister ? (
                    <>
                      <Wand2 size={16} />
                      注册并进入
                    </>
                  ) : (
                    <>
                      <Bot size={16} />
                      登录
                    </>
                  )}
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

'use client';

import { Bell, Bot, Database, KeyRound, LogOut, Moon, Palette, Shield, User } from 'lucide-react';
import AppShell from '@/components/layout/AppShell';

const preferencePills = ['简洁', '详细', '轻松', '专业'];
const modelOptions = ['平台默认', 'GPT-4o', 'Claude Sonnet', 'Gemini Flash'];

export default function SettingsPage() {
  return (
    <AppShell>
      <div className="space-y-8 py-8">
        <section className="rounded-[32px] border border-black/[0.06] bg-white/82 p-6 shadow-sm backdrop-blur sm:p-8">
          <div className="max-w-3xl">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2 text-sm font-bold text-white">
              <Shield size={16} />
              设置中心
            </div>
            <h1 className="text-4xl font-black leading-tight text-slate-950 sm:text-5xl">
              管理你的账号、模型和 Agent 偏好。
            </h1>
            <p className="mt-4 text-base leading-7 text-slate-500">
              这里会逐步承载个人资料、默认模型、Agent 创建偏好、数据和隐私设置。
            </p>
          </div>
        </section>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-6">
            <section className="rounded-[28px] border border-black/[0.06] bg-white p-5 shadow-sm sm:p-6">
              <div className="mb-5 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-950 text-white">
                  <User size={18} />
                </div>
                <div>
                  <h2 className="text-xl font-black text-slate-950">账号资料</h2>
                  <p className="text-sm text-slate-500">昵称、头像和登录状态。</p>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-2 block text-sm font-bold text-slate-700">昵称</span>
                  <input
                    placeholder="未登录用户"
                    className="h-12 w-full rounded-2xl border border-black/[0.08] bg-[#fbfaf7] px-4 text-sm font-medium outline-none focus:border-slate-300 focus:ring-4 focus:ring-slate-200/70"
                  />
                </label>
                <label className="block">
                  <span className="mb-2 block text-sm font-bold text-slate-700">邮箱</span>
                  <input
                    placeholder="name@example.com"
                    className="h-12 w-full rounded-2xl border border-black/[0.08] bg-[#fbfaf7] px-4 text-sm font-medium outline-none focus:border-slate-300 focus:ring-4 focus:ring-slate-200/70"
                  />
                </label>
              </div>
            </section>

            <section className="rounded-[28px] border border-black/[0.06] bg-white p-5 shadow-sm sm:p-6">
              <div className="mb-5 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
                  <KeyRound size={18} />
                </div>
                <div>
                  <h2 className="text-xl font-black text-slate-950">AI 模型设置</h2>
                  <p className="text-sm text-slate-500">后续可以配置默认模型和自定义 API。</p>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <div className="mb-3 text-sm font-bold text-slate-700">默认模型</div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {modelOptions.map((model, index) => (
                      <button
                        key={model}
                        className={`rounded-2xl border p-4 text-left transition ${
                          index === 0
                            ? 'border-slate-950 bg-slate-950 text-white'
                            : 'border-black/[0.06] bg-[#fbfaf7] text-slate-700 hover:bg-white'
                        }`}
                      >
                        <div className="text-sm font-black">{model}</div>
                        <div className={`mt-1 text-xs ${index === 0 ? 'text-white/60' : 'text-slate-500'}`}>
                          {index === 0 ? '优先使用平台推荐配置' : '可作为创建 Agent 时的默认模型'}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-2 block text-sm font-bold text-slate-700">API Base URL</span>
                    <input
                      placeholder="https://api.example.com/v1"
                      className="h-12 w-full rounded-2xl border border-black/[0.08] bg-[#fbfaf7] px-4 text-sm font-medium outline-none focus:border-slate-300 focus:ring-4 focus:ring-slate-200/70"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-sm font-bold text-slate-700">API Key</span>
                    <input
                      placeholder="sk-..."
                      type="password"
                      className="h-12 w-full rounded-2xl border border-black/[0.08] bg-[#fbfaf7] px-4 text-sm font-medium outline-none focus:border-slate-300 focus:ring-4 focus:ring-slate-200/70"
                    />
                  </label>
                </div>
              </div>
            </section>

            <section className="rounded-[28px] border border-black/[0.06] bg-white p-5 shadow-sm sm:p-6">
              <div className="mb-5 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
                  <Bot size={18} />
                </div>
                <div>
                  <h2 className="text-xl font-black text-slate-950">Agent 默认偏好</h2>
                  <p className="text-sm text-slate-500">影响创建 Agent 和默认回答方式。</p>
                </div>
              </div>

              <div className="space-y-5">
                <div>
                  <div className="mb-3 text-sm font-bold text-slate-700">默认回答风格</div>
                  <div className="flex flex-wrap gap-2">
                    {preferencePills.map((item, index) => (
                      <button
                        key={item}
                        className={`rounded-full border px-4 py-2 text-sm font-bold transition ${
                          index === 1
                            ? 'border-slate-950 bg-slate-950 text-white'
                            : 'border-black/[0.06] bg-[#fbfaf7] text-slate-600 hover:bg-white'
                        }`}
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl bg-[#fbfaf7] p-4">
                    <div className="text-sm font-black text-slate-950">新 Agent 默认公开</div>
                    <p className="mt-1 text-xs leading-5 text-slate-500">创建后是否出现在 Agent 广场，后续可编辑。</p>
                  </div>
                  <div className="rounded-2xl bg-[#fbfaf7] p-4">
                    <div className="text-sm font-black text-slate-950">保留上下文</div>
                    <p className="mt-1 text-xs leading-5 text-slate-500">让 Agent 延续历史对话，后续接真实设置。</p>
                  </div>
                </div>
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
              <div className="space-y-3">
                {[
                  { icon: Moon, title: '浅色 / 深色模式', desc: '后续支持跟随系统' },
                  { icon: Bell, title: '通知提醒', desc: '新回复、长任务完成提醒' },
                ].map((item) => {
                  const Icon = item.icon;
                  return (
                    <button key={item.title} className="flex w-full items-center gap-3 rounded-2xl bg-[#fbfaf7] p-4 text-left">
                      <Icon size={18} className="text-slate-500" />
                      <div>
                        <div className="text-sm font-black text-slate-950">{item.title}</div>
                        <div className="text-xs text-slate-500">{item.desc}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
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
              <div className="space-y-3">
                <button className="w-full rounded-2xl bg-[#fbfaf7] p-4 text-left">
                  <div className="text-sm font-black text-slate-950">导出聊天记录</div>
                  <div className="mt-1 text-xs text-slate-500">后续支持 Markdown / JSON 导出。</div>
                </button>
                <button className="w-full rounded-2xl bg-[#fbfaf7] p-4 text-left">
                  <div className="text-sm font-black text-slate-950">清空本地缓存</div>
                  <div className="mt-1 text-xs text-slate-500">清理本机保存的最近 Agent 和临时数据。</div>
                </button>
              </div>
            </section>

            <button className="flex w-full items-center justify-center gap-2 rounded-full border border-rose-100 bg-rose-50 px-5 py-3 text-sm font-black text-rose-600 transition hover:bg-rose-100">
              <LogOut size={17} />
              退出登录
            </button>
          </aside>
        </div>
      </div>
    </AppShell>
  );
}

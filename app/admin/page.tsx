'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Bot, Eye, EyeOff, Search, Trash2, Users, MessageCircle, UserRound, Settings2 } from 'lucide-react';
import { admin as adminApi } from '@/lib/api';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import LoadingSpinner from '@/components/shared/LoadingSpinner';

function formatDate(value?: string) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export default function AdminPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dashboard, setDashboard] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [agents, setAgents] = useState<any[]>([]);
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [userQuery, setUserQuery] = useState('');
  const [agentQuery, setAgentQuery] = useState('');
  const [busyAgentId, setBusyAgentId] = useState('');
  const [resetPassword, setResetPassword] = useState('');
  const [resetMessage, setResetMessage] = useState('');
  const [resettingPassword, setResettingPassword] = useState(false);
  const [dailyChatLimit, setDailyChatLimit] = useState('');
  const [quotaMessage, setQuotaMessage] = useState('');
  const [savingQuota, setSavingQuota] = useState(false);
  const [activeTab, setActiveTab] = useState<'users' | 'agents'>('users');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserName, setNewUserName] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [newUserDailyLimit, setNewUserDailyLimit] = useState('');
  const [createUserMessage, setCreateUserMessage] = useState('');
  const [creatingUser, setCreatingUser] = useState(false);
  const [pendingDeleteUser, setPendingDeleteUser] = useState<any>(null);
  const [deletingUser, setDeletingUser] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem('token')) {
      router.push('/login');
      return;
    }

    Promise.all([
      adminApi.dashboard(),
      adminApi.users(),
      adminApi.agents(),
    ])
      .then(([dashboardData, usersData, agentsData]) => {
        setDashboard(dashboardData);
        setUsers(usersData.users);
        setAgents(agentsData.agents);
      })
      .catch((e: Error) => {
        if (e.message === 'Forbidden') {
          router.replace('/me');
          return;
        }
        setError(e.message);
      })
      .finally(() => setLoading(false));
  }, [router]);

  const stats = useMemo(() => {
    if (!dashboard) return [];
    return [
      { label: '用户数', value: dashboard.stats.userCount, icon: Users },
      { label: 'Agent 数', value: dashboard.stats.agentCount, icon: Bot },
      { label: '会话数', value: dashboard.stats.conversationCount, icon: MessageCircle },
      { label: '今日新增用户', value: dashboard.stats.todayUserCount, icon: UserRound },
      { label: '今日新增会话', value: dashboard.stats.todayConversationCount, icon: MessageCircle },
    ];
  }, [dashboard]);

  const searchUsers = async () => {
    const result = await adminApi.users(userQuery);
    setUsers(result.users);
  };

  const searchAgents = async () => {
    const result = await adminApi.agents(agentQuery);
    setAgents(result.agents);
  };

  const openUser = async (id: string) => {
    const result = await adminApi.user(id);
    setSelectedUser(result.user);
    setResetPassword('');
    setResetMessage('');
    setDailyChatLimit(result.user.dailyChatLimit?.toString() || '');
    setQuotaMessage('');
  };

  const submitPasswordReset = async () => {
    if (!selectedUser || resetPassword.length < 6 || resettingPassword) return;

    setResetMessage('');
    setResettingPassword(true);
    try {
      await adminApi.resetUserPassword(selectedUser.id, resetPassword);
      setResetPassword('');
      setResetMessage('密码已重置');
    } catch (e: any) {
      setResetMessage(e.message || '重置失败');
    } finally {
      setResettingPassword(false);
    }
  };

  const submitDailyChatLimit = async () => {
    if (!selectedUser || savingQuota) return;

    const trimmed = dailyChatLimit.trim();
    const nextLimit = trimmed === '' ? null : Number(trimmed);
    if (nextLimit !== null && (!Number.isFinite(nextLimit) || nextLimit < 0 || nextLimit > 10000)) {
      setQuotaMessage('每日额度需要在 0-10000 之间，留空使用默认 30。');
      return;
    }

    setQuotaMessage('');
    setSavingQuota(true);
    try {
      await adminApi.updateUser(selectedUser.id, { dailyChatLimit: nextLimit === null ? null : Math.floor(nextLimit) });
      setSelectedUser((user: any) => (user ? { ...user, dailyChatLimit: nextLimit === null ? null : Math.floor(nextLimit) } : user));
      setUsers((items) =>
        items.map((user) =>
          user.id === selectedUser.id ? { ...user, dailyChatLimit: nextLimit === null ? null : Math.floor(nextLimit) } : user
        )
      );
      setQuotaMessage('每日额度已保存');
    } catch (e: any) {
      setQuotaMessage(e.message || '保存失败');
    } finally {
      setSavingQuota(false);
    }
  };

  const submitCreateUser = async () => {
    if (creatingUser) return;

    const email = newUserEmail.trim();
    const name = newUserName.trim();
    const password = newUserPassword;
    const limitText = newUserDailyLimit.trim();
    const dailyLimit = limitText === '' ? null : Number(limitText);

    if (!email || !name || password.length < 6) {
      setCreateUserMessage('Email, name and at least 6 characters password are required.');
      return;
    }

    if (dailyLimit !== null && (!Number.isFinite(dailyLimit) || dailyLimit < 0 || dailyLimit > 10000)) {
      setCreateUserMessage('Daily chat limit must be between 0 and 10000.');
      return;
    }

    setCreateUserMessage('');
    setCreatingUser(true);
    try {
      const result = await adminApi.createUser({
        email,
        name,
        password,
        dailyChatLimit: dailyLimit === null ? null : Math.floor(dailyLimit),
      });
      const detail = await adminApi.user(result.user.id);
      setUsers((items) => [result.user, ...items]);
      setSelectedUser(detail.user);
      setDailyChatLimit(result.user.dailyChatLimit?.toString() || '');
      setNewUserEmail('');
      setNewUserName('');
      setNewUserPassword('');
      setNewUserDailyLimit('');
      setCreateUserMessage('User created.');
    } catch (e: any) {
      setCreateUserMessage(e.message || 'Create user failed.');
    } finally {
      setCreatingUser(false);
    }
  };

  const toggleAgent = async (agent: any) => {
    setBusyAgentId(agent.id);
    try {
      const result = await adminApi.updateAgent(agent.id, { isPublic: !agent.isPublic });
      setAgents((items) => items.map((item) => (item.id === agent.id ? result.agent : item)));
    } finally {
      setBusyAgentId('');
    }
  };

  const deleteAgent = async (agent: any) => {
    if (!confirm(`确定删除 Agent「${agent.name}」吗？`)) return;
    setBusyAgentId(agent.id);
    try {
      await adminApi.deleteAgent(agent.id);
      setAgents((items) => items.filter((item) => item.id !== agent.id));
    } finally {
      setBusyAgentId('');
    }
  };

  const deleteUser = async () => {
    if (!pendingDeleteUser || deletingUser) return;

    setDeletingUser(true);
    try {
      await adminApi.deleteUser(pendingDeleteUser.id);
      setUsers((items) => items.filter((user) => user.id !== pendingDeleteUser.id));
      if (selectedUser?.id === pendingDeleteUser.id) {
        setSelectedUser(null);
        setResetPassword('');
        setResetMessage('');
        setDailyChatLimit('');
        setQuotaMessage('');
      }
      setPendingDeleteUser(null);
    } finally {
      setDeletingUser(false);
    }
  };

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#fbfaf7]">
        <LoadingSpinner size="lg" />
      </main>
    );
  }

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#fbfaf7] px-4">
        <div className="rounded-2xl border border-red-100 bg-white p-8 text-center shadow-sm">
          <h1 className="text-xl font-black text-slate-950">无权访问后台</h1>
          <p className="mt-2 text-sm text-slate-500">{error}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#fbfaf7] px-4 py-6 text-slate-950 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-col gap-3 border-b border-black/[0.06] pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-bold text-slate-400">Admin</p>
            <Link href="/" className="text-3xl font-black hover:text-blue-600 transition-colors">AlmarenChat</Link>
          </div>
          <div className="text-sm font-semibold text-slate-500">
            {dashboard.admin.email}
          </div>
        </header>

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {stats.map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.label} className="rounded-2xl border border-black/[0.06] bg-white p-5 shadow-sm">
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-slate-950 text-white">
                  <Icon size={18} />
                </div>
                <div className="text-3xl font-black">{item.value}</div>
                <div className="mt-1 text-sm font-semibold text-slate-500">{item.label}</div>
              </div>
            );
          })}
        </section>

        <div className="inline-flex rounded-full border border-black/[0.06] bg-white p-1 shadow-sm">
          <button
            type="button"
            onClick={() => setActiveTab('users')}
            className={`rounded-full px-5 py-2 text-sm font-black transition ${
              activeTab === 'users' ? 'bg-slate-950 text-white' : 'text-slate-500 hover:text-slate-950'
            }`}
          >
            Users
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('agents')}
            className={`rounded-full px-5 py-2 text-sm font-black transition ${
              activeTab === 'agents' ? 'bg-slate-950 text-white' : 'text-slate-500 hover:text-slate-950'
            }`}
          >
            Agents
          </button>
        </div>

        <section className="space-y-6">
          {activeTab === 'users' && (
          <div className="space-y-6">
            <div className="rounded-2xl border border-black/[0.06] bg-white p-5 shadow-sm">
              <h2 className="mb-4 text-lg font-black">Create user</h2>
              <div className="flex flex-wrap items-center gap-3">
                <input value={newUserEmail} onChange={(event) => setNewUserEmail(event.target.value)} placeholder="Email" className="h-11 min-w-[180px] flex-1 rounded-full border border-black/[0.08] bg-[#fbfaf7] px-4 text-sm outline-none focus:border-slate-300" />
                <input value={newUserName} onChange={(event) => setNewUserName(event.target.value)} placeholder="Name" className="h-11 min-w-[120px] flex-1 rounded-full border border-black/[0.08] bg-[#fbfaf7] px-4 text-sm outline-none focus:border-slate-300" />
                <input type="password" value={newUserPassword} onChange={(event) => setNewUserPassword(event.target.value)} placeholder="Password" className="h-11 min-w-[150px] flex-1 rounded-full border border-black/[0.08] bg-[#fbfaf7] px-4 text-sm outline-none focus:border-slate-300" />
                <input type="number" min={0} max={10000} value={newUserDailyLimit} onChange={(event) => setNewUserDailyLimit(event.target.value)} placeholder="Limit" className="h-11 w-[100px] rounded-full border border-black/[0.08] bg-[#fbfaf7] px-4 text-sm outline-none focus:border-slate-300" />
                <button type="button" onClick={submitCreateUser} disabled={creatingUser} className="h-11 rounded-full bg-slate-950 px-6 text-sm font-bold text-white disabled:bg-slate-200 disabled:text-slate-400">
                  {creatingUser ? 'Creating...' : 'Create'}
                </button>
              </div>
              {createUserMessage && <div className="mt-2 text-xs font-semibold text-slate-500">{createUserMessage}</div>}
            </div>

            <div className="rounded-2xl border border-black/[0.06] bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="text-lg font-black">用户列表</h2>
                <div className="flex min-w-0 items-center gap-2">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                    <input
                      value={userQuery}
                      onChange={(event) => setUserQuery(event.target.value)}
                      onKeyDown={(event) => event.key === 'Enter' && searchUsers()}
                      placeholder="搜索邮箱/昵称"
                      className="h-10 w-44 rounded-full border border-black/[0.08] bg-[#fbfaf7] pl-9 pr-3 text-sm outline-none focus:border-slate-300"
                    />
                  </div>
                  <button onClick={searchUsers} className="h-10 rounded-full bg-slate-950 px-4 text-sm font-bold text-white">
                    搜索
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                {users.map((user) => (
                  <button
                    key={user.id}
                    onClick={() => openUser(user.id)}
                    className="w-full rounded-xl border border-black/[0.05] p-4 text-left transition hover:bg-slate-50"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-black">{user.name}</div>
                        <div className="truncate text-xs text-slate-500">{user.email}</div>
                      </div>
                      <div className="shrink-0 text-right text-xs font-semibold text-slate-500">
                        <div>Agent {user._count.agents}</div>
                        <div>会话 {user._count.conversations}</div>
                      </div>
                    </div>
                    <div className="mt-2 text-xs text-slate-400">{formatDate(user.createdAt)}</div>
                  </button>
                ))}
              </div>
            </div>

            {selectedUser && (
              <div className="rounded-2xl border border-black/[0.06] bg-white p-5 shadow-sm">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <h2 className="text-lg font-black">用户详情</h2>
                  <button
                    type="button"
                    onClick={() => setPendingDeleteUser(selectedUser)}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-red-100 text-red-500 transition hover:bg-red-50"
                    title="Delete user"
                    aria-label="Delete user"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="font-black">{selectedUser.name}</div>
                  <div className="text-slate-500">{selectedUser.email}</div>
                  <div className="text-slate-500">创建时间：{formatDate(selectedUser.createdAt)}</div>
                  <div className="flex items-center gap-2 text-slate-500">
                    <Settings2 size={15} />
                    模型配置：{selectedUser.customModelEnabled ? '已开启' : '未开启'}
                  </div>
                  <div className="text-slate-500">模型：{selectedUser.modelName || '-'}</div>
                  <div className="text-slate-500">上下文消息数：{selectedUser.contextMessageLimit || 40}</div>
                  <div className="text-slate-500">Daily chat limit: {selectedUser.dailyChatLimit ?? 30}</div>
                </div>

                <div className="mt-5 rounded-xl bg-[#fbfaf7] p-3">
                  <h3 className="mb-2 text-sm font-black">Daily chat limit</h3>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      min={0}
                      max={10000}
                      value={dailyChatLimit}
                      onChange={(event) => setDailyChatLimit(event.target.value)}
                      placeholder="Default 30"
                      className="h-10 min-w-0 flex-1 rounded-full border border-black/[0.08] bg-white px-4 text-sm outline-none focus:border-slate-300"
                    />
                    <button
                      type="button"
                      onClick={submitDailyChatLimit}
                      disabled={savingQuota}
                      className="h-10 rounded-full bg-slate-950 px-4 text-sm font-bold text-white disabled:bg-slate-200 disabled:text-slate-400"
                    >
                      {savingQuota ? 'Saving' : 'Save'}
                    </button>
                  </div>
                  <p className="mt-2 text-xs font-semibold text-slate-400">0 disables platform-model chat. Leave empty to use default 30.</p>
                  {quotaMessage && <div className="mt-2 text-xs font-semibold text-slate-500">{quotaMessage}</div>}
                </div>
                <div className="mt-5 rounded-xl bg-[#fbfaf7] p-3">
                  <h3 className="mb-2 text-sm font-black">重置密码</h3>
                  <div className="flex gap-2">
                    <input
                      type="password"
                      value={resetPassword}
                      onChange={(event) => setResetPassword(event.target.value)}
                      placeholder="至少 6 位新密码"
                      className="h-10 min-w-0 flex-1 rounded-full border border-black/[0.08] bg-white px-4 text-sm outline-none focus:border-slate-300"
                    />
                    <button
                      type="button"
                      onClick={submitPasswordReset}
                      disabled={resetPassword.length < 6 || resettingPassword}
                      className="h-10 rounded-full bg-slate-950 px-4 text-sm font-bold text-white disabled:bg-slate-200 disabled:text-slate-400"
                    >
                      {resettingPassword ? '处理中' : '重置'}
                    </button>
                  </div>
                  {resetMessage && <div className="mt-2 text-xs font-semibold text-slate-500">{resetMessage}</div>}
                </div>

                <div className="mt-5">
                  <h3 className="mb-2 text-sm font-black">创建的 Agent</h3>
                  <div className="space-y-2">
                    {(selectedUser.agents || []).map((agent: any) => (
                      <div key={agent.id} className="rounded-xl bg-[#fbfaf7] px-3 py-2 text-sm">
                        <span className="font-semibold">{agent.name}</span>
                        <span className="ml-2 text-xs text-slate-400">{agent.isPublic ? '已上架' : '已下架'}</span>
                      </div>
                    ))}
                    {(selectedUser.agents || []).length === 0 && <div className="text-sm text-slate-400">暂无 Agent</div>}
                  </div>
                </div>

                <div className="mt-5">
                  <h3 className="mb-2 text-sm font-black">最近会话</h3>
                  <div className="space-y-2">
                    {(selectedUser.conversations || []).map((conversation: any) => (
                      <div key={conversation.id} className="rounded-xl bg-[#fbfaf7] px-3 py-2 text-sm">
                        <div className="font-semibold">{conversation.title || conversation.agentName || '未命名会话'}</div>
                        <div className="text-xs text-slate-400">{formatDate(conversation.updatedAt)}</div>
                      </div>
                    ))}
                    {(selectedUser.conversations || []).length === 0 && <div className="text-sm text-slate-400">暂无会话</div>}
                  </div>
                </div>
              </div>
            )}
          </div>
          )}

          {activeTab === 'agents' && (
          <div className="rounded-2xl border border-black/[0.06] bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-lg font-black">Agent 管理</h2>
              <div className="flex min-w-0 items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                  <input
                    value={agentQuery}
                    onChange={(event) => setAgentQuery(event.target.value)}
                    onKeyDown={(event) => event.key === 'Enter' && searchAgents()}
                    placeholder="搜索 Agent"
                    className="h-10 w-44 rounded-full border border-black/[0.08] bg-[#fbfaf7] pl-9 pr-3 text-sm outline-none focus:border-slate-300"
                  />
                </div>
                <button onClick={searchAgents} className="h-10 rounded-full bg-slate-950 px-4 text-sm font-bold text-white">
                  搜索
                </button>
              </div>
            </div>

            <div className="overflow-hidden rounded-xl border border-black/[0.06]">
              <div className="grid grid-cols-[1fr_120px_120px] bg-slate-50 px-4 py-3 text-xs font-black text-slate-500">
                <div>Agent</div>
                <div>状态</div>
                <div className="text-right">操作</div>
              </div>
              {agents.map((agent) => (
                <div key={agent.id} className="grid grid-cols-[1fr_120px_120px] items-center border-t border-black/[0.06] px-4 py-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-black">{agent.name}</div>
                    <div className="truncate text-xs text-slate-500">
                      {agent.creator?.email || '系统'} · {agent.category || '未分类'}
                    </div>
                  </div>
                  <div className="text-sm font-semibold text-slate-600">{agent.isPublic ? '已上架' : '已下架'}</div>
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => toggleAgent(agent)}
                      disabled={busyAgentId === agent.id}
                      title={agent.isPublic ? '下架' : '上架'}
                      className="flex h-9 w-9 items-center justify-center rounded-full border border-black/[0.08] text-slate-700 disabled:opacity-50"
                    >
                      {agent.isPublic ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                    <button
                      onClick={() => deleteAgent(agent)}
                      disabled={busyAgentId === agent.id}
                      title="删除"
                      className="flex h-9 w-9 items-center justify-center rounded-full border border-red-100 text-red-500 disabled:opacity-50"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
          )}
        </section>
      </div>
      <ConfirmDialog
        open={Boolean(pendingDeleteUser)}
        title="Delete user?"
        description={
          pendingDeleteUser
            ? `This will delete ${pendingDeleteUser.email}, including conversations, favorites, quota usage and created agents.`
            : ''
        }
        icon={<Trash2 size={20} />}
        cancelText="Cancel"
        confirmText="Delete"
        destructive
        loading={deletingUser}
        onCancel={() => setPendingDeleteUser(null)}
        onConfirm={deleteUser}
      />
    </main>
  );
}

'use client';

import React, { useState, useEffect } from 'react';
import {
  Cpu,
  Globe2,
  KeyRound,
  X,
  Loader2,
  Check,
  RotateCcw,
  Eye,
  EyeOff,
  Sparkles,
  PlugZap,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import Avatar from '@/components/shared/Avatar';
import ModelPicker from '@/components/shared/ModelPicker';
import { user as userApi } from '@/lib/api';
import type { Agent, SpaceMember } from '@/types';

interface SpaceMemberModelDialogProps {
  open: boolean;
  member: SpaceMember | null;
  agent: Agent | null;
  onClose: () => void;
  onSave: (data: {
    modelName: string | null;
    apiBaseUrl: string | null;
    apiKey: string | null;
  }) => Promise<void>;
}

const PRESET_MODELS = [
  { label: 'DeepSeek-V3', value: 'deepseek-chat', desc: '极速通用' },
  { label: 'DeepSeek-R1', value: 'deepseek-reasoner', desc: '深度推理' },
  { label: 'GPT-4o', value: 'gpt-4o', desc: '全能旗舰' },
  { label: 'GPT-4o mini', value: 'gpt-4o-mini', desc: '轻量经济' },
  { label: 'Claude 3.5 Sonnet', value: 'claude-3-5-sonnet-20241022', desc: '编程与写作' },
  { label: 'Qwen-Max', value: 'qwen-max', desc: '通义旗舰' },
];

export default function SpaceMemberModelDialog({
  open,
  member,
  agent,
  onClose,
  onSave,
}: SpaceMemberModelDialogProps) {
  // 严格按照要求的顺序：1. url 2. key 3. model
  const [apiBaseUrl, setApiBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [modelName, setModelName] = useState('');
  const [showKey, setShowKey] = useState(false);

  // 测试模型相关状态
  const [testingModel, setTestingModel] = useState(false);
  const [testResult, setTestResult] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  // 保存状态
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open && member) {
      setApiBaseUrl(member.apiBaseUrl || '');
      setApiKey(member.apiKey || '');
      setModelName(member.modelName || '');
      setShowKey(false);
      setTestResult(null);
      setError('');
    }
  }, [open, member]);

  if (!open || !member) return null;

  // 测试模型连接
  const handleTestModel = async () => {
    if (!modelName.trim() || testingModel) return;
    setTestingModel(true);
    setTestResult(null);
    try {
      const result = await userApi.testModel({
        apiBaseUrl: apiBaseUrl.trim(),
        apiKey: apiKey.trim(),
        modelName: modelName.trim(),
      });
      setTestResult({
        type: 'success',
        message: result.message || '模型连接测试成功，响应正常',
      });
    } catch (err: any) {
      setTestResult({
        type: 'error',
        message: err.message || '连接失败，请检查配置',
      });
    } finally {
      setTestingModel(false);
    }
  };

  // 恢复跟随全局
  const handleResetToDefault = async () => {
    setSaving(true);
    setError('');
    try {
      await onSave({
        modelName: null,
        apiBaseUrl: null,
        apiKey: null,
      });
      onClose();
    } catch (err: any) {
      setError(err?.message || '重置失败');
    } finally {
      setSaving(false);
    }
  };

  // 提交保存
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await onSave({
        modelName: modelName.trim() || null,
        apiBaseUrl: apiBaseUrl.trim() || null,
        apiKey: apiKey.trim() || null,
      });
      onClose();
    } catch (err: any) {
      setError(err?.message || '保存配置失败');
    } finally {
      setSaving(false);
    }
  };

  const isCustomized = Boolean(modelName.trim() || apiBaseUrl.trim() || apiKey.trim());

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 p-0 backdrop-blur-xs sm:items-center sm:p-4">
      <div className="absolute inset-0" onClick={onClose} />
      <div className="relative z-10 flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-2xl">
        {/* 头部 */}
        <div className="flex shrink-0 items-center justify-between border-b border-black/[0.06] px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
              <Cpu size={18} />
            </div>
            <div>
              <h3 className="text-base font-black text-slate-950">成员独立模型配置</h3>
              <p className="text-xs text-slate-400">仅在当前空间内生效，留空则自动继承个人中心全局配置</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            title="关闭"
          >
            <X size={16} />
          </button>
        </div>

        {/* 成员信息卡片 */}
        <div className="shrink-0 border-b border-black/[0.05] bg-[#fbfaf7] px-6 py-3.5">
          <div className="flex items-center gap-3">
            <Avatar src={agent?.avatar || '🤖'} alt={agent?.name || 'Agent'} size="md" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-black text-slate-900">{agent?.name || member.agentId}</span>
                <span className="rounded-full bg-slate-200/80 px-2 py-0.5 text-[10px] font-bold text-slate-600">
                  {member.roleName || agent?.category || 'Agent'}
                </span>
              </div>
              <p className="mt-0.5 truncate text-xs text-slate-400">
                {agent?.description || '空间协作成员'}
              </p>
            </div>
            <div className="shrink-0">
              {isCustomized ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-bold text-indigo-700">
                  <Sparkles size={12} />
                  已自定义
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500">
                  跟随全局
                </span>
              )}
            </div>
          </div>
        </div>

        {/* 表单内容 */}
        <form id="space-member-model-form" onSubmit={handleSave} className="flex-1 overflow-y-auto px-6 py-5 space-y-4 pb-8">
          {error && (
            <div className="rounded-xl bg-rose-50 px-4 py-2.5 text-xs font-bold text-rose-600">
              {error}
            </div>
          )}

          {/* 1. 先写 URL */}
          <div>
            <label className="mb-1.5 flex items-center justify-between text-xs font-bold text-slate-700">
              <span className="flex items-center gap-1.5">
                <Globe2 size={14} className="text-emerald-600" />
                API 接口地址 (Base URL)
              </span>
              <span className="text-[11px] font-normal text-slate-400">留空则跟随全局</span>
            </label>
            <input
              type="url"
              value={apiBaseUrl}
              onChange={(e) => {
                setApiBaseUrl(e.target.value);
                setTestResult(null);
              }}
              placeholder="例如: https://api.openai.com/v1 或私有端点（留空跟随全局）"
              className="h-10 w-full rounded-xl border border-black/[0.08] bg-white px-3.5 text-xs font-medium text-slate-900 placeholder:text-slate-300 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
            />
            <p className="mt-1 text-[11px] text-slate-400">
              支持 OpenAI 兼容格式服务，如硅基流动、ModelScope、OneAPI、NewAPI 或自建端点。
            </p>
          </div>

          {/* 2. 再写 Key */}
          <div>
            <label className="mb-1.5 flex items-center justify-between text-xs font-bold text-slate-700">
              <span className="flex items-center gap-1.5">
                <KeyRound size={14} className="text-amber-600" />
                API 密钥 (API Key)
              </span>
              <span className="text-[11px] font-normal text-slate-400">留空则跟随全局</span>
            </label>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  setTestResult(null);
                }}
                placeholder="例如: sk-...（留空则复用个人中心 API Key）"
                className="h-10 w-full rounded-xl border border-black/[0.08] bg-white pl-3.5 pr-10 text-xs font-medium text-slate-900 placeholder:text-slate-300 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                title={showKey ? '隐藏 Key' : '显示 Key'}
              >
                {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
            <p className="mt-1 text-[11px] text-slate-400">
              为该 Agent 配置专属 Token 额度，未填写时自动使用个人中心全局 Key。
            </p>
          </div>

          {/* 3. 使用封装的通用 ModelPicker 组件（获取全部 + 搜索下拉 + 手动写入） */}
          <ModelPicker
            id="member-model-picker"
            value={modelName}
            onChange={(val) => {
              setModelName(val);
              setTestResult(null);
            }}
            apiBaseUrl={apiBaseUrl}
            apiKey={apiKey}
            compact={true}
            label={
              <label className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
                <Cpu size={14} className="text-indigo-600" />
                模型名称 (Model Name)
              </label>
            }
            placeholder="例如: deepseek-chat 或 gpt-4o（留空跟随全局）"
            searchPlaceholder="输入关键词搜索已获取的模型..."
            actionText="手动填写其他模型"
            quickPresets={PRESET_MODELS}
          />

          {/* 4. 模型测试连接功能 */}
          <div className="rounded-2xl border border-black/[0.06] bg-[#fbfaf7] p-3.5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-bold text-slate-900">模型连通性测试</div>
                <p className="mt-0.5 text-[11px] text-slate-400">
                  发送最小 Ping 请求，验证此端点与模型名称是否能够正常对话
                </p>
              </div>
              <button
                type="button"
                onClick={handleTestModel}
                disabled={!modelName.trim() || testingModel}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-black/[0.08] bg-white px-3 py-1.5 text-xs font-bold text-slate-700 shadow-2xs transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {testingModel ? (
                  <>
                    <Loader2 size={13} className="animate-spin text-indigo-600" />
                    <span>测试中...</span>
                  </>
                ) : (
                  <>
                    <PlugZap size={13} className="text-indigo-600" />
                    <span>测试连接</span>
                  </>
                )}
              </button>
            </div>

            {/* 测试反馈结果 */}
            {testResult && (
              <div
                className={`mt-2.5 flex items-start gap-2 rounded-xl p-2.5 text-xs font-semibold ${
                  testResult.type === 'success'
                    ? 'border border-emerald-200/80 bg-emerald-50 text-emerald-800'
                    : 'border border-rose-200/80 bg-rose-50 text-rose-700'
                }`}
              >
                {testResult.type === 'success' ? (
                  <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-emerald-600" />
                ) : (
                  <AlertCircle size={15} className="mt-0.5 shrink-0 text-rose-600" />
                )}
                <div className="min-w-0 flex-1 leading-5">
                  <span className="font-bold">
                    {testResult.type === 'success' ? '测试通过：' : '测试失败：'}
                  </span>
                  <span>{testResult.message}</span>
                </div>
              </div>
            )}
          </div>

        </form>

        {/* 底部固定操作栏 */}
        <div className="shrink-0 flex items-center justify-between border-t border-black/[0.06] bg-[#fbfaf7] px-6 py-4">
          {isCustomized ? (
            <button
              type="button"
              onClick={handleResetToDefault}
              disabled={saving}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 disabled:opacity-50"
            >
              <RotateCcw size={13} />
              恢复跟随全局
            </button>
          ) : (
            <div />
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="cursor-pointer rounded-xl border border-black/[0.06] bg-white px-4 py-2 text-xs font-bold text-slate-600 transition hover:bg-slate-50"
            >
              取消
            </button>
            <button
              type="submit"
              form="space-member-model-form"
              disabled={saving}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-slate-950 px-5 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-50"
            >
              {saving ? (
                <>
                  <Loader2 size={13} className="animate-spin" />
                  保存中...
                </>
              ) : (
                <>
                  <Check size={13} />
                  保存配置
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

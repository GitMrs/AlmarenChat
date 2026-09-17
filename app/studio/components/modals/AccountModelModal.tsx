import React from 'react';
import { Settings, CheckCircle, Sparkles, ChevronRight } from 'lucide-react';

interface AccountModelModalProps {
  isOpen: boolean;
  onClose: () => void;
  userProfile: any;
  contextLength: number;
  formatTokens: (tokens: number) => string;
}

export const AccountModelModal: React.FC<AccountModelModalProps> = ({
  isOpen,
  onClose,
  userProfile,
  contextLength,
  formatTokens,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fadeIn">
      <div className="bg-white border border-black/[0.08] rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-5 text-slate-900">
        <div className="flex items-center justify-between pb-3 border-b border-black/[0.06]">
          <div className="flex items-center gap-2">
            <Settings size={18} className="text-indigo-600" />
            <h3 className="text-base font-bold text-slate-900">当前环境与模型状态</h3>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 text-xs font-medium cursor-pointer"
          >
            关闭
          </button>
        </div>

        <div className="space-y-3.5 text-xs">
          <div className="p-3.5 rounded-xl bg-[#fbfaf7] border border-black/[0.06] space-y-2.5">
            <div className="flex items-center justify-between pb-2 border-b border-black/[0.04]">
              <span className="text-slate-500">登录账号</span>
              <span className="font-mono text-slate-800 font-medium">
                {userProfile?.email || '当前登录用户'}
              </span>
            </div>

            <div className="flex items-center justify-between pb-2 border-b border-black/[0.04]">
              <span className="text-slate-500">驱动大模型</span>
              <span className="font-mono text-emerald-700 font-bold bg-emerald-50 border border-emerald-200/80 px-2 py-0.5 rounded">
                {userProfile?.modelName || '未指定 (系统默认)'}
              </span>
            </div>

            <div className="flex items-center justify-between pb-2 border-b border-black/[0.04]">
              <span className="text-slate-500">接口 Base URL</span>
              <span
                className="font-mono text-slate-700 truncate max-w-[200px]"
                title={userProfile?.apiBaseUrl || '系统默认端点'}
              >
                {userProfile?.apiBaseUrl || '系统官方接口'}
              </span>
            </div>

            <div className="flex items-center justify-between pb-2 border-b border-black/[0.04]">
              <span className="text-slate-500">API 凭据状态</span>
              <span className="flex items-center gap-1 text-emerald-700 font-medium">
                <CheckCircle size={12} />
                <span>{userProfile?.apiKey ? '已配置 (已就绪)' : '未设置'}</span>
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-slate-500">上下文窗口</span>
              <span className="font-mono text-slate-800">{formatTokens(contextLength)} tokens</span>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-indigo-50 border border-indigo-100 text-[11px] text-slate-700 space-y-1">
            <div className="font-semibold text-indigo-700 flex items-center gap-1.5">
              <Sparkles size={13} />
              <span>统一账号模型与直连机制</span>
            </div>
            <div className="text-slate-600 leading-relaxed">
              Studio 总指挥官与后台 Pi Coding Agent 已直接打通并继承您的账号模型配置，无需在此重复填写任何密钥或代理地址。
            </div>
          </div>
        </div>

        <div className="pt-2 flex items-center justify-between border-t border-black/[0.06]">
          <a
            href="/settings"
            target="_blank"
            rel="noreferrer"
            className="text-xs text-indigo-600 hover:text-indigo-700 hover:underline flex items-center gap-1 font-medium"
          >
            <span>前往系统设置修改模型配置</span>
            <ChevronRight size={13} />
          </a>

          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-semibold text-slate-700 transition-colors cursor-pointer"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
};

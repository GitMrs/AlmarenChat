import React, { useState } from 'react';
import { ChevronLeft, Check, Sparkles, Key, Globe, Cpu } from 'lucide-react';
import { User } from '../types';

interface AgentConfig {
  name: string;
  avatar: string;
  description: string;
  systemPrompt: string;
  apiBaseUrl: string;
  apiKey: string;
  modelName: string;
}

interface CreateCustomAgentScreenProps {
  onClose: () => void;
  onSave: (agent: User, config?: Partial<AgentConfig>) => void;
}

export function CreateCustomAgentScreen({ onClose, onSave }: CreateCustomAgentScreenProps) {
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState('🤖');
  const [description, setDescription] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [apiBaseUrl, setApiBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [modelName, setModelName] = useState('');
  const [isVisible, setIsVisible] = useState(false);

  React.useEffect(() => {
    requestAnimationFrame(() => setIsVisible(true));
  }, []);

  const handleClose = () => {
    setIsVisible(false);
    setTimeout(onClose, 300);
  };

  const handleSave = () => {
    if (!name.trim()) return;

    const agentId = `agent-${Date.now()}`;
    const newAgent: User = {
      id: agentId,
      name: name.trim(),
      avatar: avatar.trim() || '🤖',
      isOnline: true,
      description: description.trim(),
    };

    const config: AgentConfig = {
      name: name.trim(),
      avatar: avatar.trim() || '🤖',
      description: description.trim(),
      systemPrompt: systemPrompt.trim(),
      apiBaseUrl: apiBaseUrl.trim(),
      apiKey: apiKey.trim(),
      modelName: modelName.trim(),
    };

    setIsVisible(false);
    setTimeout(() => {
      onSave(newAgent, config);
    }, 300);
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div
        className={`absolute inset-0 bg-black/30 backdrop-blur-sm transition-opacity duration-300 dark:bg-black/60 ${isVisible ? 'opacity-100' : 'opacity-0'}`}
        onClick={handleClose}
      />

      <div className={`relative w-full max-w-md h-full bg-white dark:bg-[#121212] shadow-2xl transition-transform duration-300 ease-in-out flex flex-col ${isVisible ? 'translate-x-0' : 'translate-x-full'}`}>
        {/* App Bar */}
        <div className="flex items-center justify-between px-4 pt-6 pb-4 border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-center">
            <button
              onClick={handleClose}
              className="p-2 text-gray-500 hover:text-black dark:text-gray-400 dark:hover:text-white transition-colors rounded-full hover:bg-gray-50 dark:hover:bg-gray-800 mr-2"
            >
              <ChevronLeft size={24} />
            </button>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Create Custom Agent</h2>
          </div>
          <button
            onClick={handleSave}
            disabled={!name.trim()}
            className="flex items-center gap-1.5 px-4 py-2 bg-[#1e2329] dark:bg-white text-white dark:text-black rounded-lg font-medium text-sm hover:bg-black dark:hover:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Check size={16} /> Save
          </button>
        </div>

        {/* Form Content */}
        <div className="flex-1 overflow-y-auto px-6 py-8">
          <div className="max-w-md mx-auto space-y-8">
            {/* Avatar Section */}
            <div className="flex justify-center">
              <div className="relative">
                <div className="w-24 h-24 rounded-3xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-5xl shadow-inner border border-gray-200 dark:border-gray-700">
                  {avatar || '🤖'}
                </div>
                <div className="absolute -bottom-2 -right-2 bg-yellow-400 p-1.5 rounded-full border-2 border-white dark:border-[#121212]">
                  <Sparkles size={14} className="text-yellow-900" />
                </div>
              </div>
            </div>

            {/* Basic Info */}
            <div className="space-y-5">
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Avatar (Emoji or Image URL)</label>
                <input
                  type="text"
                  value={avatar}
                  onChange={(e) => setAvatar(e.target.value)}
                  placeholder="🤖 or https://..."
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:bg-white focus:border-gray-300 focus:ring-4 focus:ring-gray-50 transition-all text-gray-900 dark:bg-gray-900 dark:border-gray-800 dark:text-white dark:focus:ring-gray-800"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Agent Name <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="My Assistant"
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:bg-white focus:border-gray-300 focus:ring-4 focus:ring-gray-50 transition-all text-gray-900 dark:bg-gray-900 dark:border-gray-800 dark:text-white dark:focus:ring-gray-800"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Description</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What does this agent do?"
                  rows={2}
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:bg-white focus:border-gray-300 focus:ring-4 focus:ring-gray-50 transition-all text-gray-900 resize-none dark:bg-gray-900 dark:border-gray-800 dark:text-white dark:focus:ring-gray-800"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">System Prompt (instructions for AI)</label>
                <textarea
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  placeholder="You are a helpful assistant..."
                  rows={3}
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:bg-white focus:border-gray-300 focus:ring-4 focus:ring-gray-50 transition-all text-gray-900 resize-none dark:bg-gray-900 dark:border-gray-800 dark:text-white dark:focus:ring-gray-800"
                />
              </div>
            </div>

            {/* AI Configuration */}
            <div className="pt-4 border-t border-gray-100 dark:border-gray-800">
              <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                <Cpu size={18} className="text-purple-500" />
                AI Configuration
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
                Configure a custom AI provider. Leave empty to use default Gemini.
              </p>

              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
                    <Globe size={14} />
                    API Base URL
                  </label>
                  <input
                    type="text"
                    value={apiBaseUrl}
                    onChange={(e) => setApiBaseUrl(e.target.value)}
                    placeholder="https://api-inference.modelscope.cn/v1"
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:bg-white focus:border-gray-300 focus:ring-4 focus:ring-gray-50 transition-all text-gray-900 dark:bg-gray-900 dark:border-gray-800 dark:text-white dark:focus:ring-gray-800 font-mono text-sm"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
                    <Key size={14} />
                    API Key
                  </label>
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="sk-..."
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:bg-white focus:border-gray-300 focus:ring-4 focus:ring-gray-50 transition-all text-gray-900 dark:bg-gray-900 dark:border-gray-800 dark:text-white dark:focus:ring-gray-800 font-mono text-sm"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
                    <Cpu size={14} />
                    Model Name
                  </label>
                  <input
                    type="text"
                    value={modelName}
                    onChange={(e) => setModelName(e.target.value)}
                    placeholder="deepseek-ai/DeepSeek-V4-Flash"
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:bg-white focus:border-gray-300 focus:ring-4 focus:ring-gray-50 transition-all text-gray-900 dark:bg-gray-900 dark:border-gray-800 dark:text-white dark:focus:ring-gray-800 font-mono text-sm"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

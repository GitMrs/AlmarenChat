import React, { useState } from 'react';
import { Bell, Shield, Moon, CircleHelp, LogOut, ChevronRight, User as UserIcon, Bot, ChevronLeft, Trash2, Plus } from 'lucide-react';
import { currentUserObj } from '../mockData';
import { User } from '../types';

import agentData from '../lib/agent.json';

interface SettingsScreenProps {
  onLogout: () => void;
  isDark: boolean;
  onToggleDark: (v: boolean) => void;
  onOpenAgentStore: () => void;
}

export function SettingsScreen({ onLogout, isDark, onToggleDark, onOpenAgentStore }: SettingsScreenProps) {
  const [notifications, setNotifications] = useState(true);
  const [readReceipts, setReadReceipts] = useState(true);

  const handleAction = (action: string) => {
    alert(`${action} settings clicked (mock interface)`);
  };

  return (
    <div className="flex flex-col h-full bg-white relative">
      <div className="px-6 pt-6 pb-4">
        <h1 className="text-2xl font-semibold text-gray-900 tracking-tight">Settings</h1>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-24">
        {/* Profile Card */}
        <div className="bg-gray-50 rounded-3xl p-4 flex items-center mb-8">
           <div className="w-16 h-16 rounded-2xl bg-gray-200 overflow-hidden mr-4 shadow-sm border border-gray-100">
              <div className="w-full h-full bg-[#1e2329] flex items-center justify-center text-white font-bold text-xl">
                 M
              </div>
           </div>
           <div className="flex-1">
              <h2 className="text-lg font-semibold text-gray-900">{currentUserObj.name}</h2>
              <p className="text-sm text-gray-500">+1 234 567 8900</p>
           </div>
           <button 
             onClick={() => handleAction('Profile')}
             className="w-10 h-10 rounded-full border border-gray-200 flex items-center justify-center bg-white text-gray-600 hover:bg-gray-50 transition-colors"
           >
              <ChevronRight size={20} />
           </button>
        </div>

        {/* Options List */}
        <div className="space-y-4">
          <SettingsItem 
            icon={<UserIcon size={22} />} 
            label="Account" 
            onClick={() => handleAction('Account')} 
          />
          <SettingsItem 
            icon={<Bot size={22} />} 
            label="Agent Management" 
            onClick={onOpenAgentStore} 
          />
          <SettingsItem 
            type="toggle" 
            icon={<Bell size={22} />} 
            label="Notifications" 
            checked={notifications} 
            onChange={setNotifications} 
          />
          <SettingsItem 
            type="toggle" 
            icon={<Shield size={22} />} 
            label="Read Receipts" 
            checked={readReceipts} 
            onChange={setReadReceipts} 
          />
          <SettingsItem 
            type="toggle" 
            icon={<Moon size={22} />} 
            label="Dark Mode" 
            checked={isDark} 
            onChange={onToggleDark} 
          />
          <SettingsItem 
            icon={<CircleHelp size={22} />} 
            label="Help & Support" 
            onClick={() => handleAction('Help & Support')} 
          />
          
          <button 
            onClick={onLogout}
            className="flex items-center w-full p-4 rounded-2xl hover:bg-red-50 transition-colors mt-4 text-red-500 group"
          >
             <div className="w-10 h-10 flex items-center justify-center rounded-xl bg-red-50 group-hover:bg-white mr-4 transition-colors">
               <LogOut size={22} />
             </div>
             <span className="font-medium flex-1 text-left text-[15px]">Log Out</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function Switch({ checked, onChange }: { checked: boolean; onChange: (c: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
      className={`relative inline-flex h-[28px] w-[48px] shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${checked ? 'bg-[#1e2329]' : 'bg-gray-200'}`}
    >
      <span
        aria-hidden="true"
        className={`pointer-events-none inline-block h-[24px] w-[24px] transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${checked ? 'translate-x-[20px]' : 'translate-x-0'}`}
      />
    </button>
  );
}

interface SettingsItemProps {
  icon: React.ReactNode;
  label: string;
  type?: 'link' | 'toggle';
  checked?: boolean;
  onChange?: (v: boolean) => void;
  onClick?: () => void;
}

function SettingsItem({ icon, label, type = 'link', checked, onChange, onClick }: SettingsItemProps) {
  return (
    <div 
      onClick={type === 'link' ? onClick : undefined}
      className={`flex items-center w-full p-2 rounded-2xl transition-colors ${type === 'link' ? 'hover:bg-gray-50 cursor-pointer' : ''}`}
    >
       <div className="w-10 h-10 flex items-center justify-center text-gray-600 mr-4">
          {icon}
       </div>
       <span className="font-medium text-gray-900 flex-1 text-left text-[15px]">{label}</span>
       {type === 'link' && <ChevronRight size={20} className="text-gray-400" />}
       {type === 'toggle' && onChange && (
         <Switch checked={checked || false} onChange={onChange} />
       )}
    </div>
  );
}

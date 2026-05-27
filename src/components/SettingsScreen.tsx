import React, { useState } from 'react';
import { Bell, Shield, Moon, CircleHelp, LogOut, ChevronRight, User as UserIcon, Bot, ChevronLeft, Trash2, Plus, Camera } from 'lucide-react';
import { User } from '../types';
import * as api from '../lib/api';

interface SettingsScreenProps {
  onLogout: () => void;
  isDark: boolean;
  onToggleDark: (v: boolean) => void;
  onOpenAgentStore: () => void;
  notificationsEnabled: boolean;
  onToggleNotifications: (v: boolean) => void;
  currentUser?: { id: string; name: string; email: string };
  onProfileUpdate?: (user: { id: string; name: string; email: string }) => void;
}

export function SettingsScreen({
  onLogout,
  isDark,
  onToggleDark,
  onOpenAgentStore,
  notificationsEnabled,
  onToggleNotifications,
  currentUser,
  onProfileUpdate,
}: SettingsScreenProps) {
  const [showProfileEdit, setShowProfileEdit] = useState(false);
  const [editName, setEditName] = useState(currentUser?.name || '');
  const [editAvatar, setEditAvatar] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const handleSaveProfile = async () => {
    if (!editName.trim()) return;
    setIsSaving(true);
    try {
      const updated = await api.updateProfile({
        name: editName.trim(),
        avatar: editAvatar || undefined,
      });
      if (onProfileUpdate && updated) {
        onProfileUpdate({
          id: currentUser?.id || '',
          name: updated.name || editName.trim(),
          email: updated.email || currentUser?.email || '',
        });
      }
      setShowProfileEdit(false);
    } catch (err) {
      console.error('Failed to update profile:', err);
    } finally {
      setIsSaving(false);
    }
  };

  // 获取用户首字母作为默认头像
  const getInitial = (name: string) => {
    return name.charAt(0).toUpperCase();
  };

  if (showProfileEdit) {
    return (
      <div className="flex flex-col h-full bg-white relative">
        <div className="flex items-center px-4 py-4 border-b border-gray-100">
          <button
            onClick={() => setShowProfileEdit(false)}
            className="p-2 -ml-2 text-gray-700 hover:text-black"
          >
            <ChevronLeft size={24} />
          </button>
          <h1 className="text-lg font-semibold text-gray-900 ml-2">Edit Profile</h1>
          <button
            onClick={handleSaveProfile}
            disabled={isSaving || !editName.trim()}
            className="ml-auto text-[#1e2329] font-medium disabled:opacity-40"
          >
            {isSaving ? 'Saving...' : 'Save'}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-6">
          {/* Avatar */}
          <div className="flex flex-col items-center mb-8">
            <div className="relative">
              <div className="w-24 h-24 rounded-full bg-gray-100 overflow-hidden flex items-center justify-center text-3xl font-bold text-gray-600">
                {editAvatar ? (
                  <img src={editAvatar} alt="" className="w-full h-full object-cover" />
                ) : (
                  getInitial(editName || currentUser?.name || 'U')
                )}
              </div>
              <button className="absolute bottom-0 right-0 w-8 h-8 bg-[#1e2329] rounded-full flex items-center justify-center text-white">
                <Camera size={16} />
              </button>
            </div>
            <p className="text-sm text-gray-500 mt-3">Tap to change photo</p>
          </div>

          {/* Name */}
          <div className="mb-6">
            <label className="text-sm font-medium text-gray-700 mb-2 block">Name</label>
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="w-full px-4 py-3 bg-gray-50 border border-transparent rounded-xl outline-none focus:bg-white focus:border-gray-200 transition-all text-gray-900"
              placeholder="Enter your name"
            />
          </div>

          {/* Email (readonly) */}
          <div className="mb-6">
            <label className="text-sm font-medium text-gray-700 mb-2 block">Email</label>
            <input
              type="email"
              value={currentUser?.email || ''}
              readOnly
              className="w-full px-4 py-3 bg-gray-100 border border-transparent rounded-xl text-gray-500 cursor-not-allowed"
            />
            <p className="text-xs text-gray-400 mt-1">Email cannot be changed</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-white relative">
      <div className="px-6 pt-6 pb-4">
        <h1 className="text-2xl font-semibold text-gray-900 tracking-tight">Settings</h1>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-24">
        {/* Profile Card */}
        <div
          className="bg-gray-50 rounded-3xl p-4 flex items-center mb-8 cursor-pointer hover:bg-gray-100 transition-colors"
          onClick={() => {
            setEditName(currentUser?.name || '');
            setShowProfileEdit(true);
          }}
        >
           <div className="w-16 h-16 rounded-2xl bg-gray-200 overflow-hidden mr-4 shadow-sm border border-gray-100 flex items-center justify-center text-white font-bold text-xl bg-[#1e2329]">
              {getInitial(currentUser?.name || 'U')}
           </div>
           <div className="flex-1">
              <h2 className="text-lg font-semibold text-gray-900">{currentUser?.name || 'User'}</h2>
              <p className="text-sm text-gray-500">{currentUser?.email || 'email@example.com'}</p>
           </div>
           <button className="w-10 h-10 rounded-full border border-gray-200 flex items-center justify-center bg-white text-gray-600 hover:bg-gray-50 transition-colors">
              <ChevronRight size={20} />
           </button>
        </div>

        {/* Options List */}
        <div className="space-y-4">
          <SettingsItem
            icon={<Bot size={22} />}
            label="Agent Management"
            onClick={onOpenAgentStore}
          />
          <SettingsItem
            type="toggle"
            icon={<Bell size={22} />}
            label="Notifications"
            checked={notificationsEnabled}
            onChange={onToggleNotifications}
          />
          <SettingsItem
            type="toggle"
            icon={<Shield size={22} />}
            label="Read Receipts"
            checked={true}
            onChange={() => {}}
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
            onClick={() => alert('Help & Support coming soon!')}
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
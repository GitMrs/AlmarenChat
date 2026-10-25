'use client';

import React, { useEffect, useState } from 'react';
import { Phone, PhoneCall, PhoneOff, Mic, MicOff, ChevronDown, ChevronUp, Sparkles, MessageSquare } from 'lucide-react';
import type { CompanionCharacter, CompanionSkin } from '@/lib/companion/catalog';

export type CallPhase = 'idle' | 'dialing' | 'answering' | 'connected' | 'ended';

export interface CallOverlayProps {
  character: CompanionCharacter;
  activeSkin?: CompanionSkin;
  phase: CallPhase;
  duration: number; // in seconds
  isMuted: boolean;
  onToggleMute: () => void;
  onHangUp: () => void;
  onInterrupt: () => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  hearingText: string;
  userText: string;
  subtitleText: string;
  transcript: Array<{ id: string; sender: 'user' | 'companion'; text: string }>;
  isReplying: boolean;
  isSpeaking: boolean;
  isPreparingAudio?: boolean;
  isUserSpeaking: boolean;
  onManualSend?: (text: string) => void;
  onDismissEnded?: () => void;
}

export function formatCallDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export default function CallOverlay({
  character,
  activeSkin,
  phase,
  duration,
  isMuted,
  onToggleMute,
  onHangUp,
  onInterrupt,
  isCollapsed,
  onToggleCollapse,
  hearingText,
  userText,
  subtitleText,
  transcript,
  isReplying,
  isSpeaking,
  isPreparingAudio = false,
  isUserSpeaking,
  onManualSend,
  onDismissEnded,
}: CallOverlayProps) {
  const [showInput, setShowInput] = useState(false);
  const [inputText, setInputText] = useState('');
  // 临时收音和回复状态也占一个位置，舞台上总共最多两条。
  const historySlots = Math.max(0, 2 - Number(isReplying) - Number(Boolean(hearingText)));
  const visibleMessages = historySlots ? transcript.slice(-historySlots) : [];
  const canInterrupt = !isReplying && (isSpeaking || isPreparingAudio);

  if (phase === 'idle') return null;

  // 最小化为顶部悬浮灵动胶囊
  if (isCollapsed && phase === 'connected') {
    return (
      <aside aria-label="通话进行中" className="companion-call-minipill">
        <button
          type="button"
          className="companion-call-minipill-expand"
          onClick={onToggleCollapse}
          title="展开通话界面"
        >
          <span className="companion-call-minipill-dot" />
          <PhoneCall size={14} className="companion-call-minipill-icon" />
          <span className="companion-call-minipill-time">{formatCallDuration(duration)}</span>
          <span className="companion-call-minipill-name">{character.name}</span>
          <ChevronDown size={14} />
        </button>
        <button
          type="button"
          className="companion-call-minipill-hangup"
          onClick={onHangUp}
          title="挂断通话"
          aria-label="挂断"
        >
          <PhoneOff size={13} />
        </button>
      </aside>
    );
  }

  const handleInputSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = inputText.trim();
    if (!text) return;
    onManualSend?.(text);
    setInputText('');
    setShowInput(false);
  };

  return (
    <div className={`companion-call-layer ${phase === 'ended' ? 'is-ended' : ''}`} data-character={character.id} data-phase={phase}>
      <div className="companion-call-backdrop" onClick={phase === 'ended' ? onDismissEnded : undefined} />

      {/* 1. 拨号状态 (Dialing) */}
      {(phase === 'dialing' || phase === 'answering') && (
        <div className="companion-call-modal companion-call-dialing">
          <div className="companion-call-dial-center" role="status" aria-live="polite">
            <div className="companion-call-dial-emblem" aria-hidden="true">
              <Phone size={34} strokeWidth={2.6} />
            </div>
            <p className="companion-call-dial-caption">
              {phase === 'answering' ? '已接通' : `正在呼叫${character.name}`}
            </p>
            <div className="companion-call-dial-stars" aria-hidden="true">
              <span>✧</span><span>✧</span><span>✧</span>
            </div>
          </div>

          <div className="companion-call-dial-actions">
            <button
              type="button"
              className="companion-call-dial-cancel"
              onClick={onHangUp}
              aria-label={phase === 'answering' ? '挂断电话' : '取消呼叫'}
              title={phase === 'answering' ? '挂断电话' : '取消呼叫'}
            >
              <Phone size={22} fill="currentColor" strokeWidth={1.5} aria-hidden="true" />
            </button>
          </div>
        </div>
      )}

      {/* 2. 接通通话状态 (Connected) */}
      {phase === 'connected' && (
        <div className="companion-call-modal companion-call-connected">
          {/* 顶部通话状态胶囊 */}
          <div className="companion-call-header">
            <div className="companion-call-header-pill">
              <span className="companion-call-connected-dot" />
              <PhoneCall size={14} className="companion-call-icon-spin" />
              <span className="companion-call-live-label">通话中</span>
              <span className="companion-call-timer">{formatCallDuration(duration)}</span>
              <span className="companion-call-peer-name">{character.name}</span>
            </div>
            <button
              type="button"
              className="companion-call-collapse-btn"
              onClick={onToggleCollapse}
              title="收起为顶部微胶囊"
              aria-label="收起"
            >
              <ChevronDown size={18} />
            </button>
          </div>

          {/* 中部字幕互动区 */}
          <div className="companion-call-body">
            {visibleMessages.map(message => (
              <div key={message.id} className={`companion-call-bubble companion-call-bubble--${message.sender} ${message.sender === 'companion' && message.id === transcript[transcript.length - 1]?.id && isSpeaking ? 'is-speaking' : ''}`}>
                <div className="companion-call-bubble-header">
                  {message.sender === 'companion' ? (
                    <>
                      <span className="companion-call-bubble-avatar">{character.name[0]}</span>
                      <span className="companion-call-bubble-name">{character.name}</span>
                      {message.id === transcript[transcript.length - 1]?.id && isSpeaking && (
                        <div className="companion-call-wave" title="正在说话">
                          <span className="wave-bar bar-1" />
                          <span className="wave-bar bar-2" />
                          <span className="wave-bar bar-3" />
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <span className="companion-call-user-icon"><Mic size={13} /></span>
                      <span className="companion-call-bubble-name">你</span>
                    </>
                  )}
                </div>
                <p className="companion-call-bubble-text">{message.text}</p>
              </div>
            ))}

            {/* 最新一轮 AI 回复尚未生成时，紧跟在用户消息后显示状态 */}
            {isReplying && (
              <div className="companion-call-bubble companion-call-bubble--companion">
                <div className="companion-call-bubble-header">
                  <span className="companion-call-bubble-avatar">{character.name[0]}</span>
                  <span className="companion-call-bubble-name">{character.name}</span>
                </div>
                <p className="companion-call-bubble-text">
                  <span className="companion-call-typing" aria-label="正在回复">
                    <span /><span /><span /><em>正在回复…</em>
                  </span>
                </p>
              </div>
            )}

            {/* 用户实时收音字幕卡 (Hearing) */}
            {hearingText && (
              <div className="companion-call-bubble companion-call-bubble--user">
                <div className="companion-call-bubble-header">
                  <span className="companion-call-user-icon">
                    <Mic size={13} className={hearingText ? 'is-pulsing' : ''} />
                  </span>
                  <span className="companion-call-bubble-name">{hearingText ? '你正在说' : '你'}</span>
                </div>
                <p className="companion-call-bubble-text is-hearing">{hearingText}</p>
              </div>
            )}
          </div>

          {/* 临时打字输入托盘 (备用，若环境不支持麦克风时可用) */}
          {showInput && (
            <form className="companion-call-text-tray" onSubmit={handleInputSubmit}>
              <input
                type="text"
                autoFocus
                className="companion-call-text-input"
                placeholder={`在电话里给${character.name}发条文字...`}
                value={inputText}
                onChange={e => setInputText(e.target.value)}
              />
              <button type="submit" className="companion-call-text-send" disabled={!inputText.trim()}>
                发送
              </button>
            </form>
          )}

          {/* 底部功能控制托盘 */}
          <div className="companion-call-footer">
            {!showInput && (
              <button type="button" className="companion-call-activity" aria-live="polite"
                disabled={!canInterrupt} onClick={onInterrupt}
                data-active={!isMuted && !isReplying && !isPreparingAudio}>
                <span className="companion-call-activity-icon" aria-hidden="true">
                  <span /><span /><span /><span /><span />
                </span>
                <span>{canInterrupt ? '点按打断' : isReplying ? `${character.name}正在回复` : isMuted ? '麦克风已静音' : `${character.name}在听`}</span>
              </button>
            )}
            <button
              type="button"
              className={`companion-call-circle-btn ${isMuted ? 'is-muted' : ''}`}
              onClick={onToggleMute}
              title={isMuted ? '点击取消麦克风静音' : '点击静音麦克风'}
              aria-label={isMuted ? '开麦' : '静音'}
            >
              {isMuted ? <MicOff size={20} /> : <Mic size={20} />}
              <span className="companion-call-btn-label">{isMuted ? '已静音' : '静音'}</span>
            </button>

            <button
              type="button"
              className="companion-call-circle-btn companion-call-btn--hangup"
              onClick={onHangUp}
              title="挂断通话"
              aria-label="挂断电话"
            >
              <PhoneOff size={26} />
              <span className="companion-call-btn-label">挂断</span>
            </button>

            <button
              type="button"
              className={`companion-call-circle-btn ${showInput ? 'is-active' : ''}`}
              onClick={() => setShowInput(v => !v)}
              title="文字输入辅助"
              aria-label="切换打字"
            >
              <MessageSquare size={20} />
              <span className="companion-call-btn-label">打字</span>
            </button>
          </div>
        </div>
      )}

      {/* 3. 挂断结算卡片 (Ended) */}
      {phase === 'ended' && (
        <div className="companion-call-modal companion-call-ended">
          <div className="companion-call-ended-icon">
            <PhoneOff size={28} />
          </div>
          <h3 className="companion-call-ended-title">通话已结束</h3>
          <p className="companion-call-ended-duration">
            与 {character.name} 共陪伴通话 {formatCallDuration(duration)}
          </p>
          <button
            type="button"
            className="companion-call-ended-close-btn"
            onClick={onDismissEnded}
          >
            返回
          </button>
        </div>
      )}
    </div>
  );
}

'use client';

import { useMemo } from 'react';
import { ContextMemoryModal, type ContextMemorySource } from '@/components/chat/ContextMemoryModal';
import { agentMemories, conversations } from '@/lib/client/api';

export default function AgentContextModal({ agentId, agentName, conversationId, conversationMode, contextMessageLimit, maxContextMessageLimit, onContextMessageLimitChange, onClose }: {
  agentId: string;
  agentName: string;
  conversationId: string | null;
  conversationMode: 'MAIN' | 'TEMPORARY';
  contextMessageLimit: number;
  maxContextMessageLimit: number;
  onContextMessageLimitChange: (value: number) => Promise<void>;
  onClose: () => void;
}) {
  const source = useMemo<ContextMemorySource>(() => ({
    getStats: conversations.getContextStats,
    archive: conversations.archiveContext,
    getExperience: conversations.getContextExperience,
    removeExperience: id => agentMemories.updateExperience(agentId, id, { status: 'DELETED' }),
  }), [agentId]);

  return <ContextMemoryModal open onClose={onClose} conversationId={conversationId || ''} conversationMode={conversationMode} subject={agentName} variant="agent" source={source} contextMessageLimit={contextMessageLimit} maxContextMessageLimit={maxContextMessageLimit} onContextMessageLimitChange={onContextMessageLimitChange} />;
}

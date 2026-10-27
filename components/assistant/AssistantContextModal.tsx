'use client';

import { ContextMemoryModal, type ContextMemorySource } from '@/components/chat/ContextMemoryModal';
import { assistant as assistantApi } from '@/lib/client/api';
import type { AssistantExperience } from '@/types';

const source: ContextMemorySource = {
  getStats: assistantApi.getContextStats,
  archive: assistantApi.archiveExperience,
  getExperience: assistantApi.getExperience,
  removeExperience: assistantApi.deleteExperience,
};

export function AssistantContextModal(props: {
  open: boolean;
  onClose: () => void;
  conversationId: string;
  conversationMode: 'MAIN' | 'TEMPORARY';
  onArchived?: (experience: AssistantExperience) => void;
  onDeleted?: (experienceId: string) => void;
}) {
  return <ContextMemoryModal {...props} subject="小伴" source={source} />;
}

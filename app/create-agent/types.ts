import type { ReactNode } from 'react';

export type CreationType = 'mystery' | 'world' | 'character' | 'script';

export type TestChatMessage = {
  role: 'user' | 'assistant';
  content: string;
  actions?: string[];
};

export interface CreationTypeOption {
  id: CreationType;
  name: string;
  icon: string;
  description: string;
  color: string;
}

export interface AccordionSection {
  id: string;
  title: string;
  icon: ReactNode;
  color: string;
}

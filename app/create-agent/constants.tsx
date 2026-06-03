import { BookOpen, MapPin, Scroll, Search, Workflow } from 'lucide-react';
import type { AccordionSection, CreationTypeOption } from './types';

export const AVATAR_OPTIONS = ['🎭', '🏰', '🔍', '💜', '⚔️', '🌟', '👻', '🎪', '🧩', '🗡️', '📖', '🌙', '🔮', '🎯', '🏴‍☠️', '🦋'];

export const CREATION_TYPES: CreationTypeOption[] = [
  {
    id: 'mystery',
    name: '谜案推理',
    icon: '🔍',
    description: '创建一个结构化的推理案件，包含嫌疑人、线索、真相和多个结局。',
    color: '#6366f1',
  },
  {
    id: 'world',
    name: '故事世界',
    icon: '🏰',
    description: '创建一个广阔的可探索世界，包含地点、角色、规则和目标。',
    color: '#06b6d4',
  },
  {
    id: 'character',
    name: '角色扮演',
    icon: '🎭',
    description: '创建一个独特的角色或 NPC，包含性格、说话风格和背景故事。',
    color: '#8b5cf6',
  },
  {
    id: 'script',
    name: '互动剧本',
    icon: '📖',
    description: '创建一个分支故事，包含选择、触发事件和多个结局。',
    color: '#f59e0b',
  },
];

export const MYSTERY_SECTIONS: AccordionSection[] = [
  { id: 'concept', title: '嫌疑人与核心诡计', icon: <Search size={18} />, color: '#6366f1' },
  { id: 'clues', title: '线索与干扰项', icon: <BookOpen size={18} />, color: '#8b5cf6' },
  { id: 'truth', title: '真相与结局', icon: <MapPin size={18} />, color: '#f43f5e' },
  { id: 'opening', title: '场景与开场', icon: <Scroll size={18} />, color: '#10b981' },
  { id: 'blueprint', title: '案件骨架', icon: <Workflow size={18} />, color: '#06b6d4' },
];

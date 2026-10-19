import type { CompanionCharacter } from '../catalog';
import type { VoiceLine } from '../voice';


export interface QuickPromptItem {
  emoji: string;
  label: string;
  userText: string;
  motion: string;
  fallbackReply: string;
}

export interface MotionReaction {
  targetMotionId?: string;
  targetExpression?: string;
  line?: VoiceLine;
}

export interface CompanionBehavior {
  id: string;
  name: string;
  speakerTag: string;
  initialMotion: string;
  idlePool: readonly string[];
  tapSymbols: readonly string[];
  listeningMotion: string;
  tapExpressionId?: string;
  defaultSceneBg?: 'cherry_room' | 'ocean_room' | 'none';
  quickPrompts: QuickPromptItem[];

  getStartupReaction: (character: CompanionCharacter) => MotionReaction;
  getDragReaction: (character: CompanionCharacter, line: VoiceLine) => MotionReaction;
  getSurrenderReaction: (character: CompanionCharacter, defaultExpression: string) => MotionReaction;
  getRapidTapReaction: (character: CompanionCharacter, defaultExpression: string) => MotionReaction;
  getRandomTapReaction: (character: CompanionCharacter, defaultExpression: string) => MotionReaction;
}

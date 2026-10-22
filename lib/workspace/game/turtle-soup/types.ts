export interface TurtleSoupItem {
  id: string;
  index?: number;
  title: string;
  story: string;
  answer: string;
  hints: string[];
}

export type TurtleSoupCategory = '经典必玩' | '悬疑惊悚' | '脑洞逻辑' | '趣味温情';

export interface TurtleSoupSummary {
  id: string;
  index: number;
  title: string;
  storySnippet: string;
  hintCount: number;
  category: TurtleSoupCategory;
  difficulty: number; // 1 to 4 stars
}

export type DetectiveRank = 'SSS' | 'SS' | 'S' | 'A' | 'B' | 'C';

export interface DetectiveScore {
  rank: DetectiveRank;
  rankTitle: string;
  rankBadge: string;
  questionCount: number;
  hintsUsed: number;
  comment: string;
}

export type TurtleSoupVerdict = 'YES' | 'NO' | 'IRRELEVANT' | 'KEY_POINT' | 'SOLVED';

export interface TurtleSoupJudgeResult {
  verdict: TurtleSoupVerdict;
  verdictLabel: string;
  dmExplanation: string;
  luluReaction: string;
  kokoReaction: string;
  isSolved: boolean;
  unlockedClueSnippet?: string;
}

export interface TurtleSoupCompanionAdvice {
  agentId: 'gaming-lulu' | 'gaming-koko';
  agentName: string;
  content: string;
}

export interface TurtleSoupMessage {
  id: string;
  sender: 'user' | 'dm' | 'gaming-lulu' | 'gaming-koko';
  senderName: string;
  content: string;
  verdict?: TurtleSoupVerdict;
  verdictLabel?: string;
  timestamp: number;
}

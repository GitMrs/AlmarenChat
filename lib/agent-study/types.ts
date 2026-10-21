export interface AgentStudyItem {
  id: string;
  source: string;
  sourceName: string;
  title: string;
  url: string;
  heat?: string;
  thumbnail?: string;
  author?: string;
  summary: string;
  thoughts: string;
  learnedAt: string;
}

export interface AgentDailyStudyRecord {
  agentId: string;
  /** Owner of the record. Omitted only for legacy/offline records. */
  userId?: string;
  agentName: string;
  agentAvatar?: string;
  date: string; // YYYY-MM-DD
  greeting: string;
  items: AgentStudyItem[];
  sharedWithUser: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AgentInterestProfile {
  keywords: string[];
  preferredSources: string[];
  avoidKeywords?: string[];
}

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
  /** 通过知识门槛后沉淀的知识库文档 ID */
  knowledgeId?: string;
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
  /** 知识沉淀完成时间；存在则不再重复抓取/判定 */
  knowledgeIngestedAt?: string;
  /** 最近一次沉淀的诊断信息，便于排查“为什么没有入库” */
  knowledgeIngest?: {
    at: string;
    knowledgeCount: number;
    memoryCount: number;
    kinds: Record<string, string>;
    skipped: string[];
    errors: string[];
  };
  createdAt: string;
  updatedAt: string;
}

export interface AgentInterestProfile {
  keywords: string[];
  preferredSources: string[];
  avoidKeywords?: string[];
}

export type AgentStudySourceMode = 'internal' | 'bilibili';


import { fetchWebpageContent } from '@/lib/web/fetch-webpage';
import { fetchVideoContent, parseVideoUrl } from '@/lib/video/web-video.mjs';
import { isVideoAsrEnabled, transcribeBilibiliVideo, transcribeYouTubeVideo } from '@/lib/video/video-asr.mjs';
import type { CandidateStudyItem } from './interest-matcher';
import {
  isKnowledgeEligibleSource,
  MIN_KNOWLEDGE_CONTENT_CHARS,
} from './content-kind';

// 视频页需要串行调用多个接口（元数据 → 字幕列表 → 字幕正文），外层兜底超时要宽于单请求 15s
const FETCH_TIMEOUT_MS = 45_000;

export interface StudyContent {
  id: string;
  source: string;
  url: string;
  title: string;
  text: string;
  fetched: boolean;
  reason?: string;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('fetch timeout')), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function normalizeText(value: string) {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * 视频研习内容：字幕（web-fetch 同款链路）→ 无字幕时 bilibili 走本地 whisper ASR。
 * ASR 是分钟级 CPU 任务，只在研习后台链路启用；聊天贴链接不受影响。
 */
async function fetchVideoStudyContent(
  base: StudyContent,
  videoRef: { platform: 'bilibili' | 'youtube'; id: string },
  options: { bilibiliCookie?: string } = {}
): Promise<StudyContent> {
  try {
    const video = await withTimeout(fetchVideoContent(base.url, { cookie: options.bilibiliCookie }), FETCH_TIMEOUT_MS);
    if (!video) return { ...base, reason: 'video_meta_failed' };

    let text = normalizeText(video.subtitleText || '');
    let fromAsr = false;

    if (text.length < MIN_KNOWLEDGE_CONTENT_CHARS && isVideoAsrEnabled()) {
      const asr =
        videoRef.platform === 'bilibili'
          ? await transcribeBilibiliVideo(
              { bvid: videoRef.id, cid: video.cid, duration: video.duration },
              { cookie: options.bilibiliCookie } as any,
            )
          : await transcribeYouTubeVideo({ videoId: videoRef.id, duration: video.duration });
      if (asr?.text) {
        text = normalizeText(asr.text);
        fromAsr = true;
      }
    }

    if (text.length < MIN_KNOWLEDGE_CONTENT_CHARS) {
      return { ...base, text, reason: fromAsr ? 'asr_too_short' : 'no_subtitle' };
    }
    // ASR 转写没有标点分段保证，拼上简介帮助后续分型和笔记生成；保留完整字幕/转写全文交由分章提炼处理，不截断
    const desc = normalizeText(video.desc || '');
    const combined = desc ? `简介：${desc}\n\n${fromAsr ? '语音转写' : '字幕'}正文：${text}` : text;
    return { ...base, text: combined, fetched: true };
  } catch (error: any) {
    return { ...base, reason: error?.message || 'video_fetch_failed' };
  }
}

export function extractGitHubRepo(item: { source: string; url: string; title: string }) {
  const urlMatch = String(item.url || '').match(
    /^https?:\/\/(?:www\.)?github\.com\/([^/?#]+)\/([^/?#]+)/i
  );
  if (urlMatch) {
    return { owner: urlMatch[1], repo: urlMatch[2].replace(/\.git$/i, '') };
  }
  if (item.source === 'hellogithub' || item.source === 'github') {
    const match = String(item.title || '').match(/^([\w.-]+)\/([\w.-]+)\s*[:：]/);
    if (match) return { owner: match[1], repo: match[2] };
  }
  return null;
}

/**
 * 针对 HelloGitHub 的 repository 页面，通过其官方 API 解析真正的 GitHub owner 和 repo
 */
async function resolveHelloGitHubRepo(url: string, id?: string): Promise<{ owner: string; repo: string } | null> {
  const match = String(url || '').match(/\/repository\/([a-zA-Z0-9_-]+)/);
  const rid = match ? match[1] : id?.replace(/^hellogithub-/, '');
  if (!rid) return null;

  try {
    const { smartFetch } = await import('../web/proxy.ts');
    const res = await smartFetch(`https://api.hellogithub.com/v1/?rid=${rid}`, { timeoutMs: 10_000 });
    if (!res.ok) return null;
    const json = (await res.json()) as any;
    const fullName = json?.data?.[0]?.full_name;
    if (typeof fullName === 'string' && fullName.includes('/')) {
      const [owner, repo] = fullName.split('/');
      if (owner && repo) return { owner, repo };
    }
  } catch {}
  return null;
}

async function fetchGitHubReadme(owner: string, repo: string) {
  // 1. 优先通过 raw.githubusercontent.com 直连/智能代理获取（避免 GitHub API 速率限制 60次/小时）
  try {
    const { smartFetch } = await import('../web/proxy.ts');
    const rawBranches = ['HEAD', 'main', 'master'];
    for (const branch of rawBranches) {
      const rawRes = await smartFetch(`https://raw.githubusercontent.com/${owner}/${repo}/${branch}/README.md`, {
        timeoutMs: FETCH_TIMEOUT_MS,
      });
      if (rawRes.ok) {
        const text = await rawRes.text();
        if (text && text.trim().length > 0) {
          return normalizeText(text);
        }
      }
    }
  } catch {}

  // 2. 备用：调用 GitHub 官方 API
  const token = process.env.GITHUB_TOKEN;
  try {
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/readme`, {
      headers: {
        Accept: 'application/vnd.github.raw+json',
        'User-Agent': 'AlmarenChat-AgentStudy',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (response.ok) {
      return normalizeText(await response.text());
    }
  } catch {}

  return '';
}

/**
 * 为可沉淀来源抓取正文。
 * 视频/娱乐/时事来源直接返回 fetched=false，只保留为“见闻”（经历），不进入知识库。
 */
export async function fetchStudyContent(
  item: Pick<CandidateStudyItem, 'id' | 'source' | 'url' | 'title'>,
  options: { bilibiliCookie?: string } = {}
): Promise<StudyContent> {
  const base: StudyContent = {
    id: item.id,
    source: item.source,
    url: item.url,
    title: item.title,
    text: '',
    fetched: false,
  };

  if (!isKnowledgeEligibleSource(item.source)) {
    return { ...base, reason: 'source_not_eligible' };
  }

  // 视频页专用通道：字幕优先 → 无字幕走 ASR 兜底。
  // 绝不回退 Readability——视频页提取出的"正文"是推荐流垃圾，会污染知识库。
  const videoRef = parseVideoUrl(item.url) as { platform: 'bilibili' | 'youtube'; id: string } | null;
  if (videoRef) {
    return fetchVideoStudyContent(base, videoRef, options);
  }

  // 仓库类来源优先走 GitHub README，页面本身往往只有一句简介
  let repo = extractGitHubRepo(item);
  if (!repo && item.source === 'hellogithub') {
    repo = await resolveHelloGitHubRepo(item.url, item.id);
  }
  if (repo) {
    try {
      const readme = await fetchGitHubReadme(repo.owner, repo.repo);
      if (readme.length >= MIN_KNOWLEDGE_CONTENT_CHARS) {
        return { ...base, text: readme, fetched: true };
      }
    } catch {
      // README 获取失败时回退到普通网页正文
    }
  }

  try {
    // 研习链路读取网页文章时不设 20,000 字截断（maxChars: 0），完整保留章节标题、代码块与长文全貌交由动态分章提炼处理
    const page = await withTimeout(fetchWebpageContent(item.url, { maxChars: 0 }), FETCH_TIMEOUT_MS);
    const text = normalizeText(page.content);
    if (text.length < MIN_KNOWLEDGE_CONTENT_CHARS) {
      return { ...base, text, reason: 'content_too_short' };
    }
    return { ...base, text, fetched: true };
  } catch (error: any) {
    return { ...base, reason: error?.message || 'fetch_failed' };
  }
}

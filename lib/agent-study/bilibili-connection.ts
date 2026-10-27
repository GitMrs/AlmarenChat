import prisma from '@/app/api/_lib/db';
import { decryptConnectorCredential } from '@/lib/connectors/credentials.mjs';
import { buildCookieHeader } from '@/lib/bilibili/auth.mjs';

const PROVIDER = 'BILIBILI_DAILY_STUDY';

export function agentBilibiliCredentialContext(userId: string, agentId: string) {
  return { spaceId: `agent:${userId}:${agentId}`, provider: PROVIDER };
}

export async function getAgentBilibiliConnection(userId: string, agentId: string) {
  const db: any = prisma;
  return db.agentModelSetting.findUnique({
    where: { userId_agentId: { userId, agentId } },
    select: {
      dailyStudyBilibiliCredentialCiphertext: true,
      dailyStudyBilibiliProfile: true,
      dailyStudyBilibiliLastCheckedAt: true,
      dailyStudyBilibiliLastError: true,
    },
  });
}

export async function getAgentBilibiliCookie(userId: string, agentId: string): Promise<string> {
  const setting = await getAgentBilibiliConnection(userId, agentId);
  if (!setting?.dailyStudyBilibiliCredentialCiphertext) return '';
  try {
    const raw = decryptConnectorCredential(
      setting.dailyStudyBilibiliCredentialCiphertext,
      agentBilibiliCredentialContext(userId, agentId),
    );
    const sessdata = String(raw.sessdata || '').trim();
    const biliJct = String(raw.biliJct || '').trim();
    if (!sessdata || !biliJct) return '';
    return buildCookieHeader({
      sessdata,
      biliJct,
      dedeUserId: String(raw.dedeUserId || '').trim(),
      dedeUserIdCkMd5: String(raw.dedeUserIdCkMd5 || '').trim(),
      buvid3: String(raw.buvid3 || '').trim(),
      buvid4: String(raw.buvid4 || '').trim(),
    });
  } catch {
    return '';
  }
}

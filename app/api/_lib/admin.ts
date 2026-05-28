import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';

function getAdminEmails() {
  return (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminEmail(email: string) {
  return getAdminEmails().includes(email.toLowerCase());
}

export async function requireAdmin(request: Request) {
  const userId = requireAuth(request);
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true },
  });

  if (!user) throw new Error('Unauthorized');
  if (!isAdminEmail(user.email)) {
    throw new Error('Forbidden');
  }

  return user;
}

export function adminErrorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : 'Request failed';
  if (message === 'Unauthorized') return { error: 'Unauthorized', status: 401 };
  if (message === 'Forbidden') return { error: 'Forbidden', status: 403 };
  return { error: message, status: 500 };
}

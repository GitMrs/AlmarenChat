import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'almaren-chat-secret-key';

export function signToken(userId: string): string {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '7d' });
}

export function verifyToken(token: string): { userId: string } | null {
  try {
    return jwt.verify(token, JWT_SECRET) as { userId: string };
  } catch {
    return null;
  }
}

export function getUserIdFromRequest(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) return null;
  return verifyToken(header.slice(7))?.userId ?? null;
}

export function requireAuth(request: Request): string {
  const userId = getUserIdFromRequest(request);
  if (!userId) throw new Error('Unauthorized');
  return userId;
}

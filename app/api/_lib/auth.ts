import jwt from 'jsonwebtoken';

/**
 * Fail fast in production if JWT_SECRET is not configured — a hardcoded
 * fallback secret would let anyone forge tokens for arbitrary users.
 * Dev keeps a well-known default so local setup stays frictionless.
 */
function resolveJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (secret && secret.length >= 16) return secret;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      '[auth] JWT_SECRET 环境变量未设置或过短（至少 16 字符）。生产环境拒绝使用默认密钥启动，以防止伪造登录令牌。'
    );
  }
  return 'almaren-chat-dev-secret-key';
}

const JWT_SECRET = resolveJwtSecret();

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
  if (header?.startsWith('Bearer ')) {
    return verifyToken(header.slice(7))?.userId ?? null;
  }
  try {
    const url = new URL(request.url);
    const queryToken = url.searchParams.get('token');
    if (queryToken) {
      return verifyToken(queryToken)?.userId ?? null;
    }
  } catch {
    // Ignore invalid URL parse
  }
  return null;
}

export function requireAuth(request: Request): string {
  const userId = getUserIdFromRequest(request);
  if (!userId) throw new Error('Unauthorized');
  return userId;
}

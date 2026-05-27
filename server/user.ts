import { Router, Request, Response } from 'express';
import prisma from './db';
import { authMiddleware } from './auth';

const router = Router();
router.use(authMiddleware);

// Search users (for adding friends)
router.get('/search', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const q = (req.query.q as string || '').trim();

    if (!q) {
      return res.json([]);
    }

    // 搜索名称或邮箱包含关键词的用户，排除自己
    const users = await prisma.user.findMany({
      where: {
        id: { not: userId },
        OR: [
          { name: { contains: q } },
          { email: { contains: q } },
        ],
      },
      select: { id: true, name: true, avatar: true, isOnline: true, email: true },
      take: 20,
    });

    res.json(users);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// List users (returns friends only)
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;

    // 使用原始 SQL 查询双向好友关系
    const friendships = await prisma.$queryRaw<any[]>`
      SELECT f.id as friendshipId,
        CASE WHEN f.userId = ${userId} THEN fu.id ELSE fu.id END as id,
        CASE WHEN f.userId = ${userId} THEN fu.name ELSE fu.name END as name,
        CASE WHEN f.userId = ${userId} THEN fu.avatar ELSE fu.avatar END as avatar,
        CASE WHEN f.userId = ${userId} THEN fu.isOnline ELSE fu.isOnline END as isOnline
      FROM Friendship f
      JOIN User fu ON (
        CASE WHEN f.userId = ${userId} THEN f.friendId ELSE f.userId END = fu.id
      )
      WHERE f.status = 'accepted'
        AND (f.userId = ${userId} OR f.friendId = ${userId})
    `;

    const friends = friendships.map((f: any) => ({
      id: f.id,
      name: f.name,
      avatar: f.avatar || '👤',
      isOnline: !!f.isOnline,
    }));

    res.json(friends);
  } catch (e: any) {
    console.error('Get users error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Update current user profile (must be before /:id route)
router.patch('/me', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { name, avatar } = req.body;

    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        ...(name && { name }),
        ...(avatar && { avatar }),
      },
      select: { id: true, name: true, avatar: true, email: true, isOnline: true },
    });

    res.json(updated);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Get user profile
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: { id: true, name: true, avatar: true, isOnline: true, email: true, createdAt: true },
    });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Update user profile (by id)
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const targetId = req.params.id;

    // Can only update own profile
    if (userId !== targetId) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const { name, avatar } = req.body;

    const updated = await prisma.user.update({
      where: { id: targetId },
      data: {
        ...(name && { name }),
        ...(avatar && { avatar }),
      },
      select: { id: true, name: true, avatar: true, email: true, isOnline: true },
    });

    res.json(updated);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
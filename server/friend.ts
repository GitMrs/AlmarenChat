import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import prisma from './db';
import { authMiddleware } from './auth';

const router = Router();
router.use(authMiddleware);

// 获取好友列表（已接受的好友）
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;

    // 使用原始 SQL 查询双向好友关系
    const friendships = await prisma.$queryRaw<any[]>`
      SELECT f.*,
        CASE WHEN f.userId = ${userId} THEN fu.id ELSE fu.id END as friendUserId,
        CASE WHEN f.userId = ${userId} THEN fu.name ELSE fu.name END as friendName,
        CASE WHEN f.userId = ${userId} THEN fu.avatar ELSE fu.avatar END as friendAvatar,
        CASE WHEN f.userId = ${userId} THEN fu.isOnline ELSE fu.isOnline END as friendIsOnline
      FROM Friendship f
      JOIN User fu ON (
        CASE WHEN f.userId = ${userId} THEN f.friendId ELSE f.userId END = fu.id
      )
      WHERE f.status = 'accepted'
        AND (f.userId = ${userId} OR f.friendId = ${userId})
    `;

    const friends = friendships.map((f: any) => ({
      friendshipId: f.id,
      id: f.friendUserId,
      name: f.friendName,
      avatar: f.friendAvatar || '👤',
      isOnline: !!f.friendIsOnline,
    }));

    res.json(friends);
  } catch (e: any) {
    console.error('Get friends error:', e);
    res.status(500).json({ error: e.message });
  }
});

// 获取好友请求列表（收到的 pending 请求）
router.get('/requests', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;

    const requests = await prisma.$queryRaw<any[]>`
      SELECT f.*, u.id as user_id, u.name as user_name, u.avatar as user_avatar, u.isOnline as user_isOnline
      FROM Friendship f
      JOIN User u ON f.userId = u.id
      WHERE f.friendId = ${userId} AND f.status = 'pending'
    `;

    const result = requests.map((r: any) => ({
      id: r.id,
      userId: r.userId,
      friendId: r.friendId,
      status: r.status,
      user: {
        id: r.user_id,
        name: r.user_name,
        avatar: r.user_avatar || '👤',
        isOnline: !!r.user_isOnline,
      },
    }));

    res.json(result);
  } catch (e: any) {
    console.error('Get requests error:', e);
    res.status(500).json({ error: e.message });
  }
});

// 发送好友请求
router.post('/request/:userId', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const targetUserId = req.params.userId;

    if (userId === targetUserId) {
      return res.status(400).json({ error: 'Cannot add yourself' });
    }

    // 检查目标用户是否存在
    const targetUser = await prisma.user.findUnique({ where: { id: targetUserId } });
    if (!targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    // 检查是否已经是好友或已有请求
    const existing = await prisma.$queryRaw<any[]>`
      SELECT * FROM Friendship
      WHERE (userId = ${userId} AND friendId = ${targetUserId})
         OR (userId = ${targetUserId} AND friendId = ${userId})
      LIMIT 1
    `;

    if (existing && existing.length > 0) {
      if (existing[0].status === 'accepted') {
        return res.status(400).json({ error: 'Already friends' });
      }
      if (existing[0].status === 'pending') {
        return res.status(400).json({ error: 'Request already sent' });
      }
    }

    // 创建好友请求 - 使用原始 SQL 以避免 Prisma 类型问题
    const id = randomUUID();
    await prisma.$executeRaw`
      INSERT INTO Friendship (id, userId, friendId, status, createdAt, updatedAt)
      VALUES (${id}, ${userId}, ${targetUserId}, 'pending', datetime('now'), datetime('now'))
    `;

    res.json({ id, userId, friendId: targetUserId, status: 'pending' });
  } catch (e: any) {
    console.error('Send request error:', e);
    res.status(500).json({ error: e.message });
  }
});

// 接受好友请求
router.post('/accept/:friendshipId', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const friendshipId = req.params.friendshipId;

    // 检查请求是否存在且属于当前用户
    const friendship = await prisma.$queryRaw<any[]>`
      SELECT * FROM Friendship WHERE id = ${friendshipId} LIMIT 1
    `;

    if (!friendship || friendship.length === 0) {
      return res.status(404).json({ error: 'Request not found' });
    }

    if (friendship[0].friendId !== userId) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    if (friendship[0].status !== 'pending') {
      return res.status(400).json({ error: 'Request not pending' });
    }

    // 更新状态
    await prisma.$executeRaw`
      UPDATE Friendship SET status = 'accepted', updatedAt = datetime('now')
      WHERE id = ${friendshipId}
    `;

    res.json({ ...friendship[0], status: 'accepted' });
  } catch (e: any) {
    console.error('Accept request error:', e);
    res.status(500).json({ error: e.message });
  }
});

// 拒绝好友请求
router.post('/reject/:friendshipId', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const friendshipId = req.params.friendshipId;

    // 检查请求是否存在且属于当前用户
    const friendship = await prisma.$queryRaw<any[]>`
      SELECT * FROM Friendship WHERE id = ${friendshipId} LIMIT 1
    `;

    if (!friendship || friendship.length === 0) {
      return res.status(404).json({ error: 'Request not found' });
    }

    if (friendship[0].friendId !== userId) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    // 删除请求
    await prisma.$executeRaw`
      DELETE FROM Friendship WHERE id = ${friendshipId}
    `;

    res.json({ success: true });
  } catch (e: any) {
    console.error('Reject request error:', e);
    res.status(500).json({ error: e.message });
  }
});

// 删除好友
router.delete('/:userId', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const friendId = req.params.userId;

    // 删除双向好友关系
    await prisma.$executeRaw`
      DELETE FROM Friendship
      WHERE (userId = ${userId} AND friendId = ${friendId})
         OR (userId = ${friendId} AND friendId = ${userId})
    `;

    res.json({ success: true });
  } catch (e: any) {
    console.error('Delete friend error:', e);
    res.status(500).json({ error: e.message });
  }
});

export default router;
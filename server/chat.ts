import { Router, Request, Response } from 'express';
import prisma from './db';
import { authMiddleware } from './auth';

const router = Router();
router.use(authMiddleware);

// Get all chats for current user
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const chats = await prisma.chat.findMany({
      where: { users: { some: { userId } } },
      include: {
        users: { include: { user: true, agent: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: { updatedAt: 'desc' },
    });
    res.json(chats);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Create a new chat
router.post('/', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { targetUserId, agentId, title } = req.body;

    const chat = await prisma.chat.create({
      data: {
        title,
        users: {
          create: [
            { userId },
            ...(targetUserId ? [{ userId: targetUserId }] : []),
            ...(agentId ? [{ userId: userId, agentId }] : []),
          ],
        },
      },
      include: { users: { include: { user: true, agent: true } } },
    });

    res.json(chat);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Get chat detail
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const chat = await prisma.chat.findUnique({
      where: { id: req.params.id },
      include: {
        users: { include: { user: true, agent: true } },
      },
    });
    if (!chat) return res.status(404).json({ error: 'Chat not found' });
    res.json(chat);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Get messages for a chat (with pagination)
router.get('/:id/messages', async (req: Request, res: Response) => {
  try {
    const { cursor, limit = '50' } = req.query;
    const take = Math.min(parseInt(limit as string) || 50, 100);

    const messages = await prisma.message.findMany({
      where: { chatId: req.params.id },
      orderBy: { createdAt: 'desc' },
      take,
      ...(cursor ? { skip: 1, cursor: { id: cursor as string } } : {}),
    });

    res.json(messages.reverse());
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Send a message
router.post('/:id/messages', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { content, type = 'text' } = req.body;

    const message = await prisma.message.create({
      data: {
        chatId: req.params.id,
        senderId: userId,
        content,
        type,
      },
    });

    // Update chat's updatedAt
    await prisma.chat.update({
      where: { id: req.params.id },
      data: { updatedAt: new Date() },
    });

    res.json(message);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;

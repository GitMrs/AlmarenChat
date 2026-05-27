import { Router, Request, Response } from 'express';
import prisma from './db';
import { authMiddleware } from './auth';

const router = Router();
router.use(authMiddleware);

// List agents
router.get('/', async (req: Request, res: Response) => {
  try {
    const agents = await prisma.agent.findMany({
      where: { isPublic: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json(agents);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Create agent
router.post('/', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { name, avatar, description, systemPrompt, apiBaseUrl, apiKey, modelName } = req.body;

    const agent = await prisma.agent.create({
      data: { name, avatar, description, systemPrompt, apiBaseUrl, apiKey, modelName, creatorId: userId },
    });
    res.json(agent);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Update agent
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const agentId = req.params.id;
    const { name, avatar, description, systemPrompt, apiBaseUrl, apiKey, modelName } = req.body;

    const agent = await prisma.agent.findUnique({ where: { id: agentId } });
    if (!agent) return res.status(404).json({ error: 'Agent not found' });

    // Only allow creator to update
    if (agent.creatorId && agent.creatorId !== userId) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const updated = await prisma.agent.update({
      where: { id: agentId },
      data: { name, avatar, description, systemPrompt, apiBaseUrl, apiKey, modelName },
    });
    res.json(updated);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Delete agent
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const agentId = req.params.id;

    const agent = await prisma.agent.findUnique({ where: { id: agentId } });
    if (!agent) return res.status(404).json({ error: 'Agent not found' });

    if (agent.creatorId && agent.creatorId !== userId) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    await prisma.agent.delete({ where: { id: agentId } });
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Get agent detail
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const agent = await prisma.agent.findUnique({ where: { id: req.params.id } });
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    res.json(agent);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;

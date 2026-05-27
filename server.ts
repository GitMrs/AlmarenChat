import express from 'express';
import path from 'path';
import { createServer } from 'http';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import cors from 'cors';
import authRoutes from './server/auth';
import chatRoutes from './server/chat';
import agentRoutes from './server/agent';
import userRoutes from './server/user';
import friendRoutes from './server/friend';
import prisma from './server/db';
import { setupSocket } from './server/socket';

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());
  app.use(cors());

  // API routes
  app.use('/api/auth', authRoutes);
  app.use('/api/chats', chatRoutes);
  app.use('/api/agents', agentRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/friends', friendRoutes);

  // AI chat endpoint (streaming)
  let defaultAi: GoogleGenAI | null = null;

  app.post('/api/chat', async (req, res) => {
    try {
      const { message, history, context, agentId, apiBaseUrl, apiKey, modelName } = req.body;

      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Transfer-Encoding', 'chunked');

      // Use custom API if provided (user-created agent with custom config)
      if (apiBaseUrl && apiKey && modelName) {
        try {
          const client = new OpenAI({
            baseURL: apiBaseUrl,
            apiKey: apiKey,
          });

          const openaiMessages = history.map((msg: any) => ({
            role: msg.senderId === 'me' ? 'user' : 'assistant',
            content: msg.content,
          }));
          if (context) {
            openaiMessages.unshift({ role: 'system', content: context });
          }
          openaiMessages.push({ role: 'user', content: message });

          const stream = await client.chat.completions.create({
            model: modelName,
            messages: openaiMessages,
            stream: true,
          });

          for await (const chunk of stream) {
            if (chunk.choices[0]?.delta?.content) {
              res.write(chunk.choices[0].delta.content);
            }
          }
          res.end();
          return;
        } catch (e: any) {
          console.error('Custom API Error:', e);
          res.status(500).json({ error: `API Error: ${e.message}` });
          return;
        }
      }

      // Use default Gemini if no custom config
      if (!defaultAi) {
        const key = process.env.GEMINI_API_KEY;
        if (!key) {
          res.status(500).json({ error: 'GEMINI_API_KEY environment variable is required' });
          return;
        }
        defaultAi = new GoogleGenAI({
          apiKey: key,
          httpOptions: {
            headers: { 'User-Agent': 'aistudio-build' },
          },
        });
      }

      const contents = history.map((msg: any) => ({
        role: msg.senderId === 'me' ? 'user' : 'model',
        parts: [{ text: msg.content }],
      }));
      contents.push({ role: 'user', parts: [{ text: message }] });

      const responseStream = await defaultAi.models.generateContentStream({
        model: 'gemini-3.5-flash',
        contents,
        config: {
          systemInstruction: context || 'You are a helpful AI assistant.',
        },
      });

      for await (const chunk of responseStream) {
        if (chunk.text) {
          res.write(chunk.text);
        }
      }
      res.end();
    } catch (e: any) {
      console.error('AI Chat Error:', e);
      res.status(500).json({ error: e.message || 'An error occurred during text generation.' });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Create HTTP server and attach Socket.io
  const httpServer = createServer(app);
  setupSocket(httpServer);

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();

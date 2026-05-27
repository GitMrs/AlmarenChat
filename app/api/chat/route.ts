import { NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';

export async function POST(request: Request) {
  try {
    const { message, history, context, apiBaseUrl, apiKey, modelName } = await request.json();

    // Custom OpenAI-compatible API
    if (apiBaseUrl && apiKey && modelName) {
      const client = new OpenAI({ baseURL: apiBaseUrl, apiKey });
      const openaiMessages = history.map((msg: { role: string; content: string }) => ({
        role: msg.role === 'user' ? ('user' as const) : ('assistant' as const),
        content: msg.content,
      }));
      if (context) openaiMessages.unshift({ role: 'system', content: context });
      openaiMessages.push({ role: 'user', content: message });

      const stream = await client.chat.completions.create({
        model: modelName,
        messages: openaiMessages,
        stream: true,
      });

      const encoder = new TextEncoder();
      const readable = new ReadableStream({
        async start(controller) {
          for await (const chunk of stream) {
            if (chunk.choices[0]?.delta?.content) {
              controller.enqueue(encoder.encode(chunk.choices[0].delta.content));
            }
          }
          controller.close();
        },
      });

      return new Response(readable, {
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }

    // Default Gemini
    const ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY!,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
    });

    const contents = history.map((msg: { role: string; content: string }) => ({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.content }],
    }));
    contents.push({ role: 'user', parts: [{ text: message }] });

    const responseStream = await ai.models.generateContentStream({
      model: 'gemini-3.5-flash',
      contents,
      config: { systemInstruction: context || 'You are a helpful AI assistant.' },
    });

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        for await (const chunk of responseStream) {
          if (chunk.text) {
            controller.enqueue(encoder.encode(chunk.text));
          }
        }
        controller.close();
      },
    });

    return new Response(readable, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

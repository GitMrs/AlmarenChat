import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { createModelClient, resolveModelName } from '@/lib/model-client';
import { classifyReminderRequest } from '@/lib/personal-assistant/reminder-intent.mjs';
import { buildReminderExtractionPrompt, parseReminderExtraction } from '@/lib/personal-assistant/reminder-extraction.mjs';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const userId = requireAuth(request);
    const body = await request.json().catch(() => ({}));
    const userMessage = typeof body.userMessage === 'string' ? body.userMessage.trim() : '';
    if (!userMessage || userMessage.length < 2) {
      return NextResponse.json({ hasReminder: false });
    }

    const reminderIntent = classifyReminderRequest(userMessage);
    if (!reminderIntent.hasCue) {
      return NextResponse.json({ hasReminder: false });
    }

    const prompt = buildReminderExtractionPrompt(userMessage);

    const modelMessages = [{ role: 'user' as const, content: prompt }];
    const hasLocalResponse = typeof body.localResponse === 'string';
    let rawText = hasLocalResponse ? body.localResponse.trim() : '';

    if (!hasLocalResponse && body.localOnly === true) {
      return NextResponse.json({
        hasReminder: true,
        explicit: reminderIntent.explicit,
        candidates: [],
        modelMessages,
      });
    }

    if (!hasLocalResponse) {
      const userSettings = await prisma.user.findUnique({
        where: { id: userId },
        select: { customModelEnabled: true, apiBaseUrl: true, apiKey: true, modelName: true },
      });
      const usesCustom = Boolean(
        userSettings?.customModelEnabled && userSettings?.apiBaseUrl && userSettings?.apiKey
      );
      const client = createModelClient(
        usesCustom ? userSettings?.apiBaseUrl : undefined,
        usesCustom ? userSettings?.apiKey : undefined
      );
      const model = resolveModelName(usesCustom ? userSettings?.modelName : undefined);
      const completion = await client.chat.completions.create({
        model,
        messages: modelMessages,
        temperature: 0.1,
        max_tokens: 400,
      });
      rawText = completion.choices[0]?.message?.content?.trim() || '';
    }

    const candidates = parseReminderExtraction(rawText).map((item) => ({
      content: item.content,
      dueTime: item.dueTime ? item.dueTime.toISOString() : null,
    }));

    if (candidates.length === 0) {
      return NextResponse.json({ hasReminder: false });
    }

    return NextResponse.json({
      hasReminder: true,
      explicit: reminderIntent.explicit,
      candidates,
    });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ hasReminder: false, error: error.message }, { status: 500 });
  }
}

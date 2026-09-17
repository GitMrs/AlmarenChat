import { getUserIdFromRequest } from '@/app/api/_lib/auth';
import { agentSupervisor } from '@/lib/coding-agents/supervisor';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const userId = getUserIdFromRequest(request);
  if (!userId) {
    return new Response('Unauthorized', { status: 401 });
  }

  const { sessionId } = await params;
  const session = agentSupervisor.getSession(userId, sessionId);
  if (!session) {
    return new Response('Session Not Found', { status: 404 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // 1. Flush historical log backlog
      for (const line of session.logBuffer) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: 'stdout', data: line + '\n', timestamp: session.startedAt })}\n\n`)
        );
      }

      // If already ended, send final exit event and close
      if (session.status !== 'RUNNING') {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              type: 'exit',
              data: JSON.stringify({ status: session.status, exitCode: session.exitCode }),
              timestamp: session.endedAt || Date.now(),
            })}\n\n`
          )
        );
        controller.close();
        return;
      }

      // 2. Subscribe to live stream events
      const unsubscribe = agentSupervisor.subscribeSession(sessionId, (event) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          if (event.type === 'exit') {
            unsubscribe();
            controller.close();
          }
        } catch {
          unsubscribe();
        }
      });

      // Cleanup on abort
      request.signal.addEventListener('abort', () => {
        unsubscribe();
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}

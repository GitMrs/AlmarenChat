import { NextResponse } from 'next/server';
import { QQ_WEBHOOK_PATH } from '@/lib/qq-assistant/webhook.mjs';

export const runtime = 'nodejs';

// 仅允许 base64url token，防止路径注入
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,256}$/;

function workerBaseUrl() {
  const explicit = process.env.QQ_ASSISTANT_WEBHOOK_INTERNAL_URL?.trim().replace(/\/+$/, '');
  if (explicit) return explicit;
  const port = process.env.QQ_ASSISTANT_WEBHOOK_PORT || '8787';
  return `http://127.0.0.1:${port}`;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    if (!TOKEN_PATTERN.test(token)) {
      return NextResponse.json({ error: 'Webhook 地址无效' }, { status: 404 });
    }

    const contentType = request.headers.get('content-type') || 'application/json';
    const body = await request.arrayBuffer();

    const targetUrl = `${workerBaseUrl()}${QQ_WEBHOOK_PATH}/${encodeURIComponent(token)}`;
    const upstream = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': contentType,
        // 不转发 Cookie 等浏览器凭证，worker 只认 URL token
      },
      body,
      signal: AbortSignal.timeout(25_000),
    });

    const responseBody = await upstream.arrayBuffer();
    return new NextResponse(responseBody, {
      status: upstream.status,
      headers: {
        'Content-Type': upstream.headers.get('content-type') || 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  } catch (error: any) {
    const reason = error?.name === 'TimeoutError' ? 'QQ Worker 转发超时' : (error?.message || '转发失败');
    return NextResponse.json({ error: reason }, { status: 502 });
  }
}

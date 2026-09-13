import { NextResponse } from 'next/server';
import { requireAuth } from '@/app/api/_lib/auth';
import { createHttpMcpClient } from '@/lib/agent-runtime/mcp-client.mjs';

export const runtime = 'nodejs';

function sanitizeHeaders(input: unknown): Record<string, string> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const entries = Object.entries(input as Record<string, unknown>)
    .filter(([key, value]) => /^[A-Za-z0-9-]{1,80}$/.test(key) && typeof value === 'string')
    .slice(0, 16);
  return Object.fromEntries(entries) as Record<string, string>;
}

export async function POST(request: Request) {
  try {
    requireAuth(request);
    const body = await request.json().catch(() => ({}));
    const rawUrl = String(body?.url || '').trim();

    if (!rawUrl) {
      return NextResponse.json({ ok: false, error: '请输入 MCP 服务的端点地址' }, { status: 400 });
    }

    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      return NextResponse.json({ ok: false, error: '无效的 URL 地址' }, { status: 400 });
    }

    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) {
      return NextResponse.json({ ok: false, error: 'MCP 服务必须使用 HTTPS 协议（本地开发可使用 localhost/127.0.0.1）' }, { status: 400 });
    }

    const headers = sanitizeHeaders(body?.headers);
    const client = (createHttpMcpClient as any)({
      url: url.toString(),
      headers,
      timeoutMs: 12_000,
    });

    const startTime = Date.now();
    const tools = await client.listTools();
    const latencyMs = Date.now() - startTime;

    return NextResponse.json({
      ok: true,
      latencyMs,
      count: tools.length,
      tools: tools.map((tool: any) => ({
        name: String(tool?.name || ''),
        description: typeof tool?.description === 'string' ? tool.description : '',
        inputSchema: tool?.inputSchema || null,
      })),
    });
  } catch (error: any) {
    if (error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({
      ok: false,
      error: error?.message || '探测 MCP 服务失败，请检查地址与认证信息',
    });
  }
}

import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { getSpaceForUser } from '@/app/api/_lib/spaces';
import { encryptConnectorCredential } from '@/lib/connectors/credentials.mjs';
import { parseMcpServers } from '@/lib/agent-runtime/mcp-config.mjs';

export const runtime = 'nodejs';

function publicServer(row: any) {
  return { id: row.id, name: row.name, url: row.url, enabled: Boolean(row.enabled), createdAt: row.createdAt, updatedAt: row.updatedAt, hasHeaders: Boolean(row.headersCiphertext) };
}

export async function GET(request: Request, { params }: { params: Promise<{ spaceId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { spaceId } = await params;
    if (!await getSpaceForUser(spaceId, userId)) return NextResponse.json({ error: 'Space not found' }, { status: 404 });
    const rows = await prisma.$queryRawUnsafe<any[]>(`SELECT "id","name","url","enabled","headersCiphertext","createdAt","updatedAt" FROM "SpaceMcpServer" WHERE "spaceId" = ? ORDER BY "createdAt" ASC`, spaceId);
    return NextResponse.json({ servers: rows.map(publicServer) });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ spaceId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { spaceId } = await params;
    if (!await getSpaceForUser(spaceId, userId)) return NextResponse.json({ error: 'Space not found' }, { status: 404 });
    const body = await request.json();
    const parsed = parseMcpServers([{ id: body?.name, url: body?.url, headers: body?.headers }]);
    if (parsed.length !== 1) return NextResponse.json({ error: 'MCP 名称或地址无效，地址必须使用 HTTPS' }, { status: 400 });
    const server = parsed[0];
    const id = randomUUID();
    const headersCiphertext = Object.keys(server.headers).length > 0
      ? encryptConnectorCredential(server.headers, { spaceId, provider: `MCP_${server.id}` })
      : null;
    const timestamp = new Date().toISOString();
    await prisma.$executeRawUnsafe(`INSERT INTO "SpaceMcpServer" ("id","spaceId","name","url","headersCiphertext","enabled","createdAt","updatedAt") VALUES (?,?,?,?,?,1,?,?)`, id, spaceId, server.id, server.url, headersCiphertext, timestamp, timestamp);
    const rows = await prisma.$queryRawUnsafe<any[]>(`SELECT "id","name","url","enabled","headersCiphertext","createdAt","updatedAt" FROM "SpaceMcpServer" WHERE "id" = ?`, id);
    return NextResponse.json({ server: publicServer(rows[0]) }, { status: 201 });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (String(error.message).includes('UNIQUE')) return NextResponse.json({ error: '该空间已存在同名 MCP' }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

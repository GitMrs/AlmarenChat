import { NextResponse } from 'next/server';
import { readdir, readFile, writeFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { testPersonalConnector, assertConnectorScope } from '@/app/api/_lib/personal-connectors';
import { listConnectorBindings } from '@/lib/connectors/personal-store.mjs';
import { FEISHU_URL, feishuAuth, feishuPaths, feishuState, prepareFeishu, safeFeishuFile, runFeishu, validateFeishuArgs, validateFeishuFiles, redactFeishuResult, listFeishuFiles } from '@/lib/connectors/feishu-cli.mjs';
import { callFeishuEvents } from '@/lib/connectors/feishu-events.mjs';

export const runtime = 'nodejs';
export const maxDuration = 180;
type Context = { params: Promise<{ connectorId: string }> };

async function load(request: Request, context: Context) {
  const userId = requireAuth(request);
  const id = (await context.params).connectorId;
  const server = await testPersonalConnector(userId, id);
  if (server.url !== FEISHU_URL) throw new Error('不是飞书 CLI 连接器');
  return { userId, id, server };
}

async function withScope(userId: string, id: string, server: any, input: any) {
  const target = await assertConnectorScope(userId, input.scope, input.scopeId);
  if (!(await listConnectorBindings(prisma, userId, target.scope, target.scopeId)).includes(id)) throw new Error('此入口尚未开启该连接器');
  return { ...server, ...target };
}

export async function GET(request: Request, context: Context) {
  try {
    const { userId, id, server } = await load(request, context);
    const query = new URL(request.url).searchParams;
    if (query.get('action') === 'files') {
      const scoped = await withScope(userId, id, server, Object.fromEntries(query));
      const { dirs } = await prepareFeishu(scoped);
      const file = query.get('file');
      if (file) {
        const target = await safeFeishuFile(dirs.files, file, { mustExist: true });
        if ((await lstat(target)).size > 8 * 1024 * 1024) throw new Error('文件超过 8MB 下载限制');
        return NextResponse.json({ name: path.basename(file), base64: (await readFile(target)).toString('base64') });
      }
      return NextResponse.json({ files: await listFeishuFiles(dirs.files) });
    }
    const bindings = await prisma.$queryRawUnsafe<any[]>('SELECT "scope", "scopeId" FROM "ConnectorBinding" WHERE "userId" = ? AND "connectorId" = ?', userId, id);
    const pending = [];
    try {
      for (const name of await readdir(feishuPaths(server).account)) {
        if (!/^approval-[a-f0-9-]{36}\.enc$/.test(name)) continue;
        const item = await feishuState(server, name.slice(0, -4));
        if (item?.expiresAt > Date.now() && !item.claimed) pending.push({ id: name.slice(9, -4), argv: item.argv, stdin: item.stdin, scope: item.scope, scopeId: item.scopeId, expiresAt: item.expiresAt });
      }
    } catch (error: any) { if (error.code !== 'ENOENT') throw error; }
    return NextResponse.json({ bindings, pending, status: await feishuAuth(server, 'status') });
  } catch (error: any) { return NextResponse.json({ error: error.message }, { status: error.message === 'Unauthorized' ? 401 : 400 }); }
}

export async function POST(request: Request, context: Context) {
  try {
    const { userId, id, server } = await load(request, context);
    // Bound JSON upload size before decoding base64.
    const text = await request.text();
    if (text.length > 12 * 1024 * 1024) throw new Error('请求超过 12MB');
    const input = JSON.parse(text);
    if (input.action === 'events') {
      const scoped = await withScope(userId, id, server, input);
      return NextResponse.json(callFeishuEvents(scoped, input.event || {}));
    }
    if (['start', 'complete', 'logout', 'status'].includes(input.action)) {
      const result = await feishuAuth(server, input.action, { domains: input.domains });
      if (input.action === 'logout') await prisma.$executeRawUnsafe('UPDATE "ConnectorSubscription" SET "enabled" = 0, "status" = ? WHERE "connectorId" = ? AND "userId" = ? AND "identity" = ?', 'stopping', id, userId, 'user');
      return NextResponse.json(result);
    }
    if (input.action === 'upload') {
      const scoped = await withScope(userId, id, server, input);
      const { dirs } = await prepareFeishu(scoped);
      const target = await safeFeishuFile(dirs.files, input.name);
      const content = Buffer.from(String(input.base64 || ''), 'base64');
      if (content.length > 8 * 1024 * 1024) throw new Error('文件超过 8MB');
      await writeFile(target, content, { mode: 0o600, flag: 'wx' });
      return NextResponse.json({ ok: true });
    }
    if (input.action === 'approve' || input.action === 'reject') {
      if (!/^[a-f0-9-]{36}$/.test(input.approvalId)) throw new Error('审批标识无效');
      const key = `approval-${input.approvalId}`;
      const item = await feishuState(server, key);
      if (!item || item.claimed || item.expiresAt < Date.now()) throw new Error('审批已处理或过期');
      const scoped = await withScope(userId, id, server, item);
      // Exclusive claim across web processes: never replay an approved write.
      const claimPath = path.join(feishuPaths(server).account, key + '.claimed');
      await writeFile(claimPath, '', { flag: 'wx', mode: 0o600 });
      await feishuState(server, key, { ...item, claimed: true });
      if (input.action === 'reject') return NextResponse.json({ ok: true });
      const { dirs, env } = await prepareFeishu(scoped);
      const argv = validateFeishuArgs(item.argv, { confirmation: true });
      await validateFeishuFiles(dirs.files, argv);
      return NextResponse.json(redactFeishuResult(await runFeishu([...argv, '--yes'], { env, cwd: dirs.files, stdin: item.stdin }), scoped));
    }
    throw new Error('未知飞书操作');
  } catch (error: any) { return NextResponse.json({ error: error.message }, { status: error.message === 'Unauthorized' ? 401 : 400 }); }
}

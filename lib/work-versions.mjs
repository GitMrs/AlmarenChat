import { createHash, randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

function resolveSpacePath(userId, spaceId, relativePath) {
  const raw = String(relativePath || '').trim().replaceAll('\\', '/');
  if (!raw || raw.startsWith('/') || raw.startsWith('~') || raw.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error('Invalid project-relative path');
  }
  const root = path.resolve(process.cwd(), 'data', 'spaces', String(userId), String(spaceId));
  const target = path.resolve(root, raw);
  if (!target.startsWith(`${root}${path.sep}`)) throw new Error('Path outside space is forbidden');
  return target;
}

function versionRoot(userId, spaceId, workId, version) {
  return resolveSpacePath(userId, spaceId, `.versions/${workId}/v${version}`);
}

function fileTarget(userId, spaceId, relativePath) {
  return resolveSpacePath(userId, spaceId, relativePath);
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export async function createWorkVersion({ prisma, userId, spaceId, work, summary, sourceRunId = null, sourceTaskId = null }) {
  const files = await prisma.spaceFile.findMany({
    where: { spaceId, workId: work.id, status: 'READY' },
    orderBy: [{ relativePath: 'asc' }, { updatedAt: 'asc' }],
  });
  const latest = await prisma.spaceWorkVersion.findFirst({ where: { workId: work.id }, orderBy: { version: 'desc' }, select: { version: true } });
  const version = (latest?.version || 0) + 1;
  const root = versionRoot(userId, spaceId, work.id, version);
  await mkdir(root, { recursive: true });
  const manifest = [];
  for (const file of files) {
    const source = fileTarget(userId, spaceId, file.relativePath);
    const target = path.join(root, file.relativePath.replace(/^workspace\//, ''));
    await mkdir(path.dirname(target), { recursive: true });
    const bytes = await readFile(source);
    await writeFile(target, bytes);
    manifest.push({
      relativePath: file.relativePath,
      fileName: file.fileName,
      mimeType: file.mimeType,
      size: bytes.byteLength,
      sha256: digest(bytes),
      snapshotPath: path.relative(root, target).replaceAll(path.sep, '/'),
    });
  }
  const record = await prisma.spaceWorkVersion.create({
    data: {
      id: randomUUID(), workId: work.id, version,
      summary: String(summary || '').trim().slice(0, 500) || null,
      manifest, sourceRunId, sourceTaskId,
    },
  });
  return { record, manifest };
}

export async function restoreWorkVersion({ prisma, userId, spaceId, work, version }) {
  const record = await prisma.spaceWorkVersion.findFirst({ where: { id: version.id, workId: work.id } });
  if (!record) throw new Error('版本不存在');
  const manifest = Array.isArray(record.manifest) ? record.manifest : [];
  const root = versionRoot(userId, spaceId, work.id, record.version);
  for (const item of manifest) {
    const source = path.resolve(root, String(item.snapshotPath || ''));
    const target = fileTarget(userId, spaceId, String(item.relativePath || ''));
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(source, target);
  }
  const restoredAt = new Date();
  await prisma.$transaction(manifest.map((item) => prisma.spaceFile.updateMany({
    where: { spaceId, workId: work.id, relativePath: item.relativePath },
    data: { size: item.size, updatedAt: restoredAt, status: 'READY' },
  })));
  await prisma.spaceWork.update({ where: { id: work.id }, data: { updatedAt: restoredAt } });
  return record;
}

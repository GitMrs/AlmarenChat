import { randomUUID } from 'node:crypto';
import { chmod, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';

export function resolveSqliteDatabasePath(databaseUrl, cwd = process.cwd()) {
  const value = String(databaseUrl || '').trim().replace(/^['"]|['"]$/g, '');
  if (!value.startsWith('file:')) throw new Error('数据库备份仅支持 SQLite file: URL');
  const filePath = decodeURIComponent(value.slice('file:'.length).split('?')[0]);
  if (!filePath) throw new Error('SQLite 数据库路径不能为空');
  return path.resolve(cwd, filePath);
}

function backupFileName(databasePath, date) {
  const extension = path.extname(databasePath) || '.db';
  const stem = path.basename(databasePath, extension);
  const timestamp = date.toISOString().replace(/[-:]/g, '').replace('T', '-').replace('Z', '');
  return `${stem}-${timestamp}-${randomUUID().slice(0, 8)}${extension}`;
}

export async function backupSqliteDatabase({
  databaseUrl,
  cwd = process.cwd(),
  backupDirectory,
  now = () => new Date(),
} = {}) {
  const databasePath = resolveSqliteDatabasePath(databaseUrl, cwd);
  try {
    await stat(databasePath);
  } catch (error) {
    if (error?.code === 'ENOENT') return { skipped: true, databasePath, backupPath: null };
    throw error;
  }

  const directory = backupDirectory
    ? path.resolve(cwd, backupDirectory)
    : path.join(path.dirname(databasePath), 'backups');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const backupPath = path.join(directory, backupFileName(databasePath, now()));
  const source = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    await source.backup(backupPath);
  } finally {
    source.close();
  }
  await chmod(backupPath, 0o600);

  const backup = new Database(backupPath, { readonly: true, fileMustExist: true });
  try {
    const check = backup.pragma('quick_check', { simple: true });
    if (check !== 'ok') throw new Error(`SQLite 备份完整性检查失败：${check}`);
  } finally {
    backup.close();
  }
  return { skipped: false, databasePath, backupPath };
}

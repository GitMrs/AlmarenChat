import Database from 'better-sqlite3';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';

const database = new Database(':memory:');
database.prepare('SELECT 1').get();
database.close();

const factory = new PrismaBetterSqlite3({ url: 'file::memory:' });
const adapter = await factory.connect();

try {
  await adapter.queryRaw({ sql: 'SELECT 1', args: [], argTypes: [] });
} finally {
  await adapter.dispose();
}

console.log('SQLite native bindings are ready.');

import 'dotenv/config';
import { backupSqliteDatabase } from '../lib/sqlite-backup.mjs';

const result = await backupSqliteDatabase({
  databaseUrl: process.env.DATABASE_URL || 'file:./data/dev.db',
  backupDirectory: process.env.DATABASE_BACKUP_DIR || undefined,
});

if (result.skipped) {
  console.log(`SQLite database does not exist yet; backup skipped: ${result.databasePath}`);
} else {
  console.log(`SQLite backup created and verified: ${result.backupPath}`);
}

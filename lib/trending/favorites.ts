import Database from 'better-sqlite3';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export interface TrendingFavoriteItem {
  id: string;
  userId: string;
  source: string;
  sourceName: string;
  itemId: string;
  title: string;
  url: string;
  heat?: string | null;
  desc?: string | null;
  category?: string | null;
  date?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FavoriteInput {
  source: string;
  sourceName: string;
  itemId: string;
  title: string;
  url: string;
  heat?: string;
  desc?: string;
  category?: string;
  date?: string;
}

let dbInstance: any = null;

function getDb() {
  if (!dbInstance) {
    const dbPath = path.join(process.cwd(), 'dev.db');
    dbInstance = new Database(dbPath);
    // 自动初始化收藏表和索引
    dbInstance.exec(`
      CREATE TABLE IF NOT EXISTS TrendingFavorite (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        source TEXT NOT NULL,
        sourceName TEXT NOT NULL,
        itemId TEXT NOT NULL,
        title TEXT NOT NULL,
        url TEXT NOT NULL,
        heat TEXT,
        desc TEXT,
        category TEXT,
        date TEXT,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (userId) REFERENCES User(id) ON DELETE CASCADE
      );
      CREATE UNIQUE INDEX IF NOT EXISTS TrendingFavorite_userId_source_itemId_key ON TrendingFavorite(userId, source, itemId);
      CREATE INDEX IF NOT EXISTS TrendingFavorite_userId_createdAt_idx ON TrendingFavorite(userId, createdAt);
      CREATE INDEX IF NOT EXISTS TrendingFavorite_userId_source_idx ON TrendingFavorite(userId, source);
    `);
  }
  return dbInstance;
}

export function getUserFavorites(userId: string): TrendingFavoriteItem[] {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT * FROM TrendingFavorite
    WHERE userId = ?
    ORDER BY createdAt DESC
  `);
  return stmt.all(userId) as TrendingFavoriteItem[];
}

export function getUserFavoriteKeys(userId: string): string[] {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT source, itemId FROM TrendingFavorite
    WHERE userId = ?
  `);
  const rows = stmt.all(userId) as Array<{ source: string; itemId: string }>;
  return rows.map((r) => `${r.source}:${r.itemId}`);
}

export function addFavorite(userId: string, input: FavoriteInput): TrendingFavoriteItem {
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();

  const stmt = db.prepare(`
    INSERT INTO TrendingFavorite (
      id, userId, source, sourceName, itemId, title, url, heat, desc, category, date, createdAt, updatedAt
    ) VALUES (
      @id, @userId, @source, @sourceName, @itemId, @title, @url, @heat, @desc, @category, @date, @createdAt, @updatedAt
    )
    ON CONFLICT(userId, source, itemId) DO UPDATE SET
      title = excluded.title,
      url = excluded.url,
      heat = excluded.heat,
      desc = excluded.desc,
      category = excluded.category,
      date = excluded.date,
      updatedAt = excluded.updatedAt
    RETURNING *;
  `);

  const row = stmt.get({
    id,
    userId,
    source: input.source,
    sourceName: input.sourceName || input.source,
    itemId: input.itemId,
    title: input.title,
    url: input.url,
    heat: input.heat || null,
    desc: input.desc || null,
    category: input.category || null,
    date: input.date || null,
    createdAt: now,
    updatedAt: now,
  }) as TrendingFavoriteItem;

  return row;
}

export function removeFavorite(userId: string, source: string, itemId: string): boolean {
  const db = getDb();
  const stmt = db.prepare(`
    DELETE FROM TrendingFavorite
    WHERE userId = ? AND source = ? AND itemId = ?
  `);
  const info = stmt.run(userId, source, itemId);
  return info.changes > 0;
}

export function isFavorited(userId: string, source: string, itemId: string): boolean {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT 1 FROM TrendingFavorite
    WHERE userId = ? AND source = ? AND itemId = ?
    LIMIT 1
  `);
  const row = stmt.get(userId, source, itemId);
  return Boolean(row);
}

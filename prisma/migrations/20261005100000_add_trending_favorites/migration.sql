-- CreateTable
CREATE TABLE "TrendingFavorite" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceName" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "heat" TEXT,
    "desc" TEXT,
    "category" TEXT,
    "date" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TrendingFavorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "TrendingFavorite_userId_createdAt_idx" ON "TrendingFavorite"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "TrendingFavorite_userId_source_idx" ON "TrendingFavorite"("userId", "source");

-- CreateIndex
CREATE UNIQUE INDEX "TrendingFavorite_userId_source_itemId_key" ON "TrendingFavorite"("userId", "source", "itemId");

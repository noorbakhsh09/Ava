-- Memory is now shared by every user. If multiple users saved the same key,
-- keep the most recently updated value (and the lexicographically greatest id on a timestamp tie).
DELETE FROM "Memory" AS older
USING "Memory" AS newer
WHERE older."key" = newer."key"
  AND (
    older."updatedAt" < newer."updatedAt"
    OR (older."updatedAt" = newer."updatedAt" AND older."id" < newer."id")
  );

DROP INDEX "Memory_telegramUserId_key_key";
DROP INDEX "Memory_telegramUserId_updatedAt_idx";
ALTER TABLE "Memory" DROP COLUMN "telegramUserId";

CREATE UNIQUE INDEX "Memory_key_key" ON "Memory"("key");
CREATE INDEX "Memory_updatedAt_idx" ON "Memory"("updatedAt");

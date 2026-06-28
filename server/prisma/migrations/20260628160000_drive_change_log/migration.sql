CREATE TABLE "DriveChange" (
    "id" TEXT NOT NULL,
    "sequence" BIGSERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "parentId" TEXT,
    "type" VARCHAR(32) NOT NULL,
    "versionId" TEXT,
    "etag" TEXT,
    "name" TEXT,
    "pathHint" TEXT,
    "actor" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DriveChange_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DriveChange_sequence_key" ON "DriveChange"("sequence");
CREATE INDEX "DriveChange_userId_sequence_idx" ON "DriveChange"("userId", "sequence");
CREATE INDEX "DriveChange_itemId_sequence_idx" ON "DriveChange"("itemId", "sequence");
CREATE INDEX "DriveChange_userId_itemId_sequence_idx" ON "DriveChange"("userId", "itemId", "sequence");

ALTER TABLE "DriveChange"
  ADD CONSTRAINT "DriveChange_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DriveChange"
  ADD CONSTRAINT "DriveChange_itemId_fkey"
  FOREIGN KEY ("itemId") REFERENCES "DriveItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

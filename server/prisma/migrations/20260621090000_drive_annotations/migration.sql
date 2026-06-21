CREATE TABLE "DriveAnnotationThread" (
  "id" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "baseVersionId" TEXT,
  "targetKind" VARCHAR(64) NOT NULL,
  "target" JSONB NOT NULL,
  "anchorStatus" VARCHAR(32) NOT NULL DEFAULT 'attached',
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "DriveAnnotationThread_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DriveAnnotationComment" (
  "id" TEXT NOT NULL,
  "threadId" TEXT NOT NULL,
  "parentCommentId" TEXT,
  "body" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "editedAt" TIMESTAMP(3),
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "DriveAnnotationComment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DriveAnnotationThread_itemId_deletedAt_createdAt_idx"
  ON "DriveAnnotationThread"("itemId", "deletedAt", "createdAt");
CREATE INDEX "DriveAnnotationThread_createdByUserId_createdAt_idx"
  ON "DriveAnnotationThread"("createdByUserId", "createdAt");
CREATE INDEX "DriveAnnotationThread_anchorStatus_idx"
  ON "DriveAnnotationThread"("anchorStatus");
CREATE INDEX "DriveAnnotationComment_threadId_createdAt_idx"
  ON "DriveAnnotationComment"("threadId", "createdAt");
CREATE INDEX "DriveAnnotationComment_parentCommentId_idx"
  ON "DriveAnnotationComment"("parentCommentId");
CREATE INDEX "DriveAnnotationComment_createdByUserId_createdAt_idx"
  ON "DriveAnnotationComment"("createdByUserId", "createdAt");

ALTER TABLE "DriveAnnotationThread"
  ADD CONSTRAINT "DriveAnnotationThread_itemId_fkey"
  FOREIGN KEY ("itemId") REFERENCES "DriveItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DriveAnnotationThread"
  ADD CONSTRAINT "DriveAnnotationThread_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DriveAnnotationComment"
  ADD CONSTRAINT "DriveAnnotationComment_threadId_fkey"
  FOREIGN KEY ("threadId") REFERENCES "DriveAnnotationThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DriveAnnotationComment"
  ADD CONSTRAINT "DriveAnnotationComment_parentCommentId_fkey"
  FOREIGN KEY ("parentCommentId") REFERENCES "DriveAnnotationComment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DriveAnnotationComment"
  ADD CONSTRAINT "DriveAnnotationComment_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

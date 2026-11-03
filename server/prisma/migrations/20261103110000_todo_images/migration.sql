BEGIN;

CREATE TABLE "TodoImage" (
    "id" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "todoId" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "mimeType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "thumbnailSize" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "ready" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3),
    CONSTRAINT "TodoImage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TodoImage_userId_todoId_idx" ON "TodoImage"("userId", "todoId");
CREATE INDEX "TodoImage_todoId_expiresAt_idx" ON "TodoImage"("todoId", "expiresAt");
ALTER TABLE "TodoImage" ADD CONSTRAINT "TodoImage_todoId_fkey"
    FOREIGN KEY ("todoId") REFERENCES "TodoItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;

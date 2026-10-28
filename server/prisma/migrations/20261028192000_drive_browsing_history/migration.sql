-- CreateTable
CREATE TABLE "DriveBrowsingHistory" (
    "id" TEXT NOT NULL,
    "viewerId" TEXT NOT NULL,
    "visitId" UUID NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "authorHandle" VARCHAR(64) NOT NULL,
    "kind" VARCHAR(16) NOT NULL,
    "path" VARCHAR(4096) NOT NULL,
    "searchIndex" TEXT NOT NULL,
    "cleared" BOOLEAN NOT NULL DEFAULT false,
    "visitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DriveBrowsingHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DriveBrowsingHistory_viewerId_cleared_visitedAt_id_idx" ON "DriveBrowsingHistory"("viewerId", "cleared", "visitedAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "DriveBrowsingHistory_viewerId_cleared_kind_visitedAt_id_idx" ON "DriveBrowsingHistory"("viewerId", "cleared", "kind", "visitedAt" DESC, "id" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "DriveBrowsingHistory_viewerId_visitId_key" ON "DriveBrowsingHistory"("viewerId", "visitId");

-- AddForeignKey
ALTER TABLE "DriveBrowsingHistory" ADD CONSTRAINT "DriveBrowsingHistory_viewerId_fkey" FOREIGN KEY ("viewerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

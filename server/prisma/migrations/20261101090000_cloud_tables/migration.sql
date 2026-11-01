-- AlterTable
ALTER TABLE "UserApiKey" ADD COLUMN     "tableAccessMode" VARCHAR(16) NOT NULL DEFAULT 'selected',
ADD COLUMN     "tableIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "CloudTable" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "anonymous" JSONB NOT NULL DEFAULT '{}',
    "members" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "CloudTable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CloudTableField" (
    "id" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "key" VARCHAR(64) NOT NULL,
    "definition" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "CloudTableField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CloudTableRecord" (
    "id" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "values" JSONB NOT NULL,
    "creatorUserId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "CloudTableRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CloudTableReceipt" (
    "id" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "namespace" VARCHAR(200) NOT NULL,
    "key" VARCHAR(120) NOT NULL,
    "fingerprint" VARCHAR(64) NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CloudTableReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CloudTableOperationLog" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "tableId" TEXT,
    "actorId" TEXT,
    "apiKeyId" TEXT,
    "requestId" VARCHAR(64) NOT NULL,
    "operation" VARCHAR(64) NOT NULL,
    "status" INTEGER NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CloudTableOperationLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CloudTable_ownerId_deletedAt_id_idx" ON "CloudTable"("ownerId", "deletedAt", "id");

-- CreateIndex
CREATE INDEX "CloudTable_members_idx" ON "CloudTable" USING GIN ("members");

-- CreateIndex
CREATE INDEX "CloudTable_deletedAt_idx" ON "CloudTable"("deletedAt");

-- CreateIndex
CREATE INDEX "CloudTableField_tableId_archivedAt_position_idx" ON "CloudTableField"("tableId", "archivedAt", "position");

-- CreateIndex
CREATE INDEX "CloudTableField_archivedAt_idx" ON "CloudTableField"("archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CloudTableField_tableId_key_key" ON "CloudTableField"("tableId", "key");

-- CreateIndex
CREATE INDEX "CloudTableRecord_tableId_deletedAt_createdAt_id_idx" ON "CloudTableRecord"("tableId", "deletedAt", "createdAt", "id");

-- CreateIndex
CREATE INDEX "CloudTableRecord_tableId_id_idx" ON "CloudTableRecord"("tableId", "id");

-- CreateIndex
CREATE INDEX "CloudTableRecord_tableId_creatorUserId_deletedAt_createdAt__idx" ON "CloudTableRecord"("tableId", "creatorUserId", "deletedAt", "createdAt", "id");

-- CreateIndex
CREATE INDEX "CloudTableRecord_deletedAt_id_idx" ON "CloudTableRecord"("deletedAt", "id");

-- CreateIndex
CREATE INDEX "CloudTableRecord_values_idx" ON "CloudTableRecord" USING GIN ("values");

-- CreateIndex
CREATE INDEX "CloudTableReceipt_tableId_idx" ON "CloudTableReceipt"("tableId");

-- CreateIndex
CREATE INDEX "CloudTableReceipt_createdAt_idx" ON "CloudTableReceipt"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CloudTableReceipt_namespace_key_key" ON "CloudTableReceipt"("namespace", "key");

-- CreateIndex
CREATE UNIQUE INDEX "CloudTableOperationLog_requestId_key" ON "CloudTableOperationLog"("requestId");

-- CreateIndex
CREATE INDEX "CloudTableOperationLog_ownerId_tableId_id_idx" ON "CloudTableOperationLog"("ownerId", "tableId", "id");

-- CreateIndex
CREATE INDEX "CloudTableOperationLog_createdAt_idx" ON "CloudTableOperationLog"("createdAt");

-- AddForeignKey
ALTER TABLE "CloudTableField" ADD CONSTRAINT "CloudTableField_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "CloudTable"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CloudTableRecord" ADD CONSTRAINT "CloudTableRecord_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "CloudTable"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CloudTableReceipt" ADD CONSTRAINT "CloudTableReceipt_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "CloudTable"("id") ON DELETE CASCADE ON UPDATE CASCADE;

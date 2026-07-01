CREATE TABLE "AgentPersona" (
  "id" TEXT NOT NULL,
  "source" VARCHAR(16) NOT NULL,
  "ownerUserId" TEXT,
  "stableKey" VARCHAR(120),
  "name" VARCHAR(120) NOT NULL,
  "description" VARCHAR(1000) NOT NULL,
  "systemPrompt" TEXT NOT NULL,
  "defaultProviderModel" JSONB,
  "defaultToolPolicy" JSONB,
  "status" VARCHAR(16) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AgentPersona_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AgentPersonaPreference" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "personaId" TEXT NOT NULL,
  "providerModel" JSONB,
  "toolPolicy" JSONB,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AgentPersonaPreference_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AgentPersona_source_stableKey_key" ON "AgentPersona"("source", "stableKey");
CREATE INDEX "AgentPersona_ownerUserId_source_updatedAt_idx" ON "AgentPersona"("ownerUserId", "source", "updatedAt");
CREATE INDEX "AgentPersona_source_status_updatedAt_idx" ON "AgentPersona"("source", "status", "updatedAt");
CREATE UNIQUE INDEX "AgentPersonaPreference_userId_personaId_key" ON "AgentPersonaPreference"("userId", "personaId");
CREATE INDEX "AgentPersonaPreference_userId_updatedAt_idx" ON "AgentPersonaPreference"("userId", "updatedAt");

ALTER TABLE "AgentPersona"
ADD CONSTRAINT "AgentPersona_ownerUserId_fkey"
FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AgentPersonaPreference"
ADD CONSTRAINT "AgentPersonaPreference_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AgentPersonaPreference"
ADD CONSTRAINT "AgentPersonaPreference_personaId_fkey"
FOREIGN KEY ("personaId") REFERENCES "AgentPersona"("id") ON DELETE CASCADE ON UPDATE CASCADE;

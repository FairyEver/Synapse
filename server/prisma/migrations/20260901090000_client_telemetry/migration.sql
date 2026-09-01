CREATE TABLE "ClientTelemetryEvent" (
    "eventId" VARCHAR(64) NOT NULL,
    "userId" TEXT,
    "category" VARCHAR(24) NOT NULL,
    "eventKey" VARCHAR(64) NOT NULL,
    "component" VARCHAR(64) NOT NULL,
    "action" VARCHAR(32) NOT NULL,
    "outcome" VARCHAR(16),
    "durationMs" INTEGER,
    "moduleId" VARCHAR(64),
    "windowType" VARCHAR(32) NOT NULL,
    "clientInstanceId" VARCHAR(64) NOT NULL,
    "sessionId" VARCHAR(64) NOT NULL,
    "appVersion" VARCHAR(32) NOT NULL,
    "platform" VARCHAR(32) NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientTelemetryEvent_pkey" PRIMARY KEY ("eventId")
);

CREATE INDEX "ClientTelemetryEvent_occurredAt_idx" ON "ClientTelemetryEvent"("occurredAt");
CREATE INDEX "ClientTelemetryEvent_userId_occurredAt_idx" ON "ClientTelemetryEvent"("userId", "occurredAt");
CREATE INDEX "ClientTelemetryEvent_clientInstanceId_occurredAt_idx" ON "ClientTelemetryEvent"("clientInstanceId", "occurredAt");
CREATE INDEX "ClientTelemetryEvent_category_eventKey_occurredAt_idx" ON "ClientTelemetryEvent"("category", "eventKey", "occurredAt");
CREATE INDEX "ClientTelemetryEvent_appVersion_occurredAt_idx" ON "ClientTelemetryEvent"("appVersion", "occurredAt");
CREATE INDEX "ClientTelemetryEvent_platform_occurredAt_idx" ON "ClientTelemetryEvent"("platform", "occurredAt");

ALTER TABLE "ClientTelemetryEvent"
ADD CONSTRAINT "ClientTelemetryEvent_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

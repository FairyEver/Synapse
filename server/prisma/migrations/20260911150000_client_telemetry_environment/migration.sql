ALTER TABLE "ClientTelemetryEvent"
ADD COLUMN "browserName" VARCHAR(64),
ADD COLUMN "browserVersion" VARCHAR(32),
ADD COLUMN "osName" VARCHAR(64),
ADD COLUMN "osVersion" VARCHAR(32);

CREATE INDEX "ClientTelemetryEvent_browserName_browserVersion_occurredAt_idx"
ON "ClientTelemetryEvent"("browserName", "browserVersion", "occurredAt");

CREATE INDEX "ClientTelemetryEvent_osName_osVersion_occurredAt_idx"
ON "ClientTelemetryEvent"("osName", "osVersion", "occurredAt");

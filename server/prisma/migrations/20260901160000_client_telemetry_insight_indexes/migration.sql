CREATE INDEX "ClientTelemetryEvent_eventKey_occurredAt_idx"
ON "ClientTelemetryEvent"("eventKey", "occurredAt");

CREATE INDEX "ClientTelemetryEvent_moduleId_occurredAt_idx"
ON "ClientTelemetryEvent"("moduleId", "occurredAt");

CREATE INDEX "ClientTelemetryEvent_sessionId_occurredAt_idx"
ON "ClientTelemetryEvent"("sessionId", "occurredAt");

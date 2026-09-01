import { describe, expect, it } from "vitest"
import {
  parseClientTelemetryBatch,
  parseClientTelemetryStatsQuery,
} from "./client-telemetry.schemas"

const now = new Date("2026-09-01T00:00:00.000Z")

function validEvent() {
  return {
    eventId: "event-1",
    category: "interaction",
    eventKey: "database.row.save",
    component: "button",
    action: "click",
    windowType: "main",
    clientInstanceId: "client-1",
    sessionId: "session-1",
    appVersion: "0.2.419",
    platform: "darwin-arm64",
    occurredAt: "2026-09-01T00:00:00.000Z",
  }
}

describe("client telemetry schemas", () => {
  it("accepts fixed categorical event fields", () => {
    expect(parseClientTelemetryBatch({ events: [validEvent()] }, now)).toHaveLength(1)
  })

  it("rejects user identity and arbitrary metadata in the request body", () => {
    expect(() => parseClientTelemetryBatch({
      events: [{ ...validEvent(), userId: "forged-user", metadata: { text: "private" } }],
    }, now)).toThrow(/不支持的字段/u)
  })

  it("rejects batches above the fixed limit", () => {
    expect(() => parseClientTelemetryBatch({
      events: Array.from({ length: 51 }, (_, index) => ({
        ...validEvent(),
        eventId: `event-${index}`,
      })),
    }, now)).toThrow()
  })

  it("rejects expired events and ranges longer than retention", () => {
    expect(() => parseClientTelemetryBatch({
      events: [{ ...validEvent(), occurredAt: "2026-08-01T00:00:00.000Z" }],
    }, now)).toThrow("埋点时间无效。")

    expect(() => parseClientTelemetryStatsQuery({
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-09-01T00:00:00.000Z",
    }, now)).toThrow(/不能超过 180 天/u)
  })

  it("does not allow a user filter for anonymous statistics", () => {
    expect(() => parseClientTelemetryStatsQuery({
      identity: "anonymous",
      userId: "user-1",
    }, now)).toThrow("匿名统计不能指定用户。")
  })
})

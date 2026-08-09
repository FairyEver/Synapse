import { describe, expect, it } from "vitest"

import { redactSessionKey } from "../agent-redaction"
import {
  sanitizeTrackRecord,
  sanitizeTrackValue,
} from "../ui-tracking"

describe("ui tracking value sanitizers", () => {
  it("summarizes long text with an explicit log marker", () => {
    const value = "a".repeat(305)

    expect(sanitizeTrackValue("content", value)).toBe(
      `${"a".repeat(120)}...（日志自动优化：原始 305 字，仅记录前 120 字）`,
    )
  })

  it("redacts sensitive values", () => {
    expect(sanitizeTrackValue("apiKey", "sk-secret")).toBe("[redacted]")
    expect(sanitizeTrackValue("ownerId", "user-123")).toBe("[redacted]")
    expect(sanitizeTrackValue("sessionKey", "workflow:private-timeline")).toBe("[redacted]")
    expect(redactSessionKey("scheduled:private-timeline")).toBe("[redacted]")
    expect(redactSessionKey("external:private-timeline")).toBe("[redacted]")
    expect(redactSessionKey(undefined)).toBeUndefined()
  })

  it("keeps path context without logging the full path", () => {
    expect(sanitizeTrackValue("sourcePath", "/Users/liyang/Documents/orders.csv")).toBe(
      "[path redacted]/orders.csv",
    )
  })

  it("redacts generic tracked values that look sensitive or path-like", () => {
    expect(sanitizeTrackValue("value", "token=sk-secret")).toBe("[redacted]")
    expect(sanitizeTrackValue("value", "/Users/liyang/Documents/orders.csv")).toBe(
      "[path redacted]/orders.csv",
    )
  })

  it("sanitizes record fields recursively", () => {
    expect(sanitizeTrackRecord({
      title: "客户订单",
      token: "secret",
      sourcePath: "/tmp/orders.csv",
      content: "b".repeat(301),
    })).toEqual({
      title: "客户订单",
      token: "[redacted]",
      sourcePath: "[path redacted]/orders.csv",
      content: `${"b".repeat(120)}...（日志自动优化：原始 301 字，仅记录前 120 字）`,
    })
  })
})

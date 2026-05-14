import { describe, expect, it } from "vitest"

import {
  compactProgressPayload,
  progressEntryFromEvent,
  renderCompactProgress,
} from "../preview-progress"

describe("agent bridge preview progress", () => {
  it("redacts secret-like fields from rendered progress and payload entries", () => {
    const entry = progressEntryFromEvent({
      type: "toolUse",
      toolName: "bash",
      toolInput: "curl -H 'Authorization: Bearer sk-secret' --cookie session=abc https://example.test",
    })

    if (!entry) throw new Error("Expected progress entry")

    const rendered = renderCompactProgress([entry])
    const payload = compactProgressPayload([entry])

    expect(rendered).toContain("Authorization: [redacted]")
    expect(rendered).toContain("--cookie [redacted]")
    expect(rendered).not.toContain("sk-secret")
    expect(rendered).not.toContain("session=abc")
    expect(JSON.stringify(payload)).not.toContain("sk-secret")
    expect(JSON.stringify(payload)).not.toContain("session=abc")
  })

  it("redacts JSON-style secret fields from progress previews", () => {
    const entry = progressEntryFromEvent({
      type: "toolUse",
      toolName: "mcp",
      toolInput: '{"authorization":"Bearer sk-json","token":"tok-json","cookie":"sid=json","safe":"ok"}',
    })

    if (!entry) throw new Error("Expected progress entry")

    const rendered = renderCompactProgress([entry])
    const payloadJson = JSON.stringify(compactProgressPayload([entry]))

    expect(rendered).toContain('"authorization":"[redacted]"')
    expect(rendered).toContain('"token":"[redacted]"')
    expect(rendered).toContain('"cookie":"[redacted]"')
    expect(rendered).toContain('"safe":"ok"')
    expect(`${rendered}\n${payloadJson}`).not.toContain("sk-json")
    expect(`${rendered}\n${payloadJson}`).not.toContain("tok-json")
    expect(`${rendered}\n${payloadJson}`).not.toContain("sid=json")
  })

  it("redacts equals-form authorization fields from progress previews", () => {
    const entry = progressEntryFromEvent({
      type: "toolUse",
      toolName: "bash",
      toolInput: "curl --header authorization=Bearer sk-equals https://example.test",
    })

    if (!entry) throw new Error("Expected progress entry")

    const rendered = renderCompactProgress([entry])
    const payloadJson = JSON.stringify(compactProgressPayload([entry]))

    expect(rendered).toContain("authorization=[redacted]")
    expect(`${rendered}\n${payloadJson}`).not.toContain("sk-equals")
  })
})

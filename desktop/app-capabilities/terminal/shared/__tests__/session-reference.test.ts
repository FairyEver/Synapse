import { describe, expect, it } from "vitest"

import { buildTerminalSessionReferenceText } from "../session-reference"

const WORKSPACE_ID = "3f7c8a10-1c2d-4e5f-8a9b-0c1d2e3f4a5b"
const SESSION_ID = "2a91b0c1-2d3e-4f50-9a8b-7c6d5e4f3a2b"
const SESSION_REF = "tsr_abcdefghijklmnopqrstuv.abc"

describe("Terminal session reference text", () => {
  it("writes one key=value line per level, outermost first", () => {
    expect(buildTerminalSessionReferenceText({
      workspaceId: WORKSPACE_ID,
      sessionRef: SESSION_REF,
      sessionId: SESSION_ID,
    })).toBe([
      `workspace_id=${WORKSPACE_ID}`,
      `session_ref=${SESSION_REF}`,
      `session_id=${SESSION_ID}`,
    ].join("\n"))
  })

  it("keeps the reference and the immutable session id apart", () => {
    const text = buildTerminalSessionReferenceText({
      workspaceId: WORKSPACE_ID,
      sessionRef: SESSION_REF,
      sessionId: SESSION_ID,
    })
    expect(text).toContain(`session_ref=${SESSION_REF}`)
    expect(text).toContain(`session_id=${SESSION_ID}`)
    expect(text).not.toContain("pane_")
  })

  it("rejects values that are missing or would break the line format", () => {
    for (const input of [
      { workspaceId: "", sessionRef: SESSION_REF, sessionId: SESSION_ID },
      { workspaceId: WORKSPACE_ID, sessionRef: "", sessionId: SESSION_ID },
      { workspaceId: WORKSPACE_ID, sessionRef: SESSION_REF, sessionId: "" },
      { workspaceId: WORKSPACE_ID, sessionRef: SESSION_REF, sessionId: `${SESSION_ID}\n` },
      { workspaceId: WORKSPACE_ID, sessionRef: ` ${SESSION_REF}`, sessionId: SESSION_ID },
    ]) {
      expect(() => buildTerminalSessionReferenceText(input)).toThrow("invalid_terminal_session_reference_text")
    }
  })
})

import { describe, expect, it } from "vitest"

import { buildTerminalSessionReferenceText } from "../session-reference"

const WORKSPACE_ID = "3f7c8a10-1c2d-4e5f-8a9b-0c1d2e3f4a5b"
const WORKSPACE_TITLE = "Synapse"
const SESSION_ID = "2a91b0c1-2d3e-4f50-9a8b-7c6d5e4f3a2b"
const SESSION_TITLE = "Synapse #2"
const SESSION_REF = "tsr_abcdefghijklmnopqrstuv.abc"

const VALID = {
  workspaceId: WORKSPACE_ID,
  workspaceTitle: WORKSPACE_TITLE,
  sessionId: SESSION_ID,
  sessionTitle: SESSION_TITLE,
  sessionRef: SESSION_REF,
}

describe("Terminal session reference text", () => {
  it("writes each id next to the title that names it for a person", () => {
    expect(buildTerminalSessionReferenceText(VALID)).toBe([
      `workspace_id=${WORKSPACE_ID}`,
      `workspace_title=${WORKSPACE_TITLE}`,
      `session_id=${SESSION_ID}`,
      `session_title=${SESSION_TITLE}`,
      `session_ref=${SESSION_REF}`,
    ].join("\n"))
  })

  it("keeps the reference and the immutable session id apart", () => {
    const text = buildTerminalSessionReferenceText(VALID)
    expect(text).toContain(`session_ref=${SESSION_REF}`)
    expect(text).toContain(`session_id=${SESSION_ID}`)
    expect(text).not.toContain("pane_")
  })

  /*
   * 标题存在的理由就是「认得出是哪一个」：一个标签里分屏出来的几个会话，光看 id 谁也不知道
   * 读的是哪一格。所以标题必须真的出现在文本里，不能被当成可有可无的装饰。
   */
  it("carries the titles a reader needs to recognise which terminal this is", () => {
    const text = buildTerminalSessionReferenceText(VALID)
    expect(text).toContain(`workspace_title=${WORKSPACE_TITLE}`)
    expect(text).toContain(`session_title=${SESSION_TITLE}`)
  })

  it("rejects values that are missing or would break the line format", () => {
    for (const input of [
      { ...VALID, workspaceId: "" },
      { ...VALID, sessionRef: "" },
      { ...VALID, sessionId: "" },
      { ...VALID, sessionId: `${SESSION_ID}\n` },
      { ...VALID, sessionRef: ` ${SESSION_REF}` },
      { ...VALID, workspaceTitle: "" },
      { ...VALID, workspaceTitle: "   " },
      { ...VALID, sessionTitle: "" },
      { ...VALID, sessionTitle: "two\nlines" },
    ]) {
      expect(() => buildTerminalSessionReferenceText(input)).toThrow("invalid_terminal_session_reference_text")
    }
  })

  it("allows the spaces a real title contains", () => {
    expect(() => buildTerminalSessionReferenceText(VALID)).not.toThrow()
    expect(() => buildTerminalSessionReferenceText({ ...VALID, sessionTitle: "构建 日志" })).not.toThrow()
  })
})

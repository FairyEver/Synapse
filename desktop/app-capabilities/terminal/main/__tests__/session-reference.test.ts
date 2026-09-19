import { describe, expect, it } from "vitest"

import { terminalSessionReference } from "../session-reference"

const SESSION_ID = "019f8a39-0000-7000-8000-000000000777"
const OTHER_SESSION_ID = "019f8a39-0000-7000-8000-000000000888"

describe("Terminal session reference", () => {
  it("derives a stable reference from the immutable session id", () => {
    const reference = terminalSessionReference(SESSION_ID)
    expect(reference).toMatch(/^tsr_[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{3}$/)
    expect(terminalSessionReference(SESSION_ID)).toBe(reference)
    expect(terminalSessionReference(OTHER_SESSION_ID)).not.toBe(reference)
    expect(reference).not.toContain(SESSION_ID)
  })
})

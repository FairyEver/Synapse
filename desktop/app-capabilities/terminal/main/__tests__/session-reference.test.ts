import { describe, expect, it } from "vitest"

import {
  isValidTerminalSessionReference,
  looksLikeTerminalSessionReference,
  resolveTerminalSessionReference,
  terminalSessionReference,
} from "../session-reference"

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

  it("rejects references with a tampered payload or checksum", () => {
    const reference = terminalSessionReference(SESSION_ID)
    const [prefix, checksum] = reference.split(".") as [string, string]
    expect(isValidTerminalSessionReference(reference)).toBe(true)
    expect(isValidTerminalSessionReference(`${prefix}.${checksum === "aaa" ? "bbb" : "aaa"}`)).toBe(false)
    expect(isValidTerminalSessionReference(`${prefix.slice(0, -1)}x.${checksum}`)).toBe(false)
    expect(isValidTerminalSessionReference(`agc_${prefix.slice(4)}.${checksum}`)).toBe(false)
    expect(isValidTerminalSessionReference(SESSION_ID)).toBe(false)
    expect(looksLikeTerminalSessionReference(reference)).toBe(true)
    expect(looksLikeTerminalSessionReference(SESSION_ID)).toBe(false)
  })

  it("resolves the unique session that owns the reference", () => {
    const sessions = [
      { id: SESSION_ID, title: "one" },
      { id: OTHER_SESSION_ID, title: "two" },
    ]
    expect(resolveTerminalSessionReference(sessions, terminalSessionReference(SESSION_ID)))
      .toEqual(sessions[0])
  })

  it("refuses unknown references and duplicate matches", () => {
    const reference = terminalSessionReference(SESSION_ID)
    expect(resolveTerminalSessionReference([{ id: OTHER_SESSION_ID }], reference)).toBeNull()
    expect(resolveTerminalSessionReference([{ id: SESSION_ID }, { id: SESSION_ID }], reference)).toBeNull()
    expect(resolveTerminalSessionReference([{ id: SESSION_ID }], SESSION_ID)).toBeNull()
    expect(resolveTerminalSessionReference([], reference)).toBeNull()
  })
})

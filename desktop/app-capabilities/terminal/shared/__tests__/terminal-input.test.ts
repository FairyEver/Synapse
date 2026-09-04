import { describe, expect, it } from "vitest"
import { buildTerminalCommandWrites } from "../terminal-input"

describe("buildTerminalCommandWrites", () => {
  it("separates a single-line command from terminal Enter", () => {
    expect(buildTerminalCommandWrites("cloud")).toEqual(["cloud", "\r"])
  })

  it("submits every line of a multiline command", () => {
    expect(buildTerminalCommandWrites("npm run test\nnpm run build"))
      .toEqual(["npm run test", "\r", "npm run build", "\r"])
  })

  it("normalizes CRLF and CR line endings", () => {
    expect(buildTerminalCommandWrites("npm run test\r\nnpm run build\rcloud"))
      .toEqual(["npm run test", "\r", "npm run build", "\r", "cloud", "\r"])
  })

  it("preserves internal blank lines without duplicating the final Enter", () => {
    expect(buildTerminalCommandWrites("npm run test\n\nnpm run build\n"))
      .toEqual(["npm run test", "\r", "\r", "npm run build", "\r"])
  })

  it("does not modify shell syntax outside line endings", () => {
    expect(buildTerminalCommandWrites("echo \"a|b\" | grep b\nprintf 'next'"))
      .toEqual(["echo \"a|b\" | grep b", "\r", "printf 'next'", "\r"])
  })
})

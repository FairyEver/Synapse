import { describe, expect, it } from "vitest"
import { encodeTerminalCommandInput } from "../terminal-input"

describe("encodeTerminalCommandInput", () => {
  it("submits a single-line command with terminal Enter", () => {
    expect(encodeTerminalCommandInput("cloud")).toBe("cloud\r")
  })

  it("submits every line of a multiline command", () => {
    expect(encodeTerminalCommandInput("npm run test\nnpm run build"))
      .toBe("npm run test\rnpm run build\r")
  })

  it("normalizes CRLF and CR line endings", () => {
    expect(encodeTerminalCommandInput("npm run test\r\nnpm run build\rcloud"))
      .toBe("npm run test\rnpm run build\rcloud\r")
  })

  it("preserves internal blank lines without duplicating the final Enter", () => {
    expect(encodeTerminalCommandInput("npm run test\n\nnpm run build\n"))
      .toBe("npm run test\r\rnpm run build\r")
  })

  it("does not modify shell syntax outside line endings", () => {
    expect(encodeTerminalCommandInput("echo \"a|b\" | grep b\nprintf 'next'"))
      .toBe("echo \"a|b\" | grep b\rprintf 'next'\r")
  })
})

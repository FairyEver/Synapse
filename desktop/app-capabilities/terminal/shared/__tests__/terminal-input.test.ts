import { describe, expect, it } from "vitest"
import { buildTerminalCommandWrites, wrapBracketedPaste } from "../terminal-input"

describe("wrapBracketedPaste", () => {
  it("应用开了 bracketed paste 时按粘贴包一层，且绝不补回车", () => {
    expect(wrapBracketedPaste("cloud", true)).toBe("\x1b[200~cloud\x1b[201~")
  })

  it("应用没开时原样返回，不硬塞控制序列", () => {
    expect(wrapBracketedPaste("cloud", false)).toBe("cloud")
  })

  it("内容里的换行原样保留在包里", () => {
    expect(wrapBracketedPaste("第一行\n第二行", true))
      .toBe("\x1b[200~第一行\n第二行\x1b[201~")
  })

  it("空内容只会包出一对空的粘贴标记", () => {
    expect(wrapBracketedPaste("", true)).toBe("\x1b[200~\x1b[201~")
    expect(wrapBracketedPaste("", false)).toBe("")
  })

  it("包出来的永远以收尾标记结束、且不含 \\r", () => {
    for (const content of ["单行", "第一行\n第二行", "\n行首换行", "行尾换行\n"]) {
      const wrapped = wrapBracketedPaste(content, true)
      expect(wrapped.endsWith("\x1b[201~")).toBe(true)
      expect(wrapped.includes("\r")).toBe(false)
    }
  })
})

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

import { describe, expect, it } from "vitest"
import { decodeUtf8Prefix, truncateUtf8StringToBytes } from "./utf8"

describe("UTF-8 truncation helpers", () => {
  it("does not split multibyte characters when truncating strings", () => {
    expect(truncateUtf8StringToBytes("你好", 4)).toEqual({ text: "你", truncated: true })
    expect(truncateUtf8StringToBytes("hi🙂ok", 5)).toEqual({ text: "hi", truncated: true })
  })

  it("decodes byte prefixes only through complete UTF-8 code points", () => {
    const bytes = new TextEncoder().encode("ab中🙂")

    expect(decodeUtf8Prefix(bytes, 4)).toBe("ab")
    expect(decodeUtf8Prefix(bytes, 5)).toBe("ab中")
    expect(decodeUtf8Prefix(bytes, 8)).toBe("ab中")
    expect(decodeUtf8Prefix(bytes, bytes.byteLength)).toBe("ab中🙂")
  })
})

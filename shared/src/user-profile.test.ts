import { describe, expect, it } from "vitest"
import {
  buildDefaultUserNickname,
  normalizeUserNickname,
  userNicknameMaxLength,
} from "./user-profile.js"

describe("user profile shared helpers", () => {
  it("keeps inner spaces, Chinese and symbols while trimming the outer whitespace", () => {
    expect(normalizeUserNickname("  李  阳  ")).toBe("李  阳")
    expect(normalizeUserNickname("Ada Lovelace (v2)! 🌟")).toBe("Ada Lovelace (v2)! 🌟")
  })

  it("rejects empty nicknames", () => {
    expect(() => normalizeUserNickname("   ")).toThrow("昵称不能为空。")
  })

  it("counts nicknames by unicode code point up to the exported limit", () => {
    expect(normalizeUserNickname("李".repeat(userNicknameMaxLength))).toBe("李".repeat(userNicknameMaxLength))
    expect(() => normalizeUserNickname("李".repeat(userNicknameMaxLength + 1))).toThrow("昵称不能超过 24 个字符。")
    expect(normalizeUserNickname("🌟".repeat(userNicknameMaxLength))).toHaveLength(userNicknameMaxLength * 2)
    expect(() => normalizeUserNickname("🌟".repeat(userNicknameMaxLength + 1))).toThrow("昵称不能超过 24 个字符。")
  })

  it("rejects control characters that would break list and menu layout", () => {
    expect(() => normalizeUserNickname("李\n阳")).toThrow("昵称不能包含控制字符。")
    expect(() => normalizeUserNickname("李\u200b阳")).toThrow("昵称不能包含控制字符。")
    expect(() => normalizeUserNickname("李\u0000阳")).toThrow("昵称不能包含控制字符。")
  })

  it("builds the default nickname from a handle by code point truncation", () => {
    expect(buildDefaultUserNickname("liyang")).toBe("liyang")
    expect(buildDefaultUserNickname("h".repeat(userNicknameMaxLength + 6))).toBe("h".repeat(userNicknameMaxLength))
  })
})

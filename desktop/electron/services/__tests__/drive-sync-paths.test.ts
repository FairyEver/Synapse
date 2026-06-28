import { describe, expect, it } from "vitest"
import {
  assertInsideBindingRoot,
  normalizeLocalPath,
  pathCollisionKey,
  resolveBindingChildPath,
  toDriveSyncRelativePath,
} from "../drive-sync-paths"

describe("drive sync path utilities", () => {
  it("normalizes local paths without changing the root identity", () => {
    expect(normalizeLocalPath("/Users/me/docs/../docs")).toBe("/Users/me/docs")
  })

  it("returns POSIX-style relative paths inside a binding root", () => {
    expect(toDriveSyncRelativePath("/Users/me/docs", "/Users/me/docs/specs/a.md")).toBe("specs/a.md")
    expect(toDriveSyncRelativePath("/Users/me/docs", "/Users/me/docs")).toBe("")
  })

  it("rejects paths outside the binding root", () => {
    expect(() => assertInsideBindingRoot("/Users/me/docs", "/Users/me/other/a.md")).toThrow("同步路径超出绑定目录。")
    expect(() => resolveBindingChildPath("/Users/me/docs", "../secret.md")).toThrow("同步路径超出绑定目录。")
  })

  it("resolves child paths inside the binding root", () => {
    expect(resolveBindingChildPath("/Users/me/docs", "specs/a.md")).toBe("/Users/me/docs/specs/a.md")
  })

  it("creates stable case-insensitive collision keys", () => {
    expect(pathCollisionKey("Docs/Spec.md")).toBe("docs/spec.md")
  })
})

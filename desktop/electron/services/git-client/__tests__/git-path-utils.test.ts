import { describe, expect, it } from "vitest"
import { assertRepositoryPath, normalizeRepositoryPath } from "../git-path-utils"

describe("git path utilities", () => {
  it("normalizes repository paths", () => {
    expect(normalizeRepositoryPath("/tmp/repo/../repo")).toBe("/tmp/repo")
  })

  it("allows paths inside the repository", () => {
    expect(() => assertRepositoryPath("/tmp/repo", "docs/a.md")).not.toThrow()
  })

  it("rejects paths outside the repository", () => {
    expect(() => assertRepositoryPath("/tmp/repo", "../secret.txt")).toThrow("文件不在当前仓库内。")
  })
})

import { describe, expect, it } from "vitest"
import { validateLocalRepositoryNameInput } from "../repository-name"

describe("validateLocalRepositoryNameInput", () => {
  it("rejects Windows-unsafe repository folder names", () => {
    for (const name of ["CON", "aux.txt", "foo:bar", "bad|name", "report.", "report "]) {
      expect(validateLocalRepositoryNameInput(name)).toBe("本地仓库名称不能使用 Windows 非法文件名。")
    }
  })

  it("allows portable repository folder names", () => {
    expect(validateLocalRepositoryNameInput("Synapse 内容库")).toBeNull()
    expect(validateLocalRepositoryNameInput("synapse-repo_1")).toBeNull()
  })
})

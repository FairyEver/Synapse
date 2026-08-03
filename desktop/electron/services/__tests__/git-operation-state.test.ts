import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  assertGitWorktreeMutationAllowed,
  readGitRepositoryOperationDiagnostics,
} from "../git-operation-state"

const localPath = "/repo"
const gitPaths = [
  ".git/index.lock",
  ".git/MERGE_HEAD",
  ".git/rebase-merge",
  ".git/rebase-apply",
  ".git/CHERRY_PICK_HEAD",
  ".git/REVERT_HEAD",
  ".git/BISECT_LOG",
]

function createProbe(existing: readonly string[]) {
  return {
    localPath,
    pathExists: async (filePath: string) => existing.includes(path.basename(filePath)),
    run: async () => ({ stdout: `${gitPaths.join("\n")}\n` }),
  }
}

describe("Git repository operation state", () => {
  it.each([
    ["MERGE_HEAD", "merge"],
    ["rebase-merge", "rebase"],
    ["rebase-apply", "rebase"],
    ["CHERRY_PICK_HEAD", "cherry-pick"],
    ["REVERT_HEAD", "revert"],
    ["BISECT_LOG", "bisect"],
  ] as const)("detects %s", async (marker, operationState) => {
    await expect(readGitRepositoryOperationDiagnostics(createProbe([marker]))).resolves.toEqual({
      indexLockExists: false,
      operationState,
    })
  })

  it("allows a normal repository and preserves index lock diagnostics", async () => {
    const probe = createProbe(["index.lock"])
    await expect(assertGitWorktreeMutationAllowed(probe)).resolves.toBeUndefined()
    await expect(readGitRepositoryOperationDiagnostics(probe)).resolves.toEqual({
      indexLockExists: true,
      operationState: "normal",
    })
  })

  it("fails closed when state probing fails", async () => {
    await expect(assertGitWorktreeMutationAllowed({
      localPath,
      run: async () => { throw new Error("probe failed") },
    })).rejects.toThrow("无法确认当前仓库的 Git 操作状态")
  })
})

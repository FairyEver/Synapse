import { describe, expect, it, vi } from "vitest"
import { logGitOperationFailed, repositoryLogMeta } from "../git-logging"

describe("Git log path redaction", () => {
  it("keeps only repository path basenames in shared metadata", () => {
    expect(repositoryLogMeta({
      id: "repo-1",
      localPath: "/Users/writer/company/private-repo",
      name: "Private repo",
    })).toEqual({
      repositoryId: "repo-1",
      repositoryName: "Private repo",
      repoPath: "[path redacted]/private-repo",
    })

    expect(repositoryLogMeta({
      id: "repo-2",
      localPath: "C:\\Users\\writer\\company\\windows-repo",
      name: "Windows repo",
    })).toEqual({
      repositoryId: "repo-2",
      repositoryName: "Windows repo",
      repoPath: "[path redacted]/windows-repo",
    })
  })

  it("redacts explicit paths and diagnostic paths from failure logs", () => {
    const logger = { error: vi.fn() }

    logGitOperationFailed(logger, {
      operation: "git.status",
      operationId: "git-op-1",
      repoPath: "/Users/writer/company/private-repo",
      cwd: "C:\\Users\\writer\\company\\windows-repo",
      error: Object.assign(new Error("cannot change to /Users/writer/company/private-repo"), {
        stderr: "fatal: cannot change to C:\\Users\\writer\\company\\windows-repo",
      }),
    })

    expect(logger.error).toHaveBeenCalledWith("Git operation failed.", expect.objectContaining({
      repoPath: "[path redacted]/private-repo",
      cwd: "[path redacted]/windows-repo",
      errorMessage: expect.not.stringContaining("/Users/writer"),
      stderrPreview: expect.not.stringContaining("C:\\Users\\writer"),
    }))
    const serialized = JSON.stringify(logger.error.mock.calls)
    expect(serialized).not.toContain("/Users/writer/company/private-repo")
    expect(serialized).not.toContain("C:\\\\Users\\\\writer\\\\company\\\\windows-repo")
  })
})

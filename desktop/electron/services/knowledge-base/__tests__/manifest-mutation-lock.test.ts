import os from "node:os"
import path from "node:path"

import { describe, expect, it, vi } from "vitest"

import { knowledgeBaseLogger } from "../logging"
import { withKnowledgeBaseManifestMutationLock } from "../manifest-mutation-lock"

vi.mock("../logging", () => ({
  knowledgeBaseLogger: {
    warn: vi.fn(),
  },
  knowledgeBaseErrorMeta: (error: unknown) => ({
    errorName: error instanceof Error ? error.name : typeof error,
    error: error instanceof Error ? error.message : String(error),
  }),
}))

describe("withKnowledgeBaseManifestMutationLock", () => {
  it("logs a previous mutation failure before running the next queued mutation", async () => {
    const projectPath = path.join(os.tmpdir(), "synapse-manifest-lock-test")
    let rejectFirst: ((error: Error) => void) | undefined
    const first = withKnowledgeBaseManifestMutationLock(projectPath, () =>
      new Promise<void>((_resolve, reject) => {
        rejectFirst = reject
      }))
    for (let index = 0; index < 5 && !rejectFirst; index += 1) {
      await Promise.resolve()
    }
    expect(rejectFirst).toBeDefined()
    const second = withKnowledgeBaseManifestMutationLock(projectPath, async () => "second")

    rejectFirst?.(new Error("first mutation failed"))

    await expect(first).rejects.toThrow("first mutation failed")
    await expect(second).resolves.toBe("second")
    expect(knowledgeBaseLogger.warn).toHaveBeenCalledWith(
      "Knowledge Base manifest mutation continued after previous failure.",
      expect.objectContaining({
        boundary: "knowledge-base.manifest-mutation-lock",
        projectPath: path.resolve(projectPath),
        errorName: "Error",
      }),
    )
  })
})

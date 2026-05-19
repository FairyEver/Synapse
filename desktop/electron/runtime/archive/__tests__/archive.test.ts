import { describe, expect, it, vi } from "vitest"
import { createZipArchive } from "../index"
import type { ControlledProcessRunner } from "../../process"

function createProcessRunner(result: Partial<Awaited<ReturnType<ControlledProcessRunner["run"]>>> = {}) {
  return {
    run: vi.fn(async () => ({
      exitCode: 0,
      signal: null,
      stdout: "",
      stderr: "",
      timedOut: false,
      durationMs: 1,
      ...result,
    })),
  } satisfies Pick<ControlledProcessRunner, "run">
}

describe("createZipArchive", () => {
  it("requires a controlled process runner for archive commands", async () => {
    await expect(createZipArchive("/source", "/target.zip")).rejects.toThrow(
      "压缩命令缺少安全执行上下文。",
    )
  })

  it("runs archive commands through shell.exec permission and audit path", async () => {
    const processRunner = createProcessRunner()

    await createZipArchive("/source", "/target.zip", {
      actor: { kind: "user" },
      processRunner,
    })

    expect(processRunner.run).toHaveBeenCalledWith(expect.objectContaining({
      action: "shell.exec",
      actor: { kind: "user" },
      command: expect.any(String),
      metadata: expect.objectContaining({
        source: "archive.createZipArchive",
      }),
    }))
  })
})

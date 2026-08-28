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

  it("keeps the source directory as the top-level zip entry on Windows", async () => {
    const processRunner = createProcessRunner()
    const sourceDirectoryPath = "/tmp/synapse package"

    await createZipArchive(sourceDirectoryPath, "/tmp/export.zip", {
      actor: { kind: "user" },
      platform: "win32",
      processRunner,
    })

    expect(processRunner.run).toHaveBeenCalledWith(expect.objectContaining({
      command: "powershell.exe",
      cwd: "/tmp",
      args: expect.arrayContaining([
        expect.stringContaining("-LiteralPath 'synapse package'"),
      ]),
    }))
    expect(processRunner.run).not.toHaveBeenCalledWith(expect.objectContaining({
      args: expect.arrayContaining([
        expect.stringContaining("-LiteralPath '/tmp/synapse package'"),
      ]),
    }))
  })

  it("omits macOS resource metadata from zip archives", async () => {
    const processRunner = createProcessRunner()

    await createZipArchive("/tmp/synapse package", "/tmp/export.zip", {
      actor: { kind: "user" },
      platform: "darwin",
      processRunner,
    })

    expect(processRunner.run).toHaveBeenCalledWith(expect.objectContaining({
      command: "ditto",
      args: expect.arrayContaining(["--norsrc"]),
    }))
  })

  it("redacts process output before including it in archive failure errors", async () => {
    const processRunner = createProcessRunner({
      exitCode: 1,
      stdout: "zip failed token=sk-secret Authorization: Bearer sk-bearer https://example.com/callback?token=query-secret /Users/liyang/private/archive.zip",
      stderr: "ignored",
    })

    await createZipArchive("/source", "/target.zip", {
      actor: { kind: "user" },
      processRunner,
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      expect(message).toContain("创建压缩包失败，请稍后重试。")
      expect(message).toContain("token=[redacted]")
      expect(message).toContain("Authorization=[redacted]")
      expect(message).toContain("https://example.com/callback?token=[redacted]")
      expect(message).toContain("[path]")
      expect(message).not.toContain("sk-secret")
      expect(message).not.toContain("sk-bearer")
      expect(message).not.toContain("query-secret")
      expect(message).not.toContain("/Users/liyang/private/archive.zip")
    })
  })
})

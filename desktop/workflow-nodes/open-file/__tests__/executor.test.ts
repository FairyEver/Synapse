import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const logger = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn() }))
vi.mock("../../../electron/services/log-store", () => ({ createMainLogger: () => logger }))

import type { AuditSink, PermissionGuard } from "../../../electron/runtime/security"
import type { NodeExecutionInput, NodeRuntimeDeps } from "../../types"
import { openFileNodeExecutor } from "../executor.main"
import type { OpenFileNodeConfig } from "../schema"

let tempDirectory = ""

beforeEach(async () => {
  tempDirectory = await mkdtemp(path.join(os.tmpdir(), "synapse-open-file-"))
})

afterEach(async () => {
  await rm(tempDirectory, { recursive: true, force: true })
  vi.clearAllMocks()
})

function createRuntimeDeps(decisions: Array<{ allowed: true } | { allowed: false; reason: string; policyId?: string }> = [
  { allowed: true },
  { allowed: true },
]): NodeRuntimeDeps & {
  permissionGuard: PermissionGuard
  auditSink: AuditSink
  openPath: ReturnType<typeof vi.fn>
} {
  return {
    processRunner: { run: vi.fn() },
    sendHttpRequest: vi.fn(),
    permissionGuard: {
      registerPolicy: vi.fn(),
      check: vi.fn().mockImplementation(() => Promise.resolve(decisions.shift() ?? { allowed: true })),
    },
    auditSink: {
      record: vi.fn(),
      list: vi.fn().mockReturnValue([]),
      clearForTests: vi.fn(),
    },
    openPath: vi.fn().mockResolvedValue(""),
  }
}

function createInput(
  filePath: string,
  runtimeDeps: NodeRuntimeDeps,
  options?: { signal?: AbortSignal; resolvedVariables?: Record<string, string> },
): NodeExecutionInput<OpenFileNodeConfig> {
  return {
    config: { filePath, variables: [] },
    resolvedVariables: options?.resolvedVariables ?? {},
    context: {
      workflowId: "workflow-1",
      runId: "run-1",
      nodeId: "open-file-1",
      actor: { kind: "user", id: "local-user" },
      abortSignal: options?.signal ?? new AbortController().signal,
    },
    agentDeps: { sendToAgent: vi.fn() },
    runtimeDeps,
  }
}

describe("openFileNodeExecutor", () => {
  it("opens one regular absolute file and returns the submitted path", async () => {
    const filePath = path.join(tempDirectory, "report.html")
    await writeFile(filePath, "<h1>Report</h1>")
    const runtimeDeps = createRuntimeDeps()

    const result = await openFileNodeExecutor.execute(createInput(filePath, runtimeDeps))

    expect(result).toMatchObject({ status: "success", output: filePath, outputs: { path: filePath } })
    expect(runtimeDeps.permissionGuard.check).toHaveBeenNthCalledWith(1, expect.objectContaining({
      action: "fs.read.outside-userdata",
      resource: filePath,
    }))
    expect(runtimeDeps.permissionGuard.check).toHaveBeenNthCalledWith(2, expect.objectContaining({
      action: "shell.exec",
      resource: filePath,
    }))
    expect(runtimeDeps.openPath).toHaveBeenCalledOnce()
    expect(runtimeDeps.openPath).toHaveBeenCalledWith(filePath)
    expect(runtimeDeps.auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.read.outside-userdata",
      outcome: "allowed",
    }))
    expect(runtimeDeps.auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "shell.exec",
      outcome: "allowed",
    }))
  })

  it("interpolates the file path before validation and opening", async () => {
    const filePath = path.join(tempDirectory, "report.pdf")
    await writeFile(filePath, "pdf")
    const runtimeDeps = createRuntimeDeps()

    const result = await openFileNodeExecutor.execute(createInput(
      "{{report_path}}",
      runtimeDeps,
      { resolvedVariables: { report_path: filePath } },
    ))

    expect(result.output).toBe(filePath)
    expect(runtimeDeps.openPath).toHaveBeenCalledWith(filePath)
  })

  it("rejects relative paths before permission checks", async () => {
    const runtimeDeps = createRuntimeDeps()

    const result = await openFileNodeExecutor.execute(createInput("report.pdf", runtimeDeps))

    expect(result).toMatchObject({ status: "failed", error: "文件路径必须是绝对路径" })
    expect(runtimeDeps.permissionGuard.check).not.toHaveBeenCalled()
    expect(runtimeDeps.openPath).not.toHaveBeenCalled()
  })

  it("rejects missing files without opening", async () => {
    const runtimeDeps = createRuntimeDeps()
    const filePath = path.join(tempDirectory, "missing.pdf")

    const result = await openFileNodeExecutor.execute(createInput(filePath, runtimeDeps))

    expect(result.status).toBe("failed")
    expect(result.error).toBe("文件不存在或无法访问")
    expect(runtimeDeps.openPath).not.toHaveBeenCalled()
    expect(runtimeDeps.auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.read.outside-userdata",
      outcome: "failed",
      metadata: expect.objectContaining({ failureKind: "lstat_failed" }),
    }))
  })

  it("rejects directories without opening", async () => {
    const directoryPath = path.join(tempDirectory, "folder")
    await mkdir(directoryPath)
    const runtimeDeps = createRuntimeDeps()

    const result = await openFileNodeExecutor.execute(createInput(directoryPath, runtimeDeps))

    expect(result).toMatchObject({ status: "failed", error: "文件路径必须指向普通文件" })
    expect(runtimeDeps.openPath).not.toHaveBeenCalled()
  })

  it.skipIf(process.platform === "win32")("rejects symbolic links without opening", async () => {
    const targetPath = path.join(tempDirectory, "target.pdf")
    const linkPath = path.join(tempDirectory, "link.pdf")
    await writeFile(targetPath, "pdf")
    await symlink(targetPath, linkPath)
    const runtimeDeps = createRuntimeDeps()

    const result = await openFileNodeExecutor.execute(createInput(linkPath, runtimeDeps))

    expect(result).toMatchObject({ status: "failed", error: "不支持符号链接" })
    expect(runtimeDeps.openPath).not.toHaveBeenCalled()
  })

  it("does not inspect or open the file when read permission is denied", async () => {
    const filePath = path.join(tempDirectory, "report.pdf")
    const runtimeDeps = createRuntimeDeps([{ allowed: false, reason: "denied", policyId: "policy-1" }])

    const result = await openFileNodeExecutor.execute(createInput(filePath, runtimeDeps))

    expect(result).toMatchObject({ status: "failed", error: "没有读取该文件的权限" })
    expect(runtimeDeps.openPath).not.toHaveBeenCalled()
    expect(runtimeDeps.auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.read.outside-userdata",
      outcome: "denied",
    }))
  })

  it("does not open the file when shell permission is denied", async () => {
    const filePath = path.join(tempDirectory, "report.pdf")
    await writeFile(filePath, "pdf")
    const runtimeDeps = createRuntimeDeps([
      { allowed: true },
      { allowed: false, reason: "denied", policyId: "policy-2" },
    ])

    const result = await openFileNodeExecutor.execute(createInput(filePath, runtimeDeps))

    expect(result).toMatchObject({ status: "failed", error: "没有调用系统默认应用的权限" })
    expect(runtimeDeps.openPath).not.toHaveBeenCalled()
    expect(runtimeDeps.auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "shell.exec",
      outcome: "denied",
    }))
  })

  it("checks cancellation immediately before submitting the open request", async () => {
    const filePath = path.join(tempDirectory, "report.pdf")
    await writeFile(filePath, "pdf")
    const controller = new AbortController()
    const runtimeDeps = createRuntimeDeps()
    vi.mocked(runtimeDeps.permissionGuard.check).mockImplementation(async (request) => {
      if (request.action === "shell.exec") controller.abort()
      return { allowed: true }
    })

    const result = await openFileNodeExecutor.execute(createInput(filePath, runtimeDeps, { signal: controller.signal }))

    expect(result.status).toBe("cancelled")
    expect(runtimeDeps.openPath).not.toHaveBeenCalled()
  })

  it("fails when Electron returns a non-empty error string", async () => {
    const filePath = path.join(tempDirectory, "report.pdf")
    await writeFile(filePath, "pdf")
    const runtimeDeps = createRuntimeDeps()
    runtimeDeps.openPath.mockResolvedValue("No application is associated with the specified file")

    const result = await openFileNodeExecutor.execute(createInput(filePath, runtimeDeps))

    expect(result.status).toBe("failed")
    expect(result.error).toContain("系统未接受打开请求")
    expect(runtimeDeps.auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "shell.exec",
      outcome: "failed",
    }))
  })

  it("fails and audits when Electron throws", async () => {
    const filePath = path.join(tempDirectory, "report.pdf")
    await writeFile(filePath, "pdf")
    const runtimeDeps = createRuntimeDeps()
    runtimeDeps.openPath.mockRejectedValue(new Error("native failure"))

    const result = await openFileNodeExecutor.execute(createInput(filePath, runtimeDeps))

    expect(result.status).toBe("failed")
    expect(result.error).toContain("系统打开请求异常")
    expect(runtimeDeps.auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "shell.exec",
      outcome: "failed",
    }))
  })

  it("does not log the raw path", async () => {
    const filePath = path.join(tempDirectory, "private-report.pdf")
    await writeFile(filePath, "pdf")
    const runtimeDeps = createRuntimeDeps()

    await openFileNodeExecutor.execute(createInput(filePath, runtimeDeps))

    expect(JSON.stringify(logger.info.mock.calls)).not.toContain(filePath)
    expect(logger.info).toHaveBeenCalledWith("open file request submitted", expect.objectContaining({
      workflowId: "workflow-1",
      runId: "run-1",
      nodeId: "open-file-1",
      filePathLength: filePath.length,
    }))
  })
})

import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { AuditSink, PermissionGuard } from "../../../../electron/runtime/security"
import { TextFileWriterService } from "../service"

const tempDirectories: string[] = []

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })))
})

describe("TextFileWriterService", () => {
  it("writes exact UTF-8 bytes, creates parents, and resolves parent links", async () => {
    const root = await createTempDirectory()
    const actualRoot = path.join(root, "actual")
    const linkedRoot = path.join(root, "linked")
    await mkdir(actualRoot)
    await symlink(actualRoot, linkedRoot, process.platform === "win32" ? "junction" : "dir")
    const requestedPath = path.join(linkedRoot, "nested", "报告.MD")
    const expectedPath = path.join(await realpath(actualRoot), "nested", "报告.MD")
    const text = "第一行\r\nsecond\n"
    const { service, permissionGuard, auditSink } = createService()

    await expect(service.write({ text, path: requestedPath })).resolves.toEqual({
      path: expectedPath,
      fileName: "报告.MD",
      format: "md",
      encoding: "utf8",
      size: Buffer.byteLength(text, "utf8"),
      overwritten: false,
    })

    expect(await readFile(expectedPath)).toEqual(Buffer.from(text, "utf8"))
    expect(permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.write.outside-userdata",
      resource: expectedPath,
    }))
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      resource: expectedPath,
      outcome: "allowed",
      metadata: expect.not.objectContaining({ text }),
    }))
  })

  it("supports exact UTF-16 LE bytes and empty files without a BOM", async () => {
    const directory = await createTempDirectory()
    const utf16Path = path.join(directory, "note.txt")
    const emptyPath = path.join(directory, "empty.csv")
    const { service } = createService()

    const utf16 = await service.write({ text: "你好", path: utf16Path, encoding: "utf16le" })
    const empty = await service.write({ text: "", path: emptyPath })

    expect(await readFile(utf16Path)).toEqual(Buffer.from("你好", "utf16le"))
    expect(utf16.size).toBe(Buffer.byteLength("你好", "utf16le"))
    expect(await readFile(emptyPath)).toHaveLength(0)
    expect(empty.size).toBe(0)
  })

  it("writes arbitrary extensions and extensionless paths with either encoding", async () => {
    const directory = await createTempDirectory()
    const jsonPath = path.join(directory, "report.JSON")
    const extensionlessPath = path.join(directory, "README")
    const htmlPath = path.join(directory, "report.html")
    const { service } = createService()

    await expect(service.write({ text: "{\"ok\":true}", path: jsonPath })).resolves.toMatchObject({
      path: path.join(await realpath(directory), "report.JSON"),
      format: "json",
      encoding: "utf8",
    })
    await expect(service.write({ text: "notes", path: extensionlessPath })).resolves.toMatchObject({
      format: "",
    })
    await expect(service.write({ text: "<h1>报告</h1>", path: htmlPath, encoding: "utf16le" }))
      .resolves.toMatchObject({ format: "html", encoding: "utf16le" })
    await expect(readFile(htmlPath)).resolves.toEqual(Buffer.from("<h1>报告</h1>", "utf16le"))
  })

  it("writes a legal long target name without exceeding the temporary filename limit", async () => {
    const directory = await createTempDirectory()
    const fileName = `${"a".repeat(240)}.txt`
    const outputPath = path.join(directory, fileName)
    const { service } = createService()

    await expect(service.write({ text: "long target", path: outputPath })).resolves.toMatchObject({
      fileName,
      size: Buffer.byteLength("long target"),
    })
    await expect(readFile(outputPath, "utf8")).resolves.toBe("long target")
    expect((await readdir(directory)).filter((name) => name.startsWith(".synapse-text-file-writer-"))).toEqual([])
  })

  it("refuses implicit overwrite and preserves the existing file mode on explicit overwrite", async () => {
    const directory = await createTempDirectory()
    const outputPath = path.join(directory, "report.txt")
    await writeFile(outputPath, "old", "utf8")
    if (process.platform !== "win32") await chmod(outputPath, 0o640)
    const { service } = createService()

    await expect(service.write({ text: "new", path: outputPath })).rejects.toMatchObject({
      code: "TARGET_EXISTS",
    })
    await expect(readFile(outputPath, "utf8")).resolves.toBe("old")

    await expect(service.write({ text: "new", path: outputPath, overwrite: true })).resolves.toMatchObject({
      overwritten: true,
    })
    await expect(readFile(outputPath, "utf8")).resolves.toBe("new")
    if (process.platform !== "win32") {
      expect((await stat(outputPath)).mode & 0o777).toBe(0o640)
    }
  })

  it("rejects unsupported inputs and unsafe existing targets", async () => {
    const directory = await createTempDirectory()
    const regularPath = path.join(directory, "regular.txt")
    const linkedPath = path.join(directory, "linked.txt")
    const directoryPath = path.join(directory, "folder.txt")
    await writeFile(regularPath, "keep", "utf8")
    await symlink(regularPath, linkedPath)
    await mkdir(directoryPath)
    const { service } = createService()

    await expect(service.write({ text: "x", path: "relative.txt" })).rejects.toMatchObject({ code: "INVALID_PATH" })
    await expect(service.write({ text: "x", path: regularPath, encoding: "UTF-8" as never })).rejects.toMatchObject({ code: "INVALID_ENCODING" })
    await expect(service.write({ text: "x", path: linkedPath, overwrite: true })).rejects.toMatchObject({ code: "UNSAFE_TARGET" })
    await expect(service.write({ text: "x", path: directoryPath, overwrite: true })).rejects.toMatchObject({ code: "UNSAFE_TARGET" })
    await expect(readFile(regularPath, "utf8")).resolves.toBe("keep")
  })

  it("keeps an externally changed target and removes the staged temporary file", async () => {
    const directory = await createTempDirectory()
    const outputPath = path.join(directory, "report.txt")
    await writeFile(outputPath, "initial", "utf8")
    const { service } = createService()

    const writing = service.write({
      text: "x".repeat(32 * 1024 * 1024),
      path: outputPath,
      overwrite: true,
    })
    await waitForTemporaryFile(directory)
    await writeFile(outputPath, "external", "utf8")

    await expect(writing).rejects.toMatchObject({ code: "TARGET_CHANGED", retryable: true })
    await expect(readFile(outputPath, "utf8")).resolves.toBe("external")
    expect((await readdir(directory)).filter((name) => name.startsWith(".synapse-text-file-writer-"))).toEqual([])
  })

  it("serializes same-target writes and lets an aborted waiter leave the first write intact", async () => {
    const directory = await createTempDirectory()
    const outputPath = path.join(directory, "report.txt")
    let releasePermission!: () => void
    const permissionGate = new Promise<void>((resolve) => { releasePermission = resolve })
    const permissionGuard = createPermissionGuard(async (requestNumber) => {
      if (requestNumber === 1) await permissionGate
      return { allowed: true as const }
    })
    const service = new TextFileWriterService({ permissionGuard, auditSink: createAuditSink() })
    const first = service.write({ text: "first", path: outputPath })
    const controller = new AbortController()
    const second = service.write({ text: "second", path: outputPath, overwrite: true }, {
      abortSignal: controller.signal,
    })
    controller.abort()
    releasePermission()

    await expect(second).rejects.toMatchObject({ code: "ABORTED", retryable: false })
    await expect(first).resolves.toMatchObject({ overwritten: false })
    await expect(readFile(outputPath, "utf8")).resolves.toBe("first")
  })

  it("denies before writing and records no text in logs or audit metadata", async () => {
    const directory = await createTempDirectory()
    const outputPath = path.join(directory, "private.txt")
    const auditSink = createAuditSink()
    const logger = { info: vi.fn(), warn: vi.fn() }
    const permissionGuard = createPermissionGuard(async () => ({
      allowed: false as const,
      reason: "private policy detail",
      policyId: "deny-test",
    }))
    const service = new TextFileWriterService({ permissionGuard, auditSink, logger })
    const secretText = "do-not-log-this-text"

    await expect(service.write({ text: secretText, path: outputPath })).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
    })

    await expect(stat(outputPath)).rejects.toMatchObject({ code: "ENOENT" })
    expect(JSON.stringify(auditSink.record.mock.calls)).not.toContain(secretText)
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(secretText)
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(outputPath)
  })
})

function createService() {
  const permissionGuard = createPermissionGuard(async () => ({ allowed: true as const }))
  const auditSink = createAuditSink()
  return {
    permissionGuard,
    auditSink,
    service: new TextFileWriterService({ permissionGuard, auditSink }),
  }
}

function createPermissionGuard(
  decide: (requestNumber: number) => Promise<{ allowed: true } | { allowed: false; reason: string; policyId?: string }>,
): PermissionGuard & { check: ReturnType<typeof vi.fn> } {
  let requestNumber = 0
  return {
    registerPolicy: () => () => undefined,
    check: vi.fn(async () => decide(++requestNumber)),
  }
}

function createAuditSink(): AuditSink & { record: ReturnType<typeof vi.fn> } {
  return {
    record: vi.fn(),
    list: () => [],
    clearForTests: () => undefined,
  }
}

async function createTempDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "synapse-text-file-writer-"))
  tempDirectories.push(directory)
  return directory
}

async function waitForTemporaryFile(directory: string): Promise<void> {
  for (let attempt = 0; attempt < 2_000; attempt += 1) {
    const names = await readdir(directory)
    if (names.some((name) => name.startsWith(".synapse-text-file-writer-"))) return
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
  throw new Error("Timed out waiting for the staged text file.")
}

import { mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createDocumentTextSaveService } from "../save-service"

const tempDirectories: string[] = []

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })))
})

describe("DocumentTextSaveService", () => {
  it("writes the complete text as UTF-8 without a BOM", async () => {
    const directory = await createTempDirectory()
    const outputPath = path.join(directory, "report.txt")

    await expect(createDocumentTextSaveService().save({ outputPath, text: "第一行\nsecond" })).resolves.toEqual({
      outputPath,
      fileName: "report.txt",
      size: Buffer.byteLength("第一行\nsecond", "utf8"),
    })

    const bytes = await readFile(outputPath)
    expect(bytes.equals(Buffer.from("第一行\nsecond", "utf8"))).toBe(true)
    expect([...bytes.subarray(0, 3)]).not.toEqual([0xef, 0xbb, 0xbf])
  })

  it("safely replaces a regular file selected through the system dialog", async () => {
    const directory = await createTempDirectory()
    const outputPath = path.join(directory, "report.txt")
    await writeFile(outputPath, "旧正文", "utf8")

    await createDocumentTextSaveService().save({ outputPath, text: "新正文" })

    await expect(readFile(outputPath, "utf8")).resolves.toBe("新正文")
  })

  it("rejects symbolic links and non-TXT output paths", async () => {
    const directory = await createTempDirectory()
    const targetPath = path.join(directory, "target.txt")
    const linkedPath = path.join(directory, "linked.txt")
    await writeFile(targetPath, "保留", "utf8")
    await symlink(targetPath, linkedPath)

    await expect(createDocumentTextSaveService().save({ outputPath: linkedPath, text: "覆盖" }))
      .rejects.toMatchObject({
        code: "UNSAFE_OUTPUT_TARGET",
        message: "无法安全写入所选文件。",
      })
    await expect(readFile(targetPath, "utf8")).resolves.toBe("保留")
    await expect(createDocumentTextSaveService().save({
      outputPath: path.join(directory, "report.md"),
      text: "正文",
    })).rejects.toMatchObject({
      code: "INVALID_OUTPUT",
      message: "输出文件必须是 .txt 文件。",
    })
  })

  it("preserves the previous file and removes the temporary file when replacement fails", async () => {
    const directory = await createTempDirectory()
    const outputPath = path.join(directory, "report.txt")
    await writeFile(outputPath, "旧正文", "utf8")
    const service = createDocumentTextSaveService({
      rename: async (source, target) => {
        if (target === outputPath) throw new Error(`disk full while replacing ${target}`)
        await rename(source, target)
      },
    })

    await expect(service.save({ outputPath, text: "新正文" })).rejects.toMatchObject({
      code: "WRITE_FAILED",
      message: "保存文本失败。",
    })
    await expect(readFile(outputPath, "utf8")).resolves.toBe("旧正文")
    await expect(readdir(directory)).resolves.toEqual(["report.txt"])
  })

  it("logs a path-free warning when closing the temporary file during cleanup fails", async () => {
    const directory = await createTempDirectory()
    const outputPath = path.join(directory, "private-report.txt")
    const logger = { warn: vi.fn() }
    const writeError = new Error("primary write failure")
    const closeError = Object.assign(
      new Error(`cannot close ${path.join(directory, "secret.tmp")}`),
      { code: "EIO" },
    )
    const handle = {
      writeFile: vi.fn(async () => { throw writeError }),
      sync: vi.fn(),
      close: vi.fn(async () => { throw closeError }),
    }
    const service = createDocumentTextSaveService({
      logger,
      open: vi.fn(async () => handle) as unknown as typeof import("node:fs/promises").open,
    })

    await expect(service.save({ outputPath, text: "正文" })).rejects.toMatchObject({
      code: "WRITE_FAILED",
      cause: writeError,
    })
    expect(logger.warn).toHaveBeenCalledWith("Document text save cleanup failed.", {
      operation: "close-temporary-file",
      errorCategory: "EIO",
    })
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(directory)
  })

  it("logs a path-free warning when removing the temporary file during cleanup fails", async () => {
    const directory = await createTempDirectory()
    const outputPath = path.join(directory, "private-report.txt")
    const logger = { warn: vi.fn() }
    const replaceError = new Error("primary replacement failure")
    const removeError = Object.assign(
      new Error(`cannot remove ${path.join(directory, "secret.tmp")}`),
      { code: "EACCES" },
    )
    const service = createDocumentTextSaveService({
      logger,
      remove: vi.fn(async () => { throw removeError }),
      rename: vi.fn(async () => { throw replaceError }),
    })

    await expect(service.save({ outputPath, text: "正文" })).rejects.toMatchObject({
      code: "WRITE_FAILED",
      cause: replaceError,
    })
    expect(logger.warn).toHaveBeenCalledWith("Document text save cleanup failed.", {
      operation: "remove-temporary-file",
      errorCategory: "EACCES",
    })
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(directory)
  })
})

async function createTempDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "synapse-document-text-save-"))
  tempDirectories.push(directory)
  return directory
}

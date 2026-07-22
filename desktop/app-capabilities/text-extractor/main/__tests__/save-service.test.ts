import path from "node:path"
import { describe, expect, it, vi } from "vitest"
import { TextFileWriteError } from "../../../text-file-writer/shared/errors"
import { createTextSaveService } from "../save-service"

const outputPath = path.resolve("report.txt")

describe("TextSaveService compatibility adapter", () => {
  it("delegates the unchanged full text as TXT, UTF-8, and explicit overwrite", async () => {
    const text = "第一行\r\nsecond\n"
    const write = vi.fn(async () => ({
      path: outputPath,
      fileName: "report.txt",
      format: "txt" as const,
      encoding: "utf8" as const,
      size: Buffer.byteLength(text, "utf8"),
      overwritten: true,
    }))
    const context = {
      actor: { kind: "user" as const, id: "text-extractor-app" },
      source: "text-extractor" as const,
    }

    await expect(createTextSaveService({ write }).save({ outputPath, text }, context)).resolves.toEqual({
      outputPath,
      fileName: "report.txt",
      size: Buffer.byteLength(text, "utf8"),
    })
    expect(write).toHaveBeenCalledWith({
      path: outputPath,
      text,
      encoding: "utf8",
      overwrite: true,
    }, context)
  })

  it.each([
    ["INVALID_PATH", "INVALID_OUTPUT"],
    ["UNSUPPORTED_EXTENSION", "INVALID_OUTPUT"],
    ["UNSAFE_TARGET", "UNSAFE_OUTPUT_TARGET"],
    ["TARGET_CHANGED", "OUTPUT_CHANGED"],
    ["TARGET_EXISTS", "OUTPUT_CHANGED"],
    ["PERMISSION_DENIED", "PERMISSION_DENIED"],
    ["ABORTED", "WRITE_FAILED"],
    ["WRITE_FAILED", "WRITE_FAILED"],
  ] as const)("maps %s without exposing core details", async (writerCode, expectedCode) => {
    const service = createTextSaveService({
      write: vi.fn(async () => { throw new TextFileWriteError(writerCode) }),
    })

    await expect(service.save({ outputPath, text: "正文" })).rejects.toMatchObject({
      code: expectedCode,
    })
  })

  it("normalizes unknown writer failures", async () => {
    const nativeError = new Error(`cannot write ${outputPath}`)
    const service = createTextSaveService({
      write: vi.fn(async () => { throw nativeError }),
    })

    await expect(service.save({ outputPath, text: "正文" })).rejects.toMatchObject({
      code: "WRITE_FAILED",
      cause: nativeError,
    })
  })
})

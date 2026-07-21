import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  truncate,
  writeFile,
} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"
import { createDocumentTextExtractorService } from "../service"
import { createPdfFixture } from "./pdf-fixture"

const fixturePath = path.resolve(
  "resources/knowledge-base/synapse-knowledge-base-template/docs/install-guide.pdf",
)

function createTestService(logger?: { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> }) {
  const permissionGuard = {
    check: vi.fn(async () => ({ allowed: true as const })),
  }
  const auditSink = { record: vi.fn() }
  return {
    service: createDocumentTextExtractorService({
      permissionGuard: permissionGuard as never,
      auditSink: auditSink as never,
      logger: logger as never,
    }),
    permissionGuard,
    auditSink,
  }
}

describe("DocumentTextExtractorService", () => {
  it("extracts a multi-page PDF through the real worker", async () => {
    const logger = { info: vi.fn(), warn: vi.fn() }
    const { service, permissionGuard, auditSink } = createTestService(logger)
    const context = {
      source: "mcp-http" as const,
      actor: { kind: "user" as const, id: "mcp-client:test" },
    }
    const result = await service.extract({ filePath: fixturePath }, context)

    expect(result).toMatchObject({
      format: "pdf",
      fileName: "install-guide.pdf",
      size: (await stat(fixturePath)).size,
      pages: 5,
    })
    expect(result.text).toContain("cosmic-brain — Install Guide")
    expect(result.text).toContain("Troubleshooting")
    expect(result.text).toContain(
      "3. Configure the MCP server.\n\n4. Ask me ONE question",
    )
    expect(logger.info).toHaveBeenCalledWith(
      "Document text extraction completed.",
      {
        format: "pdf",
        sourceBytes: result.size,
        textBytes: Buffer.byteLength(result.text, "utf8"),
        pages: 5,
        durationMs: expect.any(Number),
      },
    )
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain(fixturePath)
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain(result.text)
    expect(permissionGuard.check).toHaveBeenCalledWith({
      action: "fs.read.outside-userdata",
      actor: context.actor,
      resource: fixturePath,
      context: {
        source: "mcp-http",
        capabilityAction: "app.document_text_extractor.document.extract",
        boundary: "documentTextExtractor.service.document",
      },
    })
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      outcome: "allowed",
      resource: "install-guide.pdf",
    }))
    expect(JSON.stringify(auditSink.record.mock.calls)).not.toContain(fixturePath)
    expect(JSON.stringify(auditSink.record.mock.calls)).not.toContain(result.text)
  })

  it("returns an empty successful result when a PDF has no text layer", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-document-text-"))
    const filePath = path.join(root, "blank.pdf")
    try {
      await writeFile(filePath, createPdfFixture([""]))

      await expect(createTestService().service.extract({ filePath }))
        .resolves.toMatchObject({ text: "", format: "pdf", pages: 1 })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("denies reads in the core service and records only a redacted resource", async () => {
    const permissionGuard = {
      check: vi.fn(async () => ({
        allowed: false as const,
        reason: "denied",
        policyId: "policy:test",
      })),
    }
    const auditSink = { record: vi.fn() }
    const service = createDocumentTextExtractorService({
      permissionGuard: permissionGuard as never,
      auditSink: auditSink as never,
    })

    await expect(service.extract({ filePath: fixturePath }, { source: "mcp-http" }))
      .rejects.toThrow("denied")
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      outcome: "denied",
      resource: "install-guide.pdf",
      metadata: expect.objectContaining({ policyId: "policy:test" }),
    }))
    expect(JSON.stringify(auditSink.record.mock.calls)).not.toContain(fixturePath)
  })

  it("normalizes outer whitespace and repeated blank page separators", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-document-text-"))
    const filePath = path.join(root, "normalize.PDF")
    try {
      await writeFile(filePath, createPdfFixture(["  first  ", "", "", "second\t  "]))

      await expect(createTestService().service.extract({ filePath }))
        .resolves.toMatchObject({ text: "first\n\nsecond", pages: 4 })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("rejects unsupported extensions and PDF content mismatches with stable codes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-document-text-"))
    const textPath = path.join(root, "document.txt")
    const disguisedPath = path.join(root, "disguised.pdf")
    const corruptPath = path.join(root, "corrupt.pdf")
    const invalidVersionPath = path.join(root, "invalid-version.pdf")
    try {
      await writeFile(textPath, createPdfFixture(["text"]))
      await writeFile(disguisedPath, "not a PDF")
      await writeFile(corruptPath, "%PDF-1.4\ncorrupt")
      const invalidVersionPdf = await readFile(fixturePath)
      invalidVersionPdf.set(Buffer.from("%PDF-9.9", "ascii"), 0)
      await writeFile(invalidVersionPath, invalidVersionPdf)
      const { service } = createTestService()

      await expect(service.extract({ filePath: textPath }))
        .rejects.toMatchObject({ code: "UNSUPPORTED_FORMAT" })
      await expect(service.extract({ filePath: disguisedPath }))
        .rejects.toMatchObject({ code: "INVALID_DOCUMENT" })
      await expect(service.extract({ filePath: corruptPath }))
        .rejects.toMatchObject({ code: "INVALID_DOCUMENT" })
      await expect(service.extract({ filePath: invalidVersionPath }))
        .rejects.toMatchObject({ code: "INVALID_DOCUMENT" })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("rejects symbolic links, non-files, and missing files without exposing paths", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-document-text-"))
    const sourcePath = path.join(root, "source.pdf")
    const linkPath = path.join(root, "link.pdf")
    const directoryPath = path.join(root, "directory.pdf")
    const missingPath = path.join(root, "missing.pdf")
    try {
      await writeFile(sourcePath, createPdfFixture(["text"]))
      await symlink(sourcePath, linkPath)
      await mkdir(directoryPath)
      const { service } = createTestService()

      for (const filePath of [linkPath, directoryPath, missingPath]) {
        const error = await service.extract({ filePath }).catch((caught: unknown) => caught)
        expect(error).toMatchObject({ code: "READ_FAILED" })
        expect(JSON.stringify(error)).not.toContain(filePath)
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("rejects a source larger than 50 MiB before reading it", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-document-text-"))
    const filePath = path.join(root, "large.pdf")
    try {
      await writeFile(filePath, "%PDF-1.4\n")
      await truncate(filePath, 50 * 1024 * 1024 + 1)

      await expect(createTestService().service.extract({ filePath }))
        .rejects.toMatchObject({ code: "FILE_TOO_LARGE" })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("rejects normalized text larger than 5 MiB without truncation", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-document-text-"))
    const filePath = path.join(root, "large-text.pdf")
    try {
      await writeFile(filePath, createPdfFixture(
        Array.from(
          { length: 2_000 },
          () => Array.from({ length: 40 }, () => "a".repeat(70)).join("\n"),
        ),
      ))

      await expect(createTestService().service.extract({ filePath }))
        .rejects.toMatchObject({ code: "TEXT_TOO_LARGE" })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 30_000)

  it("rejects a PDF with more than 2,000 pages", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-document-text-"))
    const filePath = path.join(root, "too-many-pages.pdf")
    try {
      await writeFile(filePath, createPdfFixture(Array.from({ length: 2_001 }, () => "")))

      await expect(createTestService().service.extract({ filePath }))
        .rejects.toMatchObject({ code: "PDF_PAGE_LIMIT_EXCEEDED" })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 30_000)
})

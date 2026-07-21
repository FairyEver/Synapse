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
import { Worker } from "node:worker_threads"
import { describe, expect, it, vi } from "vitest"
import {
  createDocumentTextExtractorService,
  type DocumentTextExtractionWorkerFactory,
} from "../service"
import { createDocxFixture, textParagraph } from "./docx-fixture"
import { createEncryptedDocxFixture } from "./encrypted-docx-fixture"
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

const CONTROLLED_WORKER_SOURCE = `
  const { parentPort } = require("node:worker_threads")
  parentPort.on("message", (command) => {
    if (command === "complete") {
      parentPort.postMessage({ type: "success", result: { text: "completed", pages: 1 } })
      return
    }
    if (command === "fail") {
      parentPort.postMessage({ type: "error", code: "EXTRACTION_FAILED" })
      return
    }
    if (command === "crash") throw new Error("raw worker detail")
  })
`

const MEMORY_WORKER_SOURCE = `
  const retained = []
  while (true) retained.push(new Array(500_000).fill(Math.random()))
`

function createWorkerBoundary(mode: "controlled" | "memory" = "controlled") {
  const activeWorkers: Worker[] = []
  const releaseWaiters = new Set<() => void>()
  const factory: DocumentTextExtractionWorkerFactory = (_filename, options) => {
    const worker = new Worker(
      mode === "memory" ? MEMORY_WORKER_SOURCE : CONTROLLED_WORKER_SOURCE,
      {
        ...options,
        eval: true,
        ...(mode === "memory"
          ? { resourceLimits: { maxOldGenerationSizeMb: 8, maxYoungGenerationSizeMb: 2 } }
          : {}),
      },
    )
    activeWorkers.push(worker)
    worker.once("exit", () => {
      const index = activeWorkers.indexOf(worker)
      if (index >= 0) activeWorkers.splice(index, 1)
      if (activeWorkers.length === 0) {
        for (const resolve of releaseWaiters) resolve()
        releaseWaiters.clear()
      }
    })
    return worker
  }

  const sendNext = (command: "complete" | "fail" | "crash") => {
    const worker = activeWorkers[0]
    if (!worker) throw new Error("Expected an active Worker")
    worker.postMessage(command)
  }

  return {
    factory,
    completeNext: () => sendNext("complete"),
    failNext: () => sendNext("fail"),
    crashNext: () => sendNext("crash"),
    completeAll: () => {
      for (const worker of [...activeWorkers]) worker.postMessage("complete")
    },
    waitForAllReleased: () => activeWorkers.length === 0
      ? Promise.resolve()
      : new Promise<void>((resolve) => releaseWaiters.add(resolve)),
  }
}

function createSchedulingTestService(workerFactory: DocumentTextExtractionWorkerFactory) {
  return createDocumentTextExtractorService({
    permissionGuard: { check: vi.fn(async () => ({ allowed: true as const })) } as never,
    auditSink: { record: vi.fn() } as never,
    workerFactory,
  })
}

async function waitForTaskStatus(
  task: { getState(): { readonly status: string } },
  status: string,
): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (task.getState().status === status) return
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
  expect(task.getState().status).toBe(status)
}

describe("DocumentTextExtractorService", () => {
  it("extracts DOCX paragraphs, list text, table cells, and a text box through the real worker", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-document-text-"))
    const filePath = path.join(root, "content.DOCX")
    try {
      await writeFile(filePath, createDocxFixture([
        textParagraph("Opening paragraph"),
        `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>First list item</w:t></w:r></w:p>`,
        `<w:tbl><w:tr><w:tc>${textParagraph("Left cell")}</w:tc><w:tc>${textParagraph("Right cell")}</w:tc></w:tr></w:tbl>`,
        `<w:p><w:r><w:pict><v:rect><v:textbox><w:txbxContent>${textParagraph("Text box content")}</w:txbxContent></v:textbox></v:rect></w:pict></w:r></w:p>`,
      ].join("")))

      const result = await createTestService().service.extract({ filePath })

      expect(result).toEqual({
        text: "Opening paragraph\n\nFirst list item\n\nLeft cell\n\nRight cell\n\nText box content",
        format: "docx",
        fileName: "content.DOCX",
        size: (await stat(filePath)).size,
      })
      expect(result).not.toHaveProperty("pages")
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("reports a real password-protected DOCX without attempting decryption", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-document-text-"))
    const filePath = path.join(root, "protected.docx")
    try {
      await writeFile(filePath, createEncryptedDocxFixture())

      await expect(createTestService().service.extract({ filePath }))
        .rejects.toMatchObject({ code: "PASSWORD_PROTECTED" })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("does not treat CFB-looking garbage with encryption stream names as password-protected", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-document-text-"))
    const filePath = path.join(root, "fake-protected.docx")
    const fakeCompoundFile = Buffer.concat([
      Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
      Buffer.alloc(504),
      Buffer.from("EncryptionInfo\0", "utf16le"),
      Buffer.from("EncryptedPackage\0", "utf16le"),
    ])
    try {
      await writeFile(filePath, fakeCompoundFile)

      await expect(createTestService().service.extract({ filePath }))
        .rejects.toMatchObject({ code: "INVALID_DOCUMENT" })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("returns an empty successful result for an empty DOCX body", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-document-text-"))
    const filePath = path.join(root, "empty.docx")
    try {
      await writeFile(filePath, createDocxFixture(""))

      await expect(createTestService().service.extract({ filePath }))
        .resolves.toEqual({
          text: "",
          format: "docx",
          fileName: "empty.docx",
          size: (await stat(filePath)).size,
        })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("applies the shared deterministic normalization to DOCX text", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-document-text-"))
    const filePath = path.join(root, "normalize.docx")
    try {
      await writeFile(filePath, createDocxFixture([
        textParagraph("  first  "),
        textParagraph("second\t  "),
        textParagraph(""),
        textParagraph(""),
        textParagraph("third"),
      ].join("")))

      await expect(createTestService().service.extract({ filePath }))
        .resolves.toMatchObject({ text: "first\n\nsecond\n\nthird", format: "docx" })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("rejects corrupt, disguised, and incomplete DOCX containers as invalid documents", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-document-text-"))
    const corruptPath = path.join(root, "corrupt.docx")
    const disguisedPath = path.join(root, "disguised.docx")
    const missingMainPath = path.join(root, "missing-main.docx")
    try {
      await writeFile(corruptPath, "PK\u0003\u0004corrupt")
      await writeFile(disguisedPath, createPdfFixture(["PDF in DOCX clothing"]))
      await writeFile(missingMainPath, createDocxFixture("", { includeMainDocument: false }))
      const service = createTestService().service

      for (const filePath of [corruptPath, disguisedPath, missingMainPath]) {
        await expect(service.extract({ filePath }))
          .rejects.toMatchObject({ code: "INVALID_DOCUMENT" })
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("keeps Mammoth warnings out of the result and logs only redacted diagnostics", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-document-text-"))
    const filePath = path.join(root, "warning.docx")
    const logger = { info: vi.fn(), warn: vi.fn() }
    try {
      await writeFile(filePath, createDocxFixture([
        textParagraph("Visible text"),
        `<w:unsupportedSecretElement><w:r><w:t>hidden warning detail</w:t></w:r></w:unsupportedSecretElement>`,
      ].join("")))

      const result = await createTestService(logger).service.extract({ filePath })

      expect(result).toMatchObject({ text: "Visible text", format: "docx" })
      expect(result).not.toHaveProperty("warnings")
      expect(logger.warn).toHaveBeenCalledWith(
        "Document text extraction completed with warnings.",
        {
          format: "docx",
          warningCount: 1,
          warningCategories: ["unrecognized-element"],
        },
      )
      expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(filePath)
      expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("unsupportedSecretElement")
      expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("hidden warning detail")
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("rejects DOCX text larger than 5 MiB without returning a partial result", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-document-text-"))
    const filePath = path.join(root, "large-text.docx")
    try {
      await writeFile(filePath, createDocxFixture(textParagraph("a".repeat(
        5 * 1024 * 1024 + 1,
      ))))

      await expect(createTestService().service.extract({ filePath }))
        .rejects.toMatchObject({ code: "TEXT_TOO_LARGE" })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 30_000)

  it("keeps a task waiting while bytes are prepared and starts it after Worker creation", async () => {
    let statusAtWorkerCreation: string | undefined
    const workerFactory: DocumentTextExtractionWorkerFactory = (_filename, options) => {
      statusAtWorkerCreation = task.getState().status
      return new Worker(`
        const { parentPort } = require("node:worker_threads")
        parentPort.postMessage({ type: "success", result: { text: "created", pages: 1 } })
      `, { ...options, eval: true })
    }
    const service = createDocumentTextExtractorService({
      permissionGuard: { check: vi.fn(async () => ({ allowed: true as const })) } as never,
      auditSink: { record: vi.fn() } as never,
      workerFactory,
    })

    const task = service.createTask({ filePath: fixturePath })

    await expect(task.result).resolves.toMatchObject({ text: "created" })
    expect(statusAtWorkerCreation).toBe("waiting")
    expect(task.getState().status).toBe("completed")
  })

  it("runs at most two tasks and keeps the third task waiting", async () => {
    const boundary = createWorkerBoundary()
    const scheduledService = createSchedulingTestService(boundary.factory)
    const first = scheduledService.createTask({ filePath: fixturePath })
    const second = scheduledService.createTask({ filePath: fixturePath })
    const third = scheduledService.createTask({ filePath: fixturePath })
    const firstStates: unknown[] = []
    first.subscribe((state) => firstStates.push(state))

    await vi.waitFor(() => {
      expect(first.getState().status).toBe("running")
      expect(second.getState().status).toBe("running")
      expect(third.getState().status).toBe("waiting")
    })
    boundary.completeAll()
    await expect(Promise.all([first.result, second.result])).resolves.toHaveLength(2)
    expect(firstStates).toEqual([
      expect.objectContaining({ status: "waiting" }),
      expect.objectContaining({ status: "running" }),
      expect.objectContaining({ status: "completed" }),
    ])
    expect(JSON.stringify(firstStates)).not.toMatch(/percent|progress/i)
    await vi.waitFor(() => {
      expect(third.getState().status).toBe("running")
    })

    boundary.completeNext()
    await expect(third.result).resolves.toMatchObject({ text: "completed" })
    await boundary.waitForAllReleased()
  })

  it("starts waiting tasks in FIFO order as slots become available", async () => {
    const boundary = createWorkerBoundary()
    const service = createSchedulingTestService(boundary.factory)
    const tasks = Array.from({ length: 4 }, () => service.createTask({ filePath: fixturePath }))

    await vi.waitFor(() => {
      expect(tasks.map((task) => task.getState().status)).toEqual([
        "running",
        "running",
        "waiting",
        "waiting",
      ])
    })

    boundary.completeNext()
    await vi.waitFor(() => {
      expect(tasks[2]!.getState().status).toBe("running")
      expect(tasks[3]!.getState().status).toBe("waiting")
    })

    boundary.completeNext()
    await vi.waitFor(() => expect(tasks[3]!.getState().status).toBe("running"))
    boundary.completeAll()
    await expect(Promise.all(tasks.map((task) => task.result))).resolves.toHaveLength(4)
    await boundary.waitForAllReleased()
  })

  it("cancels a waiting task without delaying the next task", async () => {
    const boundary = createWorkerBoundary()
    const service = createSchedulingTestService(boundary.factory)
    const first = service.createTask({ filePath: fixturePath })
    const second = service.createTask({ filePath: fixturePath })
    const cancelled = service.createTask({ filePath: fixturePath })
    const fourth = service.createTask({ filePath: fixturePath })

    await vi.waitFor(() => {
      expect(first.getState().status).toBe("running")
      expect(second.getState().status).toBe("running")
      expect(cancelled.getState().status).toBe("waiting")
    })
    expect(cancelled.cancel()).toBe(true)
    await expect(cancelled.result).rejects.toMatchObject({ code: "EXTRACTION_CANCELLED" })
    expect(cancelled.getState()).toMatchObject({
      status: "cancelled",
      error: { code: "EXTRACTION_CANCELLED" },
    })

    boundary.completeNext()
    await vi.waitFor(() => expect(fourth.getState().status).toBe("running"))
    boundary.completeAll()
    await expect(Promise.all([first.result, second.result, fourth.result])).resolves.toHaveLength(3)
    await boundary.waitForAllReleased()
  })

  it("cancels a running task and releases its slot for the next task", async () => {
    const boundary = createWorkerBoundary()
    const service = createSchedulingTestService(boundary.factory)
    const first = service.createTask({ filePath: fixturePath })
    const second = service.createTask({ filePath: fixturePath })
    const third = service.createTask({ filePath: fixturePath })

    await vi.waitFor(() => {
      expect(first.getState().status).toBe("running")
      expect(second.getState().status).toBe("running")
      expect(third.getState().status).toBe("waiting")
    })
    expect(first.cancel()).toBe(true)
    await expect(first.result).rejects.toMatchObject({ code: "EXTRACTION_CANCELLED" })
    await vi.waitFor(() => expect(third.getState().status).toBe("running"))
    boundary.completeAll()
    await expect(Promise.all([second.result, third.result])).resolves.toHaveLength(2)
    await boundary.waitForAllReleased()
  })

  it("keeps cancellation terminal until its Worker is released", async () => {
    const boundary = createWorkerBoundary()
    const service = createSchedulingTestService(boundary.factory)
    const task = service.createTask({ filePath: fixturePath })
    await vi.waitFor(() => expect(task.getState().status).toBe("running"))

    expect(task.cancel()).toBe(true)
    await expect(task.result).rejects.toMatchObject({ code: "EXTRACTION_CANCELLED" })
    await boundary.waitForAllReleased()
    expect(task.getState().status).toBe("cancelled")
  })

  it("releases running workers and queued tasks when the shared service stops", async () => {
    const boundary = createWorkerBoundary()
    const service = createSchedulingTestService(boundary.factory)
    const tasks = Array.from({ length: 3 }, () => service.createTask({ filePath: fixturePath }))
    const outcomes = tasks.map((task) => task.result.catch((error: unknown) => error))

    await vi.waitFor(() => {
      expect(tasks.map((task) => task.getState().status)).toEqual([
        "running",
        "running",
        "waiting",
      ])
    })
    await service.stop()
    await boundary.waitForAllReleased()

    await expect(Promise.all(outcomes)).resolves.toEqual([
      expect.objectContaining({ code: "EXTRACTION_CANCELLED" }),
      expect.objectContaining({ code: "EXTRACTION_CANCELLED" }),
      expect.objectContaining({ code: "EXTRACTION_CANCELLED" }),
    ])
    expect(tasks.map((task) => task.getState().status)).toEqual([
      "cancelled",
      "cancelled",
      "cancelled",
    ])
  })

  it("continues the FIFO queue after a worker failure", async () => {
    const boundary = createWorkerBoundary()
    const service = createSchedulingTestService(boundary.factory)
    const tasks = Array.from({ length: 3 }, () => service.createTask({ filePath: fixturePath }))
    const outcomes = tasks.map((task) => task.result.then(
      () => "completed" as const,
      (error: unknown) => error,
    ))

    await vi.waitFor(() => {
      expect(tasks[0]!.getState().status).toBe("running")
      expect(tasks[1]!.getState().status).toBe("running")
      expect(tasks[2]!.getState().status).toBe("waiting")
    })
    boundary.failNext()
    await vi.waitFor(() => expect(tasks[2]!.getState().status).toBe("running"))
    const failedTask = tasks.find((task) => task.getState().status === "failed")
    expect(failedTask?.getState()).toMatchObject({
      status: "failed",
      error: { code: "EXTRACTION_FAILED" },
    })
    expect(tasks.filter((task) => task.getState().status === "running")).toHaveLength(2)
    boundary.completeAll()
    const results = await Promise.all(outcomes)
    expect(results.filter((result) => result === "completed")).toHaveLength(2)
    expect(results.find((result) => result !== "completed"))
      .toMatchObject({ code: "EXTRACTION_FAILED" })
    await boundary.waitForAllReleased()
  })

  it("maps a worker heap exhaustion to a stable serializable failure", async () => {
    const boundary = createWorkerBoundary("memory")
    const service = createSchedulingTestService(boundary.factory)
    const task = service.createTask({ filePath: fixturePath })

    await expect(task.result).rejects.toMatchObject({
      code: "EXTRACTION_MEMORY_LIMIT",
      message: "文档文本提取超过内存限制。",
    })
    expect(task.getState()).toMatchObject({
      status: "failed",
      error: {
        code: "EXTRACTION_MEMORY_LIMIT",
        message: "文档文本提取超过内存限制。",
      },
    })
    expect(JSON.stringify(task.getState())).not.toContain(fixturePath)
    await boundary.waitForAllReleased()
  }, 30_000)

  it("maps an abnormal worker exit without exposing the worker error", async () => {
    const boundary = createWorkerBoundary()
    const service = createSchedulingTestService(boundary.factory)
    const task = service.createTask({ filePath: fixturePath })
    await vi.waitFor(() => expect(task.getState().status).toBe("running"))
    boundary.crashNext()

    await expect(task.result).rejects.toMatchObject({
      code: "EXTRACTION_FAILED",
      message: "文档文本提取失败。",
    })
    expect(task.getState()).toMatchObject({
      status: "failed",
      error: {
        code: "EXTRACTION_FAILED",
        message: "文档文本提取失败。",
      },
    })
    expect(JSON.stringify(task.getState())).not.toContain("raw worker detail")
    await boundary.waitForAllReleased()
  })

  it("starts the timeout when a waiting task begins running", async () => {
    const boundary = createWorkerBoundary()
    const service = createSchedulingTestService(boundary.factory)
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
    try {
      const first = service.createTask({ filePath: fixturePath })
      const second = service.createTask({ filePath: fixturePath })
      const third = service.createTask({ filePath: fixturePath })
      await Promise.all([
        waitForTaskStatus(first, "running"),
        waitForTaskStatus(second, "running"),
      ])
      expect(third.getState().status).toBe("waiting")

      await vi.advanceTimersByTimeAsync(59_999)
      expect(third.getState().status).toBe("waiting")
      boundary.completeAll()
      await expect(Promise.all([first.result, second.result])).resolves.toHaveLength(2)
      await waitForTaskStatus(third, "running")

      await vi.advanceTimersByTimeAsync(59_999)
      expect(third.getState().status).toBe("running")
      const timeoutResult = expect(third.result).rejects.toMatchObject({
        code: "EXTRACTION_TIMEOUT",
      })
      await vi.advanceTimersByTimeAsync(1)
      await timeoutResult
      await boundary.waitForAllReleased()
      expect(third.getState()).toMatchObject({
        status: "failed",
        error: { code: "EXTRACTION_TIMEOUT" },
      })
    } finally {
      vi.useRealTimers()
    }
  })

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
    expect(logger.info.mock.calls
      .map(([, metadata]) => metadata?.status)
      .filter(Boolean)).toEqual(["waiting", "running", "completed"])
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

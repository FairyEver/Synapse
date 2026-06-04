import { describe, expect, it, vi } from "vitest"
import { z } from "zod"

import type { AuditSink, PermissionGuard, PermissionResult } from "../../../runtime/security"
import { BuiltinToolError } from "../errors"
import { resolveBuiltinToolPermissions } from "../permissions"
import { createBuiltinToolRegistryForTests } from "../registry"
import { runBuiltinTool } from "../runner"
import type { BuiltinToolDescriptor } from "../types"

const inputSchema = z.object({
  inputPath: z.string().min(1),
  outputMode: z.enum(["return", "write-file"]),
  outputDirectory: z.string().optional(),
})

const outputSchema = z.object({
  markdown: z.string(),
  warnings: z.array(z.object({ code: z.string(), message: z.string() })),
})

function makeTool(overrides: Partial<BuiltinToolDescriptor<z.infer<typeof inputSchema>, z.infer<typeof outputSchema>>> = {}) {
  return {
    id: "docx-to-markdown",
    title: "DOCX 转 Markdown",
    description: "转换一个 DOCX 文件",
    category: "conversion",
    inputSchema,
    outputSchema,
    ui: { fields: [], resultPreview: { kind: "markdown" } },
    permissions: [
      { action: "fs.read.outside-userdata", pathFromInput: "inputPath" },
      { action: "fs.write", pathFromInput: "outputDirectory", when: { outputMode: "write-file" } },
    ],
    entryPoints: ["tools"],
    input: { kind: "file", extensions: [".docx"] },
    output: { kind: "markdown" },
    executor: vi.fn(async () => ({ markdown: "# OK", warnings: [] })),
    ...overrides,
  } satisfies BuiltinToolDescriptor<z.infer<typeof inputSchema>, z.infer<typeof outputSchema>>
}

describe("builtin tool runner", () => {
  it("resolves conditional permissions from validated input", () => {
    const permissions = resolveBuiltinToolPermissions(makeTool(), {
      inputPath: "/tmp/a.docx",
      outputMode: "write-file",
      outputDirectory: "/tmp/out",
    })
    expect(permissions).toEqual([
      { action: "fs.read.outside-userdata", resource: "/tmp/a.docx" },
      { action: "fs.write", resource: "/tmp/out" },
    ])
  })

  it("skips permissions whose condition does not match", () => {
    const permissions = resolveBuiltinToolPermissions(makeTool(), {
      inputPath: "/tmp/a.docx",
      outputMode: "return",
    })
    expect(permissions).toEqual([
      { action: "fs.read.outside-userdata", resource: "/tmp/a.docx" },
    ])
  })

  it("validates input before permission checks", async () => {
    const tool = makeTool()
    const permissionGuard = makePermissionGuard()
    const result = await runBuiltinTool({
      toolId: "docx-to-markdown",
      input: { inputPath: "", outputMode: "return" },
      context: { entryPoint: "tools", actor: { kind: "user" } },
      registry: createBuiltinToolRegistryForTests([tool]),
      permissionGuard,
      auditSink: makeAuditSink(),
      executeInWorker: vi.fn(),
    })
    expect(result.ok).toBe(false)
    expect(result.ok ? "" : result.error.code).toBe("invalid_input")
    expect(permissionGuard.check).not.toHaveBeenCalled()
  })

  it("checks permissions and runs through the worker", async () => {
    const executeInWorker = vi.fn(async () => ({ markdown: "# OK", warnings: [] }))
    const permissionGuard = makePermissionGuard()
    const auditSink = makeAuditSink()
    const result = await runBuiltinTool({
      toolId: "docx-to-markdown",
      input: { inputPath: "/tmp/a.docx", outputMode: "return" },
      context: { entryPoint: "tools", actor: { kind: "user" } },
      registry: createBuiltinToolRegistryForTests([makeTool()]),
      permissionGuard,
      auditSink,
      executeInWorker,
    })
    expect(result).toEqual({
      ok: true,
      toolId: "docx-to-markdown",
      output: { markdown: "# OK", warnings: [] },
      warnings: [],
      metadata: {},
    })
    expect(permissionGuard.check).toHaveBeenCalledWith({
      action: "fs.read.outside-userdata",
      actor: { kind: "user" },
      resource: "/tmp/a.docx",
      context: { source: "tools.builtinTool.run", toolId: "docx-to-markdown", entryPoint: "tools" },
    })
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.read.outside-userdata",
      outcome: "allowed",
    }))
    expect(executeInWorker).toHaveBeenCalledWith({
      toolId: "docx-to-markdown",
      input: { inputPath: "/tmp/a.docx", outputMode: "return" },
    })
  })

  it("returns permission_denied when a guard rejects access", async () => {
    const result = await runBuiltinTool({
      toolId: "docx-to-markdown",
      input: { inputPath: "/tmp/a.docx", outputMode: "return" },
      context: { entryPoint: "tools", actor: { kind: "user" } },
      registry: createBuiltinToolRegistryForTests([makeTool()]),
      permissionGuard: makePermissionGuard({ allowed: false, reason: "denied", policyId: "p1" }),
      auditSink: makeAuditSink(),
      executeInWorker: vi.fn(),
    })
    expect(result.ok).toBe(false)
    expect(result.ok ? "" : result.error).toEqual({ code: "permission_denied", message: "denied" })
  })

  it("normalizes worker errors", async () => {
    const result = await runBuiltinTool({
      toolId: "docx-to-markdown",
      input: { inputPath: "/tmp/a.docx", outputMode: "return" },
      context: { entryPoint: "tools", actor: { kind: "user" } },
      registry: createBuiltinToolRegistryForTests([makeTool()]),
      permissionGuard: makePermissionGuard(),
      auditSink: makeAuditSink(),
      executeInWorker: vi.fn(async () => {
        throw new BuiltinToolError("conversion_failed", "Parse failed.")
      }),
    })
    expect(result.ok).toBe(false)
    expect(result.ok ? "" : result.error).toEqual({ code: "conversion_failed", message: "Parse failed." })
  })
})

function makePermissionGuard(result: PermissionResult = { allowed: true }): PermissionGuard {
  return {
    registerPolicy: vi.fn(),
    check: vi.fn(async () => result),
  }
}

function makeAuditSink(): AuditSink {
  return {
    record: vi.fn(),
    list: vi.fn(() => []),
    clearForTests: vi.fn(),
  }
}


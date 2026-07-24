import { describe, expect, it, vi } from "vitest"
import type { NodeExecutionInput } from "../../../../workflow-nodes/types"
import {
  clipboardTextReadNodeExecutor,
  clipboardTextWriteNodeExecutor,
} from "../executor.main"
import type { ClipboardTextWriteNodeConfig } from "../schema"

function writeInput(
  overrides: Partial<NodeExecutionInput<ClipboardTextWriteNodeConfig>> = {},
): NodeExecutionInput<ClipboardTextWriteNodeConfig> {
  return {
    config: { text: "{{value}}", variables: [] },
    resolvedVariables: { value: "copied" },
    context: {
      workflowId: "workflow-1",
      runId: "run-1",
      nodeId: "write-1",
      abortSignal: new AbortController().signal,
    },
    agentDeps: {} as never,
    runtimeDeps: {
      resolveService: () => ({ write: vi.fn(() => ({ success: true })) }),
    } as never,
    ...overrides,
  }
}

describe("Clipboard Workflow executors", () => {
  it("writes the explicitly interpolated text and returns no content", async () => {
    const write = vi.fn(() => ({ success: true as const }))
    const result = await clipboardTextWriteNodeExecutor.execute(writeInput({
      runtimeDeps: { resolveService: () => ({ write }) } as never,
    }))

    expect(result).toMatchObject({
      status: "success",
      output: "{\"success\":true}",
      outputs: { success: true },
    })
    expect(write).toHaveBeenCalledWith("copied", expect.objectContaining({
      source: "workflow",
      workflowId: "workflow-1",
      runId: "run-1",
      nodeId: "write-1",
    }))
    expect(JSON.stringify(result)).not.toContain("copied")
  })

  it.each([
    ["", "empty"],
    ["a\u0000b", "forbidden_character"],
    ["\ud800", "invalid_unicode"],
  ])("rejects %j before native access", async (value, reason) => {
    const write = vi.fn()
    const result = await clipboardTextWriteNodeExecutor.execute(writeInput({
      resolvedVariables: { value },
      runtimeDeps: { resolveService: () => ({ write }) } as never,
    }))
    expect(result).toMatchObject({
      status: "failed",
      errorCode: "INVALID_INPUT",
      outputs: {
        code: "INVALID_INPUT",
        retryable: false,
        data: { field: "text", reason },
      },
    })
    expect(write).not.toHaveBeenCalled()
  })

  it("sanitizes unbound variables and missing execution identity before access", async () => {
    const write = vi.fn()
    const missingBinding = await clipboardTextWriteNodeExecutor.execute(writeInput({
      resolvedVariables: {},
      runtimeDeps: { resolveService: () => ({ write }) } as never,
    }))
    expect(missingBinding).toMatchObject({
      status: "failed",
      outputs: {
        code: "INVALID_INPUT",
        retryable: false,
      },
    })
    expect(missingBinding.outputs).not.toHaveProperty("data")

    const missingContext = await clipboardTextWriteNodeExecutor.execute(writeInput({
      context: {
        workflowId: " ",
        runId: "run-1",
        nodeId: "write-1",
        abortSignal: new AbortController().signal,
      },
      runtimeDeps: { resolveService: () => ({ write }) } as never,
    }))
    expect(missingContext).toMatchObject({
      status: "failed",
      errorCode: "INTERNAL_ERROR",
    })
    expect(write).not.toHaveBeenCalled()
  })

  it("honors cancellation only before core acceptance", async () => {
    const cancelledController = new AbortController()
    cancelledController.abort()
    const write = vi.fn()
    await expect(clipboardTextWriteNodeExecutor.execute(writeInput({
      context: {
        workflowId: "workflow-1",
        runId: "run-1",
        nodeId: "write-1",
        abortSignal: cancelledController.signal,
      },
      runtimeDeps: { resolveService: () => ({ write }) } as never,
    }))).resolves.toMatchObject({ status: "cancelled", errorCode: "CANCELLED" })
    expect(write).not.toHaveBeenCalled()

    const acceptedController = new AbortController()
    const acceptedWrite = vi.fn(() => {
      acceptedController.abort()
      return { success: true as const }
    })
    await expect(clipboardTextWriteNodeExecutor.execute(writeInput({
      context: {
        workflowId: "workflow-1",
        runId: "run-1",
        nodeId: "write-1",
        abortSignal: acceptedController.signal,
      },
      runtimeDeps: { resolveService: () => ({ write: acceptedWrite }) } as never,
    }))).resolves.toMatchObject({ status: "success" })
  })

  it("returns the complete read text for the active engine data flow", async () => {
    const read = vi.fn(() => ({ text: "clipboard-value" }))
    const result = await clipboardTextReadNodeExecutor.execute({
      config: {},
      resolvedVariables: {},
      context: {
        workflowId: "workflow-1",
        runId: "run-1",
        nodeId: "read-1",
        abortSignal: new AbortController().signal,
      },
      agentDeps: {} as never,
      runtimeDeps: { resolveService: () => ({ read }) } as never,
    })

    expect(result).toMatchObject({
      status: "success",
      output: "clipboard-value",
      outputs: { text: "clipboard-value" },
    })
  })
})

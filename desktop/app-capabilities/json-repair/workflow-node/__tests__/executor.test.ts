import { describe, expect, it, vi } from "vitest"
import type { NodeExecutionInput } from "../../../../workflow-nodes/types"
import type { JsonRepairNodeConfig } from "../schema"
import { jsonRepairNodeExecutor } from "../executor.main"

function executionInput(
  overrides: Partial<NodeExecutionInput<JsonRepairNodeConfig>> = {},
): NodeExecutionInput<JsonRepairNodeConfig> {
  const controller = new AbortController()
  return {
    config: {
      text: "prefix {{value}}",
      variables: [],
    },
    resolvedVariables: { value: "{ok:true}" },
    context: {
      workflowId: "workflow-1",
      runId: "run-1",
      nodeId: "node-1",
      abortSignal: controller.signal,
    },
    agentDeps: {} as never,
    runtimeDeps: {
      resolveService: () => ({
        repair: vi.fn(() => ({ json: "{\"ok\":true}" })),
      }),
    } as never,
    ...overrides,
  }
}

describe("JSON repair workflow executor", () => {
  it("uses safe interpolation and returns JSON text as the primary output", async () => {
    const repair = vi.fn(() => ({ json: "{\"ok\":true}" }))
    const input = executionInput({
      config: { text: "{{value}}", variables: [] },
      runtimeDeps: { resolveService: () => ({ repair }) } as never,
    })

    await expect(jsonRepairNodeExecutor.execute(input)).resolves.toMatchObject({
      status: "success",
      output: "{\"ok\":true}",
      outputs: { json: "{\"ok\":true}" },
    })
    expect(repair).toHaveBeenCalledWith(
      expect.objectContaining({ text: "{ok:true}" }),
      expect.objectContaining({
        source: "workflow",
        workflowId: "workflow-1",
        runId: "run-1",
        nodeId: "node-1",
      }),
    )
  })

  it("returns shared invalid input before entering the core service", async () => {
    const repair = vi.fn()
    const input = executionInput({
      config: { text: "{{value}}", variables: [] },
      resolvedVariables: { value: " " },
      runtimeDeps: { resolveService: () => ({ repair }) } as never,
    })

    await expect(jsonRepairNodeExecutor.execute(input)).resolves.toMatchObject({
      status: "failed",
      output: "",
      error: "JSON 修复输入无效。",
      outputs: {
        code: "INVALID_INPUT",
        message: "JSON 修复输入无效。",
        retryable: false,
        data: { field: "text", reason: "empty" },
      },
    })
    expect(repair).not.toHaveBeenCalled()
  })

  it("treats an unbound variable as a pre-acceptance node failure", async () => {
    const repair = vi.fn()
    const input = executionInput({
      resolvedVariables: {},
      runtimeDeps: { resolveService: () => ({ repair }) } as never,
    })
    const result = await jsonRepairNodeExecutor.execute(input)

    expect(result).toMatchObject({
      status: "failed",
      output: "",
      error: "JSON 修复失败。",
      outputs: {
        code: "INTERNAL_ERROR",
        message: "JSON 修复失败。",
        retryable: false,
      },
    })
    expect(repair).not.toHaveBeenCalled()
  })

  it("checks cancellation before interpolation and again before core acceptance", async () => {
    const before = new AbortController()
    before.abort()
    const repair = vi.fn()
    await expect(jsonRepairNodeExecutor.execute(executionInput({
      context: { runId: "run-1", abortSignal: before.signal },
      runtimeDeps: { resolveService: () => ({ repair }) } as never,
    }))).resolves.toMatchObject({
      status: "cancelled",
      error: "JSON 修复已取消。",
    })

    const after = new AbortController()
    const variables: Record<string, string> = {}
    Object.defineProperty(variables, "value", {
      enumerable: true,
      get: () => {
        after.abort()
        return "{}"
      },
    })
    await expect(jsonRepairNodeExecutor.execute(executionInput({
      config: { text: "{{value}}", variables: [] },
      resolvedVariables: variables,
      context: { runId: "run-2", abortSignal: after.signal },
      runtimeDeps: { resolveService: () => ({ repair }) } as never,
    }))).resolves.toMatchObject({
      status: "cancelled",
      error: "JSON 修复已取消。",
    })
    expect(repair).not.toHaveBeenCalled()
  })

  it("does not revoke a synchronous result after core acceptance", async () => {
    const controller = new AbortController()
    const repair = vi.fn(() => {
      controller.abort()
      return { json: "{}" }
    })
    await expect(jsonRepairNodeExecutor.execute(executionInput({
      context: { runId: "run-1", abortSignal: controller.signal },
      runtimeDeps: { resolveService: () => ({ repair }) } as never,
    }))).resolves.toMatchObject({
      status: "success",
      output: "{}",
    })
  })
})

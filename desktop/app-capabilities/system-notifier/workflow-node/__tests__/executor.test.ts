import { describe, expect, it, vi } from "vitest"
import type { NodeExecutionInput } from "../../../../workflow-nodes/types"
import type { SystemNotifierNodeConfig } from "../schema"

const workflowLogger = vi.hoisted(() => ({
  warn: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}))

vi.mock("../../../../electron/services/log-store", () => ({
  createMainLogger: () => workflowLogger,
}))

import { systemNotifierNodeExecutor } from "../executor.main"

function executionInput(
  overrides: Partial<NodeExecutionInput<SystemNotifierNodeConfig>> = {},
): NodeExecutionInput<SystemNotifierNodeConfig> {
  const abortController = new AbortController()
  return {
    config: {
      title: "完成：{{name}}",
      body: "任务 {{$name}} 已完成",
      variables: [],
    },
    resolvedVariables: { name: "构建" },
    context: {
      workflowId: "workflow-1",
      runId: "run-1",
      nodeId: "node-1",
      abortSignal: abortController.signal,
    },
    agentDeps: {} as never,
    runtimeDeps: {
      resolveService: () => ({
        trigger: vi.fn().mockReturnValue({ success: true }),
      }),
    } as never,
    ...overrides,
  }
}

describe("system notifier workflow executor", () => {
  it("interpolates safely, enters the shared service, and returns the fixed output", async () => {
    const trigger = vi.fn().mockReturnValue({ success: true })
    const input = executionInput({
      runtimeDeps: { resolveService: () => ({ trigger }) } as never,
    })
    await expect(systemNotifierNodeExecutor.execute(input)).resolves.toMatchObject({
      status: "success",
      output: "{\"success\":true}",
      outputs: { success: true },
    })
    expect(trigger).toHaveBeenCalledWith(
      { title: "完成：构建", body: "任务 构建 已完成" },
      expect.objectContaining({
        source: "workflow",
        workflowId: "workflow-1",
        runId: "run-1",
        nodeId: "node-1",
      }),
    )
  })

  it("fails with the shared INVALID_INPUT serialization before acceptance", async () => {
    const trigger = vi.fn()
    const input = executionInput({
      config: { title: " {{name}}", body: "正文", variables: [] },
      runtimeDeps: { resolveService: () => ({ trigger }) } as never,
    })
    await expect(systemNotifierNodeExecutor.execute(input)).resolves.toMatchObject({
      status: "failed",
      outputs: {
        ok: false,
        code: "INVALID_INPUT",
        error: "Invalid system notification input.",
        data: { field: "title", reason: "leading_or_trailing_whitespace" },
      },
    })
    expect(trigger).not.toHaveBeenCalled()
  })

  it("treats unbound interpolation as a normal pre-acceptance failure", async () => {
    const trigger = vi.fn()
    const input = executionInput({
      resolvedVariables: {},
      runtimeDeps: { resolveService: () => ({ trigger }) } as never,
    })
    const result = await systemNotifierNodeExecutor.execute(input)
    expect(result).toMatchObject({ status: "failed" })
    expect(result).not.toHaveProperty("outputs")
    expect(workflowLogger.warn).not.toHaveBeenCalled()
    expect(trigger).not.toHaveBeenCalled()
  })

  it("cancels before acceptance without calling the service", async () => {
    const controller = new AbortController()
    controller.abort()
    const trigger = vi.fn()
    const input = executionInput({
      context: {
        workflowId: "workflow-1",
        runId: "run-1",
        nodeId: "node-1",
        abortSignal: controller.signal,
      },
      runtimeDeps: { resolveService: () => ({ trigger }) } as never,
    })
    await expect(systemNotifierNodeExecutor.execute(input)).resolves.toMatchObject({
      status: "cancelled",
    })
    expect(trigger).not.toHaveBeenCalled()
  })

  it("does not let cancellation after the acceptance point revoke success", async () => {
    const controller = new AbortController()
    const trigger = vi.fn(() => {
      controller.abort()
      return { success: true }
    })
    const input = executionInput({
      context: {
        workflowId: "workflow-1",
        runId: "run-1",
        nodeId: "node-1",
        abortSignal: controller.signal,
      },
      runtimeDeps: { resolveService: () => ({ trigger }) } as never,
    })
    await expect(systemNotifierNodeExecutor.execute(input)).resolves.toMatchObject({
      status: "success",
      outputs: { success: true },
    })
  })
})

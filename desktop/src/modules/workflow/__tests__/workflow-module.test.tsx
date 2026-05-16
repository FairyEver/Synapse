/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { WorkflowModule } from "../index"

const {
  loggerWarn,
  toastError,
  workflowCreate,
  workflowOpenEditor,
} = vi.hoisted(() => ({
  loggerWarn: vi.fn(),
  toastError: vi.fn(),
  workflowCreate: vi.fn(),
  workflowOpenEditor: vi.fn(),
}))

vi.mock("sonner", () => ({
  toast: {
    error: toastError,
  },
}))

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: loggerWarn,
  }),
}))

vi.mock("../components/workflow-list", () => ({
  WorkflowList: () => <div data-testid="workflow-list" />,
}))

vi.mock("../../../workflow-nodes/register.renderer", () => ({}))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let roots: Root[] = []

beforeEach(() => {
  Object.defineProperty(window, "synapse", {
    configurable: true,
    value: {
      workflow: {
        create: workflowCreate,
        openEditor: workflowOpenEditor,
      },
    } as unknown as Window["synapse"],
  })
})

afterEach(() => {
  for (const root of roots) {
    act(() => {
      root.unmount()
    })
  }
  roots = []
  document.body.innerHTML = ""
  vi.clearAllMocks()
})

describe("WorkflowModule", () => {
  it("shows a generic create failure and logs sanitized diagnostics", async () => {
    const rawError = "create failed token=sk-secret /Users/example/repo prompt text"
    workflowCreate.mockRejectedValue(new Error(rawError))
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<WorkflowModule />)
    })

    await act(async () => {
      container.querySelector<HTMLButtonElement>("button")?.click()
      await Promise.resolve()
    })

    expect(toastError).toHaveBeenCalledWith("创建工作流失败，请重试")
    expect(loggerWarn).toHaveBeenCalledWith("Workflow create failed.", {
      boundary: "renderer.workflow.create",
      errorName: "Error",
      errorLength: rawError.length,
      errorMessage: "create failed token=[redacted] [path] prompt text",
    })
    expect(JSON.stringify(toastError.mock.calls)).not.toContain("sk-secret")
    expect(JSON.stringify(loggerWarn.mock.calls)).not.toContain("sk-secret")
    expect(JSON.stringify(loggerWarn.mock.calls)).not.toContain("/Users/example/repo")
  })
})

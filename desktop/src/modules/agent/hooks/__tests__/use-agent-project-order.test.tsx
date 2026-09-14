/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createDefaultConfig } from "@/lib/config"
import { DEFAULT_AGENT_WORKSPACE_PROJECT_ID } from "@/lib/default-agent-workspace"
import type { SynapseConfig, SynapseConfigPatch } from "@/types/config"

const mocks = vi.hoisted(() => ({
  config: null as SynapseConfig | null,
  logger: {
    error: vi.fn(),
  },
  toast: vi.fn(),
  toastError: vi.fn(),
  updateConfig: vi.fn(),
}))

vi.mock("@/app-shell/config", () => ({
  useAppConfig: () => ({
    config: mocks.config,
    updateConfig: mocks.updateConfig,
  }),
}))

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => mocks.logger,
}))

vi.mock("sonner", () => ({
  toast: Object.assign(mocks.toast, { error: mocks.toastError }),
}))

import { useAgentProjectOrder } from "../use-agent-project-order"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const projectOptions = [
  { id: DEFAULT_AGENT_WORKSPACE_PROJECT_ID, name: "本地对话", path: "synapse-agent-workspace://default" },
  { id: "project-a", name: "Project A", path: "/tmp/project-a" },
  { id: "project-b", name: "Project B", path: "/tmp/project-b" },
  { id: "project-c", name: "Project C", path: "/tmp/project-c" },
]

type ProjectOrderState = ReturnType<typeof useAgentProjectOrder<(typeof projectOptions)[number]>>

let roots: Root[] = []
let projectOrderState: ProjectOrderState | null = null

function TestAgentProjectOrder() {
  projectOrderState = useAgentProjectOrder(projectOptions)
  return (
    <div data-project-ids={projectOrderState.projects.map((project) => project.id).join(",")} />
  )
}

async function renderHookHarness() {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(<TestAgentProjectOrder />)
  })

  return container
}

function setConfigAgentProjectOrder(agentProjectOrder: string[]) {
  const defaultConfig = createDefaultConfig()
  mocks.config = {
    ...defaultConfig,
    global: {
      ...defaultConfig.global,
      agentProjectOrder,
    },
  }
}

function applyMergedConfigPatch(patch: SynapseConfigPatch): SynapseConfig {
  const currentConfig = mocks.config ?? createDefaultConfig()
  mocks.config = {
    ...currentConfig,
    global: {
      ...currentConfig.global,
      ...patch.global,
    },
  }
  return mocks.config
}

afterEach(() => {
  for (const root of roots) {
    act(() => root.unmount())
  }
  roots = []
  projectOrderState = null
  document.body.innerHTML = ""
  vi.clearAllMocks()
  setConfigAgentProjectOrder([])
})

setConfigAgentProjectOrder([])

describe("useAgentProjectOrder", () => {
  it("keeps the local conversation workspace first and persists dragged ids", async () => {
    const pendingUpdate: { resolve: ((config: SynapseConfig) => void) | null } = { resolve: null }
    mocks.updateConfig.mockImplementation((patch: SynapseConfigPatch) => {
      applyMergedConfigPatch(patch)
      return new Promise<SynapseConfig>((resolve) => {
        pendingUpdate.resolve = resolve
      })
    })
    const container = await renderHookHarness()

    let reorderPromise: Promise<boolean> | undefined
    await act(async () => {
      reorderPromise = projectOrderState?.reorderProjects(["project-c", "project-a", "project-b"])
      await Promise.resolve()
    })

    expect(mocks.updateConfig).toHaveBeenCalledWith({
      global: { agentProjectOrder: ["project-c", "project-a", "project-b"] },
    } satisfies SynapseConfigPatch)
    expect(container.querySelector("div")?.dataset.projectIds)
      .toBe(`${DEFAULT_AGENT_WORKSPACE_PROJECT_ID},project-c,project-a,project-b`)
    expect(projectOrderState?.saving).toBe(true)

    pendingUpdate.resolve?.(mocks.config ?? createDefaultConfig())
    await act(async () => {
      await reorderPromise
    })

    expect(mocks.toast).toHaveBeenCalledWith("项目顺序已保存")
    expect(projectOrderState?.saving).toBe(false)
  })

  it("drops unknown ids when persisting a new order", async () => {
    mocks.updateConfig.mockImplementation(async (patch: SynapseConfigPatch) => applyMergedConfigPatch(patch))
    await renderHookHarness()

    await act(async () => {
      await projectOrderState?.reorderProjects(["project-c", "project-missing"])
    })

    expect(mocks.updateConfig).toHaveBeenCalledWith({
      global: { agentProjectOrder: ["project-c"] },
    } satisfies SynapseConfigPatch)
  })

  it("does not persist an unchanged order", async () => {
    mocks.updateConfig.mockImplementation(async (patch: SynapseConfigPatch) => applyMergedConfigPatch(patch))
    await renderHookHarness()

    await act(async () => {
      await projectOrderState?.reorderProjects(["project-a", "project-b", "project-c"])
    })

    expect(mocks.updateConfig).not.toHaveBeenCalled()
  })

  it("moves a single project with bounds protection", async () => {
    mocks.updateConfig.mockImplementation(async (patch: SynapseConfigPatch) => applyMergedConfigPatch(patch))
    await renderHookHarness()

    expect(projectOrderState?.canMoveProject("project-a", "up")).toBe(false)
    expect(projectOrderState?.canMoveProject("project-c", "down")).toBe(false)
    expect(projectOrderState?.canMoveProject("project-b", "up")).toBe(true)

    let movedAtBoundary: boolean | undefined
    await act(async () => {
      movedAtBoundary = await projectOrderState?.moveProject("project-a", "up")
    })
    expect(movedAtBoundary).toBe(false)
    expect(mocks.updateConfig).not.toHaveBeenCalled()

    await act(async () => {
      await projectOrderState?.moveProject("project-a", "down")
    })
    expect(mocks.updateConfig).toHaveBeenCalledWith({
      global: { agentProjectOrder: ["project-b", "project-a", "project-c"] },
    } satisfies SynapseConfigPatch)
  })

  it("rolls back the optimistic order when saving fails", async () => {
    const pendingUpdate: { reject: ((error: Error) => void) | null } = { reject: null }
    mocks.updateConfig.mockImplementation(() => new Promise<SynapseConfig>((_, reject) => {
      pendingUpdate.reject = reject
    }))
    const container = await renderHookHarness()

    let reorderPromise: Promise<boolean> | undefined
    await act(async () => {
      reorderPromise = projectOrderState?.reorderProjects(["project-c", "project-a", "project-b"])
      await Promise.resolve()
    })

    expect(mocks.updateConfig).toHaveBeenCalledWith({
      global: { agentProjectOrder: ["project-c", "project-a", "project-b"] },
    } satisfies SynapseConfigPatch)
    expect(container.querySelector("div")?.dataset.projectIds)
      .toBe(`${DEFAULT_AGENT_WORKSPACE_PROJECT_ID},project-c,project-a,project-b`)

    await act(async () => {
      pendingUpdate.reject?.(new Error("config write failed"))
      await reorderPromise
    })

    expect(mocks.toastError).toHaveBeenCalledWith("保存项目顺序失败")
    expect(mocks.logger.error).toHaveBeenCalledWith(
      "Failed to save agent project order.",
      expect.any(Error),
    )
    expect(container.querySelector("div")?.dataset.projectIds)
      .toBe(`${DEFAULT_AGENT_WORKSPACE_PROJECT_ID},project-a,project-b,project-c`)
  })
})

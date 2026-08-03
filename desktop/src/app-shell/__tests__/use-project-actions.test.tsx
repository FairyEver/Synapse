/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createDefaultConfig } from "@/lib/config"
import type { SynapseConfig } from "@/types/config"

const appConfig = vi.hoisted(() => ({
  config: null as unknown as SynapseConfig,
  refreshConfig: vi.fn(),
  updateConfig: vi.fn(),
}))

vi.mock("@/app-shell/config", () => ({
  useAppConfig: () => appConfig,
}))

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => ({ info: vi.fn() }),
}))

import { useProjectActions } from "../use-project-actions"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type ProjectActions = ReturnType<typeof useProjectActions>

let currentActions: ProjectActions | null = null
let root: Root | null = null

beforeEach(async () => {
  vi.clearAllMocks()
  appConfig.config = createDefaultConfig()
  appConfig.refreshConfig.mockResolvedValue(appConfig.config)
  appConfig.updateConfig.mockResolvedValue(appConfig.config)
  vi.stubGlobal("crypto", {
    ...globalThis.crypto,
    randomUUID: vi.fn(() => "project-new"),
  })
  Object.defineProperty(window, "synapse", {
    configurable: true,
    value: { platform: "darwin" },
  })

  const container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(<ProjectActionsProbe />)
    await Promise.resolve()
  })
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  currentActions = null
  document.body.innerHTML = ""
  vi.unstubAllGlobals()
})

describe("useProjectActions", () => {
  it("refreshes the config and appends a trimmed project", async () => {
    const existingProject = { id: "project-existing", name: "Existing", path: "/work/existing" }
    const latestConfig = {
      ...createDefaultConfig(),
      global: {
        ...createDefaultConfig().global,
        projects: [existingProject],
      },
    }
    appConfig.refreshConfig.mockResolvedValue(latestConfig)

    let result: Awaited<ReturnType<ProjectActions["addProject"]>> | undefined
    await act(async () => {
      result = await currentActions?.addProject({ name: " Docs ", path: " /work/docs/ " })
    })

    expect(result).toEqual({
      status: "added",
      project: { id: "project-new", name: "Docs", path: "/work/docs/" },
    })
    expect(appConfig.updateConfig).toHaveBeenCalledWith({
      global: {
        projects: [
          existingProject,
          { id: "project-new", name: "Docs", path: "/work/docs/" },
        ],
      },
    })
  })

  it("returns the existing project without writing a duplicate path", async () => {
    const existingProject = { id: "project-existing", name: "Docs", path: "/work/docs" }
    appConfig.refreshConfig.mockResolvedValue({
      ...createDefaultConfig(),
      global: {
        ...createDefaultConfig().global,
        projects: [existingProject],
      },
    })

    let result: Awaited<ReturnType<ProjectActions["addProject"]>> | undefined
    await act(async () => {
      result = await currentActions?.addProject({ name: "Docs", path: "/work/docs/" })
    })

    expect(result).toEqual({ status: "existing", project: existingProject })
    expect(appConfig.updateConfig).not.toHaveBeenCalled()
  })

  it("compares configured project paths using the renderer platform", async () => {
    Object.defineProperty(window, "synapse", {
      configurable: true,
      value: { platform: "win32" },
    })
    appConfig.config = {
      ...createDefaultConfig(),
      global: {
        ...createDefaultConfig().global,
        projects: [{ id: "project-existing", name: "Docs", path: "C:\\Work\\Docs" }],
      },
    }

    await act(async () => {
      root?.render(<ProjectActionsProbe />)
      await Promise.resolve()
    })

    expect(currentActions?.isProjectPathConfigured("c:/work/docs/")).toBe(true)
  })
})

function ProjectActionsProbe() {
  currentActions = useProjectActions()
  return null
}

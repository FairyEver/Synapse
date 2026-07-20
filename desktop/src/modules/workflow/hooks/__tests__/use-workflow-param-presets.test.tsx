/**
 * @vitest-environment jsdom
 */
import { useEffect, type ReactNode } from "react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { WorkflowParamPreset } from "@/types/workflow"
import { useWorkflowParamPresets } from "../use-workflow-param-presets"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const roots: Root[] = []

afterEach(() => {
  for (const root of roots) {
    act(() => {
      root.unmount()
    })
  }
  roots.length = 0
  document.body.innerHTML = ""
  delete (window as unknown as { synapse?: unknown }).synapse
  vi.clearAllMocks()
})

describe("useWorkflowParamPresets", () => {
  it("does not let an older list response overwrite completed mutations", async () => {
    let resolveList: ((items: WorkflowParamPreset[]) => void) | undefined
    const list = vi.fn(() => new Promise<WorkflowParamPreset[]>((resolve) => {
      resolveList = resolve
    }))
    const saved = createPreset("saved")
    const save = vi.fn(async () => saved)
    const deletePreset = vi.fn(async () => undefined)
    installBridge({ deletePreset, list, save })
    let hook: ReturnType<typeof useWorkflowParamPresets> | undefined
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<HookProbe onChange={(next) => { hook = next }} />)
    })
    await act(async () => {
      await hook?.savePreset({ workflowId: "workflow-1", name: saved.name, values: {} })
      await hook?.deletePreset("deleted")
    })
    await act(async () => {
      resolveList?.([createPreset("existing"), createPreset("deleted")])
      await Promise.resolve()
    })

    expect(hook?.presets.map((preset) => preset.id)).toEqual(["existing", "saved"])
  })

  it("does not replay settled request mutations during a later load", async () => {
    const listResolvers: Array<(items: WorkflowParamPreset[]) => void> = []
    const list = vi.fn(() => new Promise<WorkflowParamPreset[]>((resolve) => {
      listResolvers.push(resolve)
    }))
    const saved = createPreset("saved")
    installBridge({
      deletePreset: vi.fn(async () => undefined),
      list,
      save: vi.fn(async () => saved),
    })
    let hook: ReturnType<typeof useWorkflowParamPresets> | undefined
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<HookProbe onChange={(next) => { hook = next }} />)
    })
    await act(async () => {
      await hook?.savePreset({ workflowId: "workflow-1", name: saved.name, values: {} })
      listResolvers[0]?.([createPreset("existing")])
      await Promise.resolve()
    })
    await act(async () => {
      root.render(<HookProbe enabled={false} onChange={(next) => { hook = next }} />)
    })
    await act(async () => {
      root.render(<HookProbe onChange={(next) => { hook = next }} />)
    })
    await act(async () => {
      listResolvers[1]?.([createPreset("existing")])
      await Promise.resolve()
    })

    expect(hook?.presets.map((preset) => preset.id)).toEqual(["existing"])
  })

  it("does not let an older list failure clear a completed mutation", async () => {
    let rejectList: ((reason: Error) => void) | undefined
    const list = vi.fn(() => new Promise<WorkflowParamPreset[]>((_resolve, reject) => {
      rejectList = reject
    }))
    const saved = createPreset("saved")
    const save = vi.fn(async () => saved)
    installBridge({ deletePreset: vi.fn(async () => undefined), list, save })
    let hook: ReturnType<typeof useWorkflowParamPresets> | undefined
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<HookProbe onChange={(next) => { hook = next }} />)
    })
    await act(async () => {
      await hook?.savePreset({ workflowId: "workflow-1", name: saved.name, values: {} })
    })
    await act(async () => {
      rejectList?.(new Error("stale list failed"))
      await Promise.resolve()
    })

    expect(hook?.presets).toEqual([saved])
    expect(hook?.loadError).toBe("读取预设失败")
  })

  it("does not retain presets from the previous workflow when the next list fails", async () => {
    let rejectWorkflowB: ((reason: Error) => void) | undefined
    const list = vi.fn((workflowId: string) => workflowId === "workflow-a"
      ? Promise.resolve([createPreset("preset-a", workflowId)])
      : new Promise<WorkflowParamPreset[]>((_resolve, reject) => {
          rejectWorkflowB = reject
        }))
    const saved = createPreset("preset-b", "workflow-b")
    installBridge({
      deletePreset: vi.fn(async () => undefined),
      list,
      save: vi.fn(async () => saved),
    })
    let hook: ReturnType<typeof useWorkflowParamPresets> | undefined
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<HookProbe workflowId="workflow-a" onChange={(next) => { hook = next }} />)
      await Promise.resolve()
    })
    expect(hook?.presets.map((preset) => preset.id)).toEqual(["preset-a"])

    await act(async () => {
      root.render(<HookProbe workflowId="workflow-b" onChange={(next) => { hook = next }} />)
    })
    await act(async () => {
      await hook?.savePreset({ workflowId: "workflow-b", name: saved.name, values: {} })
    })
    await act(async () => {
      rejectWorkflowB?.(new Error("workflow-b list failed"))
      await Promise.resolve()
    })

    expect(hook?.presets.map((preset) => preset.id)).toEqual(["preset-b"])
  })
})

function HookProbe({
  enabled = true,
  onChange,
  workflowId = "workflow-1",
}: {
  readonly enabled?: boolean
  readonly onChange: (hook: ReturnType<typeof useWorkflowParamPresets>) => void
  readonly workflowId?: string
}): ReactNode {
  const hook = useWorkflowParamPresets({ enabled, workflowId })
  useEffect(() => {
    onChange(hook)
  }, [hook, onChange])
  return null
}

function createPreset(id: string, workflowId = "workflow-1"): WorkflowParamPreset {
  return {
    id,
    workflowId,
    name: id,
    values: {},
    resourceEntryTypes: {},
    createdAt: 1,
    updatedAt: 1,
  }
}

function installBridge({
  deletePreset,
  list,
  save,
}: {
  deletePreset: (id: string) => Promise<void>
  list: (workflowId: string) => Promise<WorkflowParamPreset[]>
  save: (input: unknown) => Promise<WorkflowParamPreset>
}): void {
  ;(window as unknown as { synapse: unknown }).synapse = {
    workflowParamPresets: {
      delete: deletePreset,
      list,
      resolveResourceEntryTypes: vi.fn(async () => ({})),
      save,
    },
  }
}

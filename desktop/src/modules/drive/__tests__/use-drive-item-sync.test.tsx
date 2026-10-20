/** @vitest-environment jsdom */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { DriveItemDto, DriveSyncBindingDto, DriveSyncSnapshotDto } from "@synapse/shared"
import type { DriveSyncController } from "../sync"
import { useDriveItemSync } from "../use-drive-item-sync"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const item = (id: string, parentId: string | null) => ({ id, parentId, name: id, type: "folder" }) as DriveItemDto
const binding = (id: string) => ({ id, driveItemId: id, status: "active", kind: "folder" }) as DriveSyncBindingDto
const roots: Root[] = []

afterEach(async () => {
  await act(async () => { for (const root of roots.splice(0)) root.unmount() })
  document.body.replaceChildren()
})

describe("Drive sync ancestry requests", () => {
  it("uses each search result's ancestry instead of the browsed folder for sync inheritance", async () => {
    const synced = { ...binding("browsed"), localPath: "/tmp/Docs", excludeRules: { forced: [], defaults: [], importedGitignore: [], user: [] } }
    const container = document.createElement("div")
    document.body.append(container)
    const root = createRoot(container); roots.push(root)
    const controller = { snapshot: { bindings: [synced] }, getRemote: vi.fn(), error: null, loading: false } as unknown as DriveSyncController
    const file = { ...item("parent", "elsewhere"), type: "file" as const }
    await act(async () => { root.render(<Probe items={[file]} path={[{ id: "browsed", name: "当前目录" }]} pathsByItem={new Map([[file.id, [{ id: "elsewhere", name: "其他目录" }]]])} controller={controller} />) })
    expect(container.textContent).toBe("")
    await act(async () => { root.render(<Probe items={[file]} path={[]} pathsByItem={new Map([[file.id, [{ id: "browsed", name: "真实同步目录" }]]])} controller={controller} />) })
    expect(container.textContent).toBe("bound")
  })

  it("keeps contained bindings for every matching ancestor when the bound child is also a search result", async () => {
    const parent = item("parent", null), middle = item("middle", "parent"), child = item("bound-child", "middle")
    const bound = { ...binding(child.id), localPath: "/tmp/Child", excludeRules: { forced: [], defaults: [], importedGitignore: [], user: [] } }
    const getRemote = vi.fn(async (id: string) => [parent, middle, child].find(node => node.id === id)!)
    const controller = { snapshot: { bindings: [bound] }, getRemote, error: null, loading: false } as unknown as DriveSyncController
    const container = document.createElement("div"); document.body.append(container)
    const root = createRoot(container); roots.push(root)
    await act(async () => { root.render(<Probe items={[parent, middle, child]} path={[]} pathsByItem={new Map([[parent.id, []], [middle.id, [parent]], [child.id, [parent, middle]]])} controller={controller} />) })
    expect(container.textContent).toBe("contains")
    expect(container.querySelector("span")?.getAttribute("data-bindings")).toBe(child.id)
  })

  it("keeps ancestry results when progress snapshots reorder the same bindings", async () => {
    const items = [item("parent", null)]
    const path = [{ id: null, name: "根目录" }]
    const getRemote = vi.fn(async (id: string) => item(id, "parent"))
    const container = document.createElement("div")
    document.body.append(container)
    const root = createRoot(container)
    roots.push(root)
    const render = async (bindings: DriveSyncBindingDto[], currentItems = items, currentPath = path) => {
      const snapshot: DriveSyncSnapshotDto = {
        bindings, conflicts: [], operations: [],
        health: { status: "idle", connectivity: "online", readOnly: false, lastError: null, updatedAt: "2026-10-16T00:00:00Z" },
        summary: { activeBindingCount: bindings.length, runningOperationCount: 0, retryWaitingOperationCount: 0, conflictCount: 0, errorCount: 0 },
      }
      const controller: Partial<DriveSyncController> = { snapshot, getRemote, error: null, loading: false }
      await act(async () => { root.render(<Probe items={currentItems} path={currentPath} controller={controller as DriveSyncController} />) })
    }

    await render([binding("a"), binding("b")])
    expect(container.textContent).toBe("contains")
    expect(getRemote).toHaveBeenCalledTimes(2)
    for (let index = 0; index < 16; index += 1) {
      await render(index % 2 ? [binding("a"), binding("b")] : [binding("b"), binding("a")])
    }
    expect(container.textContent).toBe("contains")
    expect(getRemote).toHaveBeenCalledTimes(2)

    await render([binding("a"), binding("b")], [...items], [...path])
    expect(getRemote).toHaveBeenCalledTimes(2)
    await render([binding("a"), binding("b"), binding("c")])
    expect(getRemote).toHaveBeenCalledTimes(5)
    getRemote.mockImplementation(async (id) => item(id, id === "a" ? null : "parent"))
    await render([{ ...binding("a"), drivePathHint: "/Moved/a" }, binding("b"), binding("c")])
    expect(container.querySelector("span")?.getAttribute("data-bindings")).toBe("b,c")
    expect(getRemote).toHaveBeenCalledTimes(8)
  })
})

function Probe({ items, path, controller, pathsByItem }: {
  items: readonly DriveItemDto[]
  path: readonly { id: string | null; name: string }[]
  controller: DriveSyncController
  pathsByItem?: ReadonlyMap<string, readonly { id: string | null; name: string }[]>
}) {
  const { relations } = useDriveItemSync(items, path, controller, pathsByItem)
  const relation = relations.get("parent")
  return <span data-bindings={relation?.kind === "contains" ? relation.bindings.map(({ id }) => id).sort().join(",") : ""}>{relation?.kind}</span>
}

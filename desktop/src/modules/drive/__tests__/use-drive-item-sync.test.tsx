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

function Probe({ items, path, controller }: {
  items: readonly DriveItemDto[]
  path: readonly { id: string | null; name: string }[]
  controller: DriveSyncController
}) {
  const { relations } = useDriveItemSync(items, path, controller)
  const relation = relations.get("parent")
  return <span data-bindings={relation?.kind === "contains" ? relation.bindings.map(({ id }) => id).sort().join(",") : ""}>{relation?.kind}</span>
}

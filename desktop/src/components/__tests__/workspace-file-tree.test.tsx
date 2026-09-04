/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type {
  WorkspaceFileTreeChangedEvent,
  WorkspaceFileTreeDataSource,
  WorkspaceFileTreeEntry,
} from "@/types/workspace-file-tree"
import { WORKSPACE_FILE_TREE_DRAG_TYPE } from "@/lib/workspace-file-tree-drag"
import { WorkspaceFileTree } from "../workspace-file-tree"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let roots: Root[] = []

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    bottom: 320,
    height: 320,
    left: 0,
    right: 280,
    top: 0,
    width: 280,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  })
})

afterEach(() => {
  for (const root of roots) act(() => root.unmount())
  roots = []
  document.body.innerHTML = ""
  vi.restoreAllMocks()
})

describe("WorkspaceFileTree", () => {
  it("loads child directories lazily and refreshes loaded directories after changes", async () => {
    let changed: ((event: WorkspaceFileTreeChangedEvent) => void) | undefined
    const list = vi.fn(async ({ relativePath }: { readonly relativePath: string }) => ({
      scopeId: "scope-1",
      relativePath,
      revision: 0,
      entries: relativePath === "src"
        ? [entry("src/index.ts", "index.ts", "file")]
        : [entry("src", "src", "directory"), entry("README.md", "README.md", "file")],
    }))
    const dataSource = createDataSource(list, (listener) => {
      changed = listener
      return () => { changed = undefined }
    })

    renderTree(dataSource)
    await flush()

    expect(list).toHaveBeenCalledTimes(1)
    expect(document.body.textContent).toContain("README.md")

    const directoryRow = document.querySelector<HTMLElement>('[role="treeitem"][aria-expanded="false"]')
    await act(async () => document.querySelector<HTMLElement>('[title="src"]')?.click())
    await flush()

    expect(directoryRow?.getAttribute("aria-expanded")).toBe("true")
    expect(list).toHaveBeenLastCalledWith({ scopeId: "scope-1", relativePath: "src" })
    expect(document.body.textContent).toContain("index.ts")

    await act(async () => changed?.({ scopeId: "scope-1", relativePath: "src", revision: 1 }))
    await flush()

    expect(list).toHaveBeenCalledTimes(3)
  })

  it("keeps a very large directory virtualized", async () => {
    const entries = Array.from({ length: 10_000 }, (_, index) =>
      entry(`file-${index}.txt`, `file-${index}.txt`, "file"))
    const dataSource = createDataSource(async ({ relativePath }) => ({
      scopeId: "scope-1",
      relativePath,
      revision: 0,
      entries,
    }))

    renderTree(dataSource)
    await flush()

    const renderedRows = document.querySelectorAll('[role="treeitem"]')
    expect(renderedRows.length).toBeGreaterThan(0)
    expect(renderedRows.length).toBeLessThan(100)
    expect(document.body.textContent).toContain("file-0.txt")
    expect(document.body.textContent).not.toContain("file-9999.txt")
    const viewport = document.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]')
    expect(document.querySelector('[data-slot="scroll-area"]')).not.toBeNull()
    expect(viewport?.outerHTML)
      .toContain("data-radix-scroll-area-viewport")

    act(() => {
      if (!viewport) return
      Object.defineProperties(viewport, {
        clientHeight: { configurable: true, value: 320 },
        scrollHeight: { configurable: true, value: 280_000 },
      })
      viewport.scrollTop = 9_999 * 28
      viewport.dispatchEvent(new Event("scroll", { bubbles: true }))
    })

    expect(document.body.textContent).toContain("file-9999.txt")
    expect(document.body.textContent).not.toContain("file-0.txt")
  })

  it("clips long labels without horizontal scrolling", async () => {
    const longName = "a-very-long-file-name-that-must-stay-inside-the-file-tree.ts"
    const dataSource = createDataSource(async ({ relativePath }) => ({
      scopeId: "scope-1",
      relativePath,
      revision: 0,
      entries: [entry(longName, longName, "file")],
    }))

    renderTree(dataSource)
    await flush()

    const row = document.querySelector<HTMLElement>('[role="treeitem"]')
    const node = document.querySelector<HTMLElement>(`[title="${longName}"]`)
    const label = node?.querySelector<HTMLElement>("span:last-child")
    expect(row?.className).toContain("overflow-hidden")
    expect(row?.style.height).toBe("28px")
    expect(row?.closest('[class*="overflow-x-hidden"]')).not.toBeNull()
    expect(node?.className).toContain("text-sm")
    expect(node?.className).toContain("cursor-pointer")
    expect(node?.className).toContain("overflow-hidden")
    expect(node?.className).toContain("py-1")
    expect(label?.className).toContain("truncate")
  })

  it("matches Explorer multi-selection shortcuts", async () => {
    const dataSource = createDataSource(async ({ relativePath }) => ({
      scopeId: "scope-1",
      relativePath,
      revision: 0,
      entries: [
        entry("first.ts", "first.ts", "file"),
        entry("second.ts", "second.ts", "file"),
        entry("third.ts", "third.ts", "file"),
      ],
    }))

    renderTree(dataSource)
    await flush()

    clickNode("first.ts")
    clickNode("second.ts", { metaKey: true })
    expect(selectedNodeNames()).toEqual(["first.ts", "second.ts"])

    clickNode("third.ts")
    clickNode("first.ts", { shiftKey: true })
    expect(selectedNodeNames()).toEqual(["first.ts", "second.ts", "third.ts"])
  })

  it("drags the current selection as one workspace path payload", async () => {
    const dataSource = createDataSource(async ({ relativePath }) => ({
      scopeId: "scope-1",
      relativePath,
      revision: 0,
      entries: [
        entry("first.ts", "first.ts", "file"),
        entry("second.ts", "second.ts", "file"),
      ],
    }))

    renderTree(dataSource)
    await flush()
    clickNode("first.ts")
    clickNode("second.ts", { ctrlKey: true })

    const values = new Map<string, string>()
    const event = new Event("dragstart", { bubbles: true, cancelable: true })
    Object.defineProperty(event, "dataTransfer", {
      value: {
        effectAllowed: "none",
        setData: (type: string, value: string) => values.set(type, value),
      },
    })
    act(() => document.querySelector<HTMLElement>('[title="second.ts"]')?.dispatchEvent(event))

    expect(values.get(WORKSPACE_FILE_TREE_DRAG_TYPE)).toBe(JSON.stringify({
      scopeId: "scope-1",
      relativePaths: ["first.ts", "second.ts"],
    }))
  })
})

function entry(
  relativePath: string,
  name: string,
  kind: WorkspaceFileTreeEntry["kind"],
): WorkspaceFileTreeEntry {
  return { relativePath, name, kind }
}

function createDataSource(
  list: WorkspaceFileTreeDataSource["list"],
  onChanged: WorkspaceFileTreeDataSource["onChanged"] = () => () => undefined,
): WorkspaceFileTreeDataSource {
  return {
    open: async () => ({ scopeId: "scope-1", rootName: "project", revision: 0 }),
    list,
    close: vi.fn(async () => undefined),
    onChanged,
  }
}

function renderTree(dataSource: WorkspaceFileTreeDataSource): void {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  act(() => {
    root.render(<WorkspaceFileTree dataSource={dataSource} onClose={() => undefined} />)
  })
}

function clickNode(name: string, options: MouseEventInit = {}): void {
  act(() => document.querySelector<HTMLElement>(`[title="${name}"]`)?.dispatchEvent(new MouseEvent("click", {
    bubbles: true,
    ...options,
  })))
}

function selectedNodeNames(): string[] {
  return [...document.querySelectorAll<HTMLElement>('[role="treeitem"][aria-selected="true"]')]
    .map((row) => row.querySelector<HTMLElement>("[title]")?.title ?? "")
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

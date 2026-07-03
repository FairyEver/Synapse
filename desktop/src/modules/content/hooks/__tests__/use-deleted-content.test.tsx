/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { SynapseContentMeta } from "@/types/content"

const mocks = vi.hoisted(() => ({
  listDeletedContent: vi.fn(),
  logger: {
    error: vi.fn(),
    info: vi.fn(),
  },
  repositoryManager: {
    subscribeToContentChanges: vi.fn(),
  },
}))

vi.mock("@/app-shell/content", () => ({
  listDeletedContent: mocks.listDeletedContent,
}))

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => mocks.logger,
}))

vi.mock("@/app-shell/repository", () => ({
  useRepositoryManager: () => mocks.repositoryManager,
}))

import { useDeletedContent } from "../use-deleted-content"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let roots: Root[] = []

function createDeletedSkill(id: string): SynapseContentMeta<"skill"> {
  return {
    id,
    type: "skill",
    title: id,
    name: id,
    description: id,
    category: "development",
    icon: "Wrench",
    iconBg: "bg-muted",
    createdBy: "user",
    createdByDisplayName: "User",
    createdAt: "2026-04-27T00:00:00.000Z",
    modifiedBy: "user",
    modifiedByDisplayName: "User",
    modifiedAt: "2026-04-27T00:00:00.000Z",
    deleted: true,
    latestHistoryDirname: "20260427000000",
    attachmentCount: 0,
    source: "repository",
    isReadonly: false,
  }
}

function TestDeletedContent() {
  const deletedContent = useDeletedContent("skill")

  return <div data-count={deletedContent.count} />
}

async function renderHookHarness() {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(<TestDeletedContent />)
  })

  return container
}

afterEach(() => {
  for (const root of roots) {
    act(() => root.unmount())
  }
  roots = []
  document.body.innerHTML = ""
  vi.clearAllMocks()
})

describe("useDeletedContent", () => {
  it("refreshes deleted content after content changes are published", async () => {
    let subscriber: (() => void) | null = null
    const unsubscribe = vi.fn()
    mocks.repositoryManager.subscribeToContentChanges.mockImplementation((_contentType, callback) => {
      subscriber = callback
      return unsubscribe
    })
    mocks.listDeletedContent
      .mockResolvedValueOnce([createDeletedSkill("skill-1"), createDeletedSkill("skill-2")])
      .mockResolvedValueOnce([createDeletedSkill("skill-2")])

    const container = await renderHookHarness()

    await vi.waitFor(() => {
      expect(container.querySelector("div")?.dataset.count).toBe("2")
    })
    expect(mocks.repositoryManager.subscribeToContentChanges).toHaveBeenCalledWith("skill", expect.any(Function))

    await act(async () => {
      subscriber?.()
    })

    await vi.waitFor(() => {
      expect(container.querySelector("div")?.dataset.count).toBe("1")
    })
    expect(mocks.listDeletedContent).toHaveBeenCalledTimes(2)

    act(() => roots.pop()?.unmount())
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })
})

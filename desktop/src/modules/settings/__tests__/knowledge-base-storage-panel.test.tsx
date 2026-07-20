/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { KnowledgeBaseStoragePanel } from "../components/knowledge-base-storage-panel"
import type { SynapseKnowledgeBaseStorageStatus } from "@/types/knowledge-base"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const roots: Root[] = []
const bridge = {
  settings: {
    repository: {
      chooseDirectory: vi.fn(),
    },
  },
  knowledgeBase: {
    getStorageStatus: vi.fn(),
    recheckStorage: vi.fn(),
    startStorageMigration: vi.fn(),
  },
}

beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(window, "synapse", {
    configurable: true,
    value: bridge,
  })
})

afterEach(() => {
  for (const root of roots) {
    act(() => {
      root.unmount()
    })
  }
  roots.length = 0
  document.body.innerHTML = ""
  vi.unstubAllGlobals()
})

describe("KnowledgeBaseStoragePanel", () => {
  it("shows a loading state before storage status is ready", async () => {
    bridge.knowledgeBase.getStorageStatus.mockReturnValue(new Promise(() => undefined))

    await renderPanel()

    expect(document.querySelector('[role="status"]')?.getAttribute("aria-label")).toBe("正在读取知识库存储")
  })

  it("shows a readable error when storage status fails to load", async () => {
    bridge.knowledgeBase.getStorageStatus.mockRejectedValue(new Error("load failed"))

    await renderPanel()
    await waitForExpectation(() => {
      expect(document.querySelector('[role="alert"]')?.textContent).toBe("load failed")
    })
  })

  it("shows recheck only when custom storage is unavailable", async () => {
    bridge.knowledgeBase.getStorageStatus.mockResolvedValue({
      mode: "custom",
      rootPath: "/Volumes/Data/SynapseData",
      knowledgeBasesPath: "/Volumes/Data/SynapseData/knowledge-bases",
      available: false,
      unavailableReason: "not-found",
    } satisfies SynapseKnowledgeBaseStorageStatus)

    await renderPanel()

    expect(buttonByText("重新检测").disabled).toBe(false)
    expect(findButton("更改位置")).toBeNull()
    expect(findButton("恢复默认")).toBeNull()
  })
})

async function renderPanel() {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => {
    root.render(<KnowledgeBaseStoragePanel />)
  })
}

function findButton(text: string): HTMLButtonElement | null {
  return [...document.querySelectorAll<HTMLButtonElement>("button")]
    .find((item) => item.textContent === text) ?? null
}

function buttonByText(text: string): HTMLButtonElement {
  const button = findButton(text)
  if (!button) throw new Error(`Button not found: ${text}`)
  return button
}

async function waitForExpectation(assertion: () => void): Promise<void> {
  let lastError: unknown
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      assertion()
      return
    } catch (error) {
      lastError = error
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10))
      })
    }
  }
  throw lastError
}

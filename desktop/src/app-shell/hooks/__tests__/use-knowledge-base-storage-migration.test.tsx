/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useKnowledgeBaseStorageMigration } from "../use-knowledge-base-storage-migration"
import type { SynapseKnowledgeBaseStorageMigrationProgress } from "@/types/knowledge-base"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const idleProgress: SynapseKnowledgeBaseStorageMigrationProgress = {
  active: false,
  phase: "idle",
  cancellable: false,
  copiedBytes: 0,
  totalBytes: null,
  message: "",
}

const copyingProgress: SynapseKnowledgeBaseStorageMigrationProgress = {
  active: true,
  phase: "copying",
  cancellable: true,
  copiedBytes: 12,
  totalBytes: 24,
  message: "正在复制知识库",
}

const verifyingProgress: SynapseKnowledgeBaseStorageMigrationProgress = {
  active: true,
  phase: "verifying",
  cancellable: true,
  copiedBytes: 24,
  totalBytes: 24,
  message: "正在校验知识库",
}

let roots: Root[] = []

afterEach(() => {
  for (const root of roots) {
    act(() => {
      root.unmount()
    })
  }
  roots = []
  document.body.innerHTML = ""
  vi.restoreAllMocks()
})

describe("useKnowledgeBaseStorageMigration", () => {
  it("loads the current migration snapshot when the app shell mounts", async () => {
    const getStorageMigrationState = vi.fn().mockResolvedValue(copyingProgress)
    const unsubscribe = vi.fn()
    const onStorageMigrationChanged = vi.fn(() => unsubscribe)
    installKnowledgeBaseBridge({ getStorageMigrationState, onStorageMigrationChanged })

    await renderProbe()

    expect(getStorageMigrationState).toHaveBeenCalledTimes(1)
    expect(onStorageMigrationChanged).toHaveBeenCalledTimes(1)
    expect(document.body.textContent).toContain("copying:12")
  })

  it("keeps the newer event when it arrives before the snapshot resolves", async () => {
    let resolveSnapshot: (progress: SynapseKnowledgeBaseStorageMigrationProgress) => void = () => {}
    const getStorageMigrationState = vi.fn(() => new Promise<SynapseKnowledgeBaseStorageMigrationProgress>((resolve) => {
      resolveSnapshot = resolve
    }))
    let listener: (progress: SynapseKnowledgeBaseStorageMigrationProgress) => void = () => {}
    const onStorageMigrationChanged = vi.fn((nextListener) => {
      listener = nextListener
      return vi.fn()
    })
    installKnowledgeBaseBridge({ getStorageMigrationState, onStorageMigrationChanged })

    await renderProbe()

    await act(async () => {
      listener(verifyingProgress)
      resolveSnapshot(copyingProgress)
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain("verifying:24")
  })
})

function installKnowledgeBaseBridge(options: {
  getStorageMigrationState: () => Promise<SynapseKnowledgeBaseStorageMigrationProgress>
  onStorageMigrationChanged: (
    listener: (progress: SynapseKnowledgeBaseStorageMigrationProgress) => void,
  ) => () => void
}) {
  Object.defineProperty(window, "synapse", {
    configurable: true,
    value: {
      knowledgeBase: {
        cancelStorageMigration: vi.fn(),
        getStorageMigrationState: options.getStorageMigrationState,
        onStorageMigrationChanged: options.onStorageMigrationChanged,
      },
    },
  })
}

async function renderProbe() {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(<MigrationProbe />)
    await Promise.resolve()
  })
}

function MigrationProbe() {
  const { progress } = useKnowledgeBaseStorageMigration()
  const current = progress ?? idleProgress
  return <div>{`${current.phase}:${current.copiedBytes}`}</div>
}

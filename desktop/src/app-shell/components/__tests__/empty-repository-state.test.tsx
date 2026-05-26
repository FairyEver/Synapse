/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import { EmptyRepositoryState } from "../empty-repository-state"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  chooseDirectory: vi.fn(),
  error: vi.fn(),
  initializeRepository: vi.fn(),
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
  switchActiveRepository: vi.fn(),
  validateDirectory: vi.fn(),
}))

vi.mock("@/assets/icon.png", () => ({
  default: "icon.png",
}))

vi.mock("@/app-shell/active-repository-switch", () => ({
  useActiveRepositorySwitch: () => ({
    isSwitchingRepository: false,
    switchActiveRepository: mocks.switchActiveRepository,
  }),
}))

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => mocks.logger,
}))

vi.mock("@/app-shell/notifications", () => ({
  useAppNotifications: () => ({
    error: mocks.error,
  }),
}))

vi.mock("@/app-shell/use-repository-manager", () => ({
  useActiveRepository: () => null,
  useRepositoryActions: () => ({
    addRepository: vi.fn(),
    createLocalRepositoryAndAdd: vi.fn(),
    initializeRepository: mocks.initializeRepository,
  }),
  useRepositoryList: () => [],
  useRepositoryManager: () => ({
    chooseDirectory: mocks.chooseDirectory,
    getAllStates: () => new Map(),
    getRepositories: () => [],
    getRepositoryState: () => undefined,
    refreshRepositoryStates: vi.fn(),
    subscribeToRepositoryChanges: () => () => {},
    switchActiveRepository: mocks.switchActiveRepository,
    updateConfig: vi.fn(),
    validateDirectory: mocks.validateDirectory,
  }),
}))

let roots: Root[] = []

afterEach(() => {
  vi.useRealTimers()
  for (const root of roots) {
    act(() => {
      root.unmount()
    })
  }
  roots = []
  document.body.innerHTML = ""
  vi.clearAllMocks()
})

function renderEmptyState() {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  act(() => {
    root.render(<EmptyRepositoryState reason="no-repositories" />)
  })
}

function findButton(label: string): HTMLButtonElement {
  const button = [...document.querySelectorAll<HTMLButtonElement>("button")]
    .find((element) => element.textContent?.includes(label))
  if (!button) throw new Error(`Button not found: ${label}`)
  return button
}

describe("EmptyRepositoryState", () => {
  it("shows a destructive preview before initializing a non-empty non-Synapse directory", async () => {
    vi.useFakeTimers()
    mocks.chooseDirectory.mockResolvedValue("/repo")
    mocks.initializeRepository.mockResolvedValue(undefined)
    mocks.validateDirectory.mockResolvedValue({
      initializationPreview: {
        dangerFlags: [],
        isEmpty: false,
        nonGitEntries: ["notes.md"],
        operationToken: "token-1",
      },
      isValid: false,
      message: "该目录不是有效的 Synapse 仓库。",
      missingDirectories: ["rules", "skills", "prompts", "system/users", "system/blobs"],
    })
    renderEmptyState()

    await act(async () => {
      findButton("选择已有目录").click()
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain("检测到目录中存在以下内容")
    expect(document.body.textContent).toContain("notes.md")
    expect(document.body.textContent).not.toContain("该目录尚未包含 Synapse 仓库结构")
    expect(mocks.initializeRepository).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(3000)
    })
    await act(async () => {
      findButton("确定初始化").click()
      await Promise.resolve()
    })

    expect(mocks.initializeRepository).toHaveBeenCalledWith(expect.any(String), {
      confirmedOperationToken: "token-1",
    })
  })
})

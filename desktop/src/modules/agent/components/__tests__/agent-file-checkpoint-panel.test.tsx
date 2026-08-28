/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { AgentFileCheckpointPanel } from "../agent-file-checkpoint-panel"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  getFileCheckpoint: vi.fn(),
  getFileCheckpointDiff: vi.fn(),
  prepareFileCheckpointRewind: vi.fn(),
  confirmFileCheckpointRewind: vi.fn(),
  renderDiffViewer: vi.fn(),
}))

vi.mock("@/lib/electron-bridge", () => ({
  requireSynapseBridge: () => ({ agent: mocks }),
}))

vi.mock("@/components/diff/diff-viewer", () => ({
  DiffViewer: (props: Record<string, unknown>) => {
    mocks.renderDiffViewer(props)
    return <div>文件差异</div>
  },
}))

let roots: Root[] = []

beforeEach(() => {
  mocks.getFileCheckpoint.mockResolvedValue({
    id: "checkpoint-1",
    conversationId: "conversation-1",
    status: "available",
    insertions: 1,
    deletions: 1,
    coverageWarning: false,
    files: [{
      id: "file-1",
      path: "sy-c2c-r21-modify.md",
      kind: "modified",
      insertions: 1,
      deletions: 1,
      binary: false,
      truncated: false,
    }],
  })
  mocks.getFileCheckpointDiff.mockResolvedValue({
    checkpointId: "checkpoint-1",
    fileId: "file-1",
    path: "sy-c2c-r21-modify.md",
    kind: "modified",
    patch: "",
    binary: false,
    truncated: false,
  })
  mocks.prepareFileCheckpointRewind.mockResolvedValue({
    operationId: "operation-1",
    expiresAt: "2026-08-27T13:00:00.000Z",
    filesChanged: ["sy-c2c-r21-modify.md"],
    insertions: 1,
    deletions: 1,
  })
  mocks.confirmFileCheckpointRewind.mockResolvedValue({
    checkpointId: "checkpoint-1",
    status: "rewound",
    skippedLinks: 0,
  })
})

afterEach(() => {
  for (const root of roots) act(() => root.unmount())
  roots = []
  document.body.innerHTML = ""
  vi.clearAllMocks()
})

describe("AgentFileCheckpointPanel", () => {
  it("returns focus to undo after cancelling rewind with Escape", async () => {
    renderPanel()
    await waitForExpectation(() => expect(findButton("撤销")).toBeTruthy())
    const undoButton = findButton("撤销")

    await act(async () => {
      undoButton.click()
      await Promise.resolve()
    })
    await waitForExpectation(() => expect(findButton("取消")).toBeTruthy())

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }))
      await Promise.resolve()
    })
    await waitForExpectation(() => expect(document.activeElement).toBe(undoButton))
  })

  it("keeps the prepared file count visible while rewind is finishing", async () => {
    renderPanel(() => new Promise<void>(() => {}))
    await waitForExpectation(() => expect(findButton("撤销")).toBeTruthy())

    await act(async () => {
      findButton("撤销").click()
      await Promise.resolve()
    })
    await waitForExpectation(() => expect(findButton("撤销文件修改")).toBeTruthy())

    await act(async () => {
      findButton("撤销文件修改").click()
      await Promise.resolve()
    })
    await waitForExpectation(() => expect(document.body.textContent).toContain("正在撤销"))

    expect(document.body.textContent).toContain("将恢复 1 个文件")
    expect(document.body.textContent).not.toContain("将恢复 0 个文件")
  })

  it("warns when terminal or subagent changes may be outside the rewind", async () => {
    mocks.prepareFileCheckpointRewind.mockResolvedValueOnce({
      operationId: "operation-1",
      expiresAt: "2026-08-27T13:00:00.000Z",
      filesChanged: ["sy-c2c-r21-modify.md"],
      insertions: 1,
      deletions: 1,
      coverageWarning: true,
    })
    renderPanel()
    await waitForExpectation(() => expect(findButton("撤销")).toBeTruthy())

    await act(async () => {
      findButton("撤销").click()
      await Promise.resolve()
    })

    await waitForExpectation(() => expect(document.body.textContent).toContain(
      "终端或子智能体产生的修改可能不在此次撤销范围内",
    ))
  })

  it("distinguishes cleared and oversized checkpoint diffs", async () => {
    mocks.getFileCheckpointDiff.mockResolvedValueOnce({
      checkpointId: "checkpoint-1",
      fileId: "file-1",
      path: "sy-c2c-r21-modify.md",
      kind: "modified",
      patch: null,
      binary: false,
      truncated: true,
      diffCleared: true,
    })
    renderPanel()
    await waitForExpectation(() => expect(mocks.renderDiffViewer).toHaveBeenCalled())

    expect(mocks.renderDiffViewer).toHaveBeenLastCalledWith(expect.objectContaining({
      truncated: true,
      truncatedDescription: "差异内容已按空间配额清理，只保留了文件摘要。",
    }))

    for (const root of roots.splice(0)) act(() => root.unmount())
    mocks.renderDiffViewer.mockClear()
    mocks.getFileCheckpointDiff.mockResolvedValueOnce({
      checkpointId: "checkpoint-1",
      fileId: "file-1",
      path: "sy-c2c-r21-modify.md",
      kind: "modified",
      patch: null,
      binary: false,
      truncated: true,
      diffCleared: false,
    })
    renderPanel()
    await waitForExpectation(() => expect(mocks.renderDiffViewer).toHaveBeenCalled())

    expect(mocks.renderDiffViewer).toHaveBeenLastCalledWith(expect.objectContaining({
      truncated: true,
      truncatedDescription: "差异内容超过检查点保存上限，只保留了文件摘要。",
    }))
  })
})

function renderPanel(onRewound: () => void | Promise<void> = vi.fn()): void {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  act(() => {
    root.render(
      <AgentFileCheckpointPanel
        projectId="project-1"
        conversationId="conversation-1"
        request={{ checkpointId: "checkpoint-1" }}
        onRewound={onRewound}
      />,
    )
  })
}

function findButton(label: string): HTMLButtonElement {
  const button = [...document.querySelectorAll("button")]
    .find((candidate) => candidate.textContent?.trim() === label)
  if (!button) throw new Error(`Missing button: ${label}`)
  return button
}

async function waitForExpectation(assertion: () => void): Promise<void> {
  let lastError: unknown
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      assertion()
      return
    } catch (error) {
      lastError = error
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
  throw lastError
}

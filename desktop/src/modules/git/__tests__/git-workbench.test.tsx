/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { GitWorkbench } from "../components/git-workbench"

const repository = { id: "repo-1", name: "Docs", localPath: "/repo", addedAt: "now", lastOpenedAt: null }
const bridge = vi.hoisted(() => ({
  git: {
    getSnapshot: vi.fn(),
    getDiff: vi.fn(),
    commit: vi.fn(),
    listBranches: vi.fn(),
    checkoutBranch: vi.fn(),
    createBranch: vi.fn(),
    listHistory: vi.fn(),
    getCommit: vi.fn(),
    sync: vi.fn(),
    pull: vi.fn(),
    push: vi.fn(),
  },
}))

vi.mock("@/lib/electron-bridge", () => ({
  getSynapseBridge: () => bridge,
  requireSynapseBridge: () => bridge,
}))

describe("GitWorkbench", () => {
  const roots: Root[] = []

  beforeEach(() => {
    vi.clearAllMocks()
    document.body.innerHTML = ""
    bridge.git.getSnapshot.mockResolvedValue({
      repositoryId: "repo-1",
      pathExists: true,
      isGitRepository: true,
      currentBranch: "main",
      upstream: "origin/main",
      ahead: 1,
      behind: 0,
      hasConflicts: false,
      changes: [{ path: "docs/a.md", originalPath: null, status: "modified", staged: false, conflicted: false }],
    })
    bridge.git.getDiff.mockResolvedValue({ path: "docs/a.md", originalPath: null, binary: false, text: "+hello" })
    bridge.git.listBranches.mockResolvedValue([{ name: "main", current: true }, { name: "docs", current: false }])
    bridge.git.listHistory.mockResolvedValue([
      { hash: "abc", shortHash: "abc123", subject: "更新文档", authorName: "张三", authorEmail: "zhang@example.com", committedAt: "2026-06-17T10:00:00+08:00" },
    ])
    bridge.git.getCommit.mockResolvedValue({
      hash: "abc",
      shortHash: "abc123",
      subject: "更新文档",
      authorName: "张三",
      authorEmail: "zhang@example.com",
      committedAt: "2026-06-17T10:00:00+08:00",
      files: [{ path: "docs/a.md", originalPath: null, status: "modified", staged: false, conflicted: false }],
      diff: "+hello",
    })
    bridge.git.commit.mockResolvedValue({ completedAt: "now", message: "已提交选中文件。" })
  })

  afterEach(() => {
    for (const root of roots.splice(0)) {
      root.unmount()
    }
  })

  it("shows branch, changes, diff, and commits selected files", async () => {
    await renderWorkbench(roots)

    expect(document.body.textContent).toContain("Docs")
    expect(document.body.textContent).toContain("main")
    expect(document.body.textContent).toContain("docs/a.md")
    expect(document.body.textContent).toContain("+hello")

    await changeTextarea("提交说明", "更新文档")
    await click(findButton("提交选中文件"))

    expect(bridge.git.commit).toHaveBeenCalledWith({
      repositoryId: "repo-1",
      message: "更新文档",
      paths: ["docs/a.md"],
    })
  })

  it("shows current branch history", async () => {
    await renderWorkbench(roots)

    await click(findButton("历史"))
    expect(document.body.textContent).toContain("更新文档")
    expect(document.body.textContent).toContain("abc123")
  })
})

async function renderWorkbench(roots: Root[]): Promise<void> {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(<GitWorkbench repository={repository} onBack={vi.fn()} />)
    await flush()
    await flush()
  })
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))
    element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))
    element.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }))
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }))
    element.click()
    await flush()
    await flush()
  })
}

async function changeTextarea(label: string, value: string): Promise<void> {
  const textarea = textareaByLabel(label)
  await act(async () => {
    const descriptor = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")
    descriptor?.set?.call(textarea, value)
    textarea.dispatchEvent(new Event("input", { bubbles: true }))
    await flush()
  })
}

async function flush(): Promise<void> {
  await Promise.resolve()
  await new Promise((resolve) => window.setTimeout(resolve, 0))
}

function findButton(label: string): HTMLElement {
  const button = Array.from(document.querySelectorAll("button"))
    .find((item) => item.textContent?.includes(label))
  if (!button) throw new Error(`Button not found: ${label}`)
  return button
}

function textareaByLabel(label: string): HTMLTextAreaElement {
  const labelElement = Array.from(document.querySelectorAll("label"))
    .find((item) => item.textContent === label)
  const id = labelElement?.getAttribute("for")
  const textarea = id ? document.getElementById(id) : null
  if (!(textarea instanceof HTMLTextAreaElement)) {
    throw new Error(`Textarea not found: ${label}`)
  }
  return textarea
}

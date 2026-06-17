/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { GitHistoryTab } from "../components/git-history-tab"
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

  it("keeps long history details inside the right pane", () => {
    const longPath = "app/portal/views/simple/finance/form/001/page/pc/edit/index.vue"
    const longDiffLine = `diff --git a/${longPath} b/${longPath} `.repeat(4)
    const html = renderToStaticMarkup(<GitHistoryTab
      history={{
        commits: [],
        selectedCommit: {
          hash: "abc",
          shortHash: "abc123",
          subject: "fix(finance): 修复工资类型验证并优化提交按钮状态",
          authorName: "wangl",
          authorEmail: "wangl@example.com",
          committedAt: "2026-06-15T16:21:42+08:00",
          files: [{ path: longPath, originalPath: null, status: "modified", staged: false, conflicted: false }],
          diff: longDiffLine,
        },
        loading: false,
        detailLoading: false,
        error: null,
        refresh: vi.fn(async () => undefined),
        loadCommit: vi.fn(async () => undefined),
      }}
    />)
    const container = document.createElement("div")
    container.innerHTML = html

    const root = container.firstElementChild
    const rightPane = container.querySelector('[data-git-history-detail-pane="true"]')
    const rightViewport = rightPane?.querySelector('[data-slot="scroll-area-viewport"]')
    const detailContent = container.querySelector('[data-git-history-detail-content="true"]')
    const fileList = container.querySelector('[data-git-history-file-list="true"]')
    const diff = container.querySelector("pre")

    expect(root?.className).toContain("min-w-0")
    expect(rightPane?.className).toContain("min-w-0")
    expect(rightViewport?.className).toContain("overflow-x-hidden")
    expect(rightViewport?.className).toContain("[&>div]:!block")
    expect(rightViewport?.className).toContain("[&>div]:!max-w-full")
    expect(detailContent?.className).toContain("min-w-0")
    expect(fileList?.className).toContain("max-w-full")
    expect(diff?.className).toContain("block")
    expect(diff?.className).toContain("w-full")
    expect(diff?.className).toContain("min-w-0")
    expect(diff?.className).toContain("max-w-full")
    expect(diff?.className).toContain("overflow-x-auto")
  })

  it("does not render an empty history file list border", () => {
    const html = renderToStaticMarkup(<GitHistoryTab
      history={{
        commits: [],
        selectedCommit: {
          hash: "abc",
          shortHash: "abc123",
          subject: "Merge branch docs",
          authorName: "wangl",
          authorEmail: "wangl@example.com",
          committedAt: "2026-06-15T16:21:42+08:00",
          files: [],
          diff: "",
        },
        loading: false,
        detailLoading: false,
        error: null,
        refresh: vi.fn(async () => undefined),
        loadCommit: vi.fn(async () => undefined),
      }}
    />)
    const container = document.createElement("div")
    container.innerHTML = html

    expect(container.querySelector('[data-git-history-file-list="true"]')).toBeNull()
    expect(container.querySelector("pre")?.textContent).toBe("没有文本差异。")
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

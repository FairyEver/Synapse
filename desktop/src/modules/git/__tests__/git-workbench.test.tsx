/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { GitChangesTab } from "../components/git-changes-tab"
import { GitHistoryTab } from "../components/git-history-tab"
import { GitWorkbench } from "../components/git-workbench"
import type { useGitWorktreeStatus } from "../hooks/use-git-worktree-status"
import type { SynapseGitRepositorySnapshot } from "@/types/git"

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
    bridge.git.pull.mockResolvedValue({ completedAt: "now", message: "已拉取远程更新。" })
    bridge.git.push.mockResolvedValue({ completedAt: "now", message: "已推送本地提交。" })
    bridge.git.sync.mockResolvedValue({ completedAt: "now", message: "已同步仓库。" })
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

    expect(bridge.git.listHistory).not.toHaveBeenCalled()
    expect(bridge.git.getCommit).not.toHaveBeenCalled()

    await click(findButton("历史"))
    expect(bridge.git.listHistory).toHaveBeenCalledWith({
      repositoryId: "repo-1",
      limit: 40,
      offset: 0,
    })
    expect(document.body.textContent).toContain("更新文档")
    expect(document.body.textContent).toContain("abc123")
    expect(bridge.git.getCommit).not.toHaveBeenCalled()

    await click(findButton("更新文档"))
    expect(bridge.git.getCommit).toHaveBeenCalledWith("repo-1", "abc")
    expect(document.body.textContent).toContain("+hello")
  })

  it("does not leave a surface gap between tabs and content", () => {
    const html = renderToStaticMarkup(<GitWorkbench repository={repository} onBack={vi.fn()} />)
    const container = document.createElement("div")
    container.innerHTML = html

    const tabs = container.querySelector('[data-slot="tabs"]')

    expect(tabs?.className).toContain("gap-0")
  })

  it("shows loading labels while running toolbar actions", async () => {
    const pendingSync = deferred()
    bridge.git.getSnapshot.mockResolvedValue(gitSnapshot({ changes: [], ahead: 1, behind: 1 }))
    bridge.git.sync.mockReturnValue(pendingSync.promise)
    await renderWorkbench(roots)

    await act(async () => {
      findButton("同步").click()
      await flush()
    })

    expect(findButton("同步中").textContent).toContain("同步中")

    pendingSync.resolve({ completedAt: "now", message: "已同步。" })
    await act(async () => {
      await pendingSync.promise
      await flush()
    })
  })

  it("separates primary repository context from secondary metadata", async () => {
    const longRepository = {
      id: "repo-1",
      name: "Projects_Js_With_A_Very_Long_Display_Name",
      localPath: "/Users/liyang/Documents/code/wdbc/Projects_Js/app/portal/views/simple/finance/form/001/page/pc/edit",
      addedAt: "now",
      lastOpenedAt: null,
    }
    bridge.git.getSnapshot.mockResolvedValue(gitSnapshot({
      currentBranch: "feat/portal/王璐-人力合并功能-with-extra-long-suffix",
      upstream: "origin/feat/portal/王璐-人力合并功能-with-extra-long-suffix",
      ahead: 12,
      behind: 0,
      changes: [],
    }))

    await renderWorkbench(roots, longRepository)

    const toolbar = document.querySelector('[data-git-workbench-toolbar="true"]')
    const primaryBar = document.querySelector('[data-git-workbench-primary-bar="true"]')
    const secondaryBar = document.querySelector('[data-git-workbench-secondary-bar="true"]')
    const repositoryContext = document.querySelector('[data-git-workbench-repository-context="true"]')
    const actionBar = document.querySelector('[data-git-workbench-action-bar="true"]')
    const metadataBar = document.querySelector('[data-git-workbench-metadata-bar="true"]')
    const tabs = document.querySelector('[data-slot="tabs"]')
    const changesContent = document.querySelector('[data-slot="tabs-content"][data-state="active"]')

    expect(toolbar?.className).toContain("py-3")
    expect(primaryBar?.className).toContain("lg:grid-cols-[minmax(260px,1fr)_minmax(220px,420px)_minmax(220px,1fr)]")
    expect(repositoryContext?.className).toContain("items-start")
    expect(repositoryContext?.textContent).toContain("Projects_Js_With_A_Very_Long_Display_Name")
    expect(repositoryContext?.textContent).toContain(longRepository.localPath)
    expect(secondaryBar?.className).toContain("text-xs")
    expect(actionBar?.className).toContain("flex-wrap")
    expect(actionBar?.className).toContain("max-w-full")
    expect(metadataBar?.className).toContain("flex-wrap")
    expect(tabs?.className).toContain("min-w-0")
    expect(changesContent?.className).toContain("min-w-0")
    expect(document.body.textContent).toContain("Projects_Js_With_A_Very_Long_Display_Name")
    expect(document.body.textContent).toContain(longRepository.localPath)
    expect(document.body.textContent).toContain("origin/feat/portal/王璐-人力合并功能-with-extra-long-suffix")
    expect(document.querySelector('button[aria-label="返回仓库列表"]')).toBeTruthy()
    expect(findButton("推送本地提交")).toBeTruthy()
    expect(findButton("新建分支")).toBeTruthy()
    expect(findButton("详情")).toBeTruthy()
    expect(document.querySelector('button[aria-label="更多 Git 操作"]')).toBeTruthy()
  })

  it("uses the action bar without syncing dirty worktrees", async () => {
    await renderWorkbench(roots)

    await click(findButton("提交改动"))

    expect(bridge.git.pull).not.toHaveBeenCalled()
    expect(bridge.git.push).not.toHaveBeenCalled()
    expect(bridge.git.sync).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain("选择文件并提交。")
  })

  it("runs the matching action bar operation for remote state", async () => {
    bridge.git.getSnapshot.mockResolvedValue(gitSnapshot({ changes: [], ahead: 0, behind: 2 }))
    await renderWorkbench(roots)
    await click(findButton("拉取远程更新"))
    expect(bridge.git.pull).toHaveBeenCalledWith("repo-1")

    roots.splice(0).forEach((root) => root.unmount())
    document.body.innerHTML = ""
    vi.clearAllMocks()
    bridge.git.getSnapshot.mockResolvedValue(gitSnapshot({ changes: [], ahead: 1, behind: 0 }))
    bridge.git.listBranches.mockResolvedValue([{ name: "main", current: true }])
    bridge.git.listHistory.mockResolvedValue([])
    bridge.git.push.mockResolvedValue({ completedAt: "now", message: "已推送本地提交。" })
    await renderWorkbench(roots)
    await click(findButton("推送本地提交"))
    expect(bridge.git.push).toHaveBeenCalledWith("repo-1")

    roots.splice(0).forEach((root) => root.unmount())
    document.body.innerHTML = ""
    vi.clearAllMocks()
    bridge.git.getSnapshot.mockResolvedValue(gitSnapshot({ changes: [], ahead: 1, behind: 1 }))
    bridge.git.listBranches.mockResolvedValue([{ name: "main", current: true }])
    bridge.git.listHistory.mockResolvedValue([])
    bridge.git.sync.mockResolvedValue({ completedAt: "now", message: "已同步仓库。" })
    await renderWorkbench(roots)
    await click(findButton("同步"))
    expect(bridge.git.sync).toHaveBeenCalledWith("repo-1")
  })

  it("uses shared empty states for empty worktree panes and keeps submit disabled", () => {
    const status: ReturnType<typeof useGitWorktreeStatus> = {
      snapshot: {
        repositoryId: "repo-1",
        pathExists: true,
        isGitRepository: true,
        currentBranch: "main",
        upstream: "origin/main",
        ahead: 0,
        behind: 0,
        hasConflicts: false,
        changes: [],
      },
      selectedFile: null,
      diff: null,
      selectedPaths: [],
      loading: false,
      diffLoading: false,
      error: null,
      refresh: vi.fn(async () => null),
      loadDiff: vi.fn(async () => undefined),
      togglePath: vi.fn(),
      selectAll: vi.fn(),
      clearSelection: vi.fn(),
    }
    const html = renderToStaticMarkup(<GitChangesTab repository={repository} status={status} />)
    const container = document.createElement("div")
    container.innerHTML = html

    const emptyStates = container.querySelectorAll('[data-slot="empty"]')
    const submit = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("提交选中文件"))

    expect(emptyStates).toHaveLength(2)
    expect(container.textContent).toContain("暂无改动")
    expect(container.textContent).toContain("选择文件查看差异")
    expect(submit?.hasAttribute("disabled")).toBe(true)
  })

  it("uses shared empty states for empty history panes", () => {
    const html = renderToStaticMarkup(<GitHistoryTab
      history={{
        commits: [],
        selectedCommit: null,
        loading: false,
        detailLoading: false,
        error: null,
        hasLoaded: true,
        refresh: vi.fn(async () => undefined),
        loadCommit: vi.fn(async () => undefined),
      }}
    />)
    const container = document.createElement("div")
    container.innerHTML = html

    expect(container.querySelectorAll('[data-slot="empty"]')).toHaveLength(2)
    expect(container.textContent).toContain("暂无提交")
    expect(container.textContent).toContain("选择提交查看详情")
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
        hasLoaded: true,
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

  it("keeps long worktree diffs inside the right pane", () => {
    const longPath = "app/portal/views/simple/finance/form/001/page/pc/edit/index.vue"
    const longDiffLine = `diff --git a/${longPath} b/${longPath} `.repeat(4)
    const status: ReturnType<typeof useGitWorktreeStatus> = {
      snapshot: {
        repositoryId: "repo-1",
        pathExists: true,
        isGitRepository: true,
        currentBranch: "main",
        upstream: "origin/main",
        ahead: 0,
        behind: 0,
        hasConflicts: false,
        changes: [{ path: longPath, originalPath: null, status: "modified", staged: false, conflicted: false }],
      },
      selectedFile: { path: longPath, originalPath: null, status: "modified", staged: false, conflicted: false },
      diff: { path: longPath, originalPath: null, binary: false, text: longDiffLine },
      selectedPaths: [longPath],
      loading: false,
      diffLoading: false,
      error: null,
      refresh: vi.fn(async () => null),
      loadDiff: vi.fn(async () => undefined),
      togglePath: vi.fn(),
      selectAll: vi.fn(),
      clearSelection: vi.fn(),
    }
    const html = renderToStaticMarkup(<GitChangesTab repository={repository} status={status} />)
    const container = document.createElement("div")
    container.innerHTML = html

    const root = container.firstElementChild
    const rightPane = container.querySelector('[data-git-changes-detail-pane="true"]')
    const rightViewport = rightPane?.querySelector('[data-slot="scroll-area-viewport"]')
    const detailContent = container.querySelector('[data-git-changes-detail-content="true"]')
    const commitPanel = container.querySelector('[data-git-changes-commit-panel="true"]')
    const selectionBar = container.querySelector('[data-git-changes-selection-bar="true"]')
    const textarea = container.querySelector("textarea")
    const diff = container.querySelector("pre")

    expect(root?.className).toContain("min-w-0")
    expect(rightPane?.className).toContain("min-w-0")
    expect(rightViewport?.className).toContain("overflow-x-hidden")
    expect(rightViewport?.className).toContain("[&>div]:!block")
    expect(rightViewport?.className).toContain("[&>div]:!max-w-full")
    expect(detailContent?.className).toContain("min-w-0")
    expect(detailContent?.className).toContain("max-w-full")
    expect(commitPanel?.className).toContain("min-w-0")
    expect(commitPanel?.className).toContain("max-w-full")
    expect(commitPanel?.className).toContain("overflow-hidden")
    expect(selectionBar?.className).toContain("flex-wrap")
    expect(textarea?.className).toContain("min-w-0")
    expect(textarea?.className).toContain("max-w-full")
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
        hasLoaded: true,
        refresh: vi.fn(async () => undefined),
        loadCommit: vi.fn(async () => undefined),
      }}
    />)
    const container = document.createElement("div")
    container.innerHTML = html

    expect(container.querySelector('[data-git-history-file-list="true"]')).toBeNull()
    expect(container.querySelector("pre")?.textContent).toBe("没有文本差异。")
  })

  it("keeps commit handoff on remaining local changes", async () => {
    const status = createStatus({
      refresh: vi.fn(async () => gitSnapshot({
        ahead: 1,
        changes: [{ path: "docs/b.md", originalPath: null, status: "modified", staged: false, conflicted: false }],
      })),
    })

    await renderChangesTab(roots, status)
    await changeTextarea("提交说明", "更新文档")
    await click(findButton("提交选中文件"))

    expect(document.body.textContent).toContain("还有 1 个改动。")
    expect(exactButtonsByLabel("推送")).toHaveLength(0)
  })

  it("offers push only when commit leaves no local changes and has local commits", async () => {
    const status = createStatus({
      refresh: vi.fn(async () => gitSnapshot({ changes: [], ahead: 1, behind: 0 })),
    })

    await renderChangesTab(roots, status)
    await changeTextarea("提交说明", "更新文档")
    await click(findButton("提交选中文件"))

    expect(document.body.textContent).toContain("可以推送本地提交。")
    expect(findButton("推送")).toBeTruthy()
  })

  it("blocks commits while conflicts are present", async () => {
    const status = createStatus({
      snapshot: gitSnapshot({
        hasConflicts: true,
        changes: [{ path: "docs/conflict.md", originalPath: null, status: "conflicted", staged: false, conflicted: true }],
      }),
      selectedFile: { path: "docs/conflict.md", originalPath: null, status: "conflicted", staged: false, conflicted: true },
      selectedPaths: ["docs/conflict.md"],
    })

    await renderChangesTab(roots, status)
    await changeTextarea("提交说明", "处理冲突")

    expect(document.body.textContent).toContain("发生冲突")
    expect(findButton("提交选中文件").hasAttribute("disabled")).toBe(true)
  })
})

function gitSnapshot(overrides: Partial<SynapseGitRepositorySnapshot> = {}): SynapseGitRepositorySnapshot {
  return {
    repositoryId: "repo-1",
    pathExists: true,
    isGitRepository: true,
    currentBranch: "main",
    upstream: "origin/main",
    ahead: 0,
    behind: 0,
    hasConflicts: false,
    changes: [],
    ...overrides,
  }
}

function createStatus(overrides: Partial<ReturnType<typeof useGitWorktreeStatus>> = {}): ReturnType<typeof useGitWorktreeStatus> {
  return {
    snapshot: gitSnapshot({
      changes: [{ path: "docs/a.md", originalPath: null, status: "modified", staged: false, conflicted: false }],
    }),
    selectedFile: { path: "docs/a.md", originalPath: null, status: "modified", staged: false, conflicted: false },
    diff: { path: "docs/a.md", originalPath: null, binary: false, text: "+hello" },
    selectedPaths: ["docs/a.md"],
    loading: false,
    diffLoading: false,
    error: null,
    refresh: vi.fn(async () => gitSnapshot({ changes: [], ahead: 1 })),
    loadDiff: vi.fn(async () => undefined),
    togglePath: vi.fn(),
    selectAll: vi.fn(),
    clearSelection: vi.fn(),
    ...overrides,
  }
}

async function renderWorkbench(
  roots: Root[],
  targetRepository: typeof repository = repository,
): Promise<void> {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(<GitWorkbench repository={targetRepository} onBack={vi.fn()} />)
    await flush()
    await flush()
  })
}

async function renderChangesTab(
  roots: Root[],
  status: ReturnType<typeof useGitWorktreeStatus>,
): Promise<void> {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(<GitChangesTab repository={repository} status={status} onPush={vi.fn()} />)
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

function exactButtonsByLabel(label: string): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll("button"))
    .filter((item): item is HTMLButtonElement => item instanceof HTMLButtonElement && item.textContent === label)
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

function deferred<T = unknown>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve
    reject = innerReject
  })
  return { promise, resolve, reject }
}

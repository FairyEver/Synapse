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

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

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
    bridge.git.getDiff.mockResolvedValue({ path: "docs/a.md", originalPath: null, binary: false, truncated: false, text: "+hello" })
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
      filesTruncated: false,
      diffTruncated: false,
      truncated: false,
    })
    bridge.git.commit.mockResolvedValue({ completedAt: "now", message: "已提交选中文件。" })
    bridge.git.pull.mockResolvedValue({ completedAt: "now", message: "已拉取远程更新。" })
    bridge.git.push.mockResolvedValue({ completedAt: "now", message: "已推送本地提交。" })
    bridge.git.sync.mockResolvedValue({ completedAt: "now", message: "已同步仓库。" })
  })

  afterEach(async () => {
    for (const root of roots.splice(0)) {
      await act(async () => root.unmount())
    }
  })

  it("shows branch, changes, diff, and commits selected files", async () => {
    await renderWorkbench(roots)

    expect(document.body.textContent).toContain("Docs")
    expect(document.body.textContent).toContain("main")
    expect(document.body.textContent).toContain("docs/a.md")
    expect(document.body.textContent).toContain("+hello")

    await click(findButton("提交改动"))
    expect(findDialog().textContent).toContain("提交改动")

    await changeTextarea("提交说明", "更新文档")
    await click(findButton("提交选中文件"))

    expect(bridge.git.commit).toHaveBeenCalledWith({
      repositoryId: "repo-1",
      message: "更新文档",
      paths: ["docs/a.md"],
    })
  })

  it("commits both old and new paths for selected renames", async () => {
    bridge.git.getSnapshot.mockResolvedValue({
      repositoryId: "repo-1",
      pathExists: true,
      isGitRepository: true,
      currentBranch: "main",
      upstream: "origin/main",
      ahead: 0,
      behind: 0,
      hasConflicts: false,
      changes: [{
        path: "docs/new-name.md",
        originalPath: "docs/old-name.md",
        status: "renamed",
        staged: false,
        conflicted: false,
      }],
    })
    bridge.git.getDiff.mockResolvedValueOnce({
      path: "docs/new-name.md",
      originalPath: "docs/old-name.md",
      binary: false,
      text: "+renamed",
    })
    await renderWorkbench(roots)

    await click(findButton("提交改动"))
    await changeTextarea("提交说明", "重命名文档")
    await click(findButton("提交选中文件"))

    expect(bridge.git.commit).toHaveBeenCalledWith({
      repositoryId: "repo-1",
      message: "重命名文档",
      paths: ["docs/old-name.md", "docs/new-name.md"],
    })
  })

  it("shows current branch history", async () => {
    await renderWorkbench(roots)

    expect(bridge.git.listHistory).not.toHaveBeenCalled()
    expect(bridge.git.getCommit).not.toHaveBeenCalled()

    await click(findButton("历史"))
    expect(bridge.git.listHistory).toHaveBeenCalledWith({
      repositoryId: "repo-1",
      limit: 41,
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
    const pendingPull = deferred()
    bridge.git.getSnapshot.mockResolvedValue(gitSnapshot({ changes: [], ahead: 0, behind: 1 }))
    bridge.git.pull.mockReturnValue(pendingPull.promise)
    await renderWorkbench(roots)

    await act(async () => {
      findButton("拉取远程更新").click()
      await flush()
    })

    expect(findButton("等待中").textContent).toContain("等待中")

    pendingPull.resolve({ completedAt: "now", message: "已拉取。" })
    await act(async () => {
      await pendingPull.promise
      await flush()
    })
  })

  it("keeps repository context, branch state, actions, and metadata in a compact toolbar", async () => {
    const longBranch = "feat/portal/王璐-人力合并功能-with-extra-long-suffix"
    const longRepository = {
      id: "repo-1",
      name: "Projects_Js_With_A_Very_Long_Display_Name",
      localPath: "/Users/liyang/Documents/code/wdbc/Projects_Js/app/portal/views/simple/finance/form/001/page/pc/edit",
      addedAt: "now",
      lastOpenedAt: null,
    }
    bridge.git.getSnapshot.mockResolvedValue(gitSnapshot({
      currentBranch: longBranch,
      upstream: `origin/${longBranch}`,
      ahead: 12,
      behind: 0,
      changes: Array.from({ length: 12 }, (_, index) => ({
        path: `docs/${index}.md`,
        originalPath: null,
        status: "modified" as const,
        staged: false,
        conflicted: false,
      })),
    }))
    bridge.git.listBranches.mockResolvedValue([{ name: longBranch, current: true }])

    const handleBack = vi.fn()
    await renderWorkbench(roots, longRepository, handleBack)

    const toolbar = document.querySelector('[data-git-workbench-toolbar="true"]')
    const primaryBar = document.querySelector('[data-git-workbench-primary-bar="true"]')
    const repositoryContext = document.querySelector('[data-git-workbench-repository-context="true"]')
    const actionBar = document.querySelector('[data-git-workbench-action-bar="true"]')
    const selectionBar = document.querySelector('[data-git-changes-selection-bar="true"]')
    const tabs = document.querySelector('[data-slot="tabs"]')
    const tabsHeader = document.querySelector('[data-git-workbench-tabs-header="true"]')
    const changesContent = document.querySelector('[data-slot="tabs-content"][data-state="active"]')

    expect(toolbar?.className).toContain("py-2")
    expect(primaryBar?.className).toContain("flex-wrap")
    expect(repositoryContext?.className).toContain("items-center")
    expect(repositoryContext?.textContent).toContain("Projects_Js_With_A_Very_Long_Display_Name")
    expect(primaryBar?.textContent).toContain(longBranch)
    expect(primaryBar?.textContent).toContain("12 个改动")
    expect(actionBar?.className).toContain("flex-wrap")
    expect(actionBar?.className).toContain("justify-between")
    expect(actionBar?.textContent).toContain("~/Documents/code/wdbc/Projects_Js/.../pc/edit")
    expect(selectionBar?.textContent).toContain("已选 12 / 12")
    expect(selectionBar?.textContent).toContain("全选")
    expect(selectionBar?.textContent).toContain("全不选")
    expect(selectionBar?.textContent).toContain("新建分支")
    expect(selectionBar?.textContent).toContain("提交改动")
    expect(selectionBar?.lastElementChild?.textContent).toContain("提交改动")
    expect(document.querySelector(`[title="${longRepository.localPath}"]`)).toBeTruthy()
    expect(tabs?.className).toContain("min-w-0")
    expect(tabsHeader?.textContent).toBe("改动历史")
    expect(changesContent?.className).toContain("min-w-0")
    expect(document.body.textContent).toContain("Projects_Js_With_A_Very_Long_Display_Name")
    expect(document.body.textContent).toContain("~/Documents/code/wdbc/Projects_Js/.../pc/edit")
    expect(document.body.textContent).not.toContain(`origin/${longBranch}`)
    await click(findButtonByLabel("仓库详情"))
    expect(document.body.textContent).toContain(longRepository.localPath)
    expect(document.body.textContent).toContain(`origin/${longBranch}`)
    const backButton = document.querySelector<HTMLElement>('button[aria-label="返回仓库列表"]')
    expect(backButton).toBeTruthy()
    await click(backButton!)
    expect(handleBack).toHaveBeenCalledTimes(1)
    expect(findButton("提交改动")).toBeTruthy()
    expect(findButton("新建分支")).toBeTruthy()
    expect(findButtonByLabel("仓库详情")).toBeTruthy()
    expect(document.querySelector('button[aria-label="更多 Git 操作"]')).toBeTruthy()
  })

  it("uses the action bar without syncing dirty worktrees", async () => {
    await renderWorkbench(roots)

    await click(findButton("提交改动"))

    expect(bridge.git.pull).not.toHaveBeenCalled()
    expect(bridge.git.push).not.toHaveBeenCalled()
    expect(bridge.git.sync).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain("1 个改动")
  })

  it("runs the matching action bar operation for remote state", async () => {
    bridge.git.getSnapshot.mockResolvedValue(gitSnapshot({ changes: [], ahead: 0, behind: 2 }))
    await renderWorkbench(roots)
    await click(findButton("拉取远程更新"))
    expect(bridge.git.pull).toHaveBeenCalledWith("repo-1", expect.any(String))

    await act(async () => {
      roots.splice(0).forEach((root) => root.unmount())
    })
    document.body.innerHTML = ""
    vi.clearAllMocks()
    bridge.git.getSnapshot.mockResolvedValue(gitSnapshot({ changes: [], ahead: 1, behind: 0 }))
    bridge.git.listBranches.mockResolvedValue([{ name: "main", current: true }])
    bridge.git.listHistory.mockResolvedValue([])
    bridge.git.push.mockResolvedValue({ completedAt: "now", message: "已推送本地提交。" })
    await renderWorkbench(roots)
    await click(findButton("推送本地提交"))
    expect(bridge.git.push).toHaveBeenCalledWith("repo-1", undefined, expect.any(String))

    await act(async () => {
      roots.splice(0).forEach((root) => root.unmount())
    })
    document.body.innerHTML = ""
    vi.clearAllMocks()
    bridge.git.getSnapshot.mockResolvedValue(gitSnapshot({ changes: [], ahead: 1, behind: 1 }))
    bridge.git.listBranches.mockResolvedValue([{ name: "main", current: true }])
    bridge.git.listHistory.mockResolvedValue([])
    await renderWorkbench(roots)
    expect(document.body.textContent).toContain("本地分支与上游分支已分叉")
    expect(findButton("处理分叉").hasAttribute("disabled")).toBe(true)
    expect(bridge.git.sync).not.toHaveBeenCalled()
  })

  it("uses shared empty states for empty worktree panes without an inline submit panel", () => {
    const status: ReturnType<typeof useGitWorktreeStatus> = {
      snapshot: {
        repositoryId: "repo-1",
        pathExists: true,
        isGitRepository: true,
        currentBranch: "main",
        upstream: "origin/main",
        trackingStatus: "tracked",
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
    const html = renderToStaticMarkup(
      <GitChangesTab
        repository={repository}
        status={status}
        commitDialogOpen={false}
        onCommitDialogOpenChange={vi.fn()}
      />,
    )
    const container = document.createElement("div")
    container.innerHTML = html

    const emptyStates = container.querySelectorAll('[data-slot="empty"]')
    const submit = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("提交选中文件"))

    expect(emptyStates).toHaveLength(2)
    expect(container.textContent).toContain("暂无改动")
    expect(container.textContent).toContain("选择文件查看差异")
    expect(submit).toBeUndefined()
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
        hasMore: false,
        loadingMore: false,
        refresh: vi.fn(async () => undefined),
        loadMore: vi.fn(async () => undefined),
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
          filesTruncated: false,
          diffTruncated: false,
          truncated: false,
        },
        loading: false,
        detailLoading: false,
        error: null,
        hasLoaded: true,
        hasMore: false,
        loadingMore: false,
        refresh: vi.fn(async () => undefined),
        loadMore: vi.fn(async () => undefined),
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
          trackingStatus: "tracked",
        ahead: 0,
        behind: 0,
        hasConflicts: false,
        changes: [{ path: longPath, originalPath: null, status: "modified", staged: false, conflicted: false }],
      },
      selectedFile: { path: longPath, originalPath: null, status: "modified", staged: false, conflicted: false },
      diff: { path: longPath, originalPath: null, binary: false, truncated: false, text: longDiffLine },
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
    const html = renderToStaticMarkup(
      <GitChangesTab
        repository={repository}
        status={status}
        commitDialogOpen={false}
        onCommitDialogOpenChange={vi.fn()}
      />,
    )
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
    expect(commitPanel).toBeNull()
    expect(selectionBar).toBeNull()
    expect(textarea).toBeNull()
    expect(diff?.className).toContain("block")
    expect(diff?.className).toContain("w-full")
    expect(diff?.className).toContain("min-w-0")
    expect(diff?.className).toContain("max-w-full")
    expect(diff?.className).toContain("overflow-x-auto")
  })

  it("places selection actions in the workbench action row", async () => {
    await renderWorkbench(roots)

    const selectionBar = document.querySelector('[data-git-changes-selection-bar="true"]')
    const actionBar = document.querySelector('[data-git-workbench-action-bar="true"]')
    const tabsHeader = document.querySelector('[data-git-workbench-tabs-header="true"]')
    const commitPanel = document.querySelector('[data-git-changes-commit-panel="true"]')

    expect(selectionBar?.textContent).toContain("已选 1 / 1")
    expect(selectionBar?.textContent).toContain("全选")
    expect(selectionBar?.textContent).toContain("全不选")
    expect(actionBar?.contains(selectionBar)).toBe(true)
    expect(findButton("提交改动")).toBeTruthy()
    expect(tabsHeader?.contains(selectionBar)).toBe(false)
    expect(commitPanel).toBeNull()
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
          filesTruncated: false,
          diffTruncated: false,
          truncated: false,
        },
        loading: false,
        detailLoading: false,
        error: null,
        hasLoaded: true,
        hasMore: false,
        loadingMore: false,
        refresh: vi.fn(async () => undefined),
        loadMore: vi.fn(async () => undefined),
        loadCommit: vi.fn(async () => undefined),
      }}
    />)
    const container = document.createElement("div")
    container.innerHTML = html

    expect(container.querySelector('[data-git-history-file-list="true"]')).toBeNull()
    expect(container.querySelector("pre")?.textContent).toBe("没有文本差异。")
  })

  it("keeps commit handoff on remaining local changes", async () => {
    const current = gitSnapshot({
      changes: [{ path: "docs/a.md", originalPath: null, status: "modified", staged: false, conflicted: false }],
    })
    const status = createStatus({
      refresh: vi.fn()
        .mockResolvedValueOnce(current)
        .mockResolvedValueOnce(gitSnapshot({
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
    const current = gitSnapshot({
      changes: [{ path: "docs/a.md", originalPath: null, status: "modified", staged: false, conflicted: false }],
    })
    const status = createStatus({
      refresh: vi.fn()
        .mockResolvedValueOnce(current)
        .mockResolvedValueOnce(gitSnapshot({ changes: [], ahead: 1, behind: 0 })),
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

  it("requires reconfirmation when selected files change before commit", async () => {
    const status = createStatus({
      refresh: vi.fn(async () => gitSnapshot({
        changes: [{ path: "docs/a.md", originalPath: null, status: "deleted", staged: false, conflicted: false }],
      })),
    })

    await renderChangesTab(roots, status)
    await changeTextarea("提交说明", "更新文档")
    await click(findButton("提交选中文件"))

    expect(bridge.git.commit).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain("所选文件已发生变化")
  })
})

function gitSnapshot(overrides: Partial<SynapseGitRepositorySnapshot> = {}): SynapseGitRepositorySnapshot {
  return {
    repositoryId: "repo-1",
    pathExists: true,
    isGitRepository: true,
    currentBranch: "main",
    upstream: "origin/main",
    trackingStatus: "tracked",
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
    diff: { path: "docs/a.md", originalPath: null, binary: false, truncated: false, text: "+hello" },
    selectedPaths: ["docs/a.md"],
    loading: false,
    diffLoading: false,
    error: null,
    refresh: vi.fn(async () => gitSnapshot({
      changes: [{ path: "docs/a.md", originalPath: null, status: "modified", staged: false, conflicted: false }],
    })),
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
  onBack = vi.fn(),
): Promise<void> {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(<GitWorkbench repository={targetRepository} onBack={onBack} />)
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
    root.render(
      <GitChangesTab
        repository={repository}
        status={status}
        onPush={vi.fn()}
        commitDialogOpen
        onCommitDialogOpenChange={vi.fn()}
      />,
    )
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

function findButtonByLabel(label: string): HTMLElement {
  const button = document.querySelector<HTMLElement>(`button[aria-label="${label}"]`)
  if (!button) throw new Error(`Button not found by aria-label: ${label}`)
  return button
}

function findDialog(): HTMLElement {
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')
  if (!dialog) throw new Error("Dialog not found")
  return dialog
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

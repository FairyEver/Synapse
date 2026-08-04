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

HTMLElement.prototype.scrollIntoView = vi.fn()
HTMLElement.prototype.hasPointerCapture = vi.fn(() => false)
HTMLElement.prototype.setPointerCapture = vi.fn()
HTMLElement.prototype.releasePointerCapture = vi.fn()

const repository = { id: "repo-1", name: "Docs", localPath: "/repo", addedAt: "now", lastOpenedAt: null }
const bridge = vi.hoisted(() => ({
  git: {
    getSnapshot: vi.fn(),
    getDiff: vi.fn(),
    prepareChangeSelection: vi.fn(),
    discardChanges: vi.fn(),
    commit: vi.fn(),
    inspectInitialization: vi.fn(),
    initializeRepository: vi.fn(),
    listPushTargets: vi.fn(),
    listBranches: vi.fn(),
    listRemoteBranches: vi.fn(),
    fetchRemoteBranches: vi.fn(),
    checkoutRemoteBranch: vi.fn(),
    cancelOperation: vi.fn(),
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
      repositoryOperationState: "normal",
      hasConflicts: false,
      changeCount: 1,
      changesTruncated: false,
      changes: [{ path: "docs/a.md", originalPath: null, status: "modified", indexStatus: "unchanged", worktreeStatus: "modified" }],
    })
    bridge.git.getDiff.mockResolvedValue({ path: "docs/a.md", originalPath: null, binary: false, truncated: false, text: "+hello" })
    bridge.git.prepareChangeSelection.mockResolvedValue({
      selectionId: "selection-1",
      repositoryId: "repo-1",
      expiresAt: "2026-06-17T10:15:00.000Z",
      changes: [{ path: "docs/a.md", originalPath: null, status: "modified", indexStatus: "unchanged", worktreeStatus: "modified" }],
    })
    bridge.git.discardChanges.mockResolvedValue({
      completedAt: "now",
      discardedCount: 1,
      restoredPaths: ["docs/a.md"],
      trashedPaths: [],
    })
    bridge.git.listBranches.mockResolvedValue([{ name: "main", current: true }, { name: "docs", current: false }])
    bridge.git.listRemoteBranches.mockResolvedValue([])
    bridge.git.fetchRemoteBranches.mockResolvedValue(undefined)
    bridge.git.checkoutRemoteBranch.mockResolvedValue({
      created: true,
      localBranchName: "topic",
      remoteBranchName: "origin/topic",
    })
    bridge.git.cancelOperation.mockResolvedValue(true)
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
      files: [{ path: "docs/a.md", originalPath: null, status: "modified" }],
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
      selectionId: "selection-1",
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
      repositoryOperationState: "normal",
      hasConflicts: false,
      changeCount: 1,
      changesTruncated: false,
      changes: [{
        path: "docs/new-name.md",
        originalPath: "docs/old-name.md",
        status: "renamed",
        indexStatus: "renamed",
        worktreeStatus: "unchanged",
      }],
    })
    bridge.git.getDiff.mockResolvedValueOnce({
      path: "docs/new-name.md",
      originalPath: "docs/old-name.md",
      binary: false,
      text: "+renamed",
    })
    bridge.git.prepareChangeSelection.mockResolvedValueOnce({
      selectionId: "rename-selection",
      repositoryId: "repo-1",
      expiresAt: "2026-06-17T10:15:00.000Z",
      changes: [{
        path: "docs/new-name.md",
        originalPath: "docs/old-name.md",
        status: "renamed",
        indexStatus: "renamed",
        worktreeStatus: "unchanged",
      }],
    })
    await renderWorkbench(roots)

    await click(findButton("提交改动"))
    await changeTextarea("提交说明", "重命名文档")
    await click(findButton("提交选中文件"))

    expect(bridge.git.commit).toHaveBeenCalledWith({
      repositoryId: "repo-1",
      message: "重命名文档",
      selectionId: "rename-selection",
    })
  })

  it("requires strong confirmation before discarding selected changes", async () => {
    await renderWorkbench(roots)

    await click(findButton("丢弃改动"))
    const dialog = findAlertDialog()
    expect(dialog.textContent).toContain("丢弃 1 个改动？")
    expect(dialog.textContent).toContain("docs/a.md")
    expect(dialog.textContent).toContain("系统废纸篓")
    expect(bridge.git.discardChanges).not.toHaveBeenCalled()

    const confirm = [...dialog.querySelectorAll<HTMLElement>("button")]
      .find((button) => button.textContent?.trim() === "丢弃改动")
    expect(confirm).toBeTruthy()
    const snapshotCallsBeforeDiscard = bridge.git.getSnapshot.mock.calls.length
    await click(confirm!)

    expect(bridge.git.discardChanges).toHaveBeenCalledWith({
      repositoryId: "repo-1",
      selectionId: "selection-1",
    })
    expect(bridge.git.getSnapshot.mock.calls.length).toBeGreaterThan(snapshotCallsBeforeDiscard)
    expect(document.querySelector('[role="alertdialog"]')).toBeNull()
  })

  it("keeps discard errors visible and requires external conflict handling", async () => {
    bridge.git.prepareChangeSelection.mockRejectedValueOnce(new Error("冲突文件需要在外部处理后再继续。"))
    await renderWorkbench(roots)

    await click(findButton("丢弃改动"))

    const dialog = findAlertDialog()
    expect(dialog.textContent).toContain("冲突文件需要在外部处理")
    const confirm = [...dialog.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.trim() === "丢弃改动")
    expect(confirm?.disabled).toBe(true)
    expect(bridge.git.discardChanges).not.toHaveBeenCalled()
  })

  it("keeps a failed discard confirmation open with its error", async () => {
    bridge.git.discardChanges.mockRejectedValueOnce(new Error("无法移入系统废纸篓；Synapse 不会永久删除该文件。"))
    await renderWorkbench(roots)
    await click(findButton("丢弃改动"))
    const dialog = findAlertDialog()
    const confirm = [...dialog.querySelectorAll<HTMLElement>("button")]
      .find((button) => button.textContent?.trim() === "丢弃改动")
    expect(confirm).toBeTruthy()

    await click(confirm!)

    expect(findAlertDialog().textContent).toContain("不会永久删除")
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
        indexStatus: "unchanged" as const,
        worktreeStatus: "modified" as const,
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

  it("loads cached remote branches and refreshes them only on explicit request", async () => {
    bridge.git.listRemoteBranches
      .mockResolvedValueOnce([{
        remoteName: "origin",
        branches: [{ name: "topic", fullName: "origin/topic" }],
      }])
      .mockResolvedValueOnce([{
        remoteName: "origin",
        branches: [{ name: "topic", fullName: "origin/topic" }, { name: "release", fullName: "origin/release" }],
      }])

    await renderWorkbench(roots)

    expect(bridge.git.listRemoteBranches).toHaveBeenCalledWith("repo-1")
    expect(bridge.git.fetchRemoteBranches).not.toHaveBeenCalled()

    await click(findButton("获取远程分支"))

    expect(bridge.git.fetchRemoteBranches).toHaveBeenCalledWith("repo-1", expect.any(String))
    expect(bridge.git.listRemoteBranches).toHaveBeenCalledTimes(3)
  })

  it("cancels an in-flight remote branch fetch by operation id", async () => {
    const pendingFetch = deferred<void>()
    bridge.git.fetchRemoteBranches.mockReturnValueOnce(pendingFetch.promise)
    await renderWorkbench(roots)

    await click(findButton("获取远程分支"))
    const operationId = bridge.git.fetchRemoteBranches.mock.calls[0]?.[1]
    expect(operationId).toEqual(expect.any(String))

    await click(findButton("取消获取"))
    expect(bridge.git.cancelOperation).toHaveBeenCalledWith(operationId)

    pendingFetch.resolve()
    await act(async () => {
      await pendingFetch.promise
      await flush()
    })
  })

  it("checks out a cached remote branch with an editable local name and keeps errors visible", async () => {
    bridge.git.listRemoteBranches.mockResolvedValue([{
      remoteName: "upstream",
      branches: [{ name: "docs/topic", fullName: "upstream/docs/topic" }],
    }])
    bridge.git.checkoutRemoteBranch.mockRejectedValueOnce(
      new Error("同名本地分支未跟踪该远程分支，请填写其他本地名称。"),
    )
    await renderWorkbench(roots)

    await click(findButtonByLabel("分支"))
    const remoteOption = [...document.body.querySelectorAll<HTMLElement>('[role="option"]')]
      .find((option) => option.textContent?.trim() === "docs/topic")
    expect(remoteOption).toBeTruthy()
    await click(remoteOption!)

    expect(findDialog().textContent).toContain("检出远程分支")
    await changeInput("本地分支名称", "local/docs-topic")
    await click(findButton("检出"))

    expect(bridge.git.checkoutRemoteBranch).toHaveBeenCalledWith("repo-1", {
      remoteName: "upstream",
      branchName: "docs/topic",
      localBranchName: "local/docs-topic",
    })
    expect(findDialog().textContent).toContain("同名本地分支未跟踪该远程分支")
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
        hasCommits: true,
        upstream: "origin/main",
        trackingStatus: "tracked",
        ahead: 0,
        behind: 0,
        repositoryOperationState: "normal",
        hasConflicts: false,
        changeCount: 0,
        changesTruncated: false,
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

  it("shows an explicit notice when only part of a large worktree is visible", async () => {
    const status = createStatus({
      snapshot: gitSnapshot({
        changeCount: 10_001,
        changesTruncated: true,
        changes: [{ path: "docs/a.md", originalPath: null, status: "modified", indexStatus: "unchanged", worktreeStatus: "modified" }],
      }),
    })

    await renderChangesTab(roots, status)

    expect(document.body.textContent).toContain("仅展示前 10,000 项，共 10001 项。")
  })

  it("renders worktree changes as single-line rows with status letters and truncated paths", () => {
    const longPath = "docs/agents/rules/a-very-long-file-name-that-must-fit-the-sidebar.md"
    const status = createStatus({
      snapshot: gitSnapshot({
        changes: [{ path: longPath, originalPath: null, status: "untracked", indexStatus: "unchanged", worktreeStatus: "untracked" }],
      }),
    })
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

    const row = container.querySelector('[role="button"]')
    const indicator = row?.querySelector('[data-slot="tooltip-trigger"]')
    const path = Array.from(row?.querySelectorAll("span") ?? [])
      .find((element) => element.textContent === longPath)

    expect(row?.className).toContain("grid-cols-[auto_auto_minmax(0,1fr)]")
    expect(row?.className).toContain("py-1.5")
    expect(indicator?.textContent).toBe("U")
    expect(indicator?.getAttribute("aria-label")).toBe("未跟踪")
    expect(indicator?.className).toContain("text-chart-2")
    expect(path?.className).toContain("min-w-0")
    expect(path?.className).toContain("truncate")
    expect(path?.className).toContain("font-normal")
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
          files: [{ path: longPath, originalPath: null, status: "modified" }],
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
          hasCommits: true,
          upstream: "origin/main",
          trackingStatus: "tracked",
        ahead: 0,
        behind: 0,
        repositoryOperationState: "normal",
        hasConflicts: false,
        changeCount: 1,
        changesTruncated: false,
      changes: [{ path: longPath, originalPath: null, status: "modified", indexStatus: "unchanged", worktreeStatus: "modified" }],
      },
      selectedFile: { path: longPath, originalPath: null, status: "modified", indexStatus: "unchanged", worktreeStatus: "modified" },
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
    const status = createStatus({
      refresh: vi.fn()
        .mockResolvedValueOnce(gitSnapshot({
        ahead: 1,
        changes: [{ path: "docs/b.md", originalPath: null, status: "modified", indexStatus: "unchanged", worktreeStatus: "modified" }],
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
      refresh: vi.fn()
        .mockResolvedValueOnce(gitSnapshot({ changes: [], ahead: 1, behind: 0 })),
    })

    await renderChangesTab(roots, status)
    await changeTextarea("提交说明", "更新文档")
    await click(findButton("提交选中文件"))

    expect(document.body.textContent).toContain("可以推送本地提交。")
    expect(findButton("推送")).toBeTruthy()
  })

  it("routes a repository without commits to the initialization flow", async () => {
    const onInitialize = vi.fn()
    bridge.git.getSnapshot.mockResolvedValue(gitSnapshot({
      hasCommits: false,
      upstream: null,
      trackingStatus: "untracked",
      ahead: 0,
      changes: [],
    }))

    await renderWorkbench(roots, repository, vi.fn(), onInitialize)
    await click(findButton("初始化并推送"))

    expect(onInitialize).toHaveBeenCalledWith(repository, expect.any(Function))
  })

  it("blocks commits while conflicts are present", async () => {
    const status = createStatus({
      snapshot: gitSnapshot({
        hasConflicts: true,
        changes: [{ path: "docs/conflict.md", originalPath: null, status: "conflicted", indexStatus: "unmerged", worktreeStatus: "unmerged" }],
      }),
      selectedFile: { path: "docs/conflict.md", originalPath: null, status: "conflicted", indexStatus: "unmerged", worktreeStatus: "unmerged" },
      selectedPaths: ["docs/conflict.md"],
    })

    await renderChangesTab(roots, status)
    await changeTextarea("提交说明", "处理冲突")

    expect(document.body.textContent).toContain("发生冲突")
    expect(findButton("提交选中文件").hasAttribute("disabled")).toBe(true)
  })

  it("keeps worktree mutations disabled while an external Git operation is in progress", async () => {
    const status = createStatus({
      snapshot: gitSnapshot({
        repositoryOperationState: "merge",
        changes: [{ path: "docs/a.md", originalPath: null, status: "modified", indexStatus: "unchanged", worktreeStatus: "modified" }],
      }),
    })

    await renderChangesTab(roots, status)
    await changeTextarea("提交说明", "更新文档")

    expect(document.body.textContent).toContain("仓库正在进行合并")
    expect(document.body.textContent).toContain("外部 Git 工具")
    expect(findButton("提交选中文件").hasAttribute("disabled")).toBe(true)
    expect(bridge.git.prepareChangeSelection).not.toHaveBeenCalled()
  })

  it("requires reconfirmation when selected files change before commit", async () => {
    bridge.git.commit.mockRejectedValueOnce(new Error("所选文件已发生变化，请重新审阅后再提交。"))
    const status = createStatus()

    await renderChangesTab(roots, status)
    await changeTextarea("提交说明", "更新文档")
    await click(findButton("提交选中文件"))

    expect(bridge.git.commit).toHaveBeenCalledWith(expect.objectContaining({ selectionId: "selection-1" }))
    expect(document.body.textContent).toContain("所选文件已发生变化")
  })
})

function gitSnapshot(overrides: Partial<SynapseGitRepositorySnapshot> = {}): SynapseGitRepositorySnapshot {
  const changes = overrides.changes ?? []
  const {
    changeCount = changes.length,
    changesTruncated = false,
    ...snapshotOverrides
  } = overrides
  return {
    repositoryId: "repo-1",
    pathExists: true,
    isGitRepository: true,
    currentBranch: "main",
    hasCommits: true,
    upstream: "origin/main",
    trackingStatus: "tracked",
    ahead: 0,
    behind: 0,
    repositoryOperationState: "normal",
    hasConflicts: false,
    changes: [],
    ...snapshotOverrides,
    changeCount,
    changesTruncated,
  }
}

function createStatus(overrides: Partial<ReturnType<typeof useGitWorktreeStatus>> = {}): ReturnType<typeof useGitWorktreeStatus> {
  return {
    snapshot: gitSnapshot({
      changes: [{ path: "docs/a.md", originalPath: null, status: "modified", indexStatus: "unchanged", worktreeStatus: "modified" }],
    }),
    selectedFile: { path: "docs/a.md", originalPath: null, status: "modified", indexStatus: "unchanged", worktreeStatus: "modified" },
    diff: { path: "docs/a.md", originalPath: null, binary: false, truncated: false, text: "+hello" },
    selectedPaths: ["docs/a.md"],
    loading: false,
    diffLoading: false,
    error: null,
    refresh: vi.fn(async () => gitSnapshot({
      changes: [{ path: "docs/a.md", originalPath: null, status: "modified", indexStatus: "unchanged", worktreeStatus: "modified" }],
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
  onInitialize = vi.fn(),
): Promise<void> {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(<GitWorkbench repository={targetRepository} onBack={onBack} onInitialize={onInitialize} />)
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

async function changeInput(label: string, value: string): Promise<void> {
  const labelElement = Array.from(document.querySelectorAll("label"))
    .find((item) => item.textContent === label)
  const id = labelElement?.getAttribute("for")
  const input = id ? document.getElementById(id) : null
  if (!(input instanceof HTMLInputElement)) throw new Error(`Missing input: ${label}`)
  await act(async () => {
    const descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")
    descriptor?.set?.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
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

function findAlertDialog(): HTMLElement {
  const dialog = document.querySelector<HTMLElement>('[role="alertdialog"]')
  if (!dialog) throw new Error("Alert dialog not found")
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

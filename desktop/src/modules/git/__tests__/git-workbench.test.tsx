/**
 * @vitest-environment jsdom
 */
import { act, Profiler, useState } from "react"
import { createRoot, type Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { GitChangesTab } from "../components/git-changes-tab"
import { GitDiffViewer } from "../components/git-diff-viewer-adapter"
import { GitHistoryTab } from "../components/git-history-tab"
import { GitWorkbench } from "../components/git-workbench"
import type { useGitWorktreeStatus } from "../hooks/use-git-worktree-status"
import type { SynapseGitCommitDetail, SynapseGitRepositorySnapshot } from "@/types/git"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

HTMLElement.prototype.scrollIntoView = vi.fn()
HTMLElement.prototype.hasPointerCapture = vi.fn(() => false)
HTMLElement.prototype.setPointerCapture = vi.fn()
HTMLElement.prototype.releasePointerCapture = vi.fn()
Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
  configurable: true,
  value: vi.fn(() => ({
    font: "",
    measureText: (value: string) => ({ width: value.length * 7 }),
  })),
})

const repository = { id: "repo-1", name: "Docs", localPath: "/repo", addedAt: "now", lastOpenedAt: null }
const defaultDiffViewProps = {
  diffViewMode: "unified" as const,
  diffWrap: false,
  onDiffViewModeChange: vi.fn(),
  onDiffWrapChange: vi.fn(),
}
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
    document.documentElement.classList.remove("dark")
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
    bridge.git.getDiff.mockResolvedValue({
      path: "docs/a.md",
      originalPath: null,
      binary: false,
      truncated: false,
      text: "diff --git a/docs/a.md b/docs/a.md\n--- a/docs/a.md\n+++ b/docs/a.md\n@@ -0,0 +1 @@\n+hello\n",
    })
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
      diff: "diff --git a/docs/a.md b/docs/a.md\n--- a/docs/a.md\n+++ b/docs/a.md\n@@ -0,0 +1 @@\n+hello\n",
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
    expect(document.body.textContent).toContain("hello")

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

  it("returns focus to the commit action after cancelling confirmation", async () => {
    await renderWorkbench(roots)
    const commitButton = findButton("提交改动")

    await click(commitButton)
    const cancelButton = [...findDialog().querySelectorAll<HTMLElement>("button")]
      .find((button) => button.textContent?.trim() === "取消")
    expect(cancelButton).toBeTruthy()

    await click(cancelButton!)

    expect(document.activeElement).toBe(commitButton)
    expect(bridge.git.commit).not.toHaveBeenCalled()
  })

  it("shows a neutral loading state before the first repository snapshot", async () => {
    bridge.git.getSnapshot.mockImplementation(() => new Promise(() => {}))

    await renderWorkbench(roots)

    expect(document.body.textContent).toContain("正在读取")
    expect(document.body.textContent).not.toContain("目录不可访问")
    expect(document.body.textContent).not.toContain("无分支")
    expect(findButton("读取中").hasAttribute("disabled")).toBe(true)
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

  it("returns focus to the discard action after cancelling confirmation", async () => {
    await renderWorkbench(roots)
    const discardButton = findButton("丢弃改动")

    await click(discardButton)
    const cancelButton = [...findAlertDialog().querySelectorAll<HTMLElement>("button")]
      .find((button) => button.textContent?.trim() === "取消")
    expect(cancelButton).toBeTruthy()

    await click(cancelButton!)

    expect(document.activeElement).toBe(discardButton)
    expect(bridge.git.discardChanges).not.toHaveBeenCalled()
  })

  it("returns focus to the persistent action after discarding the last change", async () => {
    bridge.git.getSnapshot
      .mockResolvedValueOnce(gitSnapshot({
        changes: [{ path: "docs/a.md", originalPath: null, status: "modified", indexStatus: "unchanged", worktreeStatus: "modified" }],
      }))
      .mockResolvedValue(gitSnapshot())
    await renderWorkbench(roots)
    const persistentAction = findButtonByLabel("刷新仓库状态")

    await click(findButton("丢弃改动"))
    const confirm = [...findAlertDialog().querySelectorAll<HTMLElement>("button")]
      .find((button) => button.textContent?.trim() === "丢弃改动")
    expect(confirm).toBeTruthy()
    await click(confirm!)

    expect(document.body.textContent).toContain("暂无改动")
    expect(document.activeElement).toBe(persistentAction)
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
    expect(document.body.textContent).toContain("hello")
  })

  it("switches diff layout, wrapping, and theme", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    function ViewerHarness() {
      const [mode, setMode] = useState<"unified" | "split">("unified")
      const [wrap, setWrap] = useState(false)
      return (
        <GitDiffViewer
          path="docs/a.md"
          statusLabel="修改"
          text={createPatch("docs/a.md", "hello")}
          mode={mode}
          wrap={wrap}
          onModeChange={setMode}
          onWrapChange={setWrap}
        />
      )
    }

    await act(async () => {
      root.render(<ViewerHarness />)
      await flush()
    })

    expect(findButtonByLabel("统一视图").getAttribute("data-state")).toBe("on")
    expect(findButtonByLabel("统一视图").getAttribute("aria-checked")).toBe("true")
    expect(findButtonByLabel("分栏视图").getAttribute("aria-checked")).toBe("false")
    expect(findButtonByLabel("自动换行").getAttribute("data-state")).toBe("off")
    expect(findButtonByLabel("自动换行").getAttribute("aria-pressed")).toBe("false")
    expect(document.querySelector('[data-component="git-diff-view"]')?.getAttribute("data-mode")).toBe("unified")

    await click(findButtonByLabel("分栏视图"))
    await click(findButtonByLabel("自动换行"))
    expect(findButtonByLabel("分栏视图").getAttribute("data-state")).toBe("on")
    expect(findButtonByLabel("统一视图").getAttribute("aria-checked")).toBe("false")
    expect(findButtonByLabel("分栏视图").getAttribute("aria-checked")).toBe("true")
    expect(findButtonByLabel("自动换行").getAttribute("data-state")).toBe("on")
    expect(findButtonByLabel("自动换行").getAttribute("aria-pressed")).toBe("true")
    expect(document.querySelector('[data-component="git-diff-view"]')?.getAttribute("data-mode")).toBe("split")

    await act(async () => {
      document.documentElement.classList.add("dark")
      await flush()
    })
    expect(document.querySelector('[data-component="git-diff-view"]')).toBeTruthy()
  })

  it("uses shrinkable code tracks when automatic wrapping is enabled", () => {
    const unified = renderToStaticMarkup(
      <GitDiffViewer
        path="docs/long-line.md"
        text={createPatch("docs/long-line.md", "x".repeat(400))}
        mode="unified"
        wrap
        onModeChange={vi.fn()}
        onWrapChange={vi.fn()}
      />,
    )
    const split = renderToStaticMarkup(
      <GitDiffViewer
        path="docs/long-line.md"
        text={createPatch("docs/long-line.md", "x".repeat(400))}
        mode="split"
        wrap
        onModeChange={vi.fn()}
        onWrapChange={vi.fn()}
      />,
    )

    expect(unified).toContain("grid-cols-[3.25rem_3.25rem_minmax(0,1fr)]")
    expect(split).toContain("grid-cols-[3.25rem_minmax(0,1fr)]")
  })

  it("uses semantic colors for added and deleted lines", () => {
    const patch = [
      "diff --git a/docs/a.md b/docs/a.md",
      "--- a/docs/a.md",
      "+++ b/docs/a.md",
      "@@ -1,2 +1,2 @@",
      " context",
      "-old line",
      "+new line",
      "",
    ].join("\n")
    const html = renderToStaticMarkup(
      <GitDiffViewer
        path="docs/a.md"
        text={patch}
        mode="unified"
        wrap
        onModeChange={vi.fn()}
        onWrapChange={vi.fn()}
      />,
    )
    const container = document.createElement("div")
    container.innerHTML = html
    const rows = Array.from(container.querySelectorAll<HTMLElement>('[role="row"]'))
    const context = rows.find((row) => row.textContent?.includes("context"))
    const deletion = rows.find((row) => row.textContent?.includes("-old line"))
    const addition = rows.find((row) => row.textContent?.includes("+new line"))

    expect(context?.className).toContain("bg-background")
    expect(deletion?.className).toContain("bg-destructive/10")
    expect(addition?.className).toContain("bg-emerald-500/10")
    expect(addition?.className).toContain("dark:bg-emerald-400/15")

    const splitHtml = renderToStaticMarkup(
      <GitDiffViewer
        path="docs/a.md"
        text={patch}
        mode="split"
        wrap
        onModeChange={vi.fn()}
        onWrapChange={vi.fn()}
      />,
    )
    expect(splitHtml).toContain("bg-destructive/20")
    expect(splitHtml).toContain("bg-emerald-500/20")
  })

  it("keeps split line numbers aligned through uneven blocks and no-newline markers", () => {
    const patch = [
      "diff --git a/docs/a.md b/docs/a.md",
      "--- a/docs/a.md",
      "+++ b/docs/a.md",
      "@@ -7,3 +11,2 @@",
      " same",
      "-old one",
      "-old two",
      "+new one",
      "\\ No newline at end of file",
      "",
    ].join("\n")
    const html = renderToStaticMarkup(
      <GitDiffViewer
        path="docs/a.md"
        text={patch}
        mode="split"
        wrap={false}
        onModeChange={vi.fn()}
        onWrapChange={vi.fn()}
      />,
    )
    const container = document.createElement("div")
    container.innerHTML = html
    const rows = Array.from(container.querySelectorAll('[role="row"]'))
    const changed = rows.find((row) => row.textContent?.includes("old one") && row.textContent.includes("new one"))
    const deletionOnly = rows.find((row) => row.textContent?.includes("old two"))
    const noNewline = rows.find((row) => row.textContent?.includes("No newline at end of file"))

    expect(changed?.textContent).toContain("8-old one12+new one")
    expect(deletionOnly?.textContent).toContain("9-old two")
    expect(noNewline?.querySelectorAll('[role="cell"]')).toHaveLength(2)
    expect(noNewline?.textContent).not.toMatch(/^\d/)
  })

  it("normalizes CRLF patches without rendering carriage-return characters", () => {
    const patch = createPatch("docs/windows.md", "windows line").replaceAll("\n", "\r\n")
    const html = renderToStaticMarkup(
      <GitDiffViewer
        path="docs/windows.md"
        text={patch}
        mode="unified"
        wrap
        onModeChange={vi.fn()}
        onWrapChange={vi.fn()}
      />,
    )

    expect(html).not.toContain("\r")
    expect(html).toContain("windows line")
  })

  it("shares diff layout and wrapping between changes and history", async () => {
    await renderWorkbench(roots)

    await click(findButtonByLabel("分栏视图"))
    await click(findButtonByLabel("自动换行"))
    await click(findButton("历史"))
    await click(findButton("更新文档"))

    expect(findButtonByLabel("分栏视图").getAttribute("data-state")).toBe("on")
    expect(findButtonByLabel("自动换行").getAttribute("data-state")).toBe("on")
  })

  it("switches history files and resets to the first file for a new commit", async () => {
    const firstCommit = createCommitDetail({
      hash: "first",
      files: [
        { path: "docs/a.md", originalPath: null, status: "modified" },
        { path: "docs/b.md", originalPath: null, status: "modified" },
      ],
      diff: createPatch("docs/a.md", "first") + createPatch("docs/b.md", "second"),
    })
    const nextCommit = createCommitDetail({
      hash: "next",
      files: [
        { path: "docs/c.md", originalPath: null, status: "modified" },
        { path: "docs/d.md", originalPath: null, status: "modified" },
      ],
      diff: createPatch("docs/c.md", "third") + createPatch("docs/d.md", "fourth"),
    })
    let showNextCommit: (() => void) | undefined
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    function HistoryHarness() {
      const [selectedCommit, setSelectedCommit] = useState(firstCommit)
      showNextCommit = () => setSelectedCommit(nextCommit)
      return (
        <GitHistoryTab
          {...defaultDiffViewProps}
          history={{
            commits: [],
            selectedCommit,
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
        />
      )
    }

    await act(async () => {
      root.render(<HistoryHarness />)
      await flush()
    })
    expect(diffViewerText()).toContain("docs/a.md")

    await click(findButton("docs/b.md"))
    expect(diffViewerText()).toContain("docs/b.md")

    await act(async () => {
      showNextCommit?.()
      await flush()
    })
    expect(diffViewerText()).toContain("docs/c.md")
    expect(findButton("docs/c.md").getAttribute("data-active")).toBe("true")
  })

  it("never commits a stale history file while switching commits", async () => {
    const firstCommit = createCommitDetail({
      hash: "first",
      files: [
        { path: "docs/a.md", originalPath: null, status: "modified" },
        { path: "docs/b.md", originalPath: null, status: "modified" },
      ],
      diff: createPatch("docs/a.md", "first") + createPatch("docs/b.md", "second"),
    })
    const nextCommit = createCommitDetail({
      hash: "next",
      files: [
        { path: "docs/c.md", originalPath: null, status: "modified" },
        { path: "docs/d.md", originalPath: null, status: "modified" },
      ],
      diff: createPatch("docs/c.md", "third") + createPatch("docs/d.md", "fourth"),
    })
    const committedDiffs: string[] = []
    let showNextCommit: (() => void) | undefined
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    function HistoryHarness() {
      const [selectedCommit, setSelectedCommit] = useState(firstCommit)
      showNextCommit = () => setSelectedCommit(nextCommit)
      return (
        <Profiler id="history-diff" onRender={() => committedDiffs.push(diffViewerText())}>
          <GitHistoryTab
            {...defaultDiffViewProps}
            history={{
              commits: [],
              selectedCommit,
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
          />
        </Profiler>
      )
    }

    await act(async () => {
      root.render(<HistoryHarness />)
      await flush()
    })
    await click(findButton("docs/b.md"))
    committedDiffs.length = 0

    await act(async () => {
      showNextCommit?.()
      await flush()
    })

    expect(committedDiffs.some((text) => text.includes("docs/d.md"))).toBe(false)
    expect(diffViewerText()).toContain("docs/c.md")
  })

  it("falls back to copyable raw text when history patches cannot be mapped safely", () => {
    const html = renderToStaticMarkup(
      <GitHistoryTab
        {...defaultDiffViewProps}
        history={{
          commits: [],
          selectedCommit: createCommitDetail({
            files: [
              { path: "docs/a.md", originalPath: null, status: "modified" },
              { path: "docs/b.md", originalPath: null, status: "modified" },
            ],
            diff: createPatch("docs/a.md", "first"),
          }),
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
      />,
    )
    const container = document.createElement("div")
    container.innerHTML = html

    expect(container.textContent).toContain("无法格式化差异")
    expect(container.querySelector("pre")?.getAttribute("data-allow-select")).toBe("true")
    expect(container.querySelector('[data-component="git-diff-view"]')).toBeNull()
  })

  it("retains truncated and binary diff states", () => {
    const html = renderToStaticMarkup(
      <GitDiffViewer
        path="assets/logo.png"
        statusLabel="修改"
        text="GIT binary patch\nliteral 0\n"
        binary
        truncated
        mode={defaultDiffViewProps.diffViewMode}
        wrap={defaultDiffViewProps.diffWrap}
        onModeChange={defaultDiffViewProps.onDiffViewModeChange}
        onWrapChange={defaultDiffViewProps.onDiffWrapChange}
      />,
    )

    expect(html).toContain("差异内容已截断")
    expect(html).toContain("二进制文件已变更")
  })

  it("keeps empty and pure-deletion fallback states understandable", () => {
    const empty = renderToStaticMarkup(
      <GitDiffViewer
        path="docs/empty.md"
        text=""
        mode="unified"
        wrap
        onModeChange={vi.fn()}
        onWrapChange={vi.fn()}
      />,
    )
    const deleted = renderToStaticMarkup(
      <GitDiffViewer
        path="docs/deleted.md"
        statusLabel="删除"
        text={[
          "diff --git a/docs/deleted.md b/docs/deleted.md",
          "deleted file mode 100644",
          "--- a/docs/deleted.md",
          "+++ /dev/null",
          "@@ -1 +0,0 @@",
          "-removed",
          "",
        ].join("\n")}
        mode="unified"
        wrap
        onModeChange={vi.fn()}
        onWrapChange={vi.fn()}
      />,
    )

    expect(empty).toContain("没有文本差异")
    expect(deleted).toContain("删除")
    expect(deleted).toContain("+++ /dev/null")
    expect(deleted).toContain("-removed")
  })

  it("shows worktree diff failures instead of the unselected empty state", () => {
    const html = renderToStaticMarkup(
      <GitChangesTab
        {...defaultDiffViewProps}
        repository={repository}
        status={createStatus({
          selectedFile: {
            path: "docs/a.md",
            originalPath: null,
            status: "modified",
            indexStatus: "unchanged",
            worktreeStatus: "modified",
          },
          diff: null,
          error: "读取文件差异失败。",
        })}
        commitDialogOpen={false}
        onCommitDialogOpenChange={vi.fn()}
      />,
    )

    expect(html).toContain("读取文件差异失败。")
    expect(html).not.toContain("选择文件查看差异")
  })

  it("uses a native file-preview button without nesting the selection checkbox", () => {
    const html = renderToStaticMarkup(
      <GitChangesTab
        {...defaultDiffViewProps}
        repository={repository}
        status={createStatus()}
        commitDialogOpen={false}
        onCommitDialogOpenChange={vi.fn()}
      />,
    )
    const container = document.createElement("div")
    container.innerHTML = html
    const path = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("docs/a.md"))

    expect(path).toBeTruthy()
    expect(path?.querySelector('[role="checkbox"]')).toBeNull()
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

  it("keeps focus in the branch name field after creating a branch fails", async () => {
    bridge.git.createBranch.mockRejectedValueOnce(new Error("请先提交本地改动。"))
    await renderWorkbench(roots)

    await click(findButton("新建分支"))
    await changeInput("分支名称", "bad..name")
    const createButton = findButton("创建")
    createButton.focus()
    await click(createButton)

    const branchNameInput = document.querySelector<HTMLInputElement>("#git-create-branch-name")
    expect(findDialog().textContent).toContain("请先提交本地改动。")
    expect(document.activeElement).toBe(branchNameInput)
  })

  it("returns focus to the new branch action after cancelling", async () => {
    await renderWorkbench(roots)
    const newBranchButton = findButton("新建分支")

    await click(newBranchButton)
    const cancelButton = [...findDialog().querySelectorAll<HTMLElement>("button")]
      .find((button) => button.textContent?.trim() === "取消")
    expect(cancelButton).toBeTruthy()
    cancelButton!.focus()
    await click(cancelButton!)

    expect(document.activeElement).toBe(newBranchButton)
  })

  it("returns focus to the branch selector after switching branches", async () => {
    bridge.git.checkoutBranch.mockResolvedValueOnce(undefined)
    await renderWorkbench(roots)
    const branchSelector = findButtonByLabel("分支")

    await click(branchSelector)
    const docsOption = [...document.body.querySelectorAll<HTMLElement>('[role="option"]')]
      .find((option) => option.textContent?.trim() === "docs")
    expect(docsOption).toBeTruthy()
    await click(docsOption!)

    expect(bridge.git.checkoutBranch).toHaveBeenCalledWith("repo-1", "docs")
    expect(document.activeElement).toBe(branchSelector)
  })

  it("returns focus to the branch selector after switching branches fails", async () => {
    bridge.git.checkoutBranch.mockRejectedValueOnce(new Error("请先提交本地改动。"))
    await renderWorkbench(roots)
    const branchSelector = findButtonByLabel("分支")

    await click(branchSelector)
    const docsOption = [...document.body.querySelectorAll<HTMLElement>('[role="option"]')]
      .find((option) => option.textContent?.trim() === "docs")
    expect(docsOption).toBeTruthy()
    await click(docsOption!)

    expect(document.body.textContent).toContain("请先提交本地改动。")
    expect(document.activeElement).toBe(branchSelector)
  })

  it("keeps remote fetch available during an external Git operation", async () => {
    bridge.git.getSnapshot.mockResolvedValueOnce({
      ...(await bridge.git.getSnapshot()),
      repositoryOperationState: "merge",
    })

    await renderWorkbench(roots)

    expect(findButton("获取远程分支").hasAttribute("disabled")).toBe(false)
    await click(findButton("获取远程分支"))
    expect(bridge.git.fetchRemoteBranches).toHaveBeenCalled()
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
        {...defaultDiffViewProps}
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
        {...defaultDiffViewProps}
        repository={repository}
        status={status}
        commitDialogOpen={false}
        onCommitDialogOpenChange={vi.fn()}
      />,
    )
    const container = document.createElement("div")
    container.innerHTML = html

    const previewButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes(longPath))
    const row = previewButton?.parentElement
    const indicator = previewButton?.querySelector('[data-slot="tooltip-trigger"]')
    const path = Array.from(previewButton?.querySelectorAll("span") ?? [])
      .find((element) => element.textContent === longPath)

    expect(row?.className).toContain("grid-cols-[auto_minmax(0,1fr)]")
    expect(previewButton?.className).toContain("py-1.5")
    expect(indicator?.textContent).toBe("U")
    expect(indicator?.getAttribute("aria-label")).toBe("未跟踪")
    expect(indicator?.className).toContain("text-chart-2")
    expect(path?.className).toContain("min-w-0")
    expect(path?.className).toContain("truncate")
    expect(path?.className).toContain("font-normal")
  })

  it("uses shared empty states for empty history panes", () => {
    const html = renderToStaticMarkup(<GitHistoryTab
      {...defaultDiffViewProps}
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
      {...defaultDiffViewProps}
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
    const diff = container.querySelector('[data-component="git-diff-view"]')
    const diffScroller = diff?.closest('[data-scrollbars="horizontal"]')

    expect(root?.className).toContain("min-w-0")
    expect(rightPane?.className).toContain("min-w-0")
    expect(rightViewport?.className).toContain("overflow-x-hidden")
    expect(rightViewport?.className).toContain("[&>div]:!block")
    expect(rightViewport?.className).toContain("[&>div]:!max-w-full")
    expect(detailContent?.className).toContain("min-w-0")
    expect(fileList?.className).toContain("max-w-full")
    expect(diff).toBeTruthy()
    expect(diffScroller?.className).toContain("min-w-0")
    expect(diffScroller?.getAttribute("data-scrollbars")).toBe("horizontal")
    expect(diffScroller?.getAttribute("data-allow-select")).toBe("true")
  })

  it("keeps large history file lists independently scrollable", () => {
    const files = Array.from({ length: 161 }, (_, index) => ({
      path: `docs/history/file-${String(index + 1).padStart(3, "0")}.md`,
      originalPath: null,
      status: "modified" as const,
    }))
    const html = renderToStaticMarkup(<GitHistoryTab
      {...defaultDiffViewProps}
      history={{
        commits: [],
        selectedCommit: {
          hash: "large-commit",
          shortHash: "large",
          subject: "large history commit",
          authorName: "wangl",
          authorEmail: "wangl@example.com",
          committedAt: "2026-06-15T16:21:42+08:00",
          files,
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

    const fileList = container.querySelector('[data-git-history-file-list="true"]')

    expect(fileList?.querySelector(".divide-y")?.children).toHaveLength(161)
    expect(fileList?.className).toContain("max-h-80")
    expect(fileList?.getAttribute("data-scrollbars")).toBe("vertical")
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
        {...defaultDiffViewProps}
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
    const diff = container.querySelector('[data-component="git-diff-view"]')
    const diffScroller = diff?.closest('[data-scrollbars="horizontal"]')

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
    expect(diff).toBeTruthy()
    expect(diffScroller?.className).toContain("min-w-0")
    expect(diffScroller?.getAttribute("data-scrollbars")).toBe("horizontal")
    expect(diffScroller?.getAttribute("data-allow-select")).toBe("true")
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
      {...defaultDiffViewProps}
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

  it("clears the previous commit result when reopening confirmation", async () => {
    const status = createStatus({
      refresh: vi.fn().mockResolvedValue(gitSnapshot({ changes: [], ahead: 1, behind: 0 })),
    })
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)
    const render = async (commitDialogOpen: boolean) => {
      await act(async () => {
        root.render(
          <GitChangesTab
            {...defaultDiffViewProps}
            repository={repository}
            status={status}
            onPush={vi.fn()}
            commitDialogOpen={commitDialogOpen}
            onCommitDialogOpenChange={vi.fn()}
          />,
        )
        await flush()
      })
    }

    await render(true)
    await changeTextarea("提交说明", "更新文档")
    await click(findButton("提交选中文件"))
    expect(document.body.textContent).toContain("可以推送本地提交。")

    await render(false)
    await render(true)

    expect(document.body.textContent).not.toContain("可以推送本地提交。")
    expect(findButton("提交选中文件")).toBeTruthy()
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

  it("keeps empty repository history in the empty state without requesting Git history", async () => {
    bridge.git.getSnapshot.mockResolvedValue(gitSnapshot({
      hasCommits: false,
      upstream: null,
      trackingStatus: "untracked",
      ahead: 0,
      changes: [],
    }))
    bridge.git.listHistory.mockRejectedValue(new Error("fatal: branch has no commits"))

    await renderWorkbench(roots)
    await click(findButton("历史"))

    expect(document.body.textContent).toContain("暂无提交")
    expect(document.body.textContent).not.toContain("读取失败")
    expect(document.body.textContent).not.toContain("fatal: branch has no commits")
    expect(bridge.git.listHistory).not.toHaveBeenCalled()
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
    diff: { path: "docs/a.md", originalPath: null, binary: false, truncated: false, text: createPatch("docs/a.md", "hello") },
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
        {...defaultDiffViewProps}
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

function createPatch(path: string, addedLine: string): string {
  return `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -0,0 +1 @@\n+${addedLine}\n`
}

function createCommitDetail(overrides: Partial<SynapseGitCommitDetail> = {}): SynapseGitCommitDetail {
  return {
    hash: "abc",
    shortHash: "abc123",
    subject: "更新文档",
    authorName: "张三",
    authorEmail: "zhang@example.com",
    committedAt: "2026-06-17T10:00:00+08:00",
    files: [{ path: "docs/a.md", originalPath: null, status: "modified" }],
    diff: createPatch("docs/a.md", "hello"),
    filesTruncated: false,
    diffTruncated: false,
    truncated: false,
    ...overrides,
  }
}

function diffViewerText(): string {
  const diff = document.querySelector('[data-component="git-diff-view"]')
  const viewer = diff?.parentElement?.parentElement
  if (!viewer) throw new Error("Diff viewer not found")
  return viewer.textContent ?? ""
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

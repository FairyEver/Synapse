/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { SynapseProjectConfig } from "@/types/config"
import type { SynapseGitRepository } from "@/types/git"
import { DEFAULT_AGENT_WORKSPACE_PROJECT } from "@/lib/default-agent-workspace"
import {
  findProjectGitRepository,
  formatSynapseCommitMessage,
  useProjectGitActions,
} from "../use-project-git-actions"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const toast = vi.hoisted(() => Object.assign(vi.fn(), {
  error: vi.fn(),
  success: vi.fn(),
}))

const bridge = vi.hoisted(() => ({
  apps: {
    openSystemApp: vi.fn(),
  },
  git: {
    listRepositories: vi.fn(),
    getSnapshot: vi.fn(),
    prepareChangeSelection: vi.fn(),
    commit: vi.fn(),
    pull: vi.fn(),
    push: vi.fn(),
    sync: vi.fn(),
    cancelOperation: vi.fn(),
  },
}))

vi.mock("sonner", () => ({ toast }))
vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }),
}))
vi.mock("@/lib/electron-bridge", () => ({
  requireSynapseBridge: () => bridge,
}))
vi.mock("@/lib/runtime-platform", () => ({
  getRendererPlatform: () => "darwin",
}))

const project: SynapseProjectConfig = {
  id: "project-1",
  name: "Docs",
  path: "/work/docs",
}
const repository: SynapseGitRepository = {
  id: "repository-1",
  name: "Docs",
  localPath: "/work/docs",
  addedAt: "2026-08-04T00:00:00.000Z",
  lastOpenedAt: null,
}

let roots: Root[] = []
let current: ReturnType<typeof useProjectGitActions> | null = null

function Harness({ value }: { readonly value?: SynapseProjectConfig }) {
  current = useProjectGitActions(value)
  return null
}

beforeEach(() => {
  vi.clearAllMocks()
  bridge.git.listRepositories.mockResolvedValue([repository])
  bridge.git.getSnapshot.mockResolvedValue({
    repositoryId: repository.id,
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
    changeCount: 2,
    changesTruncated: false,
    changes: [change("a.md"), change("b.md")],
  })
  bridge.git.prepareChangeSelection.mockResolvedValue({
    selectionId: "selection-1",
    repositoryId: repository.id,
    expiresAt: "2026-08-04T01:00:00.000Z",
    changes: [change("a.md"), change("b.md")],
  })
  bridge.git.commit.mockResolvedValue({ completedAt: "now", message: "已提交。" })
  bridge.git.push.mockResolvedValue({ completedAt: "now", message: "已推送。" })
})

afterEach(() => {
  for (const root of roots) {
    act(() => root.unmount())
  }
  roots = []
  current = null
})

describe("useProjectGitActions", () => {
  it("matches exact project paths with platform normalization", () => {
    expect(findProjectGitRepository(project, [repository])?.id).toBe(repository.id)
    expect(findProjectGitRepository(
      { ...project, path: "C:\\WORK\\DOCS\\" },
      [{ ...repository, localPath: "c:/work/docs" }],
      "win32",
    )?.id).toBe(repository.id)
    expect(findProjectGitRepository({ ...project, path: "/work/docs/subdir" }, [repository])).toBeNull()
    expect(findProjectGitRepository(DEFAULT_AGENT_WORKSPACE_PROJECT, [
      { ...repository, localPath: DEFAULT_AGENT_WORKSPACE_PROJECT.path },
    ])).toBeNull()
    expect(formatSynapseCommitMessage(1)).toBe("Update 1 file via Synapse")
    expect(formatSynapseCommitMessage(2)).toBe("Update 2 files via Synapse")
  })

  it("refreshes matching after focus and hides a repository removed from Git", async () => {
    await renderHarness(project)
    expect(current?.repository?.id).toBe(repository.id)

    bridge.git.listRepositories.mockResolvedValue([])
    await act(async () => {
      window.dispatchEvent(new Event("focus"))
      await Promise.resolve()
    })

    expect(current?.repository).toBeNull()
  })

  it("prepares all visible changes and commits before pushing", async () => {
    await renderHarness(project)

    await act(async () => {
      await current?.prepareCommit("commit-and-push")
    })
    expect(current?.pendingCommit).toMatchObject({
      action: "commit-and-push",
      changeCount: 2,
      message: "Update 2 files via Synapse",
      selectionId: "selection-1",
    })
    expect(bridge.git.prepareChangeSelection).toHaveBeenCalledWith({
      repositoryId: repository.id,
      paths: ["a.md", "b.md"],
    })

    await act(async () => {
      await current?.confirmCommit()
    })
    expect(bridge.git.commit).toHaveBeenCalledTimes(1)
    expect(bridge.git.push).toHaveBeenCalledTimes(1)
    expect(bridge.git.commit.mock.invocationCallOrder[0]).toBeLessThan(
      bridge.git.push.mock.invocationCallOrder[0]!,
    )
    expect(current?.pendingCommit).toBeNull()
  })

  it("does not repeat the commit when the following push fails", async () => {
    bridge.git.push.mockRejectedValue(new Error("请选择推送远端。"))
    await renderHarness(project)
    await act(async () => {
      await current?.prepareCommit("commit-and-push")
    })
    await act(async () => {
      await current?.confirmCommit()
    })

    expect(bridge.git.commit).toHaveBeenCalledTimes(1)
    expect(bridge.git.push).toHaveBeenCalledTimes(1)
    expect(current?.pendingCommit).toBeNull()
    expect(toast.error).toHaveBeenCalledWith("已提交，推送失败", expect.any(Object))
  })

  it("keeps the committed-state warning when the following push is cancelled", async () => {
    const cancelled = new Error("操作已取消。")
    cancelled.name = "GitOperationCancelledError"
    bridge.git.push.mockRejectedValue(cancelled)
    await renderHarness(project)
    await act(async () => {
      await current?.prepareCommit("commit-and-push")
    })
    await act(async () => {
      await current?.confirmCommit()
    })

    expect(bridge.git.commit).toHaveBeenCalledTimes(1)
    expect(current?.pendingCommit).toBeNull()
    expect(toast.error).toHaveBeenCalledWith("已提交，推送失败", expect.objectContaining({
      description: "推送已取消。",
    }))
  })

  it("refuses truncated snapshots instead of claiming to commit all changes", async () => {
    bridge.git.getSnapshot.mockResolvedValue({
      ...(await bridge.git.getSnapshot()),
      changeCount: 10_001,
      changesTruncated: true,
    })
    await renderHarness(project)

    await act(async () => {
      await current?.prepareCommit("commit")
    })

    expect(bridge.git.prepareChangeSelection).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith("无法准备提交", expect.objectContaining({
      description: "改动超过 10,000 项，请在 Git 应用中处理。",
    }))
  })
})

async function renderHarness(value?: SynapseProjectConfig): Promise<void> {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => {
    root.render(<Harness value={value} />)
    await Promise.resolve()
  })
}

function change(path: string) {
  return {
    path,
    originalPath: null,
    status: "modified" as const,
    indexStatus: "unchanged" as const,
    worktreeStatus: "modified" as const,
  }
}

/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type {
  SynapseGitDiffResult,
  SynapseGitFileChange,
  SynapseGitRepository,
  SynapseGitRepositorySnapshot,
} from "@/types/git"
import { useGitWorktreeStatus } from "../use-git-worktree-status"

const bridge = vi.hoisted(() => ({
  git: {
    getDiff: vi.fn(),
    getSnapshot: vi.fn(),
  },
}))

vi.mock("@/lib/electron-bridge", () => ({
  requireSynapseBridge: () => bridge,
}))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type Deferred<T> = {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
  readonly reject: (error: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

const repository: SynapseGitRepository = {
  id: "repo-1",
  name: "Repo",
  localPath: "/repo",
  addedAt: "2026-01-01T00:00:00.000Z",
  lastOpenedAt: null,
}

function emptySnapshot(): SynapseGitRepositorySnapshot {
  return {
    repositoryId: repository.id,
    pathExists: true,
    isGitRepository: true,
    currentBranch: "main",
    upstream: null,
    trackingStatus: "untracked",
    ahead: 0,
    behind: 0,
    hasConflicts: false,
    changes: [],
  }
}

function fileChange(path: string): SynapseGitFileChange {
  return {
    path,
    originalPath: null,
    status: "modified",
    staged: false,
    conflicted: false,
  }
}

function diffForPath(path: string): SynapseGitDiffResult {
  return {
    path,
    originalPath: null,
    binary: false,
    truncated: false,
    text: `diff for ${path}`,
  }
}

function HookHarness({
  onStatus,
}: {
  readonly onStatus: (status: ReturnType<typeof useGitWorktreeStatus>) => void
}) {
  const status = useGitWorktreeStatus(repository)
  onStatus(status)
  return null
}

describe("useGitWorktreeStatus", () => {
  let roots: Root[]

  beforeEach(() => {
    roots = []
    bridge.git.getSnapshot.mockResolvedValue(emptySnapshot())
  })

  afterEach(() => {
    for (const root of roots) {
      act(() => {
        root.unmount()
      })
    }
    roots = []
    vi.clearAllMocks()
    document.body.innerHTML = ""
  })

  it("ignores stale diff responses after a newer file is selected", async () => {
    const slowDiff = deferred<SynapseGitDiffResult>()
    const fastDiff = deferred<SynapseGitDiffResult>()
    bridge.git.getDiff.mockImplementation(({ path }: { path: string }) => (
      path === "docs/a.md" ? slowDiff.promise : fastDiff.promise
    ))
    const statuses: Array<ReturnType<typeof useGitWorktreeStatus>> = []
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<HookHarness onStatus={(status) => statuses.push(status)} />)
    })

    let firstLoad!: Promise<void>
    await act(async () => {
      firstLoad = statuses.at(-1)!.loadDiff(fileChange("docs/a.md"))
    })
    let secondLoad!: Promise<void>
    await act(async () => {
      secondLoad = statuses.at(-1)!.loadDiff(fileChange("docs/b.md"))
    })

    fastDiff.resolve(diffForPath("docs/b.md"))
    await act(async () => {
      await secondLoad
    })
    expect(statuses.at(-1)!.selectedFile?.path).toBe("docs/b.md")
    expect(statuses.at(-1)!.diff?.path).toBe("docs/b.md")

    slowDiff.resolve(diffForPath("docs/a.md"))
    await act(async () => {
      await firstLoad
    })

    expect(statuses.at(-1)!.selectedFile?.path).toBe("docs/b.md")
    expect(statuses.at(-1)!.diff?.path).toBe("docs/b.md")
  })
})

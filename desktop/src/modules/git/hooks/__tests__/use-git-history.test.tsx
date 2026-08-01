/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { SynapseGitCommitDetail, SynapseGitRepository } from "@/types/git"
import { useGitHistory } from "../use-git-history"

const bridge = vi.hoisted(() => ({
  git: {
    getCommit: vi.fn(),
    listHistory: vi.fn(),
  },
}))

vi.mock("@/lib/electron-bridge", () => ({
  requireSynapseBridge: () => bridge,
}))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const repository: SynapseGitRepository = {
  id: "repo-1",
  name: "Repo",
  localPath: "/repo",
  addedAt: "2026-01-01T00:00:00.000Z",
  lastOpenedAt: null,
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })
  return { promise, resolve }
}

function detail(hash: string): SynapseGitCommitDetail {
  return {
    hash,
    shortHash: hash,
    subject: hash,
    authorName: "User",
    authorEmail: "user@example.com",
    committedAt: "2026-07-31T00:00:00.000Z",
    files: [],
    diff: "",
    filesTruncated: false,
    diffTruncated: false,
    truncated: false,
  }
}

function HookHarness({ onStatus }: {
  readonly onStatus: (status: ReturnType<typeof useGitHistory>) => void
}) {
  onStatus(useGitHistory(repository, { enabled: false }))
  return null
}

describe("useGitHistory", () => {
  let root: Root
  let statuses: Array<ReturnType<typeof useGitHistory>>

  beforeEach(() => {
    statuses = []
    const container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    vi.clearAllMocks()
    document.body.innerHTML = ""
  })

  it("ignores an older commit detail response after a newer selection", async () => {
    const slow = deferred<SynapseGitCommitDetail>()
    const fast = deferred<SynapseGitCommitDetail>()
    bridge.git.getCommit.mockImplementation((_repositoryId: string, hash: string) => (
      hash === "old" ? slow.promise : fast.promise
    ))

    await act(async () => {
      root.render(<HookHarness onStatus={(status) => statuses.push(status)} />)
    })

    let slowRequest!: Promise<void>
    let fastRequest!: Promise<void>
    await act(async () => {
      slowRequest = statuses.at(-1)!.loadCommit("old")
      fastRequest = statuses.at(-1)!.loadCommit("new")
    })
    await act(async () => {
      fast.resolve(detail("new"))
      await fastRequest
    })
    await act(async () => {
      slow.resolve(detail("old"))
      await slowRequest
    })

    expect(statuses.at(-1)!.selectedCommit?.hash).toBe("new")
    expect(statuses.at(-1)!.detailLoading).toBe(false)
  })
})

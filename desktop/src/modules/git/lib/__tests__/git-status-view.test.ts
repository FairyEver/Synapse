import { describe, expect, it } from "vitest"
import type { SynapseGitRepositorySnapshot } from "@/types/git"
import { getGitActionPlan, needsGitAttention } from "../git-status-view"

const snapshot: SynapseGitRepositorySnapshot = {
  repositoryId: "repo-1",
  pathExists: true,
  isGitRepository: true,
  currentBranch: "feature",
  upstream: null,
  trackingStatus: "untracked",
  ahead: 0,
  behind: 0,
  hasConflicts: false,
  changes: [],
}

describe("Git status view", () => {
  it("does not report an untracked branch as synchronized", () => {
    expect(getGitActionPlan(snapshot)).toMatchObject({
      statusText: "未设置上游",
      primaryAction: "push",
      primaryLabel: "首次推送",
    })
    expect(needsGitAttention(snapshot)).toBe(true)
  })

  it("does not offer push while HEAD is detached", () => {
    expect(getGitActionPlan({ ...snapshot, currentBranch: null, trackingStatus: "detached" })).toMatchObject({
      statusText: "游离 HEAD",
      primaryAction: "open",
    })
  })

  it("opens the workbench instead of syncing a diverged branch", () => {
    expect(getGitActionPlan({
      ...snapshot,
      upstream: "origin/feature",
      trackingStatus: "tracked",
      ahead: 2,
      behind: 1,
    })).toMatchObject({
      statusText: "分支已分叉",
      primaryAction: "open",
      primaryLabel: "处理分叉",
      blockerText: "本地分支与上游分支已分叉",
    })
  })

  it("opens the workbench when the upstream branch no longer exists", () => {
    expect(getGitActionPlan({
      ...snapshot,
      upstream: "origin/feature",
      trackingStatus: "gone",
    })).toMatchObject({
      statusText: "上游分支不存在",
      primaryAction: "open",
      primaryLabel: "处理上游",
      blockerText: "上游分支不存在",
    })
  })
})

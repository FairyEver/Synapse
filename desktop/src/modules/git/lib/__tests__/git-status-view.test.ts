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
})

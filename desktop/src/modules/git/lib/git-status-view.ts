import type { SynapseGitRepositorySnapshot } from "@/types/git"

export type GitRecommendedAction = "open" | "pull" | "push" | "sync" | "none"

export type GitActionPlan = {
  readonly statusText: string
  readonly primaryAction: GitRecommendedAction
  readonly primaryLabel: string
  readonly blockerText: string | null
  readonly recoveryText: string | null
}

export function getGitChangeCount(snapshot: SynapseGitRepositorySnapshot | null): number {
  return snapshot?.changeCount ?? 0
}

export function getGitActionPlan(snapshot: SynapseGitRepositorySnapshot | null, error: string | null = null): GitActionPlan {
  if (error) {
    return {
      statusText: "状态读取失败",
      primaryAction: "open",
      primaryLabel: "查看状态",
      blockerText: "状态读取失败",
      recoveryText: "进入仓库查看详情后重试。",
    }
  }

  if (!snapshot?.pathExists) {
    return {
      statusText: "目录不可访问",
      primaryAction: "open",
      primaryLabel: "查看状态",
      blockerText: "目录不可访问",
      recoveryText: "检查目录后重试。",
    }
  }

  if (!snapshot.isGitRepository) {
    return {
      statusText: "不是 Git 仓库",
      primaryAction: "open",
      primaryLabel: "查看状态",
      blockerText: "不是 Git 仓库",
      recoveryText: "选择正确的 Git 仓库目录。",
    }
  }

  if (snapshot.repositoryOperationState !== "normal") {
    const operationLabel = {
      merge: "合并",
      rebase: "rebase",
      "cherry-pick": "cherry-pick",
      revert: "revert",
      bisect: "bisect",
      unknown: "Git 操作",
    }[snapshot.repositoryOperationState]
    return {
      statusText: snapshot.repositoryOperationState === "unknown" ? "状态待确认" : `正在${operationLabel}`,
      primaryAction: "none",
      primaryLabel: "暂不可操作",
      blockerText: snapshot.repositoryOperationState === "unknown" ? "无法确认仓库操作状态" : `仓库正在进行${operationLabel}`,
      recoveryText: "请在外部 Git 工具中完成或中止后刷新。",
    }
  }

  if (snapshot.hasConflicts) {
    return {
      statusText: "有冲突",
      primaryAction: "open",
      primaryLabel: "查看状态",
      blockerText: "发生冲突",
      recoveryText: "处理冲突后再同步。",
    }
  }

  if (snapshot.trackingStatus === "detached") {
    return {
      statusText: "游离 HEAD",
      primaryAction: "open",
      primaryLabel: "查看状态",
      blockerText: "当前未在本地分支上",
      recoveryText: "切换到本地分支后再同步。",
    }
  }

  const changeCount = getGitChangeCount(snapshot)
  if (changeCount > 0) {
    return {
      statusText: `${changeCount} 个改动`,
      primaryAction: "open",
      primaryLabel: "提交改动",
      blockerText: "有未提交改动",
      recoveryText: "选择文件并提交。",
    }
  }

  if (snapshot.trackingStatus === "gone") {
    return {
      statusText: "上游分支不存在",
      primaryAction: "open",
      primaryLabel: "处理上游",
      blockerText: "上游分支不存在",
      recoveryText: "重新推送当前分支，或使用外部 Git 工具调整上游。",
    }
  }

  if (snapshot.ahead > 0 && snapshot.behind > 0) {
    return {
      statusText: "分支已分叉",
      primaryAction: "open",
      primaryLabel: "处理分叉",
      blockerText: "本地分支与上游分支已分叉",
      recoveryText: "使用外部 Git 工具合并或变基后再同步。",
    }
  }

  if (snapshot.trackingStatus === "untracked") {
    return {
      statusText: "未设置上游",
      primaryAction: "push",
      primaryLabel: "首次推送",
      blockerText: null,
      recoveryText: "选择远端并设置上游分支。",
    }
  }

  if (snapshot.behind > 0) {
    return {
      statusText: `↓${snapshot.behind}`,
      primaryAction: "pull",
      primaryLabel: "拉取远程更新",
      blockerText: null,
      recoveryText: "把远程更新拉到本地。",
    }
  }

  if (snapshot.ahead > 0) {
    return {
      statusText: `↑${snapshot.ahead}`,
      primaryAction: "push",
      primaryLabel: "推送本地提交",
      blockerText: null,
      recoveryText: "把本地提交推送到远端。",
    }
  }

  return {
    statusText: "已同步",
    primaryAction: "none",
    primaryLabel: "已同步",
    blockerText: null,
    recoveryText: null,
  }
}

export function getGitStatusText(snapshot: SynapseGitRepositorySnapshot | null, error: string | null = null): string {
  return getGitActionPlan(snapshot, error).statusText
}

export function getGitRecommendedAction(snapshot: SynapseGitRepositorySnapshot | null, error: string | null = null): GitRecommendedAction {
  return getGitActionPlan(snapshot, error).primaryAction
}

export function needsGitAttention(snapshot: SynapseGitRepositorySnapshot | null, error: string | null = null): boolean {
  return Boolean(
    error
      || !snapshot?.pathExists
      || !snapshot.isGitRepository
      || snapshot.hasConflicts
      || snapshot.repositoryOperationState !== "normal"
      || snapshot.trackingStatus !== "tracked"
      || snapshot.changeCount > 0
      || snapshot.ahead > 0
      || snapshot.behind > 0,
  )
}

export function isGitUnavailable(snapshot: SynapseGitRepositorySnapshot | null, error: string | null = null): boolean {
  return Boolean(error || !snapshot?.pathExists || !snapshot.isGitRepository)
}

export function getGitErrorAdvice(message: string): string {
  if (/请先提交本地改动|working tree|local changes|uncommitted/i.test(message)) return "先提交改动后再同步。"
  if (/auth|authentication|permission denied|credential|403|401|认证/i.test(message)) return "检查账号、凭据或仓库地址。"
  if (/network|timeout|timed out|could not resolve|failed to connect|网络/i.test(message)) return "检查网络后重试。"
  if (/non-fast-forward|fetch first|rejected|先拉取/i.test(message)) return "先拉取远程更新。"
  if (/conflict|冲突/i.test(message)) return "处理冲突后再继续。"
  return "查看状态后重试。"
}

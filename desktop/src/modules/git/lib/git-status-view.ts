import type { SynapseGitRepositorySnapshot } from "@/types/git"

export type GitRecommendedAction = "open" | "pull" | "push" | "sync" | "none"

export function getGitChangeCount(snapshot: SynapseGitRepositorySnapshot | null): number {
  return snapshot?.changes.length ?? 0
}

export function getGitStatusText(snapshot: SynapseGitRepositorySnapshot | null, error: string | null = null): string {
  if (error) return "状态读取失败"
  if (!snapshot?.pathExists) return "目录不可访问"
  if (!snapshot.isGitRepository) return "不是 Git 仓库"
  if (snapshot.hasConflicts) return "有冲突"
  const changeCount = getGitChangeCount(snapshot)
  if (changeCount > 0) return `${changeCount} 个改动`
  if (snapshot.ahead > 0 && snapshot.behind > 0) return `↑${snapshot.ahead} ↓${snapshot.behind}`
  if (snapshot.behind > 0) return `↓${snapshot.behind}`
  if (snapshot.ahead > 0) return `↑${snapshot.ahead}`
  return "已同步"
}

export function getGitRecommendedAction(snapshot: SynapseGitRepositorySnapshot | null, error: string | null = null): GitRecommendedAction {
  if (error || !snapshot?.pathExists || !snapshot.isGitRepository) return "open"
  if (snapshot.hasConflicts || snapshot.changes.length > 0) return "open"
  if (snapshot.ahead > 0 && snapshot.behind > 0) return "sync"
  if (snapshot.behind > 0) return "pull"
  if (snapshot.ahead > 0) return "push"
  return "none"
}

export function needsGitAttention(snapshot: SynapseGitRepositorySnapshot | null, error: string | null = null): boolean {
  return Boolean(
    error
      || !snapshot?.pathExists
      || !snapshot.isGitRepository
      || snapshot.hasConflicts
      || snapshot.changes.length > 0
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

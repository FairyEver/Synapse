import type {
  SynapseGitFailureCategory,
  SynapseGitFailurePrimaryAction,
  SynapseGitUserFacingFailure,
} from "@/types/git"

const ACTION_LABELS: Readonly<Record<NonNullable<SynapseGitFailurePrimaryAction>, string>> = {
  "install-git": "安装 Git",
  "set-identity": "配置身份",
  "login-host": "登录访问",
  "handle-github-auth": "处理 GitHub 访问",
  "handle-ssh": "处理 SSH",
  "configure-credential-helper": "配置凭据助手",
  retry: "重试",
  "choose-directory": "选择目录",
  "open-workbench": "进入仓库",
  "copy-diagnostics": "复制诊断",
}

const CATEGORY_ACTION_LABELS: Partial<Record<SynapseGitFailureCategory, string>> = {
  "git-missing": ACTION_LABELS["install-git"],
  "missing-identity": ACTION_LABELS["set-identity"],
  "https-auth": ACTION_LABELS["login-host"],
  "github-auth": ACTION_LABELS["handle-github-auth"],
  "ssh-auth": ACTION_LABELS["handle-ssh"],
  "credential-helper-missing": ACTION_LABELS["configure-credential-helper"],
  path: ACTION_LABELS["choose-directory"],
  dirty: ACTION_LABELS["open-workbench"],
  conflict: ACTION_LABELS["open-workbench"],
  "non-fast-forward": ACTION_LABELS["open-workbench"],
  timeout: ACTION_LABELS.retry,
  network: ACTION_LABELS.retry,
}

const ACCESS_FAILURE_CATEGORIES = new Set<SynapseGitFailureCategory>([
  "https-auth",
  "github-auth",
  "ssh-auth",
  "credential-helper-missing",
])

const ACCESS_FAILURE_ACTIONS = new Set<SynapseGitFailurePrimaryAction>([
  "login-host",
  "handle-github-auth",
  "handle-ssh",
  "configure-credential-helper",
])

export function getGitFailureActionLabel(failure: SynapseGitUserFacingFailure | null | undefined): string | null {
  if (!failure) return null
  if (failure.primaryAction) return ACTION_LABELS[failure.primaryAction] ?? null
  return CATEGORY_ACTION_LABELS[failure.category] ?? null
}

export function shouldRouteFailureToAccess(failure: SynapseGitUserFacingFailure | null | undefined): boolean {
  if (!failure) return false
  return ACCESS_FAILURE_CATEGORIES.has(failure.category) || ACCESS_FAILURE_ACTIONS.has(failure.primaryAction)
}

export function canHandleGitFailureAction(failure: SynapseGitUserFacingFailure | null | undefined): boolean {
  if (!failure) return false
  if (failure.primaryAction === "retry") {
    return failure.category === "network" || failure.category === "timeout"
  }
  return failure.category === "git-missing"
    || failure.primaryAction === "install-git"
    || failure.category === "missing-identity"
    || failure.primaryAction === "set-identity"
    || shouldRouteFailureToAccess(failure)
}

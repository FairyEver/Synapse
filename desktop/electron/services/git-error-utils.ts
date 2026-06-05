import type {
  SynapseRepositorySyncFailureCategory,
  SynapseRepositorySyncPrimaryAction,
} from "../../src/types/repository"

export type GitFailureInfo = {
  category: SynapseRepositorySyncFailureCategory
  message: string
  detail?: string
  recoverable: boolean
  primaryAction: SynapseRepositorySyncPrimaryAction
}

function firstUsefulLine(output: string): string | undefined {
  return output
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0)
}

export function isNonFastForwardError(output: string): boolean {
  const loweredOutput = output.toLowerCase()

  return (
    loweredOutput.includes("not possible to fast-forward")
    || loweredOutput.includes("non-fast-forward")
    || loweredOutput.includes("[rejected]")
    || loweredOutput.includes("fetch first")
    || loweredOutput.includes("tip of your current branch is behind")
  )
}

export function classifyGitFailure(output: string, fallbackMessage: string): GitFailureInfo {
  const normalizedOutput = output.trim()
  const loweredOutput = normalizedOutput.toLowerCase()
  const detail = firstUsefulLine(normalizedOutput)

  if (
    loweredOutput.includes("could not resolve host")
    || loweredOutput.includes("failed to connect")
    || loweredOutput.includes("network is unreachable")
    || loweredOutput.includes("connection reset")
  ) {
    return {
      category: "network",
      message: "网络不可用，稍后自动重试。",
      detail,
      recoverable: true,
      primaryAction: "retry",
    }
  }

  if (loweredOutput.includes("connection timed out") || loweredOutput.includes("operation timed out")) {
    return {
      category: "timeout",
      message: "同步超时，稍后自动重试。",
      detail,
      recoverable: true,
      primaryAction: "retry",
    }
  }

  if (
    loweredOutput.includes("authentication failed")
    || loweredOutput.includes("could not read username")
    || loweredOutput.includes("permission denied (publickey)")
    || loweredOutput.includes("permission denied")
    || loweredOutput.includes("access denied")
    || loweredOutput.includes("fatal: could not read from remote repository")
  ) {
    return {
      category: "auth",
      message: "Git 认证失败，请检查系统凭证或 SSH Key。",
      detail,
      recoverable: false,
      primaryAction: "resolve-git",
    }
  }

  if (
    loweredOutput.includes("repository not found")
    || loweredOutput.includes("not found")
    || loweredOutput.includes("no such remote")
  ) {
    return {
      category: "upstream-missing",
      message: "当前仓库没有可用的远程配置，或当前账号没有访问权限。",
      detail,
      recoverable: false,
      primaryAction: "resolve-git",
    }
  }

  if (
    loweredOutput.includes("there is no tracking information for the current branch")
    || loweredOutput.includes("no upstream configured for branch")
    || loweredOutput.includes("has no upstream branch")
  ) {
    return {
      category: "upstream-missing",
      message: "当前分支还没有配置上游分支。",
      detail,
      recoverable: false,
      primaryAction: "resolve-git",
    }
  }

  if (
    isNonFastForwardError(loweredOutput)
    || loweredOutput.includes("merge conflict")
    || loweredOutput.includes("could not apply")
  ) {
    return {
      category: "diverged",
      message: "仓库分支需要手动处理后再同步。",
      detail,
      recoverable: false,
      primaryAction: "resolve-git",
    }
  }

  if (loweredOutput.includes("not a git repository")) {
    return {
      category: "not-git",
      message: "当前目录不是 Git 仓库。",
      detail,
      recoverable: false,
      primaryAction: "open-settings",
    }
  }

  if (
    loweredOutput.includes("paths are ignored by one of your .gitignore files")
    || loweredOutput.includes("the following paths are ignored")
  ) {
    return {
      category: "ignored-paths",
      message: "内容目录被 .gitignore 忽略，请调整仓库规则。",
      detail,
      recoverable: false,
      primaryAction: "resolve-git",
    }
  }

  if (loweredOutput.includes("nothing to commit") || loweredOutput.includes("no changes added to commit")) {
    return {
      category: "no-changes",
      message: "当前没有可提交的改动。",
      detail,
      recoverable: false,
      primaryAction: null,
    }
  }

  return {
    category: "unknown",
    message: detail ? `${fallbackMessage}\n${detail}` : fallbackMessage,
    detail,
    recoverable: false,
    primaryAction: null,
  }
}

export function formatGitFailureMessage(output: string, fallbackMessage: string): string {
  return classifyGitFailure(output, fallbackMessage).message
}

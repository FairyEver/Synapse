import type {
  SynapseGitFailureCategory,
  SynapseGitFailurePrimaryAction,
  SynapseGitProtocol,
  SynapseGitUserFacingFailure,
} from "../../../src/types/git"
import { sanitizeRemoteUrl } from "./git-logging"
import { sanitizeGitDiagnosticText } from "./git-sanitize"

type CreateGitUserFacingFailureOptions = {
  readonly fallbackMessage: string
  readonly remoteUrl?: string | null
}

type GitRemoteInfo = {
  readonly host: string | null
  readonly port: number | null
  readonly protocol: SynapseGitProtocol
}

type FailureCopy = {
  readonly message: string
  readonly title: string
}

const HTTPS_URL_PATTERN = /https?:\/\/[^\s"'<>]+/i
const SSH_URL_PATTERN = /ssh:\/\/[^\s"'<>]+/i
const SCP_LIKE_REMOTE_PATTERN = /(?:^|[\s"'])([A-Za-z0-9._-]+@([A-Za-z0-9.-]+):[^\s"']+)/i
const FAILURE_COPY: Readonly<Record<SynapseGitFailureCategory, FailureCopy>> = {
  "git-missing": {
    message: "请先安装 Git，然后重试。",
    title: "未检测到 Git",
  },
  "missing-identity": {
    message: "请设置 Git 用户名和邮箱后重试。",
    title: "缺少 Git 身份",
  },
  "https-auth": {
    message: "需要登录后重试。",
    title: "认证失败",
  },
  "github-auth": {
    message: "请登录 GitHub 后重试。",
    title: "GitHub 需要登录",
  },
  "ssh-auth": {
    message: "请检查 SSH Key 或远程仓库访问权限。",
    title: "SSH 访问失败",
  },
  // Reserved for access checks that inspect credential helper state, not raw Git stderr classification.
  "credential-helper-missing": {
    message: "请配置 Git 凭据管理器后重试。",
    title: "缺少凭据管理器",
  },
  "repository-not-found": {
    message: "请确认仓库地址和访问权限。",
    title: "仓库不存在或无权限",
  },
  network: {
    message: "请检查网络连接后重试。",
    title: "网络连接失败",
  },
  path: {
    message: "请选择可访问的本地目录。",
    title: "本地路径不可用",
  },
  dirty: {
    message: "请先提交、暂存或丢弃本地改动。",
    title: "本地有未提交改动",
  },
  conflict: {
    message: "请先处理冲突后重试。",
    title: "需要处理冲突",
  },
  "non-fast-forward": {
    message: "请先拉取远程更新后重试。",
    title: "需要先拉取远程更新",
  },
  timeout: {
    message: "请稍后重试。",
    title: "操作超时",
  },
  "not-git-repository": {
    message: "请在工作台选择一个 Git 仓库。",
    title: "不是 Git 仓库",
  },
  unknown: {
    message: "请复制诊断信息排查问题。",
    title: "Git 操作失败",
  },
}

const PRIMARY_ACTIONS: Readonly<Record<SynapseGitFailureCategory, SynapseGitFailurePrimaryAction>> = {
  "git-missing": "install-git",
  "missing-identity": "set-identity",
  "https-auth": "login-host",
  "github-auth": "handle-github-auth",
  "ssh-auth": "handle-ssh",
  "credential-helper-missing": "configure-credential-helper",
  "repository-not-found": "login-host",
  network: "retry",
  path: "choose-directory",
  dirty: "open-workbench",
  conflict: "open-workbench",
  "non-fast-forward": "open-workbench",
  timeout: "retry",
  "not-git-repository": "open-workbench",
  unknown: "copy-diagnostics",
}

function normalizeHost(host: string): string {
  return host.toLowerCase()
}

function toOutputText(output: unknown): string {
  if (typeof output === "string") return output
  if (!output || typeof output !== "object") return String(output ?? "")

  const record = output as Record<string, unknown>
  return [
    output instanceof Error ? output.message : record.message,
    record.stderr,
    record.stdout,
    record.output,
  ].filter((value): value is string => typeof value === "string" && value.length > 0).join("\n")
}

function parseRemote(value: string | null | undefined): GitRemoteInfo | null {
  const remote = value?.trim()
  if (!remote) return null

  const scpLikeMatch = remote.match(/^[A-Za-z0-9._-]+@([A-Za-z0-9.-]+):.+/)
  if (scpLikeMatch?.[1]) {
    return { host: normalizeHost(scpLikeMatch[1]), port: null, protocol: "ssh" }
  }

  if (remote.startsWith("/")) {
    return { host: null, port: null, protocol: "file" }
  }

  try {
    const url = new URL(remote)
    if (url.protocol === "https:" || url.protocol === "http:") {
      return {
        host: normalizeHost(url.hostname),
        port: url.port ? Number(url.port) : null,
        protocol: url.protocol === "http:" ? "http" : "https",
      }
    }
    if (url.protocol === "ssh:") {
      return {
        host: normalizeHost(url.hostname),
        port: url.port ? Number(url.port) : null,
        protocol: "ssh",
      }
    }
    if (url.protocol === "file:") {
      return { host: null, port: null, protocol: "file" }
    }
  } catch {
    return null
  }

  return null
}

function findRemoteInOutput(output: string): string | null {
  const httpsMatch = output.match(HTTPS_URL_PATTERN)
  if (httpsMatch?.[0]) return httpsMatch[0]

  const sshMatch = output.match(SSH_URL_PATTERN)
  if (sshMatch?.[0]) return sshMatch[0]

  const scpLikeMatch = output.match(SCP_LIKE_REMOTE_PATTERN)
  return scpLikeMatch?.[1] ?? null
}

function resolveRemoteInfo(output: string, remoteUrl: string | null | undefined): GitRemoteInfo {
  return parseRemote(remoteUrl) ?? parseRemote(findRemoteInOutput(output)) ?? { host: null, port: null, protocol: "unknown" }
}

function classifyGitFailure(output: string, remote: GitRemoteInfo): SynapseGitFailureCategory {
  if (/no available git|no git command|ENOENT|没有可用的 git|git 命令|git executable/i.test(output)) return "git-missing"
  if (/author identity unknown|please tell me who you are|user\.email|user\.name|unable to auto-detect email address/i.test(output)) return "missing-identity"
  if (/not a git repository|not in a git directory/i.test(output)) return "not-git-repository"
  if (/timed out|timeout|操作超时|超时/i.test(output)) return "timeout"
  if (/cannot change to|no such file or directory|ENOENT|ENOTDIR|EACCES|permission denied.*(?:directory|path)|路径|目录不存在/i.test(output)) return "path"
  if (/local changes (?:to .+ )?would be overwritten|working tree|uncommitted changes|please commit your changes|未提交/i.test(output)) return "dirty"
  if (/non-fast-forward|fetch first|rejected.*non-fast-forward|tip of your current branch is behind/i.test(output)) return "non-fast-forward"
  if (/\bCONFLICT\b|merge conflict|fix conflicts|unmerged files/i.test(output)) return "conflict"
  if (/repository not found|remote not found|not found|does not appear to be a git repository|repository .* not exist/i.test(output)) return "repository-not-found"
  if (/publickey|could not read from remote repository|permission denied \(publickey\)|ssh: connect/i.test(output)) return "ssh-auth"
  if ((remote.protocol === "http" || remote.protocol === "https") && /(?:returned error|http.*status|status code)[: ]+(?:401|403)\b|\b(?:401|403)\b.*(?:unauthorized|forbidden)/i.test(output)) {
    return remote.host === "github.com" ? "github-auth" : "https-auth"
  }
  if (/authentication failed|could not read username|invalid username or password|access denied|terminal prompts disabled|认证失败/i.test(output)) {
    return remote.host === "github.com" && remote.protocol === "https" ? "github-auth" : "https-auth"
  }
  if (/could not resolve host|failed to connect|network|connection reset|connection refused|proxy|ssl|certificate|unable to access/i.test(output)) return "network"
  return "unknown"
}

function buildMessage(category: SynapseGitFailureCategory, host: string | null, fallbackMessage: string): string {
  if (category === "https-auth" && host) return `${host} 需要登录。`
  if (category === "repository-not-found" && host) return `请确认 ${host} 上的仓库地址和访问权限。`
  if (category === "unknown") return fallbackMessage.trim() || FAILURE_COPY.unknown.message
  return FAILURE_COPY[category].message
}

function sanitizeDetail(output: string, remoteUrl: string | null | undefined): string | null {
  const parts = [
    output,
    remoteUrl ? `remote: ${sanitizeRemoteUrl(remoteUrl)}` : null,
  ].filter((value): value is string => Boolean(value?.trim()))
  const detail = sanitizeGitUserFacingFailureText(parts.join("\n")).trim()
  return detail || null
}

export function sanitizeGitUserFacingFailureText(value: string): string {
  return sanitizeGitDiagnosticText(value)
}

export function createGitUserFacingFailure(
  output: unknown,
  options: CreateGitUserFacingFailureOptions,
): SynapseGitUserFacingFailure {
  const outputText = toOutputText(output)
  const remote = resolveRemoteInfo(outputText, options.remoteUrl)
  const category = classifyGitFailure(outputText, remote)

  return {
    category,
    detail: sanitizeDetail(outputText, options.remoteUrl),
    host: remote.host,
    message: buildMessage(category, remote.host, options.fallbackMessage),
    port: remote.port,
    primaryAction: PRIMARY_ACTIONS[category],
    protocol: remote.protocol,
    title: FAILURE_COPY[category].title,
  }
}

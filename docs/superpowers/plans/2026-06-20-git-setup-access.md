# Git Setup And Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing Git app with a reachable, mature setup and access-repair flow for Git installation, Git identity, HTTPS credentials, SSH keys, and user-visible Git error recovery.

**Architecture:** Build on the current `desktop/src/modules/git` UI and `desktop/electron/services/git-client` services. Add shared typed failure/access models first, then main-process access services and IPC, then renderer panels/dialogs, and finally wire operation failures to visible repair actions. Keep credentials in Git credential helpers or system credential storage, never in Synapse storage.

**Tech Stack:** Electron 41, React 19, TypeScript 6, Vite/Vitest, shadcn/Radix UI, existing Synapse IPC/service registry.

---

## Scope

Implement the accepted design in `docs/superpowers/specs/2026-06-20-git-setup-access-design.md`.

This plan deliberately does not implement package hosting, built-in downloads, silent Git installation, Linux command instructions, platform OAuth, or a Synapse password vault.

## File Structure

Create:

- `desktop/src/modules/git/lib/git-remote.ts`  
  Shared renderer-safe parsing for remote URL protocol, host, provider, and download/provider links.

- `desktop/src/modules/git/lib/git-failure-view.ts`  
  Shared renderer mapping from structured failures to labels and visible actions.

- `desktop/src/modules/git/components/git-install-panel.tsx`  
  The new `安装 Git` Tab content, using existing environment state and shell external links.

- `desktop/src/modules/git/components/git-access-panel.tsx`  
  The new `访问` Tab content and host/SSH repair surface.

- `desktop/src/modules/git/components/git-credential-dialog.tsx`  
  shadcn `Dialog` forms for generic HTTPS login and GitHub token entry.

- `desktop/src/modules/git/components/git-ssh-key-dialog.tsx`  
  shadcn `Dialog`/`AlertDialog` UI for SSH key generation and test results.

- `desktop/src/modules/git/hooks/use-git-access.ts`  
  Renderer state hook for `git.access.*` bridge calls.

- `desktop/src/modules/git/hooks/use-pending-git-action.ts`  
  Short-lived retry context for clone/pull/push/sync.

- `desktop/electron/services/git-client/git-access-service.ts`  
  Main-process credential helper, HTTPS credential, SSH key, SSH test, provider link service.

- `desktop/electron/services/git-client/git-user-facing-failure.ts`  
  Main-process Git error normalization and safe user-facing failure payloads.

- Tests next to each module:
  - `desktop/src/modules/git/lib/__tests__/git-remote.test.ts`
  - `desktop/src/modules/git/lib/__tests__/git-failure-view.test.ts`
  - `desktop/src/modules/git/hooks/__tests__/use-pending-git-action.test.tsx`
  - `desktop/electron/services/git-client/__tests__/git-access-service.test.ts`
  - `desktop/electron/services/git-client/__tests__/git-user-facing-failure.test.ts`

Modify:

- `desktop/src/types/git.ts`  
  Add access, provider, protocol, and structured failure types.

- `desktop/src/types/bridge.ts`  
  Add new `window.synapse.git.*` methods.

- `desktop/electron/preload.ts`  
  Add IPC channels and bridge methods for access operations.

- `desktop/electron/generated/ipc-channels.generated.ts`  
  Regenerate after IPC changes.

- `desktop/electron/modules/git/ipc.ts`  
  Add zod schemas and access handlers.

- `desktop/electron/bootstrap/descriptors.ts` and `desktop/electron/bootstrap/registry.ts`  
  Register `git.access-service`.

- `desktop/electron/bootstrap/__tests__/registry.test.ts` and `desktop/electron/bootstrap/__tests__/descriptors.test.ts`  
  Add service registration expectations.

- `desktop/electron/services/git-client/git-command-runner.ts`  
  Attach structured user-facing failure to thrown Git errors without logging secrets.

- `desktop/electron/services/git-client/git-clone-service.ts` and sync/branch/status call sites as needed  
  Preserve structured failures from command runner.

- `desktop/src/modules/git/index.tsx`  
  Add `安装 Git` and `访问` Tabs, auto-switch on missing Git, wire pending action.

- `desktop/src/modules/git/hooks/use-git-operations.ts`  
  Return structured failures instead of only a global string.

- `desktop/src/modules/git/components/git-clone-dialog.tsx`  
  Show visible failure actions, preserve inputs, route to access/setup.

- `desktop/src/modules/git/components/git-repository-list.tsx` and `desktop/src/modules/git/components/git-workbench.tsx`  
  Show repository/workbench failure actions.

- `desktop/src/modules/git/components/git-environment-panel.tsx`  
  Add reachable jumps to setup/access and keep existing diagnostics.

- `desktop/src/modules/git/__tests__/git-module-list.test.tsx` and related Git tests  
  Cover new tabs, dialogs, visible errors, and no-overflow shadcn dialog structure.

- `RELEASE_NOTES_PENDING.md`  
  Add user-facing release note because this is a visible Git app feature.

---

## Task 1: Shared Types And Remote Parsing

**Files:**
- Modify: `desktop/src/types/git.ts`
- Create: `desktop/src/modules/git/lib/git-remote.ts`
- Create: `desktop/src/modules/git/lib/__tests__/git-remote.test.ts`

- [ ] **Step 1: Add failing remote parsing tests**

Create `desktop/src/modules/git/lib/__tests__/git-remote.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import {
  buildGitProviderLinks,
  parseGitRemote,
} from "../git-remote"

describe("parseGitRemote", () => {
  it("parses GitHub HTTPS remotes", () => {
    expect(parseGitRemote("https://github.com/FairyEver/Synapse.git")).toEqual({
      host: "github.com",
      normalizedUrl: "https://github.com/FairyEver/Synapse.git",
      protocol: "https",
      provider: "github",
      remoteKind: "https",
    })
  })

  it("parses scp-like SSH remotes", () => {
    expect(parseGitRemote("git@gitee.com:team/docs.git")).toEqual({
      host: "gitee.com",
      normalizedUrl: "git@gitee.com:team/docs.git",
      protocol: "ssh",
      provider: "gitee",
      remoteKind: "ssh",
    })
  })

  it("treats company HTTPS remotes as generic", () => {
    expect(parseGitRemote("https://git.company.com/team/docs.git")).toMatchObject({
      host: "git.company.com",
      protocol: "https",
      provider: "generic",
      remoteKind: "https",
    })
  })

  it("returns unknown for empty or unsupported values", () => {
    expect(parseGitRemote("")).toEqual({
      host: null,
      normalizedUrl: "",
      protocol: "unknown",
      provider: "generic",
      remoteKind: "unknown",
    })
    expect(parseGitRemote("/Users/me/repo")).toMatchObject({
      host: null,
      protocol: "file",
      provider: "generic",
      remoteKind: "unknown",
    })
  })
})

describe("buildGitProviderLinks", () => {
  it("returns official setup links for GitHub", () => {
    expect(buildGitProviderLinks("github")).toEqual({
      credentialHelpUrl: "https://docs.github.com/en/get-started/git-basics/caching-your-github-credentials-in-git",
      sshKeysUrl: "https://github.com/settings/keys",
      tokenUrl: "https://github.com/settings/tokens",
    })
  })

  it("returns known SSH pages for Gitee and GitLab", () => {
    expect(buildGitProviderLinks("gitee").sshKeysUrl).toBe("https://gitee.com/profile/sshkeys")
    expect(buildGitProviderLinks("gitlab").sshKeysUrl).toBe("https://gitlab.com/-/user_settings/ssh_keys")
  })
})
```

- [ ] **Step 2: Run the failing remote parsing tests**

Run:

```bash
cd /Users/liyang/.codex/worktrees/7d29/Synapse/desktop
pnpm vitest run src/modules/git/lib/__tests__/git-remote.test.ts
```

Expected: FAIL because `git-remote.ts` does not exist.

- [ ] **Step 3: Add shared Git access types**

Modify `desktop/src/types/git.ts` by adding these types after `SynapseGitRemoteKind`:

```ts
export type SynapseGitProtocol = "https" | "ssh" | "file" | "unknown"

export type SynapseGitProvider = "github" | "gitee" | "gitlab" | "generic"

export type SynapseGitProviderLinks = {
  readonly credentialHelpUrl: string | null
  readonly sshKeysUrl: string | null
  readonly tokenUrl: string | null
}

export type SynapseGitRemoteDescriptor = {
  readonly host: string | null
  readonly normalizedUrl: string
  readonly protocol: SynapseGitProtocol
  readonly provider: SynapseGitProvider
  readonly remoteKind: SynapseGitRemoteKind
}

export type SynapseGitFailureCategory =
  | "git-missing"
  | "missing-identity"
  | "https-auth"
  | "github-auth"
  | "ssh-auth"
  | "credential-helper-missing"
  | "repository-not-found"
  | "network"
  | "path"
  | "dirty"
  | "conflict"
  | "non-fast-forward"
  | "timeout"
  | "not-git-repository"
  | "unknown"

export type SynapseGitFailurePrimaryAction =
  | "install-git"
  | "set-identity"
  | "login-host"
  | "handle-github-auth"
  | "handle-ssh"
  | "configure-credential-helper"
  | "retry"
  | "choose-directory"
  | "open-workbench"
  | "copy-diagnostics"
  | null

export type SynapseGitUserFacingFailure = {
  readonly category: SynapseGitFailureCategory
  readonly detail: string | null
  readonly host: string | null
  readonly message: string
  readonly primaryAction: SynapseGitFailurePrimaryAction
  readonly protocol: SynapseGitProtocol
  readonly title: string
}

export type SynapseGitCredentialHelperState = {
  readonly helper: string | null
  readonly safe: boolean
  readonly source: string | null
}

export type SynapseGitAccessHostState = {
  readonly host: string
  readonly lastFailure: SynapseGitUserFacingFailure | null
  readonly protocol: SynapseGitProtocol
  readonly provider: SynapseGitProvider
}

export type SynapseGitAccessState = {
  readonly checkedAt: string
  readonly credentialHelper: SynapseGitCredentialHelperState
  readonly hosts: readonly SynapseGitAccessHostState[]
  readonly providerLinks: Readonly<Record<SynapseGitProvider, SynapseGitProviderLinks>>
  readonly ssh: {
    readonly available: boolean
    readonly publicKeyComment: string | null
    readonly publicKeyFingerprint: string | null
    readonly publicKeyPath: string | null
    readonly publicKeyType: string | null
  }
}

export type SynapseGitSaveHttpsCredentialInput = {
  readonly host: string
  readonly password: string
  readonly protocol: "https"
  readonly username: string
}

export type SynapseGitClearHttpsCredentialInput = {
  readonly host: string
  readonly protocol: "https"
  readonly username?: string | null
}

export type SynapseGitGenerateSshKeyInput = {
  readonly email: string
}

export type SynapseGitTestSshConnectionInput = {
  readonly host: string
  readonly provider?: SynapseGitProvider
}

export type SynapseGitSshTestResult = {
  readonly detail: string | null
  readonly host: string
  readonly ok: boolean
  readonly title: string
}
```

- [ ] **Step 4: Implement `git-remote.ts`**

Create `desktop/src/modules/git/lib/git-remote.ts`:

```ts
import type {
  SynapseGitProvider,
  SynapseGitProviderLinks,
  SynapseGitRemoteDescriptor,
  SynapseGitRemoteKind,
  SynapseGitProtocol,
} from "@/types/git"

const PROVIDER_HOSTS: Readonly<Record<string, SynapseGitProvider>> = {
  "github.com": "github",
  "gitee.com": "gitee",
  "gitlab.com": "gitlab",
}

const PROVIDER_LINKS: Readonly<Record<SynapseGitProvider, SynapseGitProviderLinks>> = {
  generic: {
    credentialHelpUrl: null,
    sshKeysUrl: null,
    tokenUrl: null,
  },
  gitee: {
    credentialHelpUrl: null,
    sshKeysUrl: "https://gitee.com/profile/sshkeys",
    tokenUrl: null,
  },
  github: {
    credentialHelpUrl: "https://docs.github.com/en/get-started/git-basics/caching-your-github-credentials-in-git",
    sshKeysUrl: "https://github.com/settings/keys",
    tokenUrl: "https://github.com/settings/tokens",
  },
  gitlab: {
    credentialHelpUrl: null,
    sshKeysUrl: "https://gitlab.com/-/user_settings/ssh_keys",
    tokenUrl: null,
  },
}

function providerForHost(host: string | null): SynapseGitProvider {
  if (!host) return "generic"
  return PROVIDER_HOSTS[host.toLowerCase()] ?? "generic"
}

function remoteKindForProtocol(protocol: SynapseGitProtocol): SynapseGitRemoteKind {
  if (protocol === "https") return "https"
  if (protocol === "ssh") return "ssh"
  return "unknown"
}

function parseUrlRemote(value: string): Pick<SynapseGitRemoteDescriptor, "host" | "protocol"> | null {
  try {
    const url = new URL(value)
    if (url.protocol === "https:" || url.protocol === "http:") {
      return { host: url.hostname.toLowerCase(), protocol: "https" }
    }
    if (url.protocol === "ssh:") {
      return { host: url.hostname.toLowerCase(), protocol: "ssh" }
    }
    if (url.protocol === "file:") {
      return { host: null, protocol: "file" }
    }
    return null
  } catch {
    return null
  }
}

function parseScpLikeRemote(value: string): Pick<SynapseGitRemoteDescriptor, "host" | "protocol"> | null {
  const match = /^(?:[^@\s]+@)?([^:\s]+):.+/u.exec(value)
  if (!match?.[1]) return null
  return { host: match[1].toLowerCase(), protocol: "ssh" }
}

export function parseGitRemote(input: string): SynapseGitRemoteDescriptor {
  const normalizedUrl = input.trim()
  const parsed = normalizedUrl
    ? parseUrlRemote(normalizedUrl) ?? parseScpLikeRemote(normalizedUrl)
    : null
  const protocol: SynapseGitProtocol = parsed?.protocol ?? (normalizedUrl.startsWith("/") ? "file" : "unknown")
  const host = parsed?.host ?? null
  const provider = providerForHost(host)
  return {
    host,
    normalizedUrl,
    protocol,
    provider,
    remoteKind: remoteKindForProtocol(protocol),
  }
}

export function buildGitProviderLinks(provider: SynapseGitProvider): SynapseGitProviderLinks {
  return PROVIDER_LINKS[provider]
}

export function getGitProviderLinks(): Readonly<Record<SynapseGitProvider, SynapseGitProviderLinks>> {
  return PROVIDER_LINKS
}
```

- [ ] **Step 5: Run the remote parsing tests**

Run:

```bash
cd /Users/liyang/.codex/worktrees/7d29/Synapse/desktop
pnpm vitest run src/modules/git/lib/__tests__/git-remote.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 1**

Run:

```bash
cd /Users/liyang/.codex/worktrees/7d29/Synapse
git add desktop/src/types/git.ts desktop/src/modules/git/lib/git-remote.ts desktop/src/modules/git/lib/__tests__/git-remote.test.ts
git commit -m "feat(git): add remote access types"
```

---

## Task 2: Main-Process User-Facing Git Failure Classification

**Files:**
- Create: `desktop/electron/services/git-client/git-user-facing-failure.ts`
- Create: `desktop/electron/services/git-client/__tests__/git-user-facing-failure.test.ts`
- Modify: `desktop/electron/services/git-client/git-command-runner.ts`
- Modify: `desktop/electron/services/git-client/__tests__/git-command-runner.test.ts`

- [ ] **Step 1: Add failing failure-classification tests**

Create `desktop/electron/services/git-client/__tests__/git-user-facing-failure.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { createGitUserFacingFailure } from "../git-user-facing-failure"

describe("createGitUserFacingFailure", () => {
  it("maps HTTPS auth failures to a visible login action", () => {
    expect(createGitUserFacingFailure(
      "remote: HTTP Basic: Access denied\nfatal: Authentication failed for 'https://git.company.com/team/docs.git/'",
      { fallbackMessage: "Git 操作失败。", remoteUrl: "https://git.company.com/team/docs.git" },
    )).toMatchObject({
      category: "https-auth",
      host: "git.company.com",
      message: "git.company.com 需要登录。",
      primaryAction: "login-host",
      protocol: "https",
      title: "认证失败",
    })
  })

  it("maps GitHub HTTPS auth failures to GitHub-specific handling", () => {
    expect(createGitUserFacingFailure(
      "fatal: Authentication failed for 'https://github.com/FairyEver/Synapse.git/'",
      { fallbackMessage: "Git 操作失败。", remoteUrl: "https://github.com/FairyEver/Synapse.git" },
    )).toMatchObject({
      category: "github-auth",
      host: "github.com",
      primaryAction: "handle-github-auth",
      title: "GitHub 需要登录",
    })
  })

  it("maps SSH publickey failures", () => {
    expect(createGitUserFacingFailure(
      "git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.",
      { fallbackMessage: "Git 操作失败。", remoteUrl: "git@github.com:FairyEver/Synapse.git" },
    )).toMatchObject({
      category: "ssh-auth",
      host: "github.com",
      primaryAction: "handle-ssh",
      protocol: "ssh",
      title: "SSH 访问失败",
    })
  })

  it("maps network, timeout, repository, dirty, non-fast-forward, conflict, and path failures", () => {
    expect(createGitUserFacingFailure("Could not resolve host: git.example.com", { fallbackMessage: "Git 操作失败。" }).category).toBe("network")
    expect(createGitUserFacingFailure("Operation timed out", { fallbackMessage: "Git 操作失败。" }).category).toBe("timeout")
    expect(createGitUserFacingFailure("Repository not found.", { fallbackMessage: "Git 操作失败。" }).category).toBe("repository-not-found")
    expect(createGitUserFacingFailure("local changes would be overwritten", { fallbackMessage: "Git 操作失败。" }).category).toBe("dirty")
    expect(createGitUserFacingFailure("rejected non-fast-forward fetch first", { fallbackMessage: "Git 操作失败。" }).category).toBe("non-fast-forward")
    expect(createGitUserFacingFailure("CONFLICT (content): Merge conflict", { fallbackMessage: "Git 操作失败。" }).category).toBe("conflict")
    expect(createGitUserFacingFailure("No such file or directory", { fallbackMessage: "Git 操作失败。" }).category).toBe("path")
  })

  it("redacts secrets while preserving normal paths", () => {
    const result = createGitUserFacingFailure(
      "fatal: Authentication failed for 'https://token:ghp_secret123456@github.com/team/repo.git?token=raw-token' at /Users/writer/work/repo",
      { fallbackMessage: "Git 操作失败。", remoteUrl: "https://token:ghp_secret123456@github.com/team/repo.git?token=raw-token" },
    )
    expect(result.detail).toContain("https://[redacted]@github.com/team/repo.git")
    expect(result.detail).toContain("/Users/writer/work/repo")
    expect(JSON.stringify(result)).not.toContain("ghp_secret")
    expect(JSON.stringify(result)).not.toContain("raw-token")
  })
})
```

- [ ] **Step 2: Run the failing classification tests**

Run:

```bash
cd /Users/liyang/.codex/worktrees/7d29/Synapse/desktop
pnpm vitest run electron/services/git-client/__tests__/git-user-facing-failure.test.ts
```

Expected: FAIL because `git-user-facing-failure.ts` does not exist.

- [ ] **Step 3: Implement structured failure mapping**

Create `desktop/electron/services/git-client/git-user-facing-failure.ts`:

```ts
import type {
  SynapseGitProtocol,
  SynapseGitUserFacingFailure,
} from "../../../src/types/git"
import { sanitizeErrorPreservingPaths } from "../error-sanitize"

type FailureInput = {
  readonly fallbackMessage: string
  readonly remoteUrl?: string | null
}

function firstUsefulLine(output: string): string | null {
  return output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find(Boolean) ?? null
}

function parseRemote(input: string | null | undefined): { host: string | null; protocol: SynapseGitProtocol } {
  const value = input?.trim() ?? ""
  if (!value) return { host: null, protocol: "unknown" }
  try {
    const url = new URL(value)
    if (url.protocol === "https:" || url.protocol === "http:") {
      return { host: url.hostname.toLowerCase(), protocol: "https" }
    }
    if (url.protocol === "ssh:") {
      return { host: url.hostname.toLowerCase(), protocol: "ssh" }
    }
  } catch {
    const scp = /^(?:[^@\s]+@)?([^:\s]+):.+/u.exec(value)
    if (scp?.[1]) return { host: scp[1].toLowerCase(), protocol: "ssh" }
  }
  return { host: null, protocol: value.startsWith("/") ? "file" : "unknown" }
}

function inferRemoteFromOutput(output: string): string | null {
  const https = /https?:\/\/[^\s')"]+/iu.exec(output)
  if (https?.[0]) return https[0]
  const scp = /(?:ssh:\/\/[^\s')"]+|(?:[^@\s]+@)?[a-z0-9.-]+\.[a-z]{2,}:[^\s')"]+)/iu.exec(output)
  return scp?.[0] ?? null
}

function baseFailure(
  input: FailureInput,
  output: string,
): Pick<SynapseGitUserFacingFailure, "detail" | "host" | "protocol"> {
  const detail = sanitizeErrorPreservingPaths(firstUsefulLine(output) ?? input.fallbackMessage)
  const remote = parseRemote(input.remoteUrl ?? inferRemoteFromOutput(output))
  return { detail, host: remote.host, protocol: remote.protocol }
}

export function createGitUserFacingFailure(
  output: string,
  input: FailureInput,
): SynapseGitUserFacingFailure {
  const lowered = output.toLowerCase()
  const base = baseFailure(input, output)
  const hostText = base.host ?? "远程仓库"

  if (/enoent|no available git|no git command|没有可用的 git|当前系统没有可用的 git/i.test(output)) {
    return { ...base, category: "git-missing", message: "先安装 Git。", primaryAction: "install-git", title: "未检测到 Git" }
  }

  if (/user\.name|user\.email|缺少 git 身份|请输入用户名|请输入邮箱/i.test(output)) {
    return { ...base, category: "missing-identity", message: "先设置用户名和邮箱。", primaryAction: "set-identity", title: "缺少 Git 身份" }
  }

  if (/permission denied \(publickey\)|publickey|could not read from remote repository/i.test(output)) {
    return { ...base, category: "ssh-auth", message: `${hostText} 的 SSH 访问失败。`, primaryAction: "handle-ssh", title: "SSH 访问失败" }
  }

  if (/authentication failed|could not read username|access denied|invalid username or password|401|403|认证失败/i.test(output)) {
    if (base.host === "github.com") {
      return { ...base, category: "github-auth", message: "使用浏览器登录、访问令牌或 SSH。", primaryAction: "handle-github-auth", title: "GitHub 需要登录" }
    }
    return { ...base, category: "https-auth", message: `${hostText} 需要登录。`, primaryAction: "login-host", title: "认证失败" }
  }

  if (/repository not found|not found|no such remote/i.test(output)) {
    return { ...base, category: "repository-not-found", message: "检查仓库地址，或处理访问权限。", primaryAction: "login-host", title: "仓库不存在或无权限" }
  }

  if (/could not resolve host|failed to connect|network is unreachable|connection reset/i.test(output)) {
    return { ...base, category: "network", message: "检查网络后重试。", primaryAction: "retry", title: "网络连接失败" }
  }

  if (/timed out|timeout/i.test(output)) {
    return { ...base, category: "timeout", message: "稍后重试。", primaryAction: "retry", title: "操作超时" }
  }

  if (/not a git repository/i.test(output)) {
    return { ...base, category: "not-git-repository", message: "选择正确的 Git 仓库目录。", primaryAction: "open-workbench", title: "不是 Git 仓库" }
  }

  if (/no such file or directory|path does not exist|cannot access/i.test(output)) {
    return { ...base, category: "path", message: "检查本地目录后重试。", primaryAction: "choose-directory", title: "本地路径不可用" }
  }

  if (/local changes would be overwritten|working tree|uncommitted changes|未提交/i.test(output)) {
    return { ...base, category: "dirty", message: "先提交改动后再继续。", primaryAction: "open-workbench", title: "本地有未提交改动" }
  }

  if (/non-fast-forward|fetch first|rejected|tip of your current branch is behind/i.test(output)) {
    return { ...base, category: "non-fast-forward", message: "先拉取远程更新。", primaryAction: "retry", title: "需要先拉取远程更新" }
  }

  if (/conflict|merge conflict|CONFLICT/i.test(output)) {
    return { ...base, category: "conflict", message: "处理冲突后再继续。", primaryAction: "open-workbench", title: "需要处理冲突" }
  }

  return {
    ...base,
    category: "unknown",
    message: sanitizeErrorPreservingPaths(input.fallbackMessage),
    primaryAction: "copy-diagnostics",
    title: lowered.includes("git") ? "Git 操作失败" : "操作失败",
  }
}
```

- [ ] **Step 4: Attach structured failures in the command runner**

Modify `desktop/electron/services/git-client/git-command-runner.ts`:

```ts
import type { SynapseGitErrorCategory, SynapseGitUserFacingFailure } from "../../../src/types/git"
import { runGitCommand, type GitCommandResult } from "../git-command"
import { createGitUserFacingFailure } from "./git-user-facing-failure"
import { createGitOperationId, gitErrorMeta, summarizeGitArgs } from "./git-logging"
```

Update `GitClientRunInput`:

```ts
type GitClientRunInput = {
  readonly cwd: string
  readonly args: readonly string[]
  readonly fallbackMessage?: string
  readonly logFailure?: boolean
  readonly operation?: string
  readonly operationId?: string
  readonly remoteUrl?: string | null
  readonly repoPath?: string
  readonly repositoryId?: string
  readonly timeoutMs?: number
}
```

Add helper:

```ts
function outputFromGitError(error: unknown): string {
  if (error && typeof error === "object") {
    const maybe = error as { output?: unknown; stderr?: unknown; stdout?: unknown; message?: unknown }
    return [
      typeof maybe.output === "string" ? maybe.output : "",
      typeof maybe.stderr === "string" ? maybe.stderr : "",
      typeof maybe.stdout === "string" ? maybe.stdout : "",
      typeof maybe.message === "string" ? maybe.message : "",
    ].filter(Boolean).join("\n")
  }
  return String(error)
}

function attachUserFacingFailure(
  error: unknown,
  input: Pick<GitClientRunInput, "fallbackMessage" | "remoteUrl">,
): never {
  const failure = createGitUserFacingFailure(outputFromGitError(error), {
    fallbackMessage: input.fallbackMessage ?? "Git 操作失败。",
    remoteUrl: input.remoteUrl,
  })
  if (error instanceof Error) {
    Object.defineProperty(error, "userFacingFailure", {
      configurable: true,
      enumerable: false,
      value: failure,
    })
    throw error
  }
  const wrapped = new Error(failure.message)
  Object.defineProperty(wrapped, "userFacingFailure", {
    configurable: true,
    enumerable: false,
    value: failure,
  })
  throw wrapped
}

export function getGitUserFacingFailure(error: unknown): SynapseGitUserFacingFailure | null {
  if (error && typeof error === "object" && "userFacingFailure" in error) {
    return (error as { userFacingFailure?: SynapseGitUserFacingFailure }).userFacingFailure ?? null
  }
  return null
}
```

In `catch (error)` inside `run`, after logging, replace `throw error` with:

```ts
        attachUserFacingFailure(error, {
          fallbackMessage: input.fallbackMessage ?? "Git 操作失败。",
          remoteUrl: input.remoteUrl,
        })
```

- [ ] **Step 5: Extend command runner tests**

Append to `desktop/electron/services/git-client/__tests__/git-command-runner.test.ts`:

```ts
import { getGitUserFacingFailure } from "../git-command-runner"
```

Add:

```ts
  it("attaches a structured user-facing failure without logging secrets", async () => {
    const error = Object.assign(new Error("Authentication failed for https://token:secret@git.company.com/team/docs.git"), {
      output: "fatal: Authentication failed for https://token:secret@git.company.com/team/docs.git?token=raw-token",
      stderr: "fatal: Authentication failed",
      stdout: "",
      timedOut: false,
    })
    const run = vi.fn().mockRejectedValue(error)
    const runner = createGitClientCommandRunner({ runGitCommand: run })

    await expect(runner.run({
      cwd: "/repo",
      args: ["push"],
      remoteUrl: "https://git.company.com/team/docs.git",
    })).rejects.toThrow("Authentication failed")

    const failure = getGitUserFacingFailure(error)
    expect(failure).toMatchObject({
      category: "https-auth",
      host: "git.company.com",
      primaryAction: "login-host",
      title: "认证失败",
    })
    expect(JSON.stringify(failure)).not.toContain("raw-token")
    expect(JSON.stringify(failure)).not.toContain("token:secret")
  })
```

- [ ] **Step 6: Run classification and runner tests**

Run:

```bash
cd /Users/liyang/.codex/worktrees/7d29/Synapse/desktop
pnpm vitest run electron/services/git-client/__tests__/git-user-facing-failure.test.ts electron/services/git-client/__tests__/git-command-runner.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 2**

Run:

```bash
cd /Users/liyang/.codex/worktrees/7d29/Synapse
git add desktop/electron/services/git-client/git-user-facing-failure.ts desktop/electron/services/git-client/__tests__/git-user-facing-failure.test.ts desktop/electron/services/git-client/git-command-runner.ts desktop/electron/services/git-client/__tests__/git-command-runner.test.ts
git commit -m "feat(git): classify visible git failures"
```

---

## Task 3: Git Access Service

**Files:**
- Create: `desktop/electron/services/git-client/git-access-service.ts`
- Create: `desktop/electron/services/git-client/__tests__/git-access-service.test.ts`
- Modify: `desktop/electron/bootstrap/descriptors.ts`
- Modify: `desktop/electron/bootstrap/registry.ts`
- Modify: `desktop/electron/bootstrap/__tests__/descriptors.test.ts`
- Modify: `desktop/electron/bootstrap/__tests__/registry.test.ts`

- [ ] **Step 1: Add failing access service tests**

Create `desktop/electron/services/git-client/__tests__/git-access-service.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"
import { createGitAccessService } from "../git-access-service"

function createService(overrides: Partial<Parameters<typeof createGitAccessService>[0]> = {}) {
  const commandRunner = {
    run: vi.fn(async (input: { readonly args: readonly string[] }) => {
      if (input.args.join(" ") === "config --global --get credential.helper") {
        return { stdout: "manager-core\n", stderr: "" }
      }
      if (input.args.join(" ") === "credential approve") {
        return { stdout: "", stderr: "" }
      }
      if (input.args.join(" ") === "credential reject") {
        return { stdout: "", stderr: "" }
      }
      if (input.args[0] === "config") return { stdout: "", stderr: "" }
      return { stdout: "", stderr: "" }
    }),
  }
  const runGitCredential = vi.fn().mockResolvedValue({ stdout: "", stderr: "" })
  const runSshKeygen = vi.fn().mockResolvedValue(undefined)
  const runSshTest = vi.fn().mockResolvedValue({ ok: true, output: "Hi writer!" })
  const service = createGitAccessService({
    commandRunner,
    homeDir: "/Users/writer",
    logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
    now: () => new Date("2026-06-20T00:00:00.000Z"),
    pathExists: async (filePath) => filePath.endsWith("id_ed25519.pub"),
    platform: "darwin",
    readFile: async () => "ssh-ed25519 public-key writer@example.com",
    runGitCredential,
    runSshKeygen,
    runSshTest,
    ...overrides,
  })
  return { commandRunner, runGitCredential, runSshKeygen, runSshTest, service }
}

describe("git access service", () => {
  it("checks credential helper and SSH state", async () => {
    const { service } = createService()
    await expect(service.check({ hosts: [{ host: "github.com", protocol: "https", provider: "github" }] })).resolves.toMatchObject({
      checkedAt: "2026-06-20T00:00:00.000Z",
      credentialHelper: { helper: "manager-core", safe: true },
      hosts: [{ host: "github.com", protocol: "https", provider: "github" }],
      ssh: {
        available: true,
        publicKeyPath: "/Users/writer/.ssh/id_ed25519.pub",
        publicKeyType: "ssh-ed25519",
      },
    })
  })

  it("saves HTTPS credentials through git credential approve without logging the password", async () => {
    const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() }
    const { runGitCredential, service } = createService({ logger })

    await service.saveHttpsCredential({
      host: "git.company.com",
      password: "secret-password",
      protocol: "https",
      username: "writer",
    })

    expect(runGitCredential).toHaveBeenCalledWith(expect.objectContaining({
      args: ["credential", "approve"],
      input: "protocol=https\nhost=git.company.com\nusername=writer\npassword=secret-password\n\n",
    }))
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain("secret-password")
  })

  it("clears HTTPS credentials through git credential reject", async () => {
    const { runGitCredential, service } = createService()
    await service.clearHttpsCredential({ host: "git.company.com", protocol: "https", username: "writer" })

    expect(runGitCredential).toHaveBeenCalledWith(expect.objectContaining({
      args: ["credential", "reject"],
      input: "protocol=https\nhost=git.company.com\nusername=writer\n\n",
    }))
  })

  it("configures a safe credential helper and rejects store", async () => {
    const { commandRunner, service } = createService()
    await service.configureCredentialHelper({ helper: "manager-core" })
    expect(commandRunner.run).toHaveBeenCalledWith(expect.objectContaining({
      args: ["config", "--global", "credential.helper", "manager-core"],
    }))

    await expect(service.configureCredentialHelper({ helper: "store" })).rejects.toThrow("不能使用明文凭证保存方式。")
  })

  it("generates SSH keys only when the target key is missing", async () => {
    const { runSshKeygen, service } = createService({
      pathExists: async () => false,
    })
    await service.generateSshKey({ email: "writer@example.com" })
    expect(runSshKeygen).toHaveBeenCalledWith(expect.objectContaining({
      args: ["-t", "ed25519", "-C", "writer@example.com", "-f", "/Users/writer/.ssh/id_ed25519", "-N", ""],
    }))
  })

  it("tests SSH connections and returns visible state", async () => {
    const { runSshTest, service } = createService()
    const result = await service.testSshConnection({ host: "github.com", provider: "github" })
    expect(runSshTest).toHaveBeenCalledWith(expect.objectContaining({ host: "github.com" }))
    expect(result).toEqual({
      detail: "Hi writer!",
      host: "github.com",
      ok: true,
      title: "SSH 可用",
    })
  })
})
```

- [ ] **Step 2: Run the failing access service tests**

Run:

```bash
cd /Users/liyang/.codex/worktrees/7d29/Synapse/desktop
pnpm vitest run electron/services/git-client/__tests__/git-access-service.test.ts
```

Expected: FAIL because `git-access-service.ts` does not exist.

- [ ] **Step 3: Implement `git-access-service.ts`**

Create `desktop/electron/services/git-client/git-access-service.ts` with focused helpers. Use `spawn` only for commands that require stdin (`git credential`) or non-Git executables (`ssh-keygen`, `ssh`):

```ts
import { spawn } from "node:child_process"
import path from "node:path"
import type {
  SynapseGitAccessState,
  SynapseGitClearHttpsCredentialInput,
  SynapseGitCredentialHelperState,
  SynapseGitGenerateSshKeyInput,
  SynapseGitProvider,
  SynapseGitProviderLinks,
  SynapseGitProtocol,
  SynapseGitSaveHttpsCredentialInput,
  SynapseGitSshTestResult,
  SynapseGitTestSshConnectionInput,
} from "../../../src/types/git"
import type { StructuredLogger } from "../../runtime/logging"
import type { GitClientCommandRunner } from "./git-command-runner"
import { createGitOperationId, logGitOperationStarted, logGitOperationSucceeded } from "./git-logging"

type AccessDeps = {
  readonly commandRunner: Pick<GitClientCommandRunner, "run">
  readonly homeDir: string
  readonly logger?: Pick<StructuredLogger, "error" | "info" | "warn">
  readonly now?: () => Date
  readonly pathExists: (filePath: string) => Promise<boolean>
  readonly platform: NodeJS.Platform
  readonly readFile: (filePath: string) => Promise<string>
  readonly runGitCredential?: (input: GitCredentialRunInput) => Promise<{ stdout: string; stderr: string }>
  readonly runSshKeygen?: (input: SshKeygenInput) => Promise<void>
  readonly runSshTest?: (input: SshTestInput) => Promise<{ ok: boolean; output: string }>
}

type GitCredentialRunInput = {
  readonly args: readonly string[]
  readonly cwd: string
  readonly input: string
  readonly timeoutMs: number
}

type SshKeygenInput = {
  readonly args: readonly string[]
  readonly cwd: string
  readonly timeoutMs: number
}

type SshTestInput = {
  readonly host: string
  readonly timeoutMs: number
}

type CheckInput = {
  readonly hosts?: readonly {
    readonly host: string
    readonly protocol: SynapseGitProtocol
    readonly provider: SynapseGitProvider
  }[]
}

type ConfigureCredentialHelperInput = {
  readonly helper: string
}

const SAFE_HELPERS = new Set(["manager", "manager-core", "osxkeychain", "wincred", "cache"])

const PROVIDER_LINKS: Readonly<Record<SynapseGitProvider, SynapseGitProviderLinks>> = {
  generic: { credentialHelpUrl: null, sshKeysUrl: null, tokenUrl: null },
  gitee: { credentialHelpUrl: null, sshKeysUrl: "https://gitee.com/profile/sshkeys", tokenUrl: null },
  github: {
    credentialHelpUrl: "https://docs.github.com/en/get-started/git-basics/caching-your-github-credentials-in-git",
    sshKeysUrl: "https://github.com/settings/keys",
    tokenUrl: "https://github.com/settings/tokens",
  },
  gitlab: { credentialHelpUrl: null, sshKeysUrl: "https://gitlab.com/-/user_settings/ssh_keys", tokenUrl: null },
}

function runProcess(file: string, args: readonly string[], options: { cwd: string; input?: string; timeoutMs: number }): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, [...args], {
      cwd: options.cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", LANG: "C", LC_ALL: "C" },
      windowsHide: true,
    })
    let stdout = ""
    let stderr = ""
    let settled = false
    const timeout = setTimeout(() => {
      settled = true
      child.kill("SIGTERM")
      reject(new Error(`${file} 操作超时。`))
    }, options.timeoutMs)

    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8") })
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8") })
    child.on("error", (error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      reject(error)
    })
    child.on("close", (code) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (code === 0) {
        resolve({ stdout, stderr })
        return
      }
      reject(new Error(stderr.trim() || stdout.trim() || `${file} 操作失败。`))
    })
    if (options.input !== undefined) child.stdin.end(options.input)
  })
}

async function defaultRunGitCredential(input: GitCredentialRunInput): Promise<{ stdout: string; stderr: string }> {
  return runProcess("git", input.args, { cwd: input.cwd, input: input.input, timeoutMs: input.timeoutMs })
}

async function defaultRunSshKeygen(input: SshKeygenInput): Promise<void> {
  await runProcess("ssh-keygen", input.args, { cwd: input.cwd, timeoutMs: input.timeoutMs })
}

async function defaultRunSshTest(input: SshTestInput): Promise<{ ok: boolean; output: string }> {
  try {
    const result = await runProcess("ssh", ["-T", `git@${input.host}`], { cwd: process.cwd(), timeoutMs: input.timeoutMs })
    return { ok: true, output: (result.stderr || result.stdout).trim() }
  } catch (error) {
    return { ok: false, output: error instanceof Error ? error.message : String(error) }
  }
}

function helperSafe(helper: string | null): boolean {
  if (!helper) return false
  return SAFE_HELPERS.has(helper.trim().split(/\s+/u)[0] ?? "")
}

function credentialInput(input: SynapseGitSaveHttpsCredentialInput | SynapseGitClearHttpsCredentialInput): string {
  const lines = [
    "protocol=https",
    `host=${input.host}`,
    "username" in input && input.username ? `username=${input.username}` : null,
    "password" in input ? `password=${input.password}` : null,
    "",
  ].filter((line): line is string => line !== null)
  return `${lines.join("\n")}\n`
}

async function readCredentialHelper(deps: AccessDeps): Promise<SynapseGitCredentialHelperState> {
  try {
    const result = await deps.commandRunner.run({
      cwd: deps.homeDir,
      args: ["config", "--global", "--get", "credential.helper"],
      logFailure: false,
      operation: "git.access.check",
    })
    const helper = result.stdout.trim() || null
    return { helper, safe: helperSafe(helper), source: helper ? "global" : null }
  } catch {
    return { helper: null, safe: false, source: null }
  }
}

async function readSshPublicKey(deps: AccessDeps) {
  const publicKeyPath = path.join(deps.homeDir, ".ssh", "id_ed25519.pub")
  if (!await deps.pathExists(publicKeyPath)) {
    return { available: false, publicKeyComment: null, publicKeyFingerprint: null, publicKeyPath: null, publicKeyType: null }
  }
  const content = (await deps.readFile(publicKeyPath)).trim()
  const [publicKeyType, , ...commentParts] = content.split(/\s+/u)
  return {
    available: true,
    publicKeyComment: commentParts.join(" ") || null,
    publicKeyFingerprint: null,
    publicKeyPath,
    publicKeyType: publicKeyType || null,
  }
}

export function createGitAccessService(deps: AccessDeps) {
  const now = deps.now ?? (() => new Date())
  const runGitCredential = deps.runGitCredential ?? defaultRunGitCredential
  const runSshKeygen = deps.runSshKeygen ?? defaultRunSshKeygen
  const runSshTest = deps.runSshTest ?? defaultRunSshTest

  return {
    async check(input: CheckInput = {}): Promise<SynapseGitAccessState> {
      return {
        checkedAt: now().toISOString(),
        credentialHelper: await readCredentialHelper(deps),
        hosts: (input.hosts ?? []).map((host) => ({ ...host, lastFailure: null })),
        providerLinks: PROVIDER_LINKS,
        ssh: await readSshPublicKey(deps),
      }
    },

    async configureCredentialHelper(input: ConfigureCredentialHelperInput): Promise<void> {
      const helper = input.helper.trim()
      if (helper === "store") throw new Error("不能使用明文凭证保存方式。")
      if (!helperSafe(helper)) throw new Error("不支持此凭证保存方式。")
      await deps.commandRunner.run({
        cwd: deps.homeDir,
        args: ["config", "--global", "credential.helper", helper],
        operation: "git.access.configureCredentialHelper",
      })
    },

    async saveHttpsCredential(input: SynapseGitSaveHttpsCredentialInput): Promise<void> {
      const operationId = createGitOperationId()
      logGitOperationStarted(deps.logger ?? noopLogger, "git.access.saveHttpsCredential", operationId, {
        host: input.host,
        usernameLength: input.username.length,
      })
      await runGitCredential({
        args: ["credential", "approve"],
        cwd: deps.homeDir,
        input: credentialInput(input),
        timeoutMs: 30_000,
      })
      logGitOperationSucceeded(deps.logger ?? noopLogger, "git.access.saveHttpsCredential", operationId, performance.now(), {
        host: input.host,
        usernameLength: input.username.length,
      })
    },

    async clearHttpsCredential(input: SynapseGitClearHttpsCredentialInput): Promise<void> {
      await runGitCredential({
        args: ["credential", "reject"],
        cwd: deps.homeDir,
        input: credentialInput(input),
        timeoutMs: 30_000,
      })
    },

    async generateSshKey(input: SynapseGitGenerateSshKeyInput): Promise<void> {
      const privateKeyPath = path.join(deps.homeDir, ".ssh", "id_ed25519")
      const publicKeyPath = `${privateKeyPath}.pub`
      if (await deps.pathExists(publicKeyPath)) return
      await runSshKeygen({
        args: ["-t", "ed25519", "-C", input.email.trim(), "-f", privateKeyPath, "-N", ""],
        cwd: deps.homeDir,
        timeoutMs: 30_000,
      })
    },

    async testSshConnection(input: SynapseGitTestSshConnectionInput): Promise<SynapseGitSshTestResult> {
      const result = await runSshTest({ host: input.host, timeoutMs: 30_000 })
      return {
        detail: result.output || null,
        host: input.host,
        ok: result.ok,
        title: result.ok ? "SSH 可用" : "SSH 访问失败",
      }
    },
  }
}

const noopLogger = {
  error: () => undefined,
  info: () => undefined,
  warn: () => undefined,
}

export type GitAccessService = ReturnType<typeof createGitAccessService>
```

- [ ] **Step 4: Register the service descriptor**

Modify `desktop/electron/bootstrap/descriptors.ts` imports:

```ts
import { createGitAccessService, type GitAccessService } from "../services/git-client/git-access-service"
```

Add after `gitEnvironmentServiceDescriptor`:

```ts
export const gitAccessServiceDescriptor: ServiceDescriptor<GitAccessService> = {
  id: "git.access-service",
  criticality: "degraded",
  dependsOn: ["git.command-runner"],
  create(ctx) {
    return createGitAccessService({
      commandRunner: ctx.registry.get<GitClientCommandRunner>("git.command-runner"),
      homeDir: os.homedir(),
      logger: ctx.logger.child("git.access"),
      pathExists,
      platform: process.platform,
      readFile: (filePath) => readFile(filePath, "utf8"),
    })
  },
}
```

Modify `desktop/electron/bootstrap/registry.ts` to import and register `gitAccessServiceDescriptor` near other Git descriptors.

- [ ] **Step 5: Update descriptor/registry tests**

In `desktop/electron/bootstrap/__tests__/registry.test.ts`, add expectation near other Git services:

```ts
expect(serviceIds).toContain("git.access-service")
```

In `desktop/electron/bootstrap/__tests__/descriptors.test.ts`, add:

```ts
expect(byId.get("git.access-service")?.dependsOn).toEqual(["git.command-runner"])
```

- [ ] **Step 6: Run access and bootstrap tests**

Run:

```bash
cd /Users/liyang/.codex/worktrees/7d29/Synapse/desktop
pnpm vitest run electron/services/git-client/__tests__/git-access-service.test.ts electron/bootstrap/__tests__/registry.test.ts electron/bootstrap/__tests__/descriptors.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 3**

Run:

```bash
cd /Users/liyang/.codex/worktrees/7d29/Synapse
git add desktop/electron/services/git-client/git-access-service.ts desktop/electron/services/git-client/__tests__/git-access-service.test.ts desktop/electron/bootstrap/descriptors.ts desktop/electron/bootstrap/registry.ts desktop/electron/bootstrap/__tests__/registry.test.ts desktop/electron/bootstrap/__tests__/descriptors.test.ts
git commit -m "feat(git): add access service"
```

---

## Task 4: IPC, Preload, And Bridge

**Files:**
- Modify: `desktop/electron/modules/git/ipc.ts`
- Modify: `desktop/electron/modules/git/__tests__/ipc.test.ts`
- Modify: `desktop/electron/preload.ts`
- Modify: `desktop/src/types/bridge.ts`
- Regenerate: `desktop/electron/generated/ipc-channels.generated.ts`

- [ ] **Step 1: Add failing IPC tests**

Append to `desktop/electron/modules/git/__tests__/ipc.test.ts`:

```ts
  it("declares access channels", () => {
    expect(gitIpcModule.methods.checkAccess.channel).toBe("synapse:git:access:check")
    expect(gitIpcModule.methods.saveHttpsCredential.channel).toBe("synapse:git:access:save-https-credential")
    expect(gitIpcModule.methods.clearHttpsCredential.channel).toBe("synapse:git:access:clear-https-credential")
    expect(gitIpcModule.methods.generateSshKey.channel).toBe("synapse:git:access:generate-ssh-key")
    expect(gitIpcModule.methods.testSshConnection.channel).toBe("synapse:git:access:test-ssh-connection")
  })

  it("rejects unsafe access payloads", () => {
    expect(gitIpcModule.methods.saveHttpsCredential.request.safeParse({
      host: "git.company.com",
      password: "secret",
      protocol: "https",
      username: "writer",
    }).success).toBe(true)
    expect(gitIpcModule.methods.saveHttpsCredential.request.safeParse({
      host: "git.company.com",
      password: "secret",
      protocol: "ssh",
      username: "writer",
    }).success).toBe(false)
    expect(gitIpcModule.methods.saveHttpsCredential.request.safeParse({
      host: "git.company.com",
      password: "secret",
      protocol: "https",
      username: "writer",
      persistInSynapse: true,
    }).success).toBe(false)
  })

  it("routes access calls through git access service", async () => {
    const accessService = {
      check: vi.fn().mockResolvedValue({
        checkedAt: "2026-06-20T00:00:00.000Z",
        credentialHelper: { helper: "manager-core", safe: true, source: "global" },
        hosts: [],
        providerLinks: {
          generic: { credentialHelpUrl: null, sshKeysUrl: null, tokenUrl: null },
          gitee: { credentialHelpUrl: null, sshKeysUrl: "https://gitee.com/profile/sshkeys", tokenUrl: null },
          github: { credentialHelpUrl: "https://docs.github.com/en/get-started/git-basics/caching-your-github-credentials-in-git", sshKeysUrl: "https://github.com/settings/keys", tokenUrl: "https://github.com/settings/tokens" },
          gitlab: { credentialHelpUrl: null, sshKeysUrl: "https://gitlab.com/-/user_settings/ssh_keys", tokenUrl: null },
        },
        ssh: { available: false, publicKeyComment: null, publicKeyFingerprint: null, publicKeyPath: null, publicKeyType: null },
      }),
      saveHttpsCredential: vi.fn().mockResolvedValue(undefined),
    }

    await gitIpcModule.methods.checkAccess.handler(createContext({ "git.access-service": accessService }), { hosts: [] })
    await gitIpcModule.methods.saveHttpsCredential.handler(createContext({ "git.access-service": accessService }), {
      host: "git.company.com",
      password: "secret",
      protocol: "https",
      username: "writer",
    })

    expect(accessService.check).toHaveBeenCalledWith({ hosts: [] })
    expect(accessService.saveHttpsCredential).toHaveBeenCalledWith({
      host: "git.company.com",
      password: "secret",
      protocol: "https",
      username: "writer",
    })
  })
```

- [ ] **Step 2: Run failing IPC tests**

Run:

```bash
cd /Users/liyang/.codex/worktrees/7d29/Synapse/desktop
pnpm vitest run electron/modules/git/__tests__/ipc.test.ts
```

Expected: FAIL because methods are missing.

- [ ] **Step 3: Add zod schemas and handlers in `git/ipc.ts`**

Add imports:

```ts
import type { GitAccessService } from "../../services/git-client/git-access-service"
```

Add schemas:

```ts
const gitProtocolSchema = z.enum(["https", "ssh", "file", "unknown"])
const gitProviderSchema = z.enum(["github", "gitee", "gitlab", "generic"])

const providerLinksSchema = z.object({
  credentialHelpUrl: z.string().nullable(),
  sshKeysUrl: z.string().nullable(),
  tokenUrl: z.string().nullable(),
})

const userFacingFailureSchema = z.object({
  category: z.enum([
    "git-missing",
    "missing-identity",
    "https-auth",
    "github-auth",
    "ssh-auth",
    "credential-helper-missing",
    "repository-not-found",
    "network",
    "path",
    "dirty",
    "conflict",
    "non-fast-forward",
    "timeout",
    "not-git-repository",
    "unknown",
  ]),
  detail: z.string().nullable(),
  host: z.string().nullable(),
  message: z.string(),
  primaryAction: z.enum([
    "install-git",
    "set-identity",
    "login-host",
    "handle-github-auth",
    "handle-ssh",
    "configure-credential-helper",
    "retry",
    "choose-directory",
    "open-workbench",
    "copy-diagnostics",
  ]).nullable(),
  protocol: gitProtocolSchema,
  title: z.string(),
})

const checkAccessSchema = z.object({
  hosts: z.array(z.object({
    host: z.string(),
    protocol: gitProtocolSchema,
    provider: gitProviderSchema,
  })).optional(),
}).strict()

const accessStateSchema = z.object({
  checkedAt: z.string(),
  credentialHelper: z.object({
    helper: z.string().nullable(),
    safe: z.boolean(),
    source: z.string().nullable(),
  }),
  hosts: z.array(z.object({
    host: z.string(),
    lastFailure: userFacingFailureSchema.nullable(),
    protocol: gitProtocolSchema,
    provider: gitProviderSchema,
  })),
  providerLinks: z.record(gitProviderSchema, providerLinksSchema),
  ssh: z.object({
    available: z.boolean(),
    publicKeyComment: z.string().nullable(),
    publicKeyFingerprint: z.string().nullable(),
    publicKeyPath: z.string().nullable(),
    publicKeyType: z.string().nullable(),
  }),
})

const credentialHelperSchema = z.object({
  helper: z.string(),
}).strict()

const saveHttpsCredentialSchema = z.object({
  host: z.string(),
  password: z.string(),
  protocol: z.literal("https"),
  username: z.string(),
}).strict()

const clearHttpsCredentialSchema = z.object({
  host: z.string(),
  protocol: z.literal("https"),
  username: z.string().nullable().optional(),
}).strict()

const generateSshKeySchema = z.object({
  email: z.string(),
}).strict()

const testSshConnectionSchema = z.object({
  host: z.string(),
  provider: gitProviderSchema.optional(),
}).strict()

const sshTestResultSchema = z.object({
  detail: z.string().nullable(),
  host: z.string(),
  ok: z.boolean(),
  title: z.string(),
})
```

Add methods to `gitIpcModule.methods`:

```ts
    checkAccess: {
      channel: "synapse:git:access:check",
      kind: "invoke",
      request: checkAccessSchema,
      response: accessStateSchema,
      handler: async (ctx, input) => ctx.resolve<GitAccessService>("git.access-service").check(input),
    },
    configureCredentialHelper: {
      channel: "synapse:git:access:configure-credential-helper",
      kind: "invoke",
      request: credentialHelperSchema,
      response: z.void(),
      handler: async (ctx, input) => ctx.resolve<GitAccessService>("git.access-service").configureCredentialHelper(input),
    },
    saveHttpsCredential: {
      channel: "synapse:git:access:save-https-credential",
      kind: "invoke",
      request: saveHttpsCredentialSchema,
      response: z.void(),
      handler: async (ctx, input) => ctx.resolve<GitAccessService>("git.access-service").saveHttpsCredential(input),
    },
    clearHttpsCredential: {
      channel: "synapse:git:access:clear-https-credential",
      kind: "invoke",
      request: clearHttpsCredentialSchema,
      response: z.void(),
      handler: async (ctx, input) => ctx.resolve<GitAccessService>("git.access-service").clearHttpsCredential(input),
    },
    generateSshKey: {
      channel: "synapse:git:access:generate-ssh-key",
      kind: "invoke",
      request: generateSshKeySchema,
      response: z.void(),
      handler: async (ctx, input) => ctx.resolve<GitAccessService>("git.access-service").generateSshKey(input),
    },
    testSshConnection: {
      channel: "synapse:git:access:test-ssh-connection",
      kind: "invoke",
      request: testSshConnectionSchema,
      response: sshTestResultSchema,
      handler: async (ctx, input) => ctx.resolve<GitAccessService>("git.access-service").testSshConnection(input),
    },
```

- [ ] **Step 4: Add bridge types**

Modify imports in `desktop/src/types/bridge.ts` to include the new Git types, then extend `git`:

```ts
    checkAccess: (input?: {
      hosts?: {
        host: string
        protocol: SynapseGitProtocol
        provider: SynapseGitProvider
      }[]
    }) => Promise<SynapseGitAccessState>
    configureCredentialHelper: (input: { helper: string }) => Promise<void>
    saveHttpsCredential: (input: SynapseGitSaveHttpsCredentialInput) => Promise<void>
    clearHttpsCredential: (input: SynapseGitClearHttpsCredentialInput) => Promise<void>
    generateSshKey: (input: SynapseGitGenerateSshKeyInput) => Promise<void>
    testSshConnection: (input: SynapseGitTestSshConnectionInput) => Promise<SynapseGitSshTestResult>
```

- [ ] **Step 5: Add preload channels and methods**

Modify `desktop/electron/preload.ts` `IPC_CHANNELS.git`:

```ts
    "checkAccess": "synapse:git:access:check",
    "configureCredentialHelper": "synapse:git:access:configure-credential-helper",
    "saveHttpsCredential": "synapse:git:access:save-https-credential",
    "clearHttpsCredential": "synapse:git:access:clear-https-credential",
    "generateSshKey": "synapse:git:access:generate-ssh-key",
    "testSshConnection": "synapse:git:access:test-ssh-connection",
```

Add bridge methods under `git`:

```ts
    checkAccess: (input = {}) =>
      invoke(IPC_CHANNELS.git.checkAccess)(input),
    configureCredentialHelper: (input) =>
      invoke(IPC_CHANNELS.git.configureCredentialHelper)(input),
    saveHttpsCredential: (input) =>
      invoke(IPC_CHANNELS.git.saveHttpsCredential)(input),
    clearHttpsCredential: (input) =>
      invoke(IPC_CHANNELS.git.clearHttpsCredential)(input),
    generateSshKey: (input) =>
      invoke(IPC_CHANNELS.git.generateSshKey)(input),
    testSshConnection: (input) =>
      invoke(IPC_CHANNELS.git.testSshConnection)(input),
```

- [ ] **Step 6: Regenerate IPC channel file**

Run:

```bash
cd /Users/liyang/.codex/worktrees/7d29/Synapse/desktop
pnpm generate:ipc
```

Expected: `desktop/electron/generated/ipc-channels.generated.ts` updates with the new Git access channels.

- [ ] **Step 7: Run IPC tests and codegen check**

Run:

```bash
cd /Users/liyang/.codex/worktrees/7d29/Synapse/desktop
pnpm vitest run electron/modules/git/__tests__/ipc.test.ts
pnpm run check:ipc-codegen
```

Expected: PASS.

- [ ] **Step 8: Commit Task 4**

Run:

```bash
cd /Users/liyang/.codex/worktrees/7d29/Synapse
git add desktop/electron/modules/git/ipc.ts desktop/electron/modules/git/__tests__/ipc.test.ts desktop/electron/preload.ts desktop/src/types/bridge.ts desktop/electron/generated/ipc-channels.generated.ts
git commit -m "feat(git): expose access ipc"
```

---

## Task 5: Renderer Access State Hooks And Dialog Components

**Files:**
- Create: `desktop/src/modules/git/hooks/use-git-access.ts`
- Create: `desktop/src/modules/git/hooks/use-pending-git-action.ts`
- Create: `desktop/src/modules/git/hooks/__tests__/use-pending-git-action.test.tsx`
- Create: `desktop/src/modules/git/components/git-credential-dialog.tsx`
- Create: `desktop/src/modules/git/components/git-ssh-key-dialog.tsx`
- Modify or create tests in `desktop/src/modules/git/__tests__/git-dialog-errors.test.tsx`

- [ ] **Step 1: Add failing pending action hook tests**

Create `desktop/src/modules/git/hooks/__tests__/use-pending-git-action.test.tsx`:

```tsx
/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it } from "vitest"
import { usePendingGitAction } from "../use-pending-git-action"

function Harness({ onState }: { readonly onState: (state: ReturnType<typeof usePendingGitAction>) => void }) {
  const state = usePendingGitAction()
  onState(state)
  return null
}

describe("usePendingGitAction", () => {
  const roots: Root[] = []

  afterEach(() => {
    for (const root of roots.splice(0)) root.unmount()
  })

  it("stores and clears a short-lived clone retry action", async () => {
    let state: ReturnType<typeof usePendingGitAction> | null = null
    const element = document.createElement("div")
    document.body.appendChild(element)
    const root = createRoot(element)
    roots.push(root)

    await act(async () => {
      root.render(<Harness onState={(next) => { state = next }} />)
    })

    await act(async () => {
      state?.setPendingAction({
        host: "git.company.com",
        input: { name: "docs", remoteUrl: "https://git.company.com/team/docs.git", targetPath: "/work/docs" },
        protocol: "https",
        type: "clone",
      })
    })

    expect(state?.pendingAction).toMatchObject({ host: "git.company.com", type: "clone" })

    await act(async () => {
      state?.clearPendingAction()
    })

    expect(state?.pendingAction).toBeNull()
  })
})
```

- [ ] **Step 2: Implement `use-pending-git-action.ts`**

Create `desktop/src/modules/git/hooks/use-pending-git-action.ts`:

```ts
import { useCallback, useState } from "react"
import type { SynapseGitProtocol } from "@/types/git"

type CloneInput = {
  readonly name: string
  readonly remoteUrl: string
  readonly targetPath: string
}

export type PendingGitAction =
  | {
    readonly host: string
    readonly input: CloneInput
    readonly protocol: Extract<SynapseGitProtocol, "https" | "ssh">
    readonly provider: "github" | "gitee" | "gitlab" | "generic"
    readonly type: "clone"
  }
  | {
    readonly host: string
    readonly protocol: Extract<SynapseGitProtocol, "https" | "ssh">
    readonly provider: "github" | "gitee" | "gitlab" | "generic"
    readonly repositoryId: string
    readonly type: "pull" | "push" | "sync"
  }

export function usePendingGitAction() {
  const [pendingAction, setPendingActionState] = useState<PendingGitAction | null>(null)
  const setPendingAction = useCallback((action: PendingGitAction) => {
    setPendingActionState(action)
  }, [])
  const clearPendingAction = useCallback(() => {
    setPendingActionState(null)
  }, [])

  return {
    clearPendingAction,
    pendingAction,
    setPendingAction,
  }
}
```

- [ ] **Step 3: Implement `use-git-access.ts`**

Create `desktop/src/modules/git/hooks/use-git-access.ts`:

```ts
import { useCallback, useEffect, useState } from "react"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import type {
  SynapseGitAccessState,
  SynapseGitClearHttpsCredentialInput,
  SynapseGitGenerateSshKeyInput,
  SynapseGitSaveHttpsCredentialInput,
  SynapseGitTestSshConnectionInput,
  SynapseGitSshTestResult,
} from "@/types/git"

export function useGitAccess() {
  const [access, setAccess] = useState<SynapseGitAccessState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setAccess(await requireSynapseBridge().git.checkAccess({ hosts: [] }))
    } catch (err) {
      setError(err instanceof Error ? err.message : "读取 Git 访问状态失败。")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const saveHttpsCredential = useCallback(async (input: SynapseGitSaveHttpsCredentialInput) => {
    await requireSynapseBridge().git.saveHttpsCredential(input)
    await refresh()
  }, [refresh])

  const clearHttpsCredential = useCallback(async (input: SynapseGitClearHttpsCredentialInput) => {
    await requireSynapseBridge().git.clearHttpsCredential(input)
    await refresh()
  }, [refresh])

  const generateSshKey = useCallback(async (input: SynapseGitGenerateSshKeyInput) => {
    await requireSynapseBridge().git.generateSshKey(input)
    await refresh()
  }, [refresh])

  const testSshConnection = useCallback(async (input: SynapseGitTestSshConnectionInput): Promise<SynapseGitSshTestResult> => {
    return requireSynapseBridge().git.testSshConnection(input)
  }, [])

  return {
    access,
    clearHttpsCredential,
    error,
    generateSshKey,
    loading,
    refresh,
    saveHttpsCredential,
    testSshConnection,
  }
}
```

- [ ] **Step 4: Create credential dialogs using shadcn Dialog**

Create `desktop/src/modules/git/components/git-credential-dialog.tsx`:

```tsx
import { useEffect, useState, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { SynapseGitProvider } from "@/types/git"

type GitCredentialDialogProps = {
  readonly host: string | null
  readonly mode: "generic" | "github-token"
  readonly onOpenChange: (open: boolean) => void
  readonly onSubmit: (input: { username: string; password: string }) => Promise<void>
  readonly open: boolean
  readonly provider: SynapseGitProvider
  readonly tokenUrl?: string | null
}

export function GitCredentialDialog({
  host,
  mode,
  onOpenChange,
  onSubmit,
  open,
  tokenUrl,
}: GitCredentialDialogProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [password, setPassword] = useState("")
  const [username, setUsername] = useState("")
  const title = mode === "github-token" ? "使用访问令牌" : "登录仓库"
  const passwordLabel = mode === "github-token" ? "访问令牌" : "密码"

  useEffect(() => {
    if (!open) {
      setBusy(false)
      setError(null)
      setPassword("")
      setUsername("")
    }
  }, [open])

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!username.trim() || !password) {
      setError(mode === "github-token" ? "请输入账号和访问令牌。" : "请输入用户名和密码。")
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onSubmit({ password, username: username.trim() })
      setPassword("")
      onOpenChange(false)
    } catch (err) {
      setPassword("")
      setError(err instanceof Error ? err.message : "保存凭证失败。")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next) }} data-track="git-credential-dialog">
      <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
        <form className="grid gap-4" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            {host ? (
              <div className="grid gap-1 text-sm">
                <span className="font-medium">主机</span>
                <span className="break-all text-muted-foreground" data-allow-select="true">{host}</span>
              </div>
            ) : null}
            <div className="grid gap-2">
              <Label htmlFor="git-credential-username">账号</Label>
              <Input id="git-credential-username" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="git-credential-password">{passwordLabel}</Label>
              <Input id="git-credential-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" />
            </div>
            {mode === "github-token" && tokenUrl ? (
              <Button type="button" variant="outline" onClick={() => { void window.synapse?.shell.openExternal(tokenUrl) }}>
                打开令牌页面
              </Button>
            ) : null}
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>取消</Button>
            <Button type="submit" disabled={busy}>{busy ? "保存中" : "保存并重试"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 5: Create SSH key dialog using shadcn Dialog**

Create `desktop/src/modules/git/components/git-ssh-key-dialog.tsx`:

```tsx
import { useEffect, useState, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

type GitSshKeyDialogProps = {
  readonly defaultEmail: string
  readonly onGenerate: (input: { email: string }) => Promise<void>
  readonly onOpenChange: (open: boolean) => void
  readonly open: boolean
}

export function GitSshKeyDialog({ defaultEmail, onGenerate, onOpenChange, open }: GitSshKeyDialogProps) {
  const [busy, setBusy] = useState(false)
  const [email, setEmail] = useState(defaultEmail)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) setEmail(defaultEmail)
    if (!open) {
      setBusy(false)
      setError(null)
    }
  }, [defaultEmail, open])

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!email.trim()) {
      setError("请输入邮箱。")
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onGenerate({ email: email.trim() })
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成 SSH 公钥失败。")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next) }} data-track="git-ssh-key-dialog">
      <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
        <form className="grid gap-4" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>生成 SSH 公钥</DialogTitle>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="git-ssh-key-email">邮箱</Label>
            <Input id="git-ssh-key-email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" />
          </div>
          <div className="grid gap-1 text-sm">
            <span className="font-medium">路径</span>
            <span className="break-all font-mono text-xs text-muted-foreground" data-allow-select="true">~/.ssh/id_ed25519.pub</span>
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>取消</Button>
            <Button type="submit" disabled={busy}>{busy ? "生成中" : "生成"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 6: Run hook and existing dialog tests**

Run:

```bash
cd /Users/liyang/.codex/worktrees/7d29/Synapse/desktop
pnpm vitest run src/modules/git/hooks/__tests__/use-pending-git-action.test.tsx src/modules/git/__tests__/git-dialog-errors.test.tsx
```

Expected: PASS after any existing mocks are extended with new bridge methods.

- [ ] **Step 7: Commit Task 5**

Run:

```bash
cd /Users/liyang/.codex/worktrees/7d29/Synapse
git add desktop/src/modules/git/hooks/use-git-access.ts desktop/src/modules/git/hooks/use-pending-git-action.ts desktop/src/modules/git/hooks/__tests__/use-pending-git-action.test.tsx desktop/src/modules/git/components/git-credential-dialog.tsx desktop/src/modules/git/components/git-ssh-key-dialog.tsx desktop/src/modules/git/__tests__/git-dialog-errors.test.tsx
git commit -m "feat(git): add access state dialogs"
```

---

## Task 6: Install And Access Panels

**Files:**
- Create: `desktop/src/modules/git/components/git-install-panel.tsx`
- Create: `desktop/src/modules/git/components/git-access-panel.tsx`
- Modify: `desktop/src/modules/git/__tests__/git-module-list.test.tsx`

- [ ] **Step 1: Add failing panel tests**

Modify the bridge mock in `desktop/src/modules/git/__tests__/git-module-list.test.tsx` to include:

```ts
    checkAccess: vi.fn(),
    clearHttpsCredential: vi.fn(),
    configureCredentialHelper: vi.fn(),
    generateSshKey: vi.fn(),
    saveHttpsCredential: vi.fn(),
    testSshConnection: vi.fn(),
```

In `beforeEach`, add:

```ts
    bridge.git.checkAccess.mockResolvedValue({
      checkedAt: "2026-06-20T00:00:00.000Z",
      credentialHelper: { helper: "manager-core", safe: true, source: "global" },
      hosts: [],
      providerLinks: {
        generic: { credentialHelpUrl: null, sshKeysUrl: null, tokenUrl: null },
        gitee: { credentialHelpUrl: null, sshKeysUrl: "https://gitee.com/profile/sshkeys", tokenUrl: null },
        github: { credentialHelpUrl: "https://docs.github.com/en/get-started/git-basics/caching-your-github-credentials-in-git", sshKeysUrl: "https://github.com/settings/keys", tokenUrl: "https://github.com/settings/tokens" },
        gitlab: { credentialHelpUrl: null, sshKeysUrl: "https://gitlab.com/-/user_settings/ssh_keys", tokenUrl: null },
      },
      ssh: { available: true, publicKeyComment: "writer@example.com", publicKeyFingerprint: "SHA256:abc", publicKeyPath: "/Users/writer/.ssh/id_ed25519.pub", publicKeyType: "ssh-ed25519" },
    })
```

Add tests:

```ts
  it("shows install and access tabs in the existing system app shell", async () => {
    await renderGitModule(roots)

    const tabs = document.querySelector("[data-system-app-window-tabs]")?.textContent
    expect(tabs).toContain("仓库")
    expect(tabs).toContain("环境")
    expect(tabs).toContain("安装 Git")
    expect(tabs).toContain("访问")
  })

  it("switches to install tab when Git is missing", async () => {
    bridge.git.checkEnvironment.mockResolvedValue(gitEnvironment({
      gitAvailable: false,
      gitVersion: null,
      effectiveGitPath: null,
      installHint: "安装 Git for Windows 后重新检测。",
      platform: "win32",
    }))

    await renderGitModule(roots)

    expect(document.body.textContent).toContain("未检测到 Git")
    expect(document.body.textContent).toContain("Git for Windows")
    expect(document.body.textContent).toContain("打开下载页面")
  })

  it("shows access state and SSH actions", async () => {
    await renderGitModule(roots)
    await click(findButton("访问"))

    expect(document.body.textContent).toContain("凭证保存")
    expect(document.body.textContent).toContain("manager-core")
    expect(document.body.textContent).toContain("/Users/writer/.ssh/id_ed25519.pub")
    expect(document.body.textContent).toContain("复制公钥")
    expect(document.body.textContent).toContain("测试连接")
  })
```

- [ ] **Step 2: Run failing panel tests**

Run:

```bash
cd /Users/liyang/.codex/worktrees/7d29/Synapse/desktop
pnpm vitest run src/modules/git/__tests__/git-module-list.test.tsx
```

Expected: FAIL because panels/tabs are missing.

- [ ] **Step 3: Implement `GitInstallPanel`**

Create `desktop/src/modules/git/components/git-install-panel.tsx`:

```tsx
import { ExternalLink, RefreshCw } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import type { SynapseGitEnvironmentState } from "@/types/git"

type GitInstallPanelProps = {
  readonly environment: SynapseGitEnvironmentState | null
  readonly loading: boolean
  readonly onRefresh: () => Promise<void>
}

function downloadLabel(platform: string | null | undefined): string {
  if (platform === "win32") return "Git for Windows"
  if (platform === "darwin") return "Git for macOS"
  if (platform === "linux") return "暂不支持图形化引导"
  return "未检测"
}

function downloadUrl(platform: string | null | undefined): string | null {
  if (platform === "win32") return "https://git-scm.com/download/win"
  if (platform === "darwin") return "https://git-scm.com/download/mac"
  return null
}

export function GitInstallPanel({ environment, loading, onRefresh }: GitInstallPanelProps) {
  const platform = environment?.platform ?? null
  const url = downloadUrl(platform)
  const installed = Boolean(environment?.gitAvailable)

  const openDownloadPage = async () => {
    if (!url) return
    await requireSynapseBridge().shell.openExternal(url)
  }

  return (
    <ScrollArea className="h-full bg-surface">
      <div className="space-y-4 p-4">
        <Card>
          <CardHeader>
            <CardTitle>安装 Git</CardTitle>
            <CardAction>
              <Button type="button" variant="outline" size="sm" disabled={loading} onClick={() => void onRefresh()}>
                <RefreshCw data-icon="inline-start" className={loading ? "animate-spin" : undefined} />
                重新检测
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2 text-sm md:grid-cols-[8rem_minmax(0,1fr)]">
              <span className="font-medium">状态</span>
              <span>{installed ? "已安装" : platform === "linux" ? "当前系统暂不支持图形化引导" : "未检测到 Git"}</span>
              <span className="font-medium">系统</span>
              <span>{platform ?? "未检测"}</span>
              <span className="font-medium">来源</span>
              <span>{downloadLabel(platform)}</span>
              <span className="font-medium">版本</span>
              <span>{environment?.gitVersion ?? "未检测到"}</span>
              <span className="font-medium">位置</span>
              <span className="break-all font-mono text-xs text-muted-foreground" data-allow-select="true">
                {environment?.effectiveGitPath ?? "未检测到"}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {url ? (
                <Button type="button" onClick={() => void openDownloadPage()}>
                  <ExternalLink data-icon="inline-start" />
                  打开下载页面
                </Button>
              ) : null}
              <Button type="button" variant="outline" disabled={loading} onClick={() => void onRefresh()}>
                重新检测
              </Button>
            </div>
            {!url && platform === "linux" ? (
              <Alert>
                <AlertTitle>当前系统暂不支持图形化引导</AlertTitle>
                <AlertDescription>请在安装 Git 后重新检测。</AlertDescription>
              </Alert>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </ScrollArea>
  )
}
```

- [ ] **Step 4: Implement `GitAccessPanel`**

Create `desktop/src/modules/git/components/git-access-panel.tsx`:

```tsx
import { Copy, KeyRound, RefreshCw } from "lucide-react"
import { useState } from "react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import type { SynapseGitAccessState, SynapseGitEnvironmentState } from "@/types/git"
import { GitCredentialDialog } from "./git-credential-dialog"
import { GitSshKeyDialog } from "./git-ssh-key-dialog"

type GitAccessPanelProps = {
  readonly access: SynapseGitAccessState | null
  readonly environment: SynapseGitEnvironmentState | null
  readonly error: string | null
  readonly loading: boolean
  readonly onClearCredential: (input: { host: string; protocol: "https"; username?: string | null }) => Promise<void>
  readonly onGenerateSshKey: (input: { email: string }) => Promise<void>
  readonly onRefresh: () => Promise<void>
  readonly onRetryPendingAction?: (() => Promise<void>) | null
  readonly onSaveCredential: (input: { host: string; password: string; protocol: "https"; username: string }) => Promise<void>
  readonly pendingAction?: {
    readonly host: string
    readonly provider: "github" | "gitee" | "gitlab" | "generic"
    readonly protocol: "https" | "ssh"
    readonly type: string
  } | null
}

export function GitAccessPanel({
  access,
  environment,
  error,
  loading,
  onClearCredential,
  onGenerateSshKey,
  onRefresh,
  onRetryPendingAction,
  onSaveCredential,
  pendingAction,
}: GitAccessPanelProps) {
  const [credentialMode, setCredentialMode] = useState<"generic" | "github-token" | null>(null)
  const [sshDialogOpen, setSshDialogOpen] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const ssh = access?.ssh
  const activeHost = pendingAction?.host ?? null
  const activeProvider = pendingAction?.provider ?? "generic"
  const tokenUrl = access?.providerLinks.github.tokenUrl ?? null

  const copyPublicKey = async () => {
    setMessage(null)
    const key = await requireSynapseBridge().git.getSshPublicKey()
    if (!key) {
      setMessage("未找到 SSH 公钥。")
      return
    }
    await navigator.clipboard.writeText(key.content)
    setMessage("已复制公钥。")
  }

  const testGithubSsh = async () => {
    setMessage(null)
    const result = await requireSynapseBridge().git.testSshConnection({ host: "github.com", provider: "github" })
    setMessage(result.title)
  }

  return (
    <ScrollArea className="h-full bg-surface">
      <div className="space-y-4 p-4">
        <GitCredentialDialog
          host={activeHost}
          mode={credentialMode ?? "generic"}
          onOpenChange={(open) => { if (!open) setCredentialMode(null) }}
          onSubmit={async (input) => {
            if (!activeHost) throw new Error("缺少仓库主机。")
            await onSaveCredential({
              host: activeHost,
              password: input.password,
              protocol: "https",
              username: input.username,
            })
            await onRetryPendingAction?.()
          }}
          open={credentialMode !== null}
          provider={activeProvider}
          tokenUrl={tokenUrl}
        />
        <GitSshKeyDialog
          defaultEmail={environment?.userEmail ?? ""}
          onGenerate={onGenerateSshKey}
          onOpenChange={setSshDialogOpen}
          open={sshDialogOpen}
        />
        <Card>
          <CardHeader>
            <CardTitle>访问</CardTitle>
            <CardAction>
              <Button type="button" variant="outline" size="sm" disabled={loading} onClick={() => void onRefresh()}>
                <RefreshCw data-icon="inline-start" className={loading ? "animate-spin" : undefined} />
                重新检测
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="space-y-4">
            {error ? (
              <Alert variant="destructive">
                <AlertTitle>读取失败</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            <div className="grid gap-2 text-sm md:grid-cols-[8rem_minmax(0,1fr)]">
              <span className="font-medium">凭证保存</span>
              <span>{access?.credentialHelper.helper ?? "未设置"}</span>
              <span className="font-medium">状态</span>
              <span>{access?.credentialHelper.safe ? "可用" : "未设置"}</span>
            </div>
          </CardContent>
        </Card>

        {pendingAction ? (
          <Card>
            <CardHeader>
              <CardTitle>{pendingAction.host}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-2 text-sm md:grid-cols-[8rem_minmax(0,1fr)]">
                <span className="font-medium">方式</span>
                <span>{pendingAction.protocol.toUpperCase()}</span>
                <span className="font-medium">状态</span>
                <span>{pendingAction.provider === "github" ? "需要 GitHub 登录" : "需要登录"}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {pendingAction.provider === "github" && pendingAction.protocol === "https" ? (
                  <>
                    <Button type="button" onClick={() => { void window.synapse?.shell.openExternal(access?.providerLinks.github.credentialHelpUrl ?? "https://docs.github.com/en/get-started/git-basics/caching-your-github-credentials-in-git") }}>
                      浏览器登录
                    </Button>
                    <Button type="button" variant="outline" onClick={() => setCredentialMode("github-token")}>
                      使用访问令牌
                    </Button>
                  </>
                ) : pendingAction.protocol === "https" ? (
                  <Button type="button" onClick={() => setCredentialMode("generic")}>
                    登录仓库
                  </Button>
                ) : null}
                {pendingAction.protocol === "https" ? (
                  <Button type="button" variant="outline" onClick={() => { void onClearCredential({ host: pendingAction.host, protocol: "https" }) }}>
                    清除凭证
                  </Button>
                ) : null}
                {onRetryPendingAction ? (
                  <Button type="button" variant="outline" onClick={() => { void onRetryPendingAction() }}>
                    {pendingAction.type === "clone" ? "重试克隆" : "重试同步"}
                  </Button>
                ) : null}
              </div>
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>SSH</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2 text-sm md:grid-cols-[8rem_minmax(0,1fr)]">
              <span className="font-medium">状态</span>
              <span>{ssh?.available ? "已检测到公钥" : "未检测到公钥"}</span>
              <span className="font-medium">公钥</span>
              <span className="break-all font-mono text-xs text-muted-foreground" data-allow-select="true">{ssh?.publicKeyPath ?? "未检测到"}</span>
              <span className="font-medium">指纹</span>
              <span className="break-all font-mono text-xs text-muted-foreground" data-allow-select="true">{ssh?.publicKeyFingerprint ?? "未检测到"}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {ssh?.available ? (
                <>
                  <Button type="button" variant="outline" onClick={() => void copyPublicKey()}>
                    <Copy data-icon="inline-start" />
                    复制公钥
                  </Button>
                  <Button type="button" variant="outline" onClick={() => void testGithubSsh()}>
                    <KeyRound data-icon="inline-start" />
                    测试连接
                  </Button>
                </>
              ) : (
                <Button type="button" onClick={() => setSshDialogOpen(true)}>
                  生成 SSH 公钥
                </Button>
              )}
              {message ? <span className="self-center text-sm text-muted-foreground">{message}</span> : null}
            </div>
          </CardContent>
        </Card>
      </div>
    </ScrollArea>
  )
}
```

- [ ] **Step 5: Run panel tests**

Run:

```bash
cd /Users/liyang/.codex/worktrees/7d29/Synapse/desktop
pnpm vitest run src/modules/git/__tests__/git-module-list.test.tsx
```

Expected: still FAIL until Task 7 wires panels into `GitModule`; commit after Task 7. Do not commit Task 6 separately.

---

## Task 7: Wire Tabs, Access State, And Visible Operation Failures

**Files:**
- Modify: `desktop/src/modules/git/index.tsx`
- Modify: `desktop/src/modules/git/hooks/use-git-operations.ts`
- Modify: `desktop/src/modules/git/components/git-clone-dialog.tsx`
- Modify: `desktop/src/modules/git/components/git-repository-list.tsx`
- Modify: `desktop/src/modules/git/components/git-workbench.tsx`
- Modify: `desktop/src/modules/git/components/git-environment-panel.tsx`
- Modify: `desktop/src/modules/git/lib/git-status-view.ts`
- Modify: `desktop/src/modules/git/__tests__/git-module-list.test.tsx`
- Modify: `desktop/src/modules/git/__tests__/git-workbench.test.tsx`

- [ ] **Step 1: Add failure-view tests**

Create `desktop/src/modules/git/lib/__tests__/git-failure-view.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { getGitFailureActionLabel, shouldRouteFailureToAccess } from "../git-failure-view"
import type { SynapseGitUserFacingFailure } from "@/types/git"

function failure(overrides: Partial<SynapseGitUserFacingFailure>): SynapseGitUserFacingFailure {
  return {
    category: "https-auth",
    detail: null,
    host: "git.company.com",
    message: "git.company.com 需要登录。",
    primaryAction: "login-host",
    protocol: "https",
    title: "认证失败",
    ...overrides,
  }
}

describe("git-failure-view", () => {
  it("labels access failures with repair actions", () => {
    expect(getGitFailureActionLabel(failure({ primaryAction: "login-host" }))).toBe("登录仓库")
    expect(getGitFailureActionLabel(failure({ primaryAction: "handle-github-auth" }))).toBe("处理 GitHub 登录")
    expect(getGitFailureActionLabel(failure({ primaryAction: "handle-ssh" }))).toBe("设置 SSH 访问")
  })

  it("routes auth and ssh failures to access", () => {
    expect(shouldRouteFailureToAccess(failure({ category: "https-auth" }))).toBe(true)
    expect(shouldRouteFailureToAccess(failure({ category: "github-auth" }))).toBe(true)
    expect(shouldRouteFailureToAccess(failure({ category: "ssh-auth" }))).toBe(true)
    expect(shouldRouteFailureToAccess(failure({ category: "network", primaryAction: "retry" }))).toBe(false)
  })
})
```

- [ ] **Step 2: Implement `git-failure-view.ts`**

Create `desktop/src/modules/git/lib/git-failure-view.ts`:

```ts
import type { SynapseGitUserFacingFailure } from "@/types/git"

export function getGitFailureActionLabel(failure: SynapseGitUserFacingFailure | null): string | null {
  if (!failure?.primaryAction) return null
  if (failure.primaryAction === "install-git") return "安装 Git"
  if (failure.primaryAction === "set-identity") return "设置身份"
  if (failure.primaryAction === "login-host") return "登录仓库"
  if (failure.primaryAction === "handle-github-auth") return "处理 GitHub 登录"
  if (failure.primaryAction === "handle-ssh") return "设置 SSH 访问"
  if (failure.primaryAction === "configure-credential-helper") return "设置凭证保存"
  if (failure.primaryAction === "retry") return "重试"
  if (failure.primaryAction === "choose-directory") return "重新选择文件夹"
  if (failure.primaryAction === "open-workbench") return "查看状态"
  return "复制诊断信息"
}

export function shouldRouteFailureToAccess(failure: SynapseGitUserFacingFailure | null): boolean {
  return failure?.category === "https-auth"
    || failure?.category === "github-auth"
    || failure?.category === "ssh-auth"
    || failure?.category === "credential-helper-missing"
    || failure?.primaryAction === "login-host"
    || failure?.primaryAction === "handle-github-auth"
    || failure?.primaryAction === "handle-ssh"
}
```

- [ ] **Step 3: Upgrade `useGitOperations`**

Modify `desktop/src/modules/git/hooks/use-git-operations.ts`:

```ts
import { useState } from "react"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import type { SynapseGitRepositoryRemoveInput, SynapseGitUserFacingFailure } from "@/types/git"

type CloneRepositoryInput = {
  readonly remoteUrl: string
  readonly targetPath: string
  readonly name: string
}

type AddLocalRepositoryInput = {
  readonly name: string
  readonly localPath: string
}

type GitGlobalOperation = "clone" | "add-local"
export type GitRepositoryOperation = "sync" | "pull" | "push" | "remove"

export type GitOperationFailure = {
  readonly message: string
  readonly repositoryId: string | null
  readonly userFacingFailure: SynapseGitUserFacingFailure | null
}

export type GitGlobalOperationResult =
  | { readonly ok: true }
  | { readonly error: string; readonly failure: GitOperationFailure | null; readonly ok: false }

export type GitOperationBusyState = {
  readonly global: GitGlobalOperation | null
  readonly repositories: Readonly<Record<string, GitRepositoryOperation>>
}

const EMPTY_BUSY_STATE: GitOperationBusyState = {
  global: null,
  repositories: {},
}

function readFailure(err: unknown, repositoryId: string | null): GitOperationFailure {
  const maybeFailure = err && typeof err === "object" && "userFacingFailure" in err
    ? (err as { userFacingFailure?: SynapseGitUserFacingFailure }).userFacingFailure ?? null
    : null
  return {
    message: err instanceof Error ? err.message : "操作失败。",
    repositoryId,
    userFacingFailure: maybeFailure,
  }
}

export function useGitOperations(onCompleted: () => void | Promise<void>) {
  const [busy, setBusy] = useState<GitOperationBusyState>(EMPTY_BUSY_STATE)
  const [error, setError] = useState<string | null>(null)
  const [lastFailure, setLastFailure] = useState<GitOperationFailure | null>(null)

  async function runGlobal(label: GitGlobalOperation, action: () => Promise<unknown>): Promise<GitGlobalOperationResult> {
    setBusy((current) => ({ ...current, global: label }))
    setError(null)
    setLastFailure(null)
    try {
      await action()
      await onCompleted()
      return { ok: true }
    } catch (err) {
      const failure = readFailure(err, null)
      setError(failure.message)
      setLastFailure(failure)
      return { ok: false, error: failure.message, failure }
    } finally {
      setBusy((current) => ({ ...current, global: null }))
    }
  }

  async function runRepository(
    repositoryId: string,
    operation: GitRepositoryOperation,
    action: () => Promise<unknown>,
  ): Promise<boolean> {
    setBusy((current) => ({
      ...current,
      repositories: {
        ...current.repositories,
        [repositoryId]: operation,
      },
    }))
    setError(null)
    setLastFailure(null)
    try {
      await action()
      await onCompleted()
      return true
    } catch (err) {
      const failure = readFailure(err, repositoryId)
      setError(failure.message)
      setLastFailure(failure)
      return false
    } finally {
      setBusy((current) => {
        const { [repositoryId]: _completedOperation, ...repositories } = current.repositories
        return { ...current, repositories }
      })
    }
  }

  return {
    busy,
    error,
    lastFailure,
    cloneRepository: (input: CloneRepositoryInput) =>
      runGlobal("clone", () => requireSynapseBridge().git.cloneRepository(input)),
    addLocalRepository: (input: AddLocalRepositoryInput) =>
      runGlobal("add-local", () => requireSynapseBridge().git.addLocalRepository(input)),
    sync: (repositoryId: string) =>
      runRepository(repositoryId, "sync", () => requireSynapseBridge().git.sync(repositoryId)),
    pull: (repositoryId: string) =>
      runRepository(repositoryId, "pull", () => requireSynapseBridge().git.pull(repositoryId)),
    push: (repositoryId: string) =>
      runRepository(repositoryId, "push", () => requireSynapseBridge().git.push(repositoryId)),
    removeRepository: (input: SynapseGitRepositoryRemoveInput) =>
      runRepository(input.repositoryId, "remove", () => requireSynapseBridge().git.removeRepository(input)),
  }
}
```

- [ ] **Step 4: Wire tabs and panels in `GitModule`**

Modify `desktop/src/modules/git/index.tsx`:

```tsx
type GitAppViewId = "repositories" | "environment" | "install" | "access"

const GIT_APP_TABS: readonly { readonly id: GitAppViewId; readonly label: string }[] = [
  { id: "repositories", label: "仓库" },
  { id: "environment", label: "环境" },
  { id: "install", label: "安装 Git" },
  { id: "access", label: "访问" },
]
```

Import:

```tsx
import { GitAccessPanel } from "./components/git-access-panel"
import { GitInstallPanel } from "./components/git-install-panel"
import { useGitAccess } from "./hooks/use-git-access"
import { usePendingGitAction } from "./hooks/use-pending-git-action"
```

Inside `GitModule`:

```tsx
  const accessState = useGitAccess()
  const pendingGitAction = usePendingGitAction()

  useEffect(() => {
    if (environment && !environment.gitAvailable) {
      setView("install")
    }
  }, [environment])
```

Add tabs:

```tsx
          <TabsContent value="install" className="m-0 h-full data-[state=inactive]:hidden">
            <GitInstallPanel
              environment={environment}
              loading={environmentLoading}
              onRefresh={refreshEnvironment}
            />
          </TabsContent>
          <TabsContent value="access" className="m-0 h-full data-[state=inactive]:hidden">
            <GitAccessPanel
              access={accessState.access}
              environment={environment}
              error={accessState.error}
              loading={accessState.loading}
              onClearCredential={accessState.clearHttpsCredential}
              onGenerateSshKey={accessState.generateSshKey}
              onRefresh={accessState.refresh}
              onRetryPendingAction={pendingGitAction.pendingAction ? async () => {
                const pending = pendingGitAction.pendingAction
                if (!pending) return
                if (pending.type === "clone") {
                  const result = await operations.cloneRepository(pending.input)
                  if (result.ok) pendingGitAction.clearPendingAction()
                  return
                }
                const ok = pending.type === "pull"
                  ? await operations.pull(pending.repositoryId)
                  : pending.type === "push"
                    ? await operations.push(pending.repositoryId)
                    : await operations.sync(pending.repositoryId)
                if (ok) pendingGitAction.clearPendingAction()
              } : null}
              onSaveCredential={accessState.saveHttpsCredential}
              pendingAction={pendingGitAction.pendingAction}
            />
          </TabsContent>
```

Pass `operations.lastFailure` and handlers to repository/workbench after adding props in the next steps.

- [ ] **Step 5: Add visible clone failure handling**

Modify `GitCloneDialog` props:

```ts
  readonly onFailureAction?: (input: {
    readonly cloneInput: CloneInput
    readonly failure: SynapseGitUserFacingFailure
  }) => void
```

Inside submit, when `submitError` result includes failure from Task 7 API:

```tsx
    const submitResult = await onSubmit({ remoteUrl: remoteUrl.trim(), targetPath: targetPath.trim(), name })
    if (submitResult) {
      setError(submitResult.error)
      if (submitResult.failure?.userFacingFailure) {
        onFailureAction?.({
          cloneInput: { remoteUrl: remoteUrl.trim(), targetPath: targetPath.trim(), name },
          failure: submitResult.failure.userFacingFailure,
        })
      }
    }
```

If keeping the existing `onSubmit` return type is simpler for compatibility, update it to return:

```ts
Promise<{ error: string; failure: GitOperationFailure | null } | null>
```

Then update callers and tests.

- [ ] **Step 6: Add repository list visible failure action**

Modify `GitRepositoryListProps`:

```ts
  readonly failure: GitOperationFailure | null
  readonly onHandleFailure: (failure: GitOperationFailure) => void
```

Replace the top error alert body with:

```tsx
            {failure ? (
              <Alert variant="destructive">
                <AlertTitle>{failure.userFacingFailure?.title ?? "操作失败"}</AlertTitle>
                <AlertDescription className="space-y-2">
                  <p>{failure.userFacingFailure?.message ?? failure.message}</p>
                  {failure.userFacingFailure ? (
                    <Button type="button" variant="outline" size="sm" onClick={() => onHandleFailure(failure)}>
                      {getGitFailureActionLabel(failure.userFacingFailure)}
                    </Button>
                  ) : null}
                </AlertDescription>
              </Alert>
            ) : error ? (
              <Alert variant="destructive">
                <AlertTitle>操作失败</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
```

Add row-level indicator when `failure.repositoryId === repository.id`.

- [ ] **Step 7: Wire failure routing in `GitModule`**

Add helper:

```tsx
  const handleGitFailure = (failure: GitOperationFailure) => {
    const userFailure = failure.userFacingFailure
    if (!userFailure) return
    if (userFailure.primaryAction === "install-git") {
      setView("install")
      return
    }
    if (shouldRouteFailureToAccess(userFailure)) {
      setView("access")
    }
  }
```

Pass:

```tsx
failure={operations.lastFailure}
onHandleFailure={handleGitFailure}
```

For clone failure, create pending clone action:

```tsx
                onFailureAction={({ cloneInput, failure }) => {
                  if (failure.host && (failure.protocol === "https" || failure.protocol === "ssh")) {
                    pendingGitAction.setPendingAction({
                      host: failure.host,
                      input: cloneInput,
                      provider: failure.host === "github.com" ? "github" : "generic",
                      protocol: failure.protocol,
                      type: "clone",
                    })
                  }
                  handleGitFailure({ message: failure.message, repositoryId: null, userFacingFailure: failure })
                }}
```

- [ ] **Step 8: Run Git renderer tests**

Run:

```bash
cd /Users/liyang/.codex/worktrees/7d29/Synapse/desktop
pnpm vitest run src/modules/git/lib/__tests__/git-failure-view.test.ts src/modules/git/__tests__/git-module-list.test.tsx src/modules/git/__tests__/git-workbench.test.tsx src/modules/git/__tests__/git-dialog-errors.test.tsx
```

Expected: PASS.

- [ ] **Step 9: Commit Tasks 6 and 7**

Run:

```bash
cd /Users/liyang/.codex/worktrees/7d29/Synapse
git add desktop/src/modules/git
git commit -m "feat(git): add setup and access panels"
```

---

## Task 8: Release Notes, Typecheck, And Focused Verification

**Files:**
- Modify: `RELEASE_NOTES_PENDING.md`

- [ ] **Step 1: Add release note**

Append one user-facing bullet to `RELEASE_NOTES_PENDING.md` under the pending section:

```md
- Git 应用新增安装和访问处理入口：未安装 Git 时会引导打开官方下载安装到页面，克隆或同步遇到账号、密码、访问令牌、SSH 公钥、网络或路径问题时，会显示可操作的修复入口并支持处理后重试。
```

- [ ] **Step 2: Run focused Git test suite**

Run:

```bash
cd /Users/liyang/.codex/worktrees/7d29/Synapse/desktop
pnpm vitest run \
  electron/services/git-client/__tests__/git-user-facing-failure.test.ts \
  electron/services/git-client/__tests__/git-command-runner.test.ts \
  electron/services/git-client/__tests__/git-access-service.test.ts \
  electron/modules/git/__tests__/ipc.test.ts \
  src/modules/git/lib/__tests__/git-remote.test.ts \
  src/modules/git/lib/__tests__/git-failure-view.test.ts \
  src/modules/git/hooks/__tests__/use-pending-git-action.test.tsx \
  src/modules/git/__tests__/git-module-list.test.tsx \
  src/modules/git/__tests__/git-workbench.test.tsx \
  src/modules/git/__tests__/git-dialog-errors.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run IPC codegen check**

Run:

```bash
cd /Users/liyang/.codex/worktrees/7d29/Synapse/desktop
pnpm run check:ipc-codegen
```

Expected: PASS.

- [ ] **Step 4: Run typecheck**

Run:

```bash
cd /Users/liyang/.codex/worktrees/7d29/Synapse/desktop
pnpm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Run hard constraints check**

Run:

```bash
cd /Users/liyang/.codex/worktrees/7d29/Synapse/desktop
pnpm run check:hard-constraints
```

Expected: PASS. If it flags custom colors, inline styles, or disallowed UI patterns in Git files, revise the affected components to use existing shadcn components and token utilities.

- [ ] **Step 6: Commit final notes and verification fixes**

Run:

```bash
cd /Users/liyang/.codex/worktrees/7d29/Synapse
git add RELEASE_NOTES_PENDING.md
git commit -m "docs: note git setup access flow"
```

---

## Manual UI Review Checklist

Run this checklist before asking for review:

- [ ] Open Git app with mocked or real missing Git state. It auto-switches to `安装 Git`.
- [ ] `安装 Git` shows Windows/macOS download action without marketing copy.
- [ ] Linux state does not show command instructions.
- [ ] `访问` Tab is always reachable.
- [ ] Generic company HTTPS auth failure shows `登录仓库`.
- [ ] GitHub HTTPS auth failure shows `浏览器登录` / `使用访问令牌` / `改用 SSH`.
- [ ] SSH missing key shows `生成 SSH 公钥`.
- [ ] Long host, path, URL, and error detail text does not widen dialogs.
- [ ] Dialog footer remains visible in a narrow window.
- [ ] Password/token fields clear after submit failure and after submit success.
- [ ] No secret appears in logs, visible errors, copied diagnostics, or test snapshots.

## Final Verification Command Set

```bash
cd /Users/liyang/.codex/worktrees/7d29/Synapse/desktop
pnpm vitest run \
  electron/services/git-client/__tests__/git-user-facing-failure.test.ts \
  electron/services/git-client/__tests__/git-command-runner.test.ts \
  electron/services/git-client/__tests__/git-access-service.test.ts \
  electron/modules/git/__tests__/ipc.test.ts \
  src/modules/git/lib/__tests__/git-remote.test.ts \
  src/modules/git/lib/__tests__/git-failure-view.test.ts \
  src/modules/git/hooks/__tests__/use-pending-git-action.test.tsx \
  src/modules/git/__tests__/git-module-list.test.tsx \
  src/modules/git/__tests__/git-workbench.test.tsx \
  src/modules/git/__tests__/git-dialog-errors.test.tsx
pnpm run check:ipc-codegen
pnpm run typecheck
pnpm run check:hard-constraints
```

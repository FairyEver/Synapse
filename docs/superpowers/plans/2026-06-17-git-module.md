# Git Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an independent SourceTree Lite Git module that lets non-developer document users clone repositories, manage multiple local repositories, inspect changes, commit selected files, sync with remotes, switch local branches, and view current-branch history.

**Architecture:** The module is a new system app, independent from existing Synapse repository/resource repository concepts. Renderer code calls structured IPC methods; Electron services validate paths, run system Git through argument arrays, parse results, and return typed snapshots. No renderer path can execute arbitrary Git arguments.

**Tech Stack:** Electron IpcModule, React 19, TypeScript, shadcn/Radix UI, Tailwind token classes, Vitest, system Git CLI.

---

## Scope Check

The design spans app registration, Git environment detection, repository persistence, Git operations, IPC, renderer UI, icon asset, and release notes. This plan keeps those in one first-phase implementation because each task contributes to the same user-visible closed loop: clone or add a repository, inspect it, commit selected files, sync, switch branch, and view current-branch history. Do not add unrelated Git features such as rebase, stash, reset, force push, conflict resolution, remote branch management, `.gitignore` management, submodule UI, or LFS UI.

## File Map

Create:

- `desktop/src/types/git.ts`: shared type definitions for Git module data, snapshots, history, branches, environment, and operation results.
- `desktop/electron/services/git-client/git-command-runner.ts`: small system Git runner wrapper for this module, delegating to existing `runGitCommand`.
- `desktop/electron/services/git-client/git-path-utils.ts`: path normalization and repository containment helpers.
- `desktop/electron/services/git-client/git-environment-service.ts`: Git and SSH environment checks, global identity reads/writes.
- `desktop/electron/services/git-client/git-repository-registry.ts`: persistence for the independent Git module repository list under Electron user data.
- `desktop/electron/services/git-client/git-status-service.ts`: status snapshot and file diff parsing.
- `desktop/electron/services/git-client/git-commit-service.ts`: file-level staging and commit creation.
- `desktop/electron/services/git-client/git-sync-service.ts`: fetch, pull, push, and sync.
- `desktop/electron/services/git-client/git-branch-service.ts`: local branch list, checkout, and create branch.
- `desktop/electron/services/git-client/git-history-service.ts`: current-branch log, commit detail, commit diff.
- `desktop/electron/modules/git/ipc.ts`: structured IPC surface for renderer calls.
- `desktop/electron/modules/git/__tests__/ipc.test.ts`: schema and handler tests.
- `desktop/electron/services/git-client/__tests__/*.test.ts`: service unit tests.
- `desktop/src/modules/git/app-definition.ts`: system app definition.
- `desktop/src/modules/git/app-manifest.ts`: system app manifest using icon asset.
- `desktop/src/modules/git/assets/icon.png`: 1254 x 1254 PNG matching existing system app style.
- `desktop/src/modules/git/index.tsx`: Git system app entry.
- `desktop/src/modules/git/types.ts`: renderer-local view types if needed.
- `desktop/src/modules/git/hooks/use-git-repositories.ts`: repository list hook.
- `desktop/src/modules/git/hooks/use-git-worktree-status.ts`: worktree snapshot hook.
- `desktop/src/modules/git/hooks/use-git-history.ts`: history hook.
- `desktop/src/modules/git/hooks/use-git-operations.ts`: action wrapper hook.
- `desktop/src/modules/git/components/git-repository-list.tsx`: repository list.
- `desktop/src/modules/git/components/git-clone-dialog.tsx`: clone dialog.
- `desktop/src/modules/git/components/git-workbench.tsx`: workbench shell.
- `desktop/src/modules/git/components/git-changes-tab.tsx`: changes, diff, selected-file commit.
- `desktop/src/modules/git/components/git-history-tab.tsx`: current-branch history.
- `desktop/src/modules/git/components/git-branch-switcher.tsx`: local branch switch/create UI.
- `desktop/src/modules/git/__tests__/*.test.tsx`: renderer tests.

Modify:

- `desktop/src/modules/apps/types.ts`: add `"git"` to `SYSTEM_APP_IDS`.
- `desktop/src/modules/apps/registry.ts`: include `gitAppManifest`.
- `desktop/src/modules/apps/definitions.ts`: include `gitAppDefinition`.
- `desktop/src/modules/apps/components/app-launcher-grid.tsx`: add app description for Git.
- `desktop/src/modules/apps/__tests__/registry.test.ts`: expected fixed app order.
- `desktop/src/modules/apps/__tests__/app-launcher.test.tsx`: launcher description and open behavior.
- `desktop/src/modules/apps/__tests__/system-app-window-app.test.tsx`: known system app window route.
- `desktop/electron/modules/apps/__tests__/ipc.test.ts`: `git` is accepted as system app ID.
- `desktop/electron/bootstrap/descriptors.ts`: register `gitIpcModule`.
- `desktop/electron/preload.ts`: expose `git` bridge methods after IPC generation if generator does not cover the shape automatically.
- `desktop/src/types/bridge.ts`: add `git` bridge type if generation does not cover it.
- `RELEASE_NOTES_PENDING.md`: add user-facing release note after implementation.

Do not modify:

- `templates/`.
- Existing Synapse repository/content/resource repository behavior except shared system app registration arrays.

---

### Task 1: Shared Types and Git Status Parsing Helpers

**Files:**

- Create: `desktop/src/types/git.ts`
- Create: `desktop/electron/services/git-client/git-status-parser.ts`
- Test: `desktop/electron/services/git-client/__tests__/git-status-parser.test.ts`

- [ ] **Step 1: Write failing parser tests**

Create `desktop/electron/services/git-client/__tests__/git-status-parser.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { parseGitStatusPorcelainV2 } from "../git-status-parser"

describe("parseGitStatusPorcelainV2", () => {
  it("parses branch, ahead behind, and common file states", () => {
    const snapshot = parseGitStatusPorcelainV2([
      "# branch.oid 0f00abc",
      "# branch.head main",
      "# branch.upstream origin/main",
      "# branch.ab +2 -1",
      "1 .M N... 100644 100644 100644 abc abc docs/intro.md",
      "1 D. N... 100644 000000 000000 abc 000000 docs/old.md",
      "? docs/new.md",
      "u UU N... 100644 100644 100644 100644 a b c d docs/conflict.md",
    ].join("\n"))

    expect(snapshot.currentBranch).toBe("main")
    expect(snapshot.upstream).toBe("origin/main")
    expect(snapshot.ahead).toBe(2)
    expect(snapshot.behind).toBe(1)
    expect(snapshot.hasConflicts).toBe(true)
    expect(snapshot.changes).toEqual([
      { path: "docs/intro.md", originalPath: null, status: "modified", staged: false, conflicted: false },
      { path: "docs/old.md", originalPath: null, status: "deleted", staged: true, conflicted: false },
      { path: "docs/new.md", originalPath: null, status: "untracked", staged: false, conflicted: false },
      { path: "docs/conflict.md", originalPath: null, status: "conflicted", staged: false, conflicted: true },
    ])
  })

  it("parses renamed files", () => {
    const snapshot = parseGitStatusPorcelainV2(
      "2 R. N... 100644 100644 100644 abc abc R100 docs/new-name.md\t docs/old-name.md",
    )

    expect(snapshot.changes).toEqual([
      { path: "docs/new-name.md", originalPath: "docs/old-name.md", status: "renamed", staged: true, conflicted: false },
    ])
  })
})
```

- [ ] **Step 2: Run parser test to verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/electron/services/git-client/__tests__/git-status-parser.test.ts
```

Expected: fails because `git-status-parser.ts` does not exist.

- [ ] **Step 3: Add shared Git types**

Create `desktop/src/types/git.ts`:

```ts
export type SynapseGitRemoteKind = "https" | "ssh" | "unknown"

export type SynapseGitRepository = {
  readonly id: string
  readonly name: string
  readonly localPath: string
  readonly addedAt: string
  readonly lastOpenedAt: string | null
}

export type SynapseGitFileStatus =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "untracked"
  | "conflicted"
  | "unknown"

export type SynapseGitFileChange = {
  readonly path: string
  readonly originalPath: string | null
  readonly status: SynapseGitFileStatus
  readonly staged: boolean
  readonly conflicted: boolean
}

export type SynapseGitRepositorySnapshot = {
  readonly repositoryId: string
  readonly pathExists: boolean
  readonly isGitRepository: boolean
  readonly currentBranch: string | null
  readonly upstream: string | null
  readonly ahead: number
  readonly behind: number
  readonly hasConflicts: boolean
  readonly changes: readonly SynapseGitFileChange[]
}

export type SynapseGitStatusParseResult = Omit<
  SynapseGitRepositorySnapshot,
  "repositoryId" | "pathExists" | "isGitRepository"
>

export type SynapseGitDiffResult = {
  readonly path: string
  readonly originalPath: string | null
  readonly binary: boolean
  readonly text: string
}

export type SynapseGitBranch = {
  readonly name: string
  readonly current: boolean
}

export type SynapseGitCommitSummary = {
  readonly hash: string
  readonly shortHash: string
  readonly subject: string
  readonly authorName: string
  readonly authorEmail: string
  readonly committedAt: string
}

export type SynapseGitCommitDetail = SynapseGitCommitSummary & {
  readonly files: readonly SynapseGitFileChange[]
  readonly diff: string
}

export type SynapseGitEnvironmentState = {
  readonly gitAvailable: boolean
  readonly gitVersion: string | null
  readonly gitPath: string | null
  readonly sshAvailable: boolean
  readonly userName: string | null
  readonly userEmail: string | null
  readonly commonSshKeyExists: boolean
  readonly installHint: string | null
}

export type SynapseGitOperationResult = {
  readonly completedAt: string
  readonly message: string
}

export type SynapseGitErrorCategory =
  | "git-missing"
  | "auth-failed"
  | "network-failed"
  | "path-missing"
  | "not-git-repository"
  | "working-tree-dirty"
  | "non-fast-forward"
  | "conflict"
  | "unknown"
```

- [ ] **Step 4: Add parser implementation**

Create `desktop/electron/services/git-client/git-status-parser.ts`:

```ts
import type {
  SynapseGitFileChange,
  SynapseGitFileStatus,
  SynapseGitStatusParseResult,
} from "../../../src/types/git"

const EMPTY_RESULT: SynapseGitStatusParseResult = {
  currentBranch: null,
  upstream: null,
  ahead: 0,
  behind: 0,
  hasConflicts: false,
  changes: [],
}

function parseAheadBehind(line: string): Pick<SynapseGitStatusParseResult, "ahead" | "behind"> {
  const match = line.match(/^# branch\.ab \+(\d+) -(\d+)$/)
  if (!match) return { ahead: 0, behind: 0 }
  return {
    ahead: Number.parseInt(match[1] ?? "0", 10) || 0,
    behind: Number.parseInt(match[2] ?? "0", 10) || 0,
  }
}

function statusFromCodes(indexCode: string, worktreeCode: string): SynapseGitFileStatus {
  if (indexCode === "U" || worktreeCode === "U" || (indexCode === "A" && worktreeCode === "A")) return "conflicted"
  if (indexCode === "R") return "renamed"
  if (indexCode === "A") return "added"
  if (indexCode === "D" || worktreeCode === "D") return "deleted"
  if (indexCode === "M" || worktreeCode === "M") return "modified"
  return "unknown"
}

function parseOrdinaryChange(line: string): SynapseGitFileChange | null {
  const fields = line.split(" ")
  if (fields.length < 9) return null
  const xy = fields[1] ?? ".."
  const indexCode = xy[0] ?? "."
  const worktreeCode = xy[1] ?? "."
  const path = fields.slice(8).join(" ").trim()
  if (!path) return null
  const status = statusFromCodes(indexCode, worktreeCode)
  return {
    path,
    originalPath: null,
    status,
    staged: indexCode !== "." && status !== "conflicted",
    conflicted: status === "conflicted",
  }
}

function parseRenamedChange(line: string): SynapseGitFileChange | null {
  const tabIndex = line.indexOf("\t")
  const beforeTab = tabIndex >= 0 ? line.slice(0, tabIndex) : line
  const originalPath = tabIndex >= 0 ? line.slice(tabIndex + 1).trim() : null
  const fields = beforeTab.split(" ")
  if (fields.length < 10) return null
  const xy = fields[1] ?? ".."
  const path = fields.slice(9).join(" ").trim()
  if (!path) return null
  return {
    path,
    originalPath,
    status: "renamed",
    staged: xy[0] !== ".",
    conflicted: false,
  }
}

function parseUntrackedChange(line: string): SynapseGitFileChange | null {
  const path = line.slice(2).trim()
  if (!path) return null
  return {
    path,
    originalPath: null,
    status: "untracked",
    staged: false,
    conflicted: false,
  }
}

function parseConflictChange(line: string): SynapseGitFileChange | null {
  const fields = line.split(" ")
  const path = fields.slice(10).join(" ").trim()
  if (!path) return null
  return {
    path,
    originalPath: null,
    status: "conflicted",
    staged: false,
    conflicted: true,
  }
}

export function parseGitStatusPorcelainV2(stdout: string): SynapseGitStatusParseResult {
  const result: SynapseGitStatusParseResult = { ...EMPTY_RESULT, changes: [] }
  const changes: SynapseGitFileChange[] = []
  let ahead = 0
  let behind = 0
  let currentBranch: string | null = null
  let upstream: string | null = null
  let hasConflicts = false

  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue
    if (line.startsWith("# branch.head ")) {
      const value = line.slice("# branch.head ".length).trim()
      currentBranch = value === "(detached)" ? null : value
      continue
    }
    if (line.startsWith("# branch.upstream ")) {
      upstream = line.slice("# branch.upstream ".length).trim() || null
      continue
    }
    if (line.startsWith("# branch.ab ")) {
      const parsed = parseAheadBehind(line)
      ahead = parsed.ahead
      behind = parsed.behind
      continue
    }

    const change = line.startsWith("1 ")
      ? parseOrdinaryChange(line)
      : line.startsWith("2 ")
        ? parseRenamedChange(line)
        : line.startsWith("? ")
          ? parseUntrackedChange(line)
          : line.startsWith("u ")
            ? parseConflictChange(line)
            : null

    if (change) {
      changes.push(change)
      hasConflicts = hasConflicts || change.conflicted
    }
  }

  return {
    ...result,
    currentBranch,
    upstream,
    ahead,
    behind,
    hasConflicts,
    changes,
  }
}
```

- [ ] **Step 5: Run parser test**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/electron/services/git-client/__tests__/git-status-parser.test.ts
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add desktop/src/types/git.ts desktop/electron/services/git-client/git-status-parser.ts desktop/electron/services/git-client/__tests__/git-status-parser.test.ts
git commit -m "feat(git): add shared git types and status parser"
```

---

### Task 2: Git Command Runner, Error Categories, and Path Safety

**Files:**

- Create: `desktop/electron/services/git-client/git-command-runner.ts`
- Create: `desktop/electron/services/git-client/git-path-utils.ts`
- Test: `desktop/electron/services/git-client/__tests__/git-command-runner.test.ts`
- Test: `desktop/electron/services/git-client/__tests__/git-path-utils.test.ts`

- [ ] **Step 1: Write failing runner and path tests**

Create `desktop/electron/services/git-client/__tests__/git-command-runner.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"
import { categorizeGitError, createGitClientCommandRunner } from "../git-command-runner"

describe("categorizeGitError", () => {
  it("maps common Git failures to product categories", () => {
    expect(categorizeGitError(new Error("current system has no git command"))).toBe("git-missing")
    expect(categorizeGitError(new Error("Authentication failed for https://example.com/repo.git"))).toBe("auth-failed")
    expect(categorizeGitError(new Error("Could not resolve host: git.example.com"))).toBe("network-failed")
    expect(categorizeGitError(new Error("not a git repository"))).toBe("not-git-repository")
    expect(categorizeGitError(new Error("Your local changes would be overwritten by checkout"))).toBe("working-tree-dirty")
    expect(categorizeGitError(new Error("non-fast-forward"))).toBe("non-fast-forward")
    expect(categorizeGitError(new Error("CONFLICT (content): Merge conflict"))).toBe("conflict")
  })
})

describe("createGitClientCommandRunner", () => {
  it("passes args as arrays and keeps terminal prompt disabled", async () => {
    const run = vi.fn().mockResolvedValue({ stdout: "ok\n", stderr: "" })
    const runner = createGitClientCommandRunner({ runGitCommand: run })

    await expect(runner.run({ cwd: "/repo", args: ["status", "--porcelain=v2"] })).resolves.toEqual({
      stdout: "ok\n",
      stderr: "",
    })

    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      cwd: "/repo",
      args: ["status", "--porcelain=v2"],
      fallbackMessage: "Git 操作失败。",
      timeoutMs: 60000,
    }))
  })
})
```

Create `desktop/electron/services/git-client/__tests__/git-path-utils.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { assertRepositoryPath, normalizeRepositoryPath } from "../git-path-utils"

describe("git path utilities", () => {
  it("normalizes repository paths", () => {
    expect(normalizeRepositoryPath("/tmp/repo/../repo")).toBe("/tmp/repo")
  })

  it("allows paths inside the repository", () => {
    expect(() => assertRepositoryPath("/tmp/repo", "docs/a.md")).not.toThrow()
  })

  it("rejects paths outside the repository", () => {
    expect(() => assertRepositoryPath("/tmp/repo", "../secret.txt")).toThrow("文件不在当前仓库内。")
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/electron/services/git-client/__tests__/git-command-runner.test.ts desktop/electron/services/git-client/__tests__/git-path-utils.test.ts
```

Expected: fail because files do not exist.

- [ ] **Step 3: Implement runner**

Create `desktop/electron/services/git-client/git-command-runner.ts`:

```ts
import type { SynapseGitErrorCategory } from "../../../src/types/git"
import { runGitCommand, type GitCommandResult } from "../git-command"

type GitClientRunInput = {
  readonly cwd: string
  readonly args: readonly string[]
  readonly fallbackMessage?: string
  readonly timeoutMs?: number
}

type GitCommandFunction = typeof runGitCommand

export function categorizeGitError(error: unknown): SynapseGitErrorCategory {
  const message = error instanceof Error ? error.message : String(error)
  if (/no available git|no git command|ENOENT|没有可用的 git|git 命令/i.test(message)) return "git-missing"
  if (/authentication failed|permission denied|could not read username|access denied|认证失败/i.test(message)) return "auth-failed"
  if (/could not resolve host|failed to connect|network|timed out|timeout|超时/i.test(message)) return "network-failed"
  if (/not a git repository/i.test(message)) return "not-git-repository"
  if (/local changes would be overwritten|working tree|uncommitted changes|未提交/i.test(message)) return "working-tree-dirty"
  if (/non-fast-forward|fetch first|rejected/i.test(message)) return "non-fast-forward"
  if (/conflict|merge conflict|CONFLICT/i.test(message)) return "conflict"
  return "unknown"
}

export function createGitClientCommandRunner(deps: { readonly runGitCommand?: GitCommandFunction } = {}) {
  const command = deps.runGitCommand ?? runGitCommand
  return {
    async run(input: GitClientRunInput): Promise<GitCommandResult> {
      return command({
        args: [...input.args],
        cwd: input.cwd,
        fallbackMessage: input.fallbackMessage ?? "Git 操作失败。",
        timeoutMessage: "Git 操作超时。",
        timeoutMs: input.timeoutMs ?? 60_000,
      })
    },
  }
}

export type GitClientCommandRunner = ReturnType<typeof createGitClientCommandRunner>
```

- [ ] **Step 4: Implement path helpers**

Create `desktop/electron/services/git-client/git-path-utils.ts`:

```ts
import path from "node:path"

export function normalizeRepositoryPath(localPath: string): string {
  return path.resolve(localPath)
}

export function assertRepositoryPath(repositoryPath: string, relativePath: string): string {
  const root = normalizeRepositoryPath(repositoryPath)
  const resolved = path.resolve(root, relativePath)
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error("文件不在当前仓库内。")
  }
  return resolved
}
```

- [ ] **Step 5: Run tests**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/electron/services/git-client/__tests__/git-command-runner.test.ts desktop/electron/services/git-client/__tests__/git-path-utils.test.ts
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add desktop/electron/services/git-client/git-command-runner.ts desktop/electron/services/git-client/git-path-utils.ts desktop/electron/services/git-client/__tests__/git-command-runner.test.ts desktop/electron/services/git-client/__tests__/git-path-utils.test.ts
git commit -m "feat(git): add command runner and path guards"
```

---

### Task 3: Repository Registry Persistence

**Files:**

- Create: `desktop/electron/services/git-client/git-repository-registry.ts`
- Test: `desktop/electron/services/git-client/__tests__/git-repository-registry.test.ts`

- [ ] **Step 1: Write failing registry tests**

Create `desktop/electron/services/git-client/__tests__/git-repository-registry.test.ts`:

```ts
import { mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { createGitRepositoryRegistry } from "../git-repository-registry"

let tempDir: string | null = null

async function makeRegistry() {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-git-registry-"))
  return createGitRepositoryRegistry({ userDataPath: tempDir, now: () => new Date("2026-06-17T10:00:00.000Z") })
}

afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true })
  tempDir = null
})

describe("git repository registry", () => {
  it("adds, lists, opens, and removes repositories without deleting local files", async () => {
    const registry = await makeRegistry()
    const added = await registry.addLocal({ name: "Docs", localPath: "/tmp/docs" })

    expect(await registry.list()).toEqual([added])
    expect(added).toMatchObject({
      name: "Docs",
      localPath: path.resolve("/tmp/docs"),
      addedAt: "2026-06-17T10:00:00.000Z",
      lastOpenedAt: null,
    })

    await registry.markOpened(added.id)
    expect((await registry.list())[0]?.lastOpenedAt).toBe("2026-06-17T10:00:00.000Z")

    await registry.remove(added.id)
    expect(await registry.list()).toEqual([])
  })

  it("deduplicates repositories by normalized path", async () => {
    const registry = await makeRegistry()
    const first = await registry.addLocal({ name: "Docs", localPath: "/tmp/docs" })
    const second = await registry.addLocal({ name: "Docs Again", localPath: "/tmp/docs/." })

    expect(second.id).toBe(first.id)
    expect(await registry.list()).toHaveLength(1)
  })

  it("stores data in the git module registry file", async () => {
    const registry = await makeRegistry()
    await registry.addLocal({ name: "Docs", localPath: "/tmp/docs" })

    const raw = await readFile(path.join(tempDir as string, "git-client", "repositories.json"), "utf8")
    expect(JSON.parse(raw).repositories).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/electron/services/git-client/__tests__/git-repository-registry.test.ts
```

Expected: fail because registry file does not exist.

- [ ] **Step 3: Implement registry**

Create `desktop/electron/services/git-client/git-repository-registry.ts`:

```ts
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { randomUUID } from "node:crypto"
import type { SynapseGitRepository } from "../../../src/types/git"
import { normalizeRepositoryPath } from "./git-path-utils"

type RegistryFile = {
  readonly version: 1
  readonly repositories: readonly SynapseGitRepository[]
}

type AddLocalInput = {
  readonly name: string
  readonly localPath: string
}

type RegistryDeps = {
  readonly userDataPath: string
  readonly now?: () => Date
}

function registryFilePath(userDataPath: string): string {
  return path.join(userDataPath, "git-client", "repositories.json")
}

function sanitizeName(name: string, localPath: string): string {
  const trimmed = name.trim()
  return trimmed || path.basename(localPath) || "Git 仓库"
}

async function readRegistry(filePath: string): Promise<RegistryFile> {
  try {
    const raw = await readFile(filePath, "utf8")
    const parsed = JSON.parse(raw) as Partial<RegistryFile>
    return {
      version: 1,
      repositories: Array.isArray(parsed.repositories) ? parsed.repositories : [],
    }
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { version: 1, repositories: [] }
    }
    throw error
  }
}

async function writeRegistry(filePath: string, data: RegistryFile): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8")
}

export function createGitRepositoryRegistry(deps: RegistryDeps) {
  const filePath = registryFilePath(deps.userDataPath)
  const now = deps.now ?? (() => new Date())

  return {
    async list(): Promise<SynapseGitRepository[]> {
      const data = await readRegistry(filePath)
      return [...data.repositories]
    },

    async addLocal(input: AddLocalInput): Promise<SynapseGitRepository> {
      const data = await readRegistry(filePath)
      const localPath = normalizeRepositoryPath(input.localPath)
      const existing = data.repositories.find((repository) => repository.localPath === localPath)
      if (existing) return existing

      const repository: SynapseGitRepository = {
        id: randomUUID(),
        name: sanitizeName(input.name, localPath),
        localPath,
        addedAt: now().toISOString(),
        lastOpenedAt: null,
      }
      await writeRegistry(filePath, { version: 1, repositories: [...data.repositories, repository] })
      return repository
    },

    async markOpened(repositoryId: string): Promise<void> {
      const data = await readRegistry(filePath)
      const openedAt = now().toISOString()
      await writeRegistry(filePath, {
        version: 1,
        repositories: data.repositories.map((repository) => (
          repository.id === repositoryId ? { ...repository, lastOpenedAt: openedAt } : repository
        )),
      })
    },

    async remove(repositoryId: string): Promise<void> {
      const data = await readRegistry(filePath)
      await writeRegistry(filePath, {
        version: 1,
        repositories: data.repositories.filter((repository) => repository.id !== repositoryId),
      })
    },
  }
}

export type GitRepositoryRegistry = ReturnType<typeof createGitRepositoryRegistry>
```

- [ ] **Step 4: Run registry test**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/electron/services/git-client/__tests__/git-repository-registry.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add desktop/electron/services/git-client/git-repository-registry.ts desktop/electron/services/git-client/__tests__/git-repository-registry.test.ts
git commit -m "feat(git): persist independent git repository list"
```

---

### Task 4: Environment, Clone, and Identity Services

**Files:**

- Create: `desktop/electron/services/git-client/git-environment-service.ts`
- Create: `desktop/electron/services/git-client/git-clone-service.ts`
- Test: `desktop/electron/services/git-client/__tests__/git-environment-service.test.ts`
- Test: `desktop/electron/services/git-client/__tests__/git-clone-service.test.ts`

- [ ] **Step 1: Write failing tests**

Create `desktop/electron/services/git-client/__tests__/git-environment-service.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"
import { createGitEnvironmentService } from "../git-environment-service"

describe("git environment service", () => {
  it("reports Git and identity state", async () => {
    const run = vi.fn()
      .mockResolvedValueOnce({ stdout: "git version 2.50.0\n", stderr: "" })
      .mockResolvedValueOnce({ stdout: "ssh -V output\n", stderr: "" })
      .mockResolvedValueOnce({ stdout: "Writer\n", stderr: "" })
      .mockResolvedValueOnce({ stdout: "writer@example.com\n", stderr: "" })

    const service = createGitEnvironmentService({
      commandRunner: { run },
      homeDir: "/Users/writer",
      pathExists: async (filePath) => filePath.endsWith("id_ed25519.pub"),
      platform: "darwin",
    })

    await expect(service.check()).resolves.toEqual({
      gitAvailable: true,
      gitVersion: "git version 2.50.0",
      gitPath: null,
      sshAvailable: true,
      userName: "Writer",
      userEmail: "writer@example.com",
      commonSshKeyExists: true,
      installHint: null,
    })
  })

  it("returns install hint when Git is missing", async () => {
    const service = createGitEnvironmentService({
      commandRunner: { run: vi.fn().mockRejectedValue(new Error("ENOENT")) },
      homeDir: "/Users/writer",
      pathExists: async () => false,
      platform: "win32",
    })

    const state = await service.check()
    expect(state.gitAvailable).toBe(false)
    expect(state.installHint).toBe("安装 Git for Windows 后重新检测。")
  })

  it("writes global identity", async () => {
    const run = vi.fn().mockResolvedValue({ stdout: "", stderr: "" })
    const service = createGitEnvironmentService({
      commandRunner: { run },
      homeDir: "/Users/writer",
      pathExists: async () => false,
      platform: "darwin",
    })

    await service.configureIdentity({ userName: "Writer", userEmail: "writer@example.com" })

    expect(run).toHaveBeenCalledWith({ cwd: "/Users/writer", args: ["config", "--global", "user.name", "Writer"] })
    expect(run).toHaveBeenCalledWith({ cwd: "/Users/writer", args: ["config", "--global", "user.email", "writer@example.com"] })
  })
})
```

Create `desktop/electron/services/git-client/__tests__/git-clone-service.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"
import { createGitCloneService, detectRemoteKind } from "../git-clone-service"

describe("detectRemoteKind", () => {
  it("detects https and ssh URLs", () => {
    expect(detectRemoteKind("https://git.example.com/team/docs.git")).toBe("https")
    expect(detectRemoteKind("git@git.example.com:team/docs.git")).toBe("ssh")
    expect(detectRemoteKind("file:///tmp/repo")).toBe("unknown")
  })
})

describe("git clone service", () => {
  it("clones into the selected target and registers the repository", async () => {
    const run = vi.fn().mockResolvedValue({ stdout: "", stderr: "" })
    const addLocal = vi.fn().mockResolvedValue({
      id: "repo-1",
      name: "docs",
      localPath: "/work/docs",
      addedAt: "2026-06-17T10:00:00.000Z",
      lastOpenedAt: null,
    })
    const service = createGitCloneService({
      commandRunner: { run },
      registry: { addLocal },
      pathExists: async () => false,
    })

    const result = await service.clone({
      remoteUrl: "https://git.example.com/team/docs.git",
      targetPath: "/work/docs",
      name: "docs",
    })

    expect(run).toHaveBeenCalledWith({ cwd: "/work", args: ["clone", "--progress", "https://git.example.com/team/docs.git", "/work/docs"], timeoutMs: 300000 })
    expect(result.repository.id).toBe("repo-1")
  })

  it("does not overwrite existing targets", async () => {
    const service = createGitCloneService({
      commandRunner: { run: vi.fn() },
      registry: { addLocal: vi.fn() },
      pathExists: async () => true,
    })

    await expect(service.clone({
      remoteUrl: "https://git.example.com/team/docs.git",
      targetPath: "/work/docs",
      name: "docs",
    })).rejects.toThrow("目标目录已存在。请选择空目录。")
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/electron/services/git-client/__tests__/git-environment-service.test.ts desktop/electron/services/git-client/__tests__/git-clone-service.test.ts
```

Expected: fail because services do not exist.

- [ ] **Step 3: Implement environment service**

Create `desktop/electron/services/git-client/git-environment-service.ts`:

```ts
import path from "node:path"
import type { SynapseGitEnvironmentState } from "../../../src/types/git"
import type { GitClientCommandRunner } from "./git-command-runner"

type Platform = NodeJS.Platform

type EnvironmentDeps = {
  readonly commandRunner: Pick<GitClientCommandRunner, "run">
  readonly homeDir: string
  readonly pathExists: (filePath: string) => Promise<boolean>
  readonly platform: Platform
}

function installHint(platform: Platform): string {
  if (platform === "win32") return "安装 Git for Windows 后重新检测。"
  if (platform === "darwin") return "安装 Apple Command Line Tools 或官方 Git 后重新检测。"
  return "通过系统包管理器安装 Git 后重新检测。"
}

async function readConfig(commandRunner: Pick<GitClientCommandRunner, "run">, homeDir: string, key: string): Promise<string | null> {
  try {
    const result = await commandRunner.run({ cwd: homeDir, args: ["config", "--global", key] })
    return result.stdout.trim() || null
  } catch {
    return null
  }
}

async function hasCommonSshKey(homeDir: string, pathExists: (filePath: string) => Promise<boolean>): Promise<boolean> {
  const sshDir = path.join(homeDir, ".ssh")
  return (await pathExists(path.join(sshDir, "id_ed25519.pub")))
    || (await pathExists(path.join(sshDir, "id_rsa.pub")))
}

export function createGitEnvironmentService(deps: EnvironmentDeps) {
  return {
    async check(): Promise<SynapseGitEnvironmentState> {
      try {
        const gitVersionResult = await deps.commandRunner.run({ cwd: deps.homeDir, args: ["--version"] })
        let sshAvailable = false
        try {
          await deps.commandRunner.run({ cwd: deps.homeDir, args: ["-c", "core.sshCommand=ssh -V", "version"] })
          sshAvailable = true
        } catch {
          sshAvailable = false
        }

        return {
          gitAvailable: true,
          gitVersion: gitVersionResult.stdout.trim() || null,
          gitPath: null,
          sshAvailable,
          userName: await readConfig(deps.commandRunner, deps.homeDir, "user.name"),
          userEmail: await readConfig(deps.commandRunner, deps.homeDir, "user.email"),
          commonSshKeyExists: await hasCommonSshKey(deps.homeDir, deps.pathExists),
          installHint: null,
        }
      } catch {
        return {
          gitAvailable: false,
          gitVersion: null,
          gitPath: null,
          sshAvailable: false,
          userName: null,
          userEmail: null,
          commonSshKeyExists: await hasCommonSshKey(deps.homeDir, deps.pathExists),
          installHint: installHint(deps.platform),
        }
      }
    },

    async configureIdentity(input: { readonly userName: string; readonly userEmail: string }): Promise<void> {
      const userName = input.userName.trim()
      const userEmail = input.userEmail.trim()
      if (!userName) throw new Error("请输入用户名。")
      if (!userEmail) throw new Error("请输入邮箱。")
      await deps.commandRunner.run({ cwd: deps.homeDir, args: ["config", "--global", "user.name", userName] })
      await deps.commandRunner.run({ cwd: deps.homeDir, args: ["config", "--global", "user.email", userEmail] })
    },
  }
}
```

Note for implementer: if `git -c core.sshCommand=ssh -V version` behaves inconsistently on a platform, replace the SSH probe with a direct `execFile("ssh", ["-V"])` helper and adjust the test to inject that helper. Keep the public service result unchanged.

- [ ] **Step 4: Implement clone service**

Create `desktop/electron/services/git-client/git-clone-service.ts`:

```ts
import path from "node:path"
import type { SynapseGitRemoteKind, SynapseGitRepository } from "../../../src/types/git"
import type { GitClientCommandRunner } from "./git-command-runner"

type CloneInput = {
  readonly remoteUrl: string
  readonly targetPath: string
  readonly name: string
}

type CloneResult = {
  readonly repository: SynapseGitRepository
  readonly remoteKind: SynapseGitRemoteKind
}

type CloneDeps = {
  readonly commandRunner: Pick<GitClientCommandRunner, "run">
  readonly registry: { addLocal(input: { readonly name: string; readonly localPath: string }): Promise<SynapseGitRepository> }
  readonly pathExists: (filePath: string) => Promise<boolean>
}

export function detectRemoteKind(remoteUrl: string): SynapseGitRemoteKind {
  if (/^https:\/\//i.test(remoteUrl)) return "https"
  if (/^(ssh:\/\/|[^@\s]+@[^:\s]+:.+)/i.test(remoteUrl)) return "ssh"
  return "unknown"
}

export function createGitCloneService(deps: CloneDeps) {
  return {
    async clone(input: CloneInput): Promise<CloneResult> {
      const remoteUrl = input.remoteUrl.trim()
      const targetPath = path.resolve(input.targetPath)
      if (!remoteUrl) throw new Error("请输入仓库地址。")
      if (!targetPath) throw new Error("请选择保存位置。")
      if (await deps.pathExists(targetPath)) {
        throw new Error("目标目录已存在。请选择空目录。")
      }

      await deps.commandRunner.run({
        cwd: path.dirname(targetPath),
        args: ["clone", "--progress", remoteUrl, targetPath],
        timeoutMs: 300_000,
      })
      const repository = await deps.registry.addLocal({ name: input.name, localPath: targetPath })
      return { repository, remoteKind: detectRemoteKind(remoteUrl) }
    },
  }
}
```

- [ ] **Step 5: Run tests**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/electron/services/git-client/__tests__/git-environment-service.test.ts desktop/electron/services/git-client/__tests__/git-clone-service.test.ts
```

Expected: pass. If the SSH probe test needs a direct `execFile` injection, update the test and service together in this task.

- [ ] **Step 6: Commit**

```bash
git add desktop/electron/services/git-client/git-environment-service.ts desktop/electron/services/git-client/git-clone-service.ts desktop/electron/services/git-client/__tests__/git-environment-service.test.ts desktop/electron/services/git-client/__tests__/git-clone-service.test.ts
git commit -m "feat(git): add environment and clone services"
```

---

### Task 5: Status, Diff, Commit, Sync, Branch, and History Services

**Files:**

- Create: `desktop/electron/services/git-client/git-status-service.ts`
- Create: `desktop/electron/services/git-client/git-commit-service.ts`
- Create: `desktop/electron/services/git-client/git-sync-service.ts`
- Create: `desktop/electron/services/git-client/git-branch-service.ts`
- Create: `desktop/electron/services/git-client/git-history-service.ts`
- Test: `desktop/electron/services/git-client/__tests__/git-worktree-services.test.ts`

- [ ] **Step 1: Write failing service tests**

Create `desktop/electron/services/git-client/__tests__/git-worktree-services.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"
import { createGitBranchService } from "../git-branch-service"
import { createGitCommitService } from "../git-commit-service"
import { createGitHistoryService } from "../git-history-service"
import { createGitStatusService } from "../git-status-service"
import { createGitSyncService } from "../git-sync-service"

const repository = {
  id: "repo-1",
  name: "Docs",
  localPath: "/repo",
  addedAt: "2026-06-17T10:00:00.000Z",
  lastOpenedAt: null,
}

describe("git worktree services", () => {
  it("reads status snapshot", async () => {
    const run = vi.fn().mockResolvedValue({
      stdout: "# branch.head main\n# branch.upstream origin/main\n# branch.ab +1 -0\n1 .M N... 100644 100644 100644 abc abc docs/a.md\n",
      stderr: "",
    })
    const service = createGitStatusService({ commandRunner: { run }, pathExists: async () => true })

    await expect(service.getSnapshot(repository)).resolves.toMatchObject({
      repositoryId: "repo-1",
      pathExists: true,
      isGitRepository: true,
      currentBranch: "main",
      ahead: 1,
      behind: 0,
    })
  })

  it("loads text diff and marks binary diff", async () => {
    const textService = createGitStatusService({
      commandRunner: { run: vi.fn().mockResolvedValue({ stdout: "diff --git a/docs/a.md b/docs/a.md\n+hello\n", stderr: "" }) },
      pathExists: async () => true,
    })
    await expect(textService.getDiff(repository, { path: "docs/a.md", staged: false })).resolves.toEqual({
      path: "docs/a.md",
      originalPath: null,
      binary: false,
      text: "diff --git a/docs/a.md b/docs/a.md\n+hello\n",
    })

    const binaryService = createGitStatusService({
      commandRunner: { run: vi.fn().mockResolvedValue({ stdout: "Binary files a/logo.png and b/logo.png differ\n", stderr: "" }) },
      pathExists: async () => true,
    })
    await expect(binaryService.getDiff(repository, { path: "logo.png", staged: false })).resolves.toMatchObject({ binary: true })
  })

  it("commits selected files", async () => {
    const run = vi.fn().mockResolvedValue({ stdout: "", stderr: "" })
    const service = createGitCommitService({ commandRunner: { run }, now: () => new Date("2026-06-17T10:00:00.000Z") })

    await expect(service.commit(repository, { message: "更新文档", paths: ["docs/a.md"] })).resolves.toEqual({
      completedAt: "2026-06-17T10:00:00.000Z",
      message: "已提交选中文件。",
    })

    expect(run).toHaveBeenCalledWith({ cwd: "/repo", args: ["add", "--", "docs/a.md"] })
    expect(run).toHaveBeenCalledWith({ cwd: "/repo", args: ["commit", "-m", "更新文档"] })
  })

  it("syncs by fetch, pull fast-forward, then push", async () => {
    const run = vi.fn().mockResolvedValue({ stdout: "", stderr: "" })
    const getSnapshot = vi.fn()
      .mockResolvedValueOnce({ changes: [], behind: 2, ahead: 1 })
      .mockResolvedValueOnce({ changes: [], behind: 0, ahead: 1 })
    const service = createGitSyncService({ commandRunner: { run }, getSnapshot, now: () => new Date("2026-06-17T10:00:00.000Z") })

    await service.sync(repository)

    expect(run).toHaveBeenCalledWith({ cwd: "/repo", args: ["fetch", "--prune"], timeoutMs: 120000 })
    expect(run).toHaveBeenCalledWith({ cwd: "/repo", args: ["pull", "--ff-only"], timeoutMs: 120000 })
    expect(run).toHaveBeenCalledWith({ cwd: "/repo", args: ["push"], timeoutMs: 120000 })
  })

  it("blocks sync when worktree has changes", async () => {
    const service = createGitSyncService({
      commandRunner: { run: vi.fn() },
      getSnapshot: vi.fn().mockResolvedValue({ changes: [{ path: "a.md" }], behind: 0, ahead: 0 }),
      now: () => new Date("2026-06-17T10:00:00.000Z"),
    })

    await expect(service.sync(repository)).rejects.toThrow("请先提交本地改动。")
  })

  it("lists and switches local branches", async () => {
    const run = vi.fn()
      .mockResolvedValueOnce({ stdout: "* main\n  docs-update\n", stderr: "" })
      .mockResolvedValueOnce({ stdout: "", stderr: "" })
      .mockResolvedValueOnce({ stdout: "", stderr: "" })
    const service = createGitBranchService({ commandRunner: { run }, getSnapshot: vi.fn().mockResolvedValue({ changes: [] }) })

    await expect(service.list(repository)).resolves.toEqual([
      { name: "main", current: true },
      { name: "docs-update", current: false },
    ])
    await service.checkout(repository, "docs-update")
    await service.create(repository, "new-docs")

    expect(run).toHaveBeenCalledWith({ cwd: "/repo", args: ["checkout", "docs-update"] })
    expect(run).toHaveBeenCalledWith({ cwd: "/repo", args: ["checkout", "-b", "new-docs"] })
  })

  it("reads current branch history and commit details", async () => {
    const run = vi.fn()
      .mockResolvedValueOnce({ stdout: "abc123%x1fa1b2c3d%x1f更新文档%x1f张三%x1fzhang@example.com%x1f2026-06-17T10:00:00+08:00%x1e", stderr: "" })
      .mockResolvedValueOnce({ stdout: "abc123%x1fa1b2c3d%x1f更新文档%x1f张三%x1fzhang@example.com%x1f2026-06-17T10:00:00+08:00\nM\tdocs/a.md\n", stderr: "" })
      .mockResolvedValueOnce({ stdout: "diff --git a/docs/a.md b/docs/a.md\n+hello\n", stderr: "" })
    const service = createGitHistoryService({ commandRunner: { run } })

    await expect(service.list(repository, { limit: 20, offset: 0 })).resolves.toHaveLength(1)
    await expect(service.getCommit(repository, "abc123")).resolves.toMatchObject({
      hash: "abc123",
      shortHash: "a1b2c3d",
      subject: "更新文档",
      files: [{ path: "docs/a.md", originalPath: null, status: "modified", staged: false, conflicted: false }],
      diff: "diff --git a/docs/a.md b/docs/a.md\n+hello\n",
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/electron/services/git-client/__tests__/git-worktree-services.test.ts
```

Expected: fail because services do not exist.

- [ ] **Step 3: Implement status service**

Create `desktop/electron/services/git-client/git-status-service.ts`:

```ts
import type { SynapseGitDiffResult, SynapseGitRepository, SynapseGitRepositorySnapshot } from "../../../src/types/git"
import type { GitClientCommandRunner } from "./git-command-runner"
import { assertRepositoryPath } from "./git-path-utils"
import { parseGitStatusPorcelainV2 } from "./git-status-parser"

type StatusDeps = {
  readonly commandRunner: Pick<GitClientCommandRunner, "run">
  readonly pathExists: (filePath: string) => Promise<boolean>
}

function isNotGitRepository(error: unknown): boolean {
  return error instanceof Error && /not a git repository/i.test(error.message)
}

export function createGitStatusService(deps: StatusDeps) {
  return {
    async getSnapshot(repository: SynapseGitRepository): Promise<SynapseGitRepositorySnapshot> {
      if (!(await deps.pathExists(repository.localPath))) {
        return {
          repositoryId: repository.id,
          pathExists: false,
          isGitRepository: false,
          currentBranch: null,
          upstream: null,
          ahead: 0,
          behind: 0,
          hasConflicts: false,
          changes: [],
        }
      }

      try {
        const result = await deps.commandRunner.run({
          cwd: repository.localPath,
          args: ["status", "--porcelain=v2", "--branch"],
        })
        return {
          repositoryId: repository.id,
          pathExists: true,
          isGitRepository: true,
          ...parseGitStatusPorcelainV2(result.stdout),
        }
      } catch (error) {
        if (isNotGitRepository(error)) {
          return {
            repositoryId: repository.id,
            pathExists: true,
            isGitRepository: false,
            currentBranch: null,
            upstream: null,
            ahead: 0,
            behind: 0,
            hasConflicts: false,
            changes: [],
          }
        }
        throw error
      }
    },

    async getDiff(
      repository: SynapseGitRepository,
      input: { readonly path: string; readonly originalPath?: string | null; readonly staged: boolean },
    ): Promise<SynapseGitDiffResult> {
      assertRepositoryPath(repository.localPath, input.path)
      const args = input.staged
        ? ["diff", "--staged", "--", input.path]
        : ["diff", "--", input.path]
      const result = await deps.commandRunner.run({ cwd: repository.localPath, args })
      const text = result.stdout
      return {
        path: input.path,
        originalPath: input.originalPath ?? null,
        binary: /^Binary files /m.test(text),
        text,
      }
    },
  }
}
```

- [ ] **Step 4: Implement commit service**

Create `desktop/electron/services/git-client/git-commit-service.ts`:

```ts
import type { SynapseGitOperationResult, SynapseGitRepository } from "../../../src/types/git"
import type { GitClientCommandRunner } from "./git-command-runner"
import { assertRepositoryPath } from "./git-path-utils"

type CommitDeps = {
  readonly commandRunner: Pick<GitClientCommandRunner, "run">
  readonly now?: () => Date
}

export function createGitCommitService(deps: CommitDeps) {
  const now = deps.now ?? (() => new Date())
  return {
    async commit(
      repository: SynapseGitRepository,
      input: { readonly message: string; readonly paths: readonly string[] },
    ): Promise<SynapseGitOperationResult> {
      const message = input.message.trim()
      if (!message) throw new Error("请输入提交说明。")
      if (input.paths.length === 0) throw new Error("请选择要提交的文件。")
      for (const filePath of input.paths) {
        assertRepositoryPath(repository.localPath, filePath)
      }
      await deps.commandRunner.run({ cwd: repository.localPath, args: ["add", "--", ...input.paths] })
      await deps.commandRunner.run({ cwd: repository.localPath, args: ["commit", "-m", message] })
      return {
        completedAt: now().toISOString(),
        message: "已提交选中文件。",
      }
    },
  }
}
```

- [ ] **Step 5: Implement sync service**

Create `desktop/electron/services/git-client/git-sync-service.ts`:

```ts
import type { SynapseGitOperationResult, SynapseGitRepository, SynapseGitRepositorySnapshot } from "../../../src/types/git"
import type { GitClientCommandRunner } from "./git-command-runner"

type SyncDeps = {
  readonly commandRunner: Pick<GitClientCommandRunner, "run">
  readonly getSnapshot: (repository: SynapseGitRepository) => Promise<Pick<SynapseGitRepositorySnapshot, "changes" | "ahead" | "behind">>
  readonly now?: () => Date
}

export function createGitSyncService(deps: SyncDeps) {
  const now = deps.now ?? (() => new Date())

  async function result(message: string): Promise<SynapseGitOperationResult> {
    return { completedAt: now().toISOString(), message }
  }

  return {
    async fetch(repository: SynapseGitRepository): Promise<SynapseGitOperationResult> {
      await deps.commandRunner.run({ cwd: repository.localPath, args: ["fetch", "--prune"], timeoutMs: 120_000 })
      return result("已获取远程更新。")
    },

    async pull(repository: SynapseGitRepository): Promise<SynapseGitOperationResult> {
      await deps.commandRunner.run({ cwd: repository.localPath, args: ["pull", "--ff-only"], timeoutMs: 120_000 })
      return result("已拉取远程更新。")
    },

    async push(repository: SynapseGitRepository): Promise<SynapseGitOperationResult> {
      await deps.commandRunner.run({ cwd: repository.localPath, args: ["push"], timeoutMs: 120_000 })
      return result("已推送本地提交。")
    },

    async sync(repository: SynapseGitRepository): Promise<SynapseGitOperationResult> {
      const before = await deps.getSnapshot(repository)
      if (before.changes.length > 0) throw new Error("请先提交本地改动。")

      await deps.commandRunner.run({ cwd: repository.localPath, args: ["fetch", "--prune"], timeoutMs: 120_000 })
      if (before.behind > 0) {
        await deps.commandRunner.run({ cwd: repository.localPath, args: ["pull", "--ff-only"], timeoutMs: 120_000 })
      }
      const afterPull = await deps.getSnapshot(repository)
      if (afterPull.ahead > 0) {
        await deps.commandRunner.run({ cwd: repository.localPath, args: ["push"], timeoutMs: 120_000 })
      }
      return result("已同步仓库。")
    },
  }
}
```

- [ ] **Step 6: Implement branch service**

Create `desktop/electron/services/git-client/git-branch-service.ts`:

```ts
import type { SynapseGitBranch, SynapseGitRepository, SynapseGitRepositorySnapshot } from "../../../src/types/git"
import type { GitClientCommandRunner } from "./git-command-runner"

type BranchDeps = {
  readonly commandRunner: Pick<GitClientCommandRunner, "run">
  readonly getSnapshot: (repository: SynapseGitRepository) => Promise<Pick<SynapseGitRepositorySnapshot, "changes">>
}

function assertBranchName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) throw new Error("请输入分支名称。")
  if (trimmed.startsWith("-") || trimmed.includes("..") || trimmed.includes(" ")) {
    throw new Error("分支名称不合法。")
  }
  return trimmed
}

export function createGitBranchService(deps: BranchDeps) {
  async function assertClean(repository: SynapseGitRepository): Promise<void> {
    const snapshot = await deps.getSnapshot(repository)
    if (snapshot.changes.length > 0) throw new Error("请先提交本地改动。")
  }

  return {
    async list(repository: SynapseGitRepository): Promise<SynapseGitBranch[]> {
      const result = await deps.commandRunner.run({ cwd: repository.localPath, args: ["branch", "--list"] })
      return result.stdout.split(/\r?\n/)
        .map((line) => line.trimEnd())
        .filter(Boolean)
        .map((line) => ({
          name: line.replace(/^\*\s*/, "").trim(),
          current: line.trimStart().startsWith("* "),
        }))
    },

    async checkout(repository: SynapseGitRepository, branchName: string): Promise<void> {
      await assertClean(repository)
      await deps.commandRunner.run({ cwd: repository.localPath, args: ["checkout", assertBranchName(branchName)] })
    },

    async create(repository: SynapseGitRepository, branchName: string): Promise<void> {
      await assertClean(repository)
      await deps.commandRunner.run({ cwd: repository.localPath, args: ["checkout", "-b", assertBranchName(branchName)] })
    },
  }
}
```

- [ ] **Step 7: Implement history service**

Create `desktop/electron/services/git-client/git-history-service.ts`:

```ts
import type { SynapseGitCommitDetail, SynapseGitCommitSummary, SynapseGitFileChange, SynapseGitRepository } from "../../../src/types/git"
import type { GitClientCommandRunner } from "./git-command-runner"

const FIELD = "%x1f"
const RECORD = "%x1e"
const PRETTY = `%H${FIELD}%h${FIELD}%s${FIELD}%an${FIELD}%ae${FIELD}%cI${RECORD}`

function parseCommitRecord(record: string): SynapseGitCommitSummary | null {
  const [hash, shortHash, subject, authorName, authorEmail, committedAt] = record.split("\x1f")
  if (!hash || !shortHash || !subject || !authorName || !authorEmail || !committedAt) return null
  return { hash, shortHash, subject, authorName, authorEmail, committedAt }
}

function statusFromNameStatus(code: string): SynapseGitFileChange["status"] {
  if (code.startsWith("A")) return "added"
  if (code.startsWith("M")) return "modified"
  if (code.startsWith("D")) return "deleted"
  if (code.startsWith("R")) return "renamed"
  return "unknown"
}

function parseNameStatus(lines: readonly string[]): SynapseGitFileChange[] {
  return lines.filter(Boolean).map((line) => {
    const parts = line.split("\t")
    const code = parts[0] ?? ""
    const path = parts[1] ?? ""
    const originalPath = code.startsWith("R") ? path : null
    const nextPath = code.startsWith("R") ? (parts[2] ?? path) : path
    return {
      path: nextPath,
      originalPath,
      status: statusFromNameStatus(code),
      staged: false,
      conflicted: false,
    }
  })
}

export function createGitHistoryService(deps: { readonly commandRunner: Pick<GitClientCommandRunner, "run"> }) {
  return {
    async list(repository: SynapseGitRepository, input: { readonly limit: number; readonly offset: number }): Promise<SynapseGitCommitSummary[]> {
      const result = await deps.commandRunner.run({
        cwd: repository.localPath,
        args: ["log", `--pretty=format:${PRETTY}`, "--date=iso-strict", "--max-count", String(input.limit), "--skip", String(input.offset)],
      })
      return result.stdout.split("\x1e").map((record) => parseCommitRecord(record.trim())).filter((item): item is SynapseGitCommitSummary => Boolean(item))
    },

    async getCommit(repository: SynapseGitRepository, hash: string): Promise<SynapseGitCommitDetail> {
      const summaryResult = await deps.commandRunner.run({
        cwd: repository.localPath,
        args: ["show", "--name-status", `--pretty=format:${PRETTY}`, "--date=iso-strict", "--no-renames", hash],
      })
      const [firstLine = "", ...fileLines] = summaryResult.stdout.split(/\r?\n/)
      const summary = parseCommitRecord(firstLine.replace(/\x1e$/, ""))
      if (!summary) throw new Error("找不到提交记录。")
      const diffResult = await deps.commandRunner.run({ cwd: repository.localPath, args: ["show", "--format=", "--patch", hash] })
      return {
        ...summary,
        files: parseNameStatus(fileLines),
        diff: diffResult.stdout,
      }
    },
  }
}
```

- [ ] **Step 8: Run tests**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/electron/services/git-client/__tests__/git-worktree-services.test.ts
```

Expected: pass. If TypeScript flags the history `show` parsing, keep the test behavior and adjust only the parsing implementation.

- [ ] **Step 9: Commit**

```bash
git add desktop/electron/services/git-client/git-status-service.ts desktop/electron/services/git-client/git-commit-service.ts desktop/electron/services/git-client/git-sync-service.ts desktop/electron/services/git-client/git-branch-service.ts desktop/electron/services/git-client/git-history-service.ts desktop/electron/services/git-client/__tests__/git-worktree-services.test.ts
git commit -m "feat(git): add worktree operation services"
```

---

### Task 6: Git IPC Module and Bridge Exposure

**Files:**

- Create: `desktop/electron/modules/git/ipc.ts`
- Create: `desktop/electron/modules/git/__tests__/ipc.test.ts`
- Modify: `desktop/electron/bootstrap/descriptors.ts`
- Modify generated bridge files only by running `pnpm --filter @synapse/desktop generate:ipc`.
- Modify manually if generation does not expose the new module: `desktop/electron/preload.ts`, `desktop/src/types/bridge.ts`.

- [ ] **Step 1: Write failing IPC tests**

Create `desktop/electron/modules/git/__tests__/ipc.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"
import { gitIpcModule } from "../ipc"

function createContext(resolveMap: Record<string, unknown>) {
  return {
    moduleId: "git",
    resolve: (key: string) => resolveMap[key],
  }
}

describe("gitIpcModule", () => {
  it("declares structured channels", () => {
    expect(gitIpcModule.id).toBe("git")
    expect(gitIpcModule.methods.listRepositories.channel).toBe("synapse:git:repositories:list")
    expect(gitIpcModule.methods.getSnapshot.channel).toBe("synapse:git:status:get-snapshot")
    expect(gitIpcModule.methods.commit.channel).toBe("synapse:git:commit:create")
  })

  it("rejects arbitrary git command payloads", () => {
    expect(gitIpcModule.methods.getSnapshot.request.safeParse({ repositoryId: "repo-1", args: ["status"] }).success).toBe(false)
  })

  it("lists repositories through the registry service", async () => {
    const registry = { list: vi.fn().mockResolvedValue([{ id: "repo-1", name: "Docs", localPath: "/repo", addedAt: "now", lastOpenedAt: null }]) }
    const result = await gitIpcModule.methods.listRepositories.handler(createContext({ "git.repository-registry": registry }) as never)
    expect(result).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/electron/modules/git/__tests__/ipc.test.ts
```

Expected: fail because IPC module does not exist.

- [ ] **Step 3: Implement IPC module**

Create `desktop/electron/modules/git/ipc.ts` with zod schemas matching `desktop/src/types/git.ts`. Keep handlers thin: resolve services from context, validate repository IDs through registry lookup, call service methods, and return typed results. Use these exact channel names:

```ts
export const gitIpcModule: IpcModule = {
  id: "git",
  methods: {
    checkEnvironment: { channel: "synapse:git:environment:check", kind: "invoke", request: z.void(), response: environmentStateSchema, handler: async (ctx) => ctx.resolve<GitEnvironmentService>("git.environment-service").check() },
    configureIdentity: { channel: "synapse:git:environment:configure-identity", kind: "invoke", request: configureIdentitySchema, response: z.void(), handler: async (ctx, input) => ctx.resolve<GitEnvironmentService>("git.environment-service").configureIdentity(input) },
    listRepositories: { channel: "synapse:git:repositories:list", kind: "invoke", request: z.void(), response: z.array(repositorySchema), handler: async (ctx) => ctx.resolve<GitRepositoryRegistry>("git.repository-registry").list() },
    addLocalRepository: { channel: "synapse:git:repositories:add-local", kind: "invoke", request: addLocalRepositorySchema, response: repositorySchema, handler: async (ctx, input) => ctx.resolve<GitRepositoryRegistry>("git.repository-registry").addLocal(input) },
    removeRepository: { channel: "synapse:git:repositories:remove", kind: "invoke", request: repositoryIdSchema, response: z.void(), handler: async (ctx, input) => ctx.resolve<GitRepositoryRegistry>("git.repository-registry").remove(input.repositoryId) },
    cloneRepository: { channel: "synapse:git:repositories:clone", kind: "invoke", request: cloneRepositorySchema, response: cloneResultSchema, handler: async (ctx, input) => ctx.resolve<GitCloneService>("git.clone-service").clone(input) },
    getSnapshot: { channel: "synapse:git:status:get-snapshot", kind: "invoke", request: repositoryIdSchema, response: snapshotSchema, handler: async (ctx, input) => ctx.resolve<GitStatusService>("git.status-service").getSnapshot(await resolveRepository(ctx, input.repositoryId)) },
    getDiff: { channel: "synapse:git:status:get-diff", kind: "invoke", request: diffRequestSchema, response: diffResultSchema, handler: async (ctx, input) => ctx.resolve<GitStatusService>("git.status-service").getDiff(await resolveRepository(ctx, input.repositoryId), input) },
    commit: { channel: "synapse:git:commit:create", kind: "invoke", request: commitRequestSchema, response: operationResultSchema, handler: async (ctx, input) => ctx.resolve<GitCommitService>("git.commit-service").commit(await resolveRepository(ctx, input.repositoryId), input) },
    fetch: { channel: "synapse:git:sync:fetch", kind: "invoke", request: repositoryIdSchema, response: operationResultSchema, handler: async (ctx, input) => ctx.resolve<GitSyncService>("git.sync-service").fetch(await resolveRepository(ctx, input.repositoryId)) },
    pull: { channel: "synapse:git:sync:pull", kind: "invoke", request: repositoryIdSchema, response: operationResultSchema, handler: async (ctx, input) => ctx.resolve<GitSyncService>("git.sync-service").pull(await resolveRepository(ctx, input.repositoryId)) },
    push: { channel: "synapse:git:sync:push", kind: "invoke", request: repositoryIdSchema, response: operationResultSchema, handler: async (ctx, input) => ctx.resolve<GitSyncService>("git.sync-service").push(await resolveRepository(ctx, input.repositoryId)) },
    sync: { channel: "synapse:git:sync:sync", kind: "invoke", request: repositoryIdSchema, response: operationResultSchema, handler: async (ctx, input) => ctx.resolve<GitSyncService>("git.sync-service").sync(await resolveRepository(ctx, input.repositoryId)) },
    listBranches: { channel: "synapse:git:branches:list", kind: "invoke", request: repositoryIdSchema, response: z.array(branchSchema), handler: async (ctx, input) => ctx.resolve<GitBranchService>("git.branch-service").list(await resolveRepository(ctx, input.repositoryId)) },
    checkoutBranch: { channel: "synapse:git:branches:checkout", kind: "invoke", request: branchRequestSchema, response: z.void(), handler: async (ctx, input) => ctx.resolve<GitBranchService>("git.branch-service").checkout(await resolveRepository(ctx, input.repositoryId), input.branchName) },
    createBranch: { channel: "synapse:git:branches:create", kind: "invoke", request: branchRequestSchema, response: z.void(), handler: async (ctx, input) => ctx.resolve<GitBranchService>("git.branch-service").create(await resolveRepository(ctx, input.repositoryId), input.branchName) },
    listHistory: { channel: "synapse:git:history:list", kind: "invoke", request: historyListRequestSchema, response: z.array(commitSummarySchema), handler: async (ctx, input) => ctx.resolve<GitHistoryService>("git.history-service").list(await resolveRepository(ctx, input.repositoryId), input) },
    getCommit: { channel: "synapse:git:history:get-commit", kind: "invoke", request: commitDetailRequestSchema, response: commitDetailSchema, handler: async (ctx, input) => ctx.resolve<GitHistoryService>("git.history-service").getCommit(await resolveRepository(ctx, input.repositoryId), input.hash) },
  },
  events: {},
}
```

The snippet above is the required method set. Fill in schemas and service type imports in the same file. Do not add a method that accepts arbitrary `args`.

- [ ] **Step 4: Register descriptors and dependency providers**

Modify `desktop/electron/bootstrap/descriptors.ts`:

- Import `gitIpcModule`.
- Register it with existing IPC module descriptors.
- Register service instances under keys used by `gitIpcModule`: `git.repository-registry`, `git.environment-service`, `git.clone-service`, `git.status-service`, `git.commit-service`, `git.sync-service`, `git.branch-service`, `git.history-service`.

Use app userData path, existing `pathExists`, existing `runGitCommand` wrapper, and the services from previous tasks. Keep construction in one place; do not create service singletons in service files.

- [ ] **Step 5: Run IPC generation**

Run:

```bash
pnpm --filter @synapse/desktop generate:ipc
```

Expected: generated bridge files update or report no generated consumers. If the new module is not generated into the bridge, add a typed `git` object manually in `desktop/electron/preload.ts` and `desktop/src/types/bridge.ts` following the existing `apps` bridge style.

- [ ] **Step 6: Run IPC tests**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/electron/modules/git/__tests__/ipc.test.ts desktop/electron/modules/apps/__tests__/ipc.test.ts
```

Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add desktop/electron/modules/git desktop/electron/bootstrap/descriptors.ts desktop/electron/preload.ts desktop/src/types/bridge.ts
git commit -m "feat(git): expose structured git ipc"
```

Adjust the staged file list if generated IPC writes a different known generated file.

---

### Task 7: System App Registration and Launcher Icon

**Files:**

- Create: `desktop/src/modules/git/app-definition.ts`
- Create: `desktop/src/modules/git/app-manifest.ts`
- Create: `desktop/src/modules/git/assets/icon.png`
- Modify: `desktop/src/modules/apps/types.ts`
- Modify: `desktop/src/modules/apps/registry.ts`
- Modify: `desktop/src/modules/apps/definitions.ts`
- Modify: `desktop/src/modules/apps/components/app-launcher-grid.tsx`
- Test: `desktop/src/modules/apps/__tests__/registry.test.ts`
- Test: `desktop/src/modules/apps/__tests__/app-launcher.test.tsx`
- Test: `desktop/src/modules/apps/__tests__/system-app-window-app.test.tsx`
- Test: `desktop/electron/modules/apps/__tests__/ipc.test.ts`

- [ ] **Step 1: Write failing app registration test updates**

Update `desktop/src/modules/apps/__tests__/registry.test.ts` expected order to include `"git"` after `"resource-repository"`:

```ts
expect(listSystemApps().map((app) => app.id)).toEqual([
  "resource-repository",
  "git",
  "database",
  "editor-scan",
  "usage-monitor",
  "model-price",
])
```

Update `desktop/electron/modules/apps/__tests__/ipc.test.ts` to accept `git`:

```ts
expect(appsIpcModule.methods.openSystemApp.request.safeParse({ appId: "git" }).success).toBe(true)
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/src/modules/apps/__tests__/registry.test.ts desktop/electron/modules/apps/__tests__/ipc.test.ts
```

Expected: fail because `git` is not registered.

- [ ] **Step 3: Add app definition and manifest**

Create `desktop/src/modules/git/app-definition.ts`:

```ts
import type { SynapseSystemAppDefinition } from "../apps/types"

export const gitAppDefinition = {
  id: "git",
  type: "system",
  name: "Git",
  windowTitle: "Git",
  removable: false,
  renameable: false,
  iconEditable: false,
} as const satisfies SynapseSystemAppDefinition
```

Create `desktop/src/modules/git/app-manifest.ts`:

```ts
import icon from "./assets/icon.png"
import type { SynapseSystemAppManifest } from "@/modules/apps/types"
import { gitAppDefinition } from "./app-definition"

export const gitAppManifest = {
  ...gitAppDefinition,
  icon,
} as const satisfies SynapseSystemAppManifest
```

- [ ] **Step 4: Add system app ID and registries**

Modify `desktop/src/modules/apps/types.ts`:

```ts
export const SYSTEM_APP_IDS = [
  "resource-repository",
  "git",
  "database",
  "editor-scan",
  "usage-monitor",
  "model-price",
] as const
```

Modify `desktop/src/modules/apps/registry.ts`:

```ts
import { gitAppManifest } from "@/modules/git/app-manifest"
```

and include `gitAppManifest` immediately after `resourceRepositoryAppManifest`.

Modify `desktop/src/modules/apps/definitions.ts`:

```ts
import { gitAppDefinition } from "../git/app-definition"
```

and include `gitAppDefinition` immediately after `resourceRepositoryAppDefinition`.

Modify `desktop/src/modules/apps/components/app-launcher-grid.tsx`:

```ts
const appDescriptions = {
  "resource-repository": "技能、规则、提示词",
  git: "仓库、提交、同步",
  database: "表、字段、数据记录",
  "editor-scan": "编辑器扫描与安装状态",
  "usage-monitor": "CC 与 Codex 用量",
  "model-price": "模型价格规则",
} satisfies Record<SynapseSystemAppId, string>
```

- [ ] **Step 5: Create icon asset**

Create `desktop/src/modules/git/assets/icon.png` as a 1254 x 1254 PNG matching existing system app icons:

- dark rounded base plate,
- 3D object style,
- white/gray material body,
- soft shadows,
- small amber accent,
- concept: document tray or folder with Git branch nodes.

Use image generation or a design tool. Save the final asset at the exact path. Do not use Git's official logo, a flat lucide icon, or a terminal symbol.

- [ ] **Step 6: Run registration tests**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/src/modules/apps/__tests__/registry.test.ts desktop/src/modules/apps/__tests__/app-launcher.test.tsx desktop/src/modules/apps/__tests__/system-app-window-app.test.tsx desktop/electron/modules/apps/__tests__/ipc.test.ts
```

Expected: pass. Update snapshots or text expectations only for the new Git app.

- [ ] **Step 7: Commit**

```bash
git add desktop/src/modules/git/app-definition.ts desktop/src/modules/git/app-manifest.ts desktop/src/modules/git/assets/icon.png desktop/src/modules/apps/types.ts desktop/src/modules/apps/registry.ts desktop/src/modules/apps/definitions.ts desktop/src/modules/apps/components/app-launcher-grid.tsx desktop/src/modules/apps/__tests__/registry.test.ts desktop/src/modules/apps/__tests__/app-launcher.test.tsx desktop/src/modules/apps/__tests__/system-app-window-app.test.tsx desktop/electron/modules/apps/__tests__/ipc.test.ts
git commit -m "feat(git): register git system app"
```

---

### Task 8: Renderer Git App List, Environment, Clone, and Add Local

**Files:**

- Create: `desktop/src/modules/git/index.tsx`
- Create: `desktop/src/modules/git/hooks/use-git-repositories.ts`
- Create: `desktop/src/modules/git/hooks/use-git-operations.ts`
- Create: `desktop/src/modules/git/components/git-repository-list.tsx`
- Create: `desktop/src/modules/git/components/git-clone-dialog.tsx`
- Test: `desktop/src/modules/git/__tests__/git-module-list.test.tsx`

- [ ] **Step 1: Write failing renderer tests**

Create `desktop/src/modules/git/__tests__/git-module-list.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import GitModule from "../index"

const bridge = {
  git: {
    checkEnvironment: vi.fn(),
    listRepositories: vi.fn(),
    addLocalRepository: vi.fn(),
    cloneRepository: vi.fn(),
    removeRepository: vi.fn(),
    getSnapshot: vi.fn(),
    sync: vi.fn(),
    pull: vi.fn(),
    push: vi.fn(),
  },
}

vi.mock("@/lib/electron-bridge", () => ({
  requireSynapseBridge: () => bridge,
  getSynapseBridge: () => bridge,
}))

beforeEach(() => {
  vi.clearAllMocks()
  bridge.git.checkEnvironment.mockResolvedValue({
    gitAvailable: true,
    gitVersion: "git version 2.50.0",
    gitPath: null,
    sshAvailable: true,
    userName: "Writer",
    userEmail: "writer@example.com",
    commonSshKeyExists: true,
    installHint: null,
  })
  bridge.git.listRepositories.mockResolvedValue([])
})

describe("GitModule repository list", () => {
  it("shows empty state actions", async () => {
    render(<GitModule />)

    expect(await screen.findByRole("button", { name: "克隆仓库" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "添加本地仓库" })).toBeInTheDocument()
  })

  it("opens clone dialog and submits clone request", async () => {
    bridge.git.cloneRepository.mockResolvedValue({
      repository: { id: "repo-1", name: "docs", localPath: "/work/docs", addedAt: "now", lastOpenedAt: null },
      remoteKind: "https",
    })
    const user = userEvent.setup()
    render(<GitModule />)

    await user.click(await screen.findByRole("button", { name: "克隆仓库" }))
    await user.type(screen.getByLabelText("仓库地址"), "https://git.example.com/team/docs.git")
    await user.type(screen.getByLabelText("保存到"), "/work/docs")
    await user.click(screen.getByRole("button", { name: "开始克隆" }))

    await waitFor(() => {
      expect(bridge.git.cloneRepository).toHaveBeenCalledWith({
        remoteUrl: "https://git.example.com/team/docs.git",
        targetPath: "/work/docs",
        name: "docs",
      })
    })
  })
})
```

- [ ] **Step 2: Run renderer test to verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/src/modules/git/__tests__/git-module-list.test.tsx
```

Expected: fail because renderer Git module does not exist.

- [ ] **Step 3: Implement repository hook**

Create `desktop/src/modules/git/hooks/use-git-repositories.ts`:

```ts
import { useCallback, useEffect, useState } from "react"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import type { SynapseGitRepository } from "@/types/git"

function getGitBridge() {
  return requireSynapseBridge().git
}

export function useGitRepositories() {
  const [repositories, setRepositories] = useState<readonly SynapseGitRepository[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setRepositories(await getGitBridge().listRepositories())
    } catch (err) {
      setError(err instanceof Error ? err.message : "读取仓库失败。")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { repositories, loading, error, refresh }
}
```

- [ ] **Step 4: Implement operations hook**

Create `desktop/src/modules/git/hooks/use-git-operations.ts`:

```ts
import { useState } from "react"
import { requireSynapseBridge } from "@/lib/electron-bridge"

export function useGitOperations(onCompleted: () => void | Promise<void>) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function run(label: string, action: () => Promise<unknown>) {
    setBusy(label)
    setError(null)
    try {
      await action()
      await onCompleted()
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败。")
    } finally {
      setBusy(null)
    }
  }

  return {
    busy,
    error,
    cloneRepository: (input: { remoteUrl: string; targetPath: string; name: string }) =>
      run("clone", () => requireSynapseBridge().git.cloneRepository(input)),
    addLocalRepository: (input: { name: string; localPath: string }) =>
      run("add-local", () => requireSynapseBridge().git.addLocalRepository(input)),
    sync: (repositoryId: string) => run("sync", () => requireSynapseBridge().git.sync({ repositoryId })),
    pull: (repositoryId: string) => run("pull", () => requireSynapseBridge().git.pull({ repositoryId })),
    push: (repositoryId: string) => run("push", () => requireSynapseBridge().git.push({ repositoryId })),
  }
}
```

- [ ] **Step 5: Implement clone dialog**

Create `desktop/src/modules/git/components/git-clone-dialog.tsx` using existing shadcn `Dialog`, `Input`, `Label`, and `Button`. Use labels only: `仓库地址`, `保存到`, `开始克隆`, `取消`. Derive repository name from target path basename.

- [ ] **Step 6: Implement repository list**

Create `desktop/src/modules/git/components/git-repository-list.tsx`. Render:

- top action row with `克隆仓库` and `添加本地仓库`,
- empty state with the same two actions,
- rows that show repository name, local path, and buttons `拉取`, `推送`, `同步`, `进入`.

Keep rows clickable for entering the workbench. Stop propagation in row action buttons.

- [ ] **Step 7: Implement module entry**

Create `desktop/src/modules/git/index.tsx`:

```tsx
import { useState } from "react"
import { GitCloneDialog } from "./components/git-clone-dialog"
import { GitRepositoryList } from "./components/git-repository-list"
import { GitWorkbench } from "./components/git-workbench"
import { useGitRepositories } from "./hooks/use-git-repositories"
import { useGitOperations } from "./hooks/use-git-operations"
import type { SynapseGitRepository } from "@/types/git"

export default function GitModule() {
  const [selectedRepository, setSelectedRepository] = useState<SynapseGitRepository | null>(null)
  const [cloneOpen, setCloneOpen] = useState(false)
  const repositoriesState = useGitRepositories()
  const operations = useGitOperations(repositoriesState.refresh)

  if (selectedRepository) {
    return <GitWorkbench repository={selectedRepository} onBack={() => setSelectedRepository(null)} />
  }

  return (
    <>
      <GitRepositoryList
        repositories={repositoriesState.repositories}
        loading={repositoriesState.loading}
        error={repositoriesState.error ?? operations.error}
        busy={operations.busy}
        onClone={() => setCloneOpen(true)}
        onAddLocal={(input) => void operations.addLocalRepository(input)}
        onOpenRepository={setSelectedRepository}
        onPull={(repositoryId) => void operations.pull(repositoryId)}
        onPush={(repositoryId) => void operations.push(repositoryId)}
        onSync={(repositoryId) => void operations.sync(repositoryId)}
      />
      <GitCloneDialog
        open={cloneOpen}
        busy={operations.busy === "clone"}
        onOpenChange={setCloneOpen}
        onSubmit={(input) => operations.cloneRepository(input).then(() => setCloneOpen(false))}
      />
    </>
  )
}
```

If `GitWorkbench` does not exist yet, add a temporary component in `git-workbench.tsx` that renders the repository name and a back button; Task 9 replaces it with full workbench behavior.

- [ ] **Step 8: Run renderer test**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/src/modules/git/__tests__/git-module-list.test.tsx
```

Expected: pass.

- [ ] **Step 9: Commit**

```bash
git add desktop/src/modules/git/index.tsx desktop/src/modules/git/hooks/use-git-repositories.ts desktop/src/modules/git/hooks/use-git-operations.ts desktop/src/modules/git/components/git-repository-list.tsx desktop/src/modules/git/components/git-clone-dialog.tsx desktop/src/modules/git/components/git-workbench.tsx desktop/src/modules/git/__tests__/git-module-list.test.tsx
git commit -m "feat(git): add git repository list ui"
```

---

### Task 9: Renderer Workbench, Changes, History, and Branch UI

**Files:**

- Create/Modify: `desktop/src/modules/git/components/git-workbench.tsx`
- Create: `desktop/src/modules/git/components/git-changes-tab.tsx`
- Create: `desktop/src/modules/git/components/git-history-tab.tsx`
- Create: `desktop/src/modules/git/components/git-branch-switcher.tsx`
- Create: `desktop/src/modules/git/hooks/use-git-worktree-status.ts`
- Create: `desktop/src/modules/git/hooks/use-git-history.ts`
- Test: `desktop/src/modules/git/__tests__/git-workbench.test.tsx`

- [ ] **Step 1: Write failing workbench tests**

Create `desktop/src/modules/git/__tests__/git-workbench.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { GitWorkbench } from "../components/git-workbench"

const repository = { id: "repo-1", name: "Docs", localPath: "/repo", addedAt: "now", lastOpenedAt: null }
const bridge = {
  git: {
    getSnapshot: vi.fn(),
    getDiff: vi.fn(),
    commit: vi.fn(),
    listBranches: vi.fn(),
    checkoutBranch: vi.fn(),
    createBranch: vi.fn(),
    listHistory: vi.fn(),
    getCommit: vi.fn(),
    sync: vi.fn(),
    pull: vi.fn(),
    push: vi.fn(),
  },
}

vi.mock("@/lib/electron-bridge", () => ({
  requireSynapseBridge: () => bridge,
  getSynapseBridge: () => bridge,
}))

beforeEach(() => {
  vi.clearAllMocks()
  bridge.git.getSnapshot.mockResolvedValue({
    repositoryId: "repo-1",
    pathExists: true,
    isGitRepository: true,
    currentBranch: "main",
    upstream: "origin/main",
    ahead: 1,
    behind: 0,
    hasConflicts: false,
    changes: [{ path: "docs/a.md", originalPath: null, status: "modified", staged: false, conflicted: false }],
  })
  bridge.git.getDiff.mockResolvedValue({ path: "docs/a.md", originalPath: null, binary: false, text: "+hello" })
  bridge.git.listBranches.mockResolvedValue([{ name: "main", current: true }, { name: "docs", current: false }])
  bridge.git.listHistory.mockResolvedValue([
    { hash: "abc", shortHash: "abc123", subject: "更新文档", authorName: "张三", authorEmail: "zhang@example.com", committedAt: "2026-06-17T10:00:00+08:00" },
  ])
  bridge.git.getCommit.mockResolvedValue({
    hash: "abc",
    shortHash: "abc123",
    subject: "更新文档",
    authorName: "张三",
    authorEmail: "zhang@example.com",
    committedAt: "2026-06-17T10:00:00+08:00",
    files: [{ path: "docs/a.md", originalPath: null, status: "modified", staged: false, conflicted: false }],
    diff: "+hello",
  })
})

describe("GitWorkbench", () => {
  it("shows branch, changes, diff, and commits selected files", async () => {
    const user = userEvent.setup()
    bridge.git.commit.mockResolvedValue({ completedAt: "now", message: "已提交选中文件。" })

    render(<GitWorkbench repository={repository} onBack={vi.fn()} />)

    expect(await screen.findByText("Docs")).toBeInTheDocument()
    expect(screen.getByText("main")).toBeInTheDocument()
    await user.click(await screen.findByLabelText("选择 docs/a.md"))
    await user.type(screen.getByLabelText("提交说明"), "更新文档")
    await user.click(screen.getByRole("button", { name: "提交选中文件" }))

    await waitFor(() => {
      expect(bridge.git.commit).toHaveBeenCalledWith({
        repositoryId: "repo-1",
        message: "更新文档",
        paths: ["docs/a.md"],
      })
    })
  })

  it("shows current branch history", async () => {
    const user = userEvent.setup()
    render(<GitWorkbench repository={repository} onBack={vi.fn()} />)

    await user.click(await screen.findByRole("tab", { name: "历史" }))
    expect(await screen.findByText("更新文档")).toBeInTheDocument()
    await user.click(screen.getByText("更新文档"))
    expect(await screen.findByText("abc123")).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/src/modules/git/__tests__/git-workbench.test.tsx
```

Expected: fail because workbench implementation is missing or incomplete.

- [ ] **Step 3: Implement status and history hooks**

Create `desktop/src/modules/git/hooks/use-git-worktree-status.ts`:

```ts
import { useCallback, useEffect, useState } from "react"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import type { SynapseGitRepository, SynapseGitRepositorySnapshot } from "@/types/git"

export function useGitWorktreeStatus(repository: SynapseGitRepository) {
  const [snapshot, setSnapshot] = useState<SynapseGitRepositorySnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setSnapshot(await requireSynapseBridge().git.getSnapshot({ repositoryId: repository.id }))
    } catch (err) {
      setError(err instanceof Error ? err.message : "读取仓库状态失败。")
    } finally {
      setLoading(false)
    }
  }, [repository.id])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { snapshot, loading, error, refresh }
}
```

Create `desktop/src/modules/git/hooks/use-git-history.ts` with the same shape, calling `listHistory({ repositoryId, limit: 40, offset: 0 })` and `getCommit({ repositoryId, hash })`.

- [ ] **Step 4: Implement workbench shell**

Implement `git-workbench.tsx` using:

- `SystemAppWindowShell` is not needed because the system app window already wraps the module. Use a full-height flex layout.
- `Tabs` with `改动` and `历史`.
- header with repository name, local path, branch switcher, `拉取`, `推送`, `同步`.
- all buttons use existing shadcn `Button`.
- no inline style, no hardcoded colors, no custom CSS module.

- [ ] **Step 5: Implement changes tab**

Implement `git-changes-tab.tsx`:

- left pane: checkbox list with accessible labels `选择 <path>`,
- right pane: selected file diff text in a scroll area,
- bottom commit textarea labelled `提交说明`,
- button `提交选中文件`,
- binary diff displays `文件已变更`,
- commit calls `git.commit({ repositoryId, message, paths })`, refreshes snapshot on success, and preserves message/selection on failure.

- [ ] **Step 6: Implement branch switcher**

Implement `git-branch-switcher.tsx`:

- button label is current branch or `无分支`,
- dropdown lists local branches,
- selecting a non-current branch calls `checkoutBranch`,
- `新建分支` opens a small inline input inside the dropdown or a dialog,
- empty branch name disables confirm,
- any error text is short.

- [ ] **Step 7: Implement history tab**

Implement `git-history-tab.tsx`:

- left pane: current branch commit list,
- right pane: selected commit detail,
- show subject, short hash, author, date, file list, and diff,
- no reset/revert/cherry-pick buttons.

- [ ] **Step 8: Run workbench test**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/src/modules/git/__tests__/git-workbench.test.tsx
```

Expected: pass.

- [ ] **Step 9: Commit**

```bash
git add desktop/src/modules/git/components/git-workbench.tsx desktop/src/modules/git/components/git-changes-tab.tsx desktop/src/modules/git/components/git-history-tab.tsx desktop/src/modules/git/components/git-branch-switcher.tsx desktop/src/modules/git/hooks/use-git-worktree-status.ts desktop/src/modules/git/hooks/use-git-history.ts desktop/src/modules/git/__tests__/git-workbench.test.tsx
git commit -m "feat(git): add git workbench ui"
```

---

### Task 10: Release Notes, Integration Checks, and Full Verification

**Files:**

- Modify: `RELEASE_NOTES_PENDING.md`
- Optional test updates if caused by app order: existing app launcher and system window tests.

- [ ] **Step 1: Add release note**

Append a user-facing entry to `RELEASE_NOTES_PENDING.md`:

```md
- 新增 Git 模块：可以克隆公司仓库、添加本地仓库、查看改动、选择文件提交、同步远程，并查看当前分支历史。
```

- [ ] **Step 2: Run targeted Git module tests**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/electron/services/git-client desktop/electron/modules/git desktop/src/modules/git desktop/src/modules/apps/__tests__/registry.test.ts desktop/src/modules/apps/__tests__/app-launcher.test.tsx desktop/src/modules/apps/__tests__/system-app-window-app.test.tsx desktop/electron/modules/apps/__tests__/ipc.test.ts
```

Expected: pass.

- [ ] **Step 3: Run IPC codegen check**

Run:

```bash
pnpm --filter @synapse/desktop run check:ipc-codegen
```

Expected: pass. If it fails with generated diff, run `pnpm --filter @synapse/desktop generate:ipc`, inspect generated files, and commit them.

- [ ] **Step 4: Run typecheck**

Run:

```bash
pnpm --filter @synapse/desktop run typecheck
```

Expected: pass.

- [ ] **Step 5: Run hard constraints**

Run:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: pass.

- [ ] **Step 6: Run UI manual verification**

Start the smallest required dev scope:

```bash
pnpm dev:desktop
```

Open Synapse, then verify:

```text
应用启动器显示 Git
Git 图标风格与其它系统 App 一致
点击 Git 打开独立系统 App 窗口
空状态显示 克隆仓库 和 添加本地仓库
克隆对话显示 仓库地址、保存到、开始克隆
仓库工作台显示 改动 和 历史 Tab
同步是主按钮，拉取和推送是次级按钮
当前分支历史不显示分支树
```

- [ ] **Step 7: Stop dev server if this task started it**

Run:

```bash
pnpm quit:desktop
```

Expected: desktop dev process stops. Do not stop it if it was already running before this task.

- [ ] **Step 8: Commit release note and final fixes**

```bash
git add RELEASE_NOTES_PENDING.md
git commit -m "docs: note git module release"
```

If verification required small fixes, include only those Git-module files in this commit or make a separate focused commit with a precise message.

---

## Self-Review

Spec coverage:

- Independent Git module: covered by Tasks 6, 7, 8, 9.
- System Git, no embedded Git: covered by Tasks 2, 4, 6.
- HTTPS/SSH clone and environment guidance: covered by Task 4 and Task 8.
- Multiple repository management: covered by Task 3 and Task 8.
- Worktree changes, diff, selected-file commit: covered by Task 5 and Task 9.
- Sync, pull, push: covered by Task 5, Task 8, Task 9.
- Local branch list, create, checkout: covered by Task 5 and Task 9.
- Current-branch history and commit detail: covered by Task 5 and Task 9.
- No branch tree or conflict resolution: enforced by UI task scope and non-goals.
- App launcher entry and icon style: covered by Task 7.
- Release notes: covered by Task 10.

Placeholder scan:

- The plan intentionally avoids placeholder markers and forbids unsupported first-phase features.
- Implementation notes name exact files and commands.

Type consistency:

- Shared type names use `SynapseGit*` in `desktop/src/types/git.ts`.
- IPC method names align with bridge calls used in renderer hooks.
- Service method names align with tests and IPC channel names.

# Skill Uninstaller Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a reusable Skill uninstaller that finds every exact-name match in global Agent roots or below an optional directory, lets users select targets, and moves confirmed targets to the system trash from either a standalone app or an IDE Manager dialog.

**Architecture:** Add a `skill-uninstaller` App Capability Package with shared zod contracts, a main-process bounded recursive scanner, a revalidating sequential trash service, IPC adapters, and one shared renderer flow. The system app and callable dialog are thin containers around that flow. IDE Manager single-item and bulk Skill removal delegate to the same main service, while Rule removal stays on the existing editor-scan path.

**Tech Stack:** Electron 41, Node.js filesystem APIs, React 19, TypeScript 6, zod, shadcn/ui with Radix, Tailwind CSS 4, Vitest.

## Global Constraints

- Do not add a dependency.
- Do not permanently delete Skill directories; use Electron `shell.trashItem` only.
- Do not persist scan results, uninstall history, queues, or scan cancellation state.
- Do not follow directory or `SKILL.md` symbolic links.
- Match the trimmed query case-insensitively and exactly against the directory basename or `SKILL.md` frontmatter `name`; do not add fuzzy matching.
- Without `searchRootPath`, scan only global Skill roots supplied by registered Agent adapters; do not scan configured projects.
- With `searchRootPath`, treat it as an arbitrary recursive root and require read permission plus a realpath containment check.
- Exclude exact directory basenames `node_modules`, `.git`, `.svn`, `.hg`, `.next`, `.nuxt`, `.cache`, `.turbo`, `dist`, `build`, `out`, `coverage`, `target`, and `vendor`.
- Stop descending once a directory contains a readable regular-file `SKILL.md`.
- Default scan limits are depth 32, 50,000 visited directories, 30 seconds, and 8 concurrent directory reads.
- A cancelled or limited scan returns discovered candidates with `complete: false`; never present it as complete.
- Scan results are deduplicated by real path. A shared physical directory is one selectable item with multiple `editorIds`.
- Selection defaults to empty. The user must select items or choose all, then pass an explicit confirmation before trashing.
- Revalidate path containment, symlinks, `SKILL.md`, and exact name immediately before every trash operation.
- Process selected targets sequentially. One failed or skipped item must not block later items.
- Use current shadcn components and theme tokens. No custom colors, CSS modules, inline styles, gradients, glow, nested cards, or marketing copy.
- Do not start a dev server for verification.
- Update `docs/reference/editor-integration-matrix.md`, `AGENTS.md`, and `RELEASE_NOTES_PENDING.md` in the same implementation.

---

## File Structure

Create:

- `desktop/app-capabilities/skill-uninstaller/shared/capability.ts`: stable system app id and namespace.
- `desktop/app-capabilities/skill-uninstaller/shared/schema.ts`: query, candidate, scan, cancel, target, and batch-result schemas/types.
- `desktop/app-capabilities/skill-uninstaller/main/scanner.ts`: bounded, cancellable, symlink-safe recursive discovery.
- `desktop/app-capabilities/skill-uninstaller/main/service.ts`: root resolution, permission/audit boundaries, pre-trash revalidation, sequential trash, and status refresh hooks.
- `desktop/app-capabilities/skill-uninstaller/main/ipc.ts`: scan/cancel/uninstall IPC adapter and in-memory `AbortController` map.
- `desktop/app-capabilities/skill-uninstaller/main/__tests__/scanner.test.ts`: traversal, exclusion, matching, dedupe, cancellation, and limit tests.
- `desktop/app-capabilities/skill-uninstaller/main/__tests__/service.test.ts`: security, revalidation, sequential trash, partial failure, and external Skill tests.
- `desktop/app-capabilities/skill-uninstaller/main/__tests__/ipc.test.ts`: schemas, cancellation cleanup, security dependency, and refresh tests.
- `desktop/app-capabilities/skill-uninstaller/renderer/skill-uninstaller-flow.tsx`: shared query, scan, selection, confirmation, and result UI.
- `desktop/app-capabilities/skill-uninstaller/renderer/skill-uninstaller-dialog.tsx`: large-dialog container for a prefilled locked query.
- `desktop/app-capabilities/skill-uninstaller/renderer/use-skill-uninstaller-dialog.tsx`: callable renderer hook returning `openSkillUninstaller` and the rendered dialog.
- `desktop/app-capabilities/skill-uninstaller/renderer/index.tsx`: standalone system app page.
- `desktop/app-capabilities/skill-uninstaller/renderer/app-definition.ts`: pure system app definition.
- `desktop/app-capabilities/skill-uninstaller/renderer/app-manifest.ts`: manifest using the existing Skill installer icon.
- `desktop/app-capabilities/skill-uninstaller/renderer/__tests__/skill-uninstaller-flow.test.tsx`: default selection, select all, cancellation, confirmation, and partial result UI.
- `desktop/app-capabilities/skill-uninstaller/renderer/__tests__/skill-uninstaller-dialog.test.tsx`: prefilled read-only query and auto-scan coverage.
- `desktop/app-capabilities/skill-uninstaller/renderer/__tests__/skill-uninstaller-module.test.tsx`: standalone page query and directory chooser coverage.

Modify:

- `desktop/config.ts`: add four Chinese-commented scan limit constants.
- `desktop/electron/services/editor-scan-roots.ts`: expose global-only roots and adapter-driven project-path attribution helpers.
- `desktop/electron/services/__tests__/editor-scan-roots.test.ts`: global-only and path-attribution coverage.
- `desktop/electron/bootstrap/ipc-registry.ts`: register the capability IPC module.
- `desktop/scripts/build/generate-ipc.mjs`: add the capability module to codegen sources.
- `desktop/electron/generated/ipc-channels.generated.ts`: regenerate; do not hand-edit.
- `desktop/electron/preload.ts`: expose the `skillUninstaller` bridge.
- `desktop/electron/__tests__/preload.test.ts`: verify channel mapping.
- `desktop/src/types/bridge.ts`: add the typed bridge domain.
- `desktop/src/modules/apps/types.ts`: add app id and namespace.
- `desktop/src/modules/apps/registry.ts`: add the manifest.
- `desktop/src/modules/apps/definitions.ts`: add the definition.
- `desktop/src/modules/apps/components/system-app-content.tsx`: render the system app.
- `desktop/src/modules/apps/__tests__/registry.test.ts`: update order and metadata assertions.
- `desktop/src/modules/apps/__tests__/system-app-window-app.test.tsx`: mock and render the standalone window.
- `desktop/src/modules/apps/__tests__/system-app-content-launcher.test.tsx`: mock and render embedded content.
- `desktop/src/modules/editor-scan/components/scan-item-detail-dialog.tsx`: delegate Skill single-item removal to the shared dialog while retaining Rule trash behavior.
- `desktop/src/modules/editor-scan/components/editor-bulk-skill-trash-dialog.tsx`: submit one public batch request instead of looping over `editorScan.trashItem`.
- `desktop/src/modules/editor-scan/index.tsx`: own the callable dialog and safely transition from the detail dialog.
- `desktop/src/modules/editor-scan/lib/bulk-skill-trash.ts`: map IDE items to `SkillUninstallTarget` and map batch results back to selected keys.
- `desktop/src/modules/editor-scan/__tests__/editor-bulk-skill-trash-dialog.test.tsx`: assert public batch service usage and partial results.
- `desktop/src/modules/editor-scan/__tests__/editor-scan-module-state.test.tsx`: assert detail-to-uninstaller transition and refresh.
- `docs/reference/editor-integration-matrix.md`: document uninstaller discovery rules.
- `AGENTS.md`: record the stable public Skill uninstall boundary.
- `RELEASE_NOTES_PENDING.md`: add a user-facing release note.

---

### Task 1: Shared Contracts And Scan Limits

**Files:**
- Create: `desktop/app-capabilities/skill-uninstaller/shared/capability.ts`
- Create: `desktop/app-capabilities/skill-uninstaller/shared/schema.ts`
- Modify: `desktop/config.ts`
- Test: `desktop/app-capabilities/skill-uninstaller/main/__tests__/ipc.test.ts`

**Interfaces:**
- Produces `SKILL_UNINSTALLER_APP_ID = "skill-uninstaller"`.
- Produces zod schemas and inferred types: `SkillUninstallQuery`, `SkillUninstallCandidate`, `SkillUninstallScanResult`, `SkillUninstallTarget`, `SkillUninstallBatchResult`, `SkillUninstallScanRequest`, and `SkillUninstallCancelRequest`.
- Produces `SKILL_UNINSTALL_SCAN_MAX_DEPTH`, `SKILL_UNINSTALL_SCAN_MAX_DIRECTORIES`, `SKILL_UNINSTALL_SCAN_TIMEOUT_MS`, and `SKILL_UNINSTALL_SCAN_CONCURRENCY`.

- [ ] **Step 1: Write the failing schema test**

Create `desktop/app-capabilities/skill-uninstaller/main/__tests__/ipc.test.ts` with the schema cases first:

```ts
import { describe, expect, it } from "vitest"
import {
  skillUninstallQuerySchema,
  skillUninstallTargetSchema,
} from "../../shared/schema"

describe("skill uninstaller schemas", () => {
  it("accepts a name with an optional search root", () => {
    expect(skillUninstallQuerySchema.parse({ name: "jenkins" })).toEqual({ name: "jenkins" })
    expect(skillUninstallQuerySchema.parse({
      name: "jenkins",
      searchRootPath: "/repo",
    })).toEqual({ name: "jenkins", searchRootPath: "/repo" })
  })

  it("rejects empty names and empty target paths", () => {
    expect(() => skillUninstallQuerySchema.parse({ name: "  " })).toThrow()
    expect(() => skillUninstallTargetSchema.parse({
      query: { name: "jenkins" },
      path: "",
    })).toThrow()
  })
})
```

- [ ] **Step 2: Run the focused test and confirm failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run app-capabilities/skill-uninstaller/main/__tests__/ipc.test.ts
```

Expected: FAIL because `../../shared/schema` does not exist.

- [ ] **Step 3: Add exact shared schemas and constants**

Create `desktop/app-capabilities/skill-uninstaller/shared/capability.ts`:

```ts
export const SKILL_UNINSTALLER_APP_ID = "skill-uninstaller" as const
```

Create `desktop/app-capabilities/skill-uninstaller/shared/schema.ts` with strict schemas:

```ts
import { z } from "zod"

const trimmedNonEmptyString = z.string().transform((value) => value.trim()).pipe(z.string().min(1))

export const skillUninstallQuerySchema = z.object({
  name: trimmedNonEmptyString,
  searchRootPath: trimmedNonEmptyString.optional(),
}).strict()

export const skillUninstallCandidateSchema = z.object({
  path: z.string().min(1),
  name: z.string().min(1),
  frontmatterName: z.string().optional(),
  editorIds: z.array(z.string()),
  source: z.enum(["synapse", "external"]),
  synapseContentId: z.string().optional(),
}).strict()

export const skillUninstallScanResultSchema = z.object({
  candidates: z.array(skillUninstallCandidateSchema),
  complete: z.boolean(),
  warnings: z.array(z.string()),
}).strict()

export const skillUninstallTargetSchema = z.object({
  query: skillUninstallQuerySchema,
  path: z.string().min(1),
}).strict()

export const skillUninstallBatchResultItemSchema = z.object({
  path: z.string().min(1),
  status: z.enum(["trashed", "failed", "skipped"]),
  error: z.string().optional(),
}).strict()

export const skillUninstallBatchResultSchema = z.object({
  results: z.array(skillUninstallBatchResultItemSchema),
}).strict()

export const skillUninstallScanRequestSchema = z.object({
  scanId: z.string().min(1),
  query: skillUninstallQuerySchema,
}).strict()

export const skillUninstallCancelRequestSchema = z.object({
  scanId: z.string().min(1),
}).strict()

export type SkillUninstallQuery = z.infer<typeof skillUninstallQuerySchema>
export type SkillUninstallCandidate = z.infer<typeof skillUninstallCandidateSchema>
export type SkillUninstallScanResult = z.infer<typeof skillUninstallScanResultSchema>
export type SkillUninstallTarget = z.infer<typeof skillUninstallTargetSchema>
export type SkillUninstallBatchResult = z.infer<typeof skillUninstallBatchResultSchema>
export type SkillUninstallScanRequest = z.infer<typeof skillUninstallScanRequestSchema>
export type SkillUninstallCancelRequest = z.infer<typeof skillUninstallCancelRequestSchema>
```

Append these constants to `desktop/config.ts`, keeping the required Chinese comment above every constant:

```ts
// Skill 卸载器递归扫描最大目录深度：限制自定义根目录中的异常深层级遍历。
export const SKILL_UNINSTALL_SCAN_MAX_DEPTH = 32

// Skill 卸载器单次最多访问目录数：避免误选超大目录后长期占用主进程。
export const SKILL_UNINSTALL_SCAN_MAX_DIRECTORIES = 50_000

// Skill 卸载器单次扫描超时时间（毫秒）：超时后返回已发现结果并标记扫描未完成。
export const SKILL_UNINSTALL_SCAN_TIMEOUT_MS = 30_000

// Skill 卸载器目录读取并发数：限制递归扫描对本机文件系统的瞬时压力。
export const SKILL_UNINSTALL_SCAN_CONCURRENCY = 8
```

- [ ] **Step 4: Run schema tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run app-capabilities/skill-uninstaller/main/__tests__/ipc.test.ts
```

Expected: PASS for the two schema tests.

- [ ] **Step 5: Commit shared contracts**

```bash
git add desktop/config.ts desktop/app-capabilities/skill-uninstaller/shared desktop/app-capabilities/skill-uninstaller/main/__tests__/ipc.test.ts
git commit -m "feat: define skill uninstaller contracts"
```

---

### Task 2: Bounded Recursive Skill Scanner

**Files:**
- Create: `desktop/app-capabilities/skill-uninstaller/main/scanner.ts`
- Create: `desktop/app-capabilities/skill-uninstaller/main/__tests__/scanner.test.ts`

**Interfaces:**
- Consumes `SkillUninstallQuery` and `SkillUninstallCandidate` from Task 1.
- Produces `scanSkillRoots(input: ScanSkillRootsInput): Promise<SkillUninstallScanResult>`.
- `ScanSkillRootsInput.roots` carries a path plus the Agent ids associated with that physical root.
- `classifyEditors(candidatePath)` asynchronously adds project-path Agent attribution for custom-root scans.

- [ ] **Step 1: Write failing traversal and matching tests**

Create temp fixtures in `desktop/app-capabilities/skill-uninstaller/main/__tests__/scanner.test.ts`:

```ts
import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { scanSkillRoots } from "../scanner"

const roots: string[] = []

async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "skill-uninstaller-scan-"))
  roots.push(root)
  return root
}

async function skill(root: string, relative: string, frontmatterName?: string): Promise<string> {
  const dir = path.join(root, relative)
  await mkdir(dir, { recursive: true })
  const frontmatter = frontmatterName
    ? `---\nname: ${frontmatterName}\ndescription: test\n---\n`
    : "# Skill\n"
  await writeFile(path.join(dir, "SKILL.md"), frontmatter)
  return dir
}

afterEach(async () => {
  const { rm } = await import("node:fs/promises")
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("scanSkillRoots", () => {
  it("matches directory or frontmatter name case-insensitively and returns every location", async () => {
    const root = await fixture()
    const first = await skill(root, ".cursor/skills/Jenkins")
    const second = await skill(root, "nested/custom-folder", "JENKINS")

    const result = await scanSkillRoots({
      query: { name: "jenkins", searchRootPath: root },
      roots: [{ path: root, editorIds: [] }],
      classifyEditors: (candidatePath) => candidatePath === first ? ["cursor"] : [],
    })

    expect(result.complete).toBe(true)
    expect(result.candidates.map((candidate) => candidate.path).sort()).toEqual([first, second].sort())
    expect(result.candidates[0]?.source).toBe("external")
  })

  it("skips excluded directories and does not descend below a Skill root", async () => {
    const root = await fixture()
    await skill(root, "node_modules/jenkins")
    const parent = await skill(root, "bundle", "other")
    await skill(parent, "children/jenkins")

    const result = await scanSkillRoots({
      query: { name: "jenkins", searchRootPath: root },
      roots: [{ path: root, editorIds: [] }],
      classifyEditors: () => [],
    })

    expect(result.candidates).toEqual([])
  })

  it("does not follow symlink directories and deduplicates real paths", async () => {
    const root = await fixture()
    const target = await skill(root, "real/jenkins")
    await symlink(path.dirname(target), path.join(root, "linked"), "dir")

    const result = await scanSkillRoots({
      query: { name: "jenkins", searchRootPath: root },
      roots: [
        { path: root, editorIds: ["cursor"] },
        { path: root, editorIds: ["codex"] },
      ],
      classifyEditors: () => [],
    })

    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]?.editorIds.sort()).toEqual(["codex", "cursor"])
  })
})
```

- [ ] **Step 2: Run tests and confirm failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run app-capabilities/skill-uninstaller/main/__tests__/scanner.test.ts
```

Expected: FAIL because `../scanner` does not exist.

- [ ] **Step 3: Implement the iterative scanner**

Create `scanner.ts` with these exact exports and defaults:

```ts
import { lstat, readFile, readdir, realpath } from "node:fs/promises"
import path from "node:path"
import {
  SKILL_UNINSTALL_SCAN_CONCURRENCY,
  SKILL_UNINSTALL_SCAN_MAX_DEPTH,
  SKILL_UNINSTALL_SCAN_MAX_DIRECTORIES,
  SKILL_UNINSTALL_SCAN_TIMEOUT_MS,
} from "../../../config"
import { parseFrontmatterBlock } from "../../../src/definitions/editor/shared-yaml-scalar"
import type {
  SkillUninstallCandidate,
  SkillUninstallQuery,
  SkillUninstallScanResult,
} from "../shared/schema"

export const SKILL_UNINSTALL_EXCLUDED_DIRECTORIES = new Set([
  "node_modules", ".git", ".svn", ".hg", ".next", ".nuxt", ".cache",
  ".turbo", "dist", "build", "out", "coverage", "target", "vendor",
])

export type ScanSkillRoot = {
  readonly path: string
  readonly editorIds: readonly string[]
}

export type ScanSkillRootsInput = {
  readonly query: SkillUninstallQuery
  readonly roots: readonly ScanSkillRoot[]
  readonly classifyEditors: (
    candidatePath: string,
  ) => readonly string[] | Promise<readonly string[]>
  readonly signal?: AbortSignal
  readonly limits?: Partial<{
    maxDepth: number
    maxDirectories: number
    timeoutMs: number
    concurrency: number
  }>
}

export async function scanSkillRoots(input: ScanSkillRootsInput): Promise<SkillUninstallScanResult>
```

Implementation requirements:

```ts
function normalizeName(value: string): string {
  return value.trim().toLowerCase()
}

function readFrontmatterName(content: string): string | undefined {
  if (!content.startsWith("---")) return undefined
  const end = content.indexOf("\n---", 3)
  if (end < 0) return undefined
  return parseFrontmatterBlock(content.slice(4, end)).metadata.name?.trim() || undefined
}
```

Use one shared FIFO queue of `{ path, depth, editorIds }`, up to `concurrency` workers, and a `Map<realPath, SkillUninstallCandidate>`. Every worker must check `signal.aborted`, elapsed time, visited count, excluded basename, and depth before reading children. Use `lstat` before `realpath`; skip symlink directories and symlink `SKILL.md`. Read only `SKILL.md` and optional `.synapse.json`. When `SKILL.md` is a regular file, evaluate the name and stop descending regardless of match. Merge `root.editorIds` and `await classifyEditors(realPath)` into the deduplicated candidate. Sort candidates by `path` before returning.

Set `complete: false` and one of these stable warnings when applicable:

```ts
"扫描已取消。"
"扫描超时，当前结果可能不完整。"
"目录数量超过上限，当前结果可能不完整。"
"目录层级超过上限，当前结果可能不完整。"
```

- [ ] **Step 4: Add cancellation and limit tests**

Append explicit tests using injected limits:

```ts
it("returns partial results when cancelled or limited", async () => {
  const root = await fixture()
  await skill(root, "a/jenkins")
  await mkdir(path.join(root, "b", "c", "d"), { recursive: true })

  const limited = await scanSkillRoots({
    query: { name: "jenkins", searchRootPath: root },
    roots: [{ path: root, editorIds: [] }],
    classifyEditors: () => [],
    limits: { maxDepth: 1, maxDirectories: 50, timeoutMs: 30_000, concurrency: 1 },
  })
  expect(limited.complete).toBe(false)
  expect(limited.warnings).toContain("目录层级超过上限，当前结果可能不完整。")

  const controller = new AbortController()
  controller.abort()
  const cancelled = await scanSkillRoots({
    query: { name: "jenkins", searchRootPath: root },
    roots: [{ path: root, editorIds: [] }],
    classifyEditors: () => [],
    signal: controller.signal,
  })
  expect(cancelled).toMatchObject({ complete: false, warnings: ["扫描已取消。"] })
})
```

- [ ] **Step 5: Run scanner tests and commit**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run app-capabilities/skill-uninstaller/main/__tests__/scanner.test.ts
```

Expected: PASS.

```bash
git add desktop/app-capabilities/skill-uninstaller/main/scanner.ts desktop/app-capabilities/skill-uninstaller/main/__tests__/scanner.test.ts
git commit -m "feat: scan skill uninstall targets"
```

---

### Task 3: Secure Scan And Sequential Trash Service

**Files:**
- Create: `desktop/app-capabilities/skill-uninstaller/main/service.ts`
- Create: `desktop/app-capabilities/skill-uninstaller/main/__tests__/service.test.ts`
- Modify: `desktop/electron/services/editor-scan-roots.ts`
- Modify: `desktop/electron/services/__tests__/editor-scan-roots.test.ts`

**Interfaces:**
- Produces `listGlobalTrustedSkillRoots(): Promise<TrustedSkillRoot[]>`.
- Produces `inferProjectSkillEditors(candidatePath: string, searchRootPath: string): Promise<SynapseEditorId[]>` using adapter `projectPaths()` rules.
- Produces `SkillUninstallerService.scan(query, security, signal?)`.
- Produces `SkillUninstallerService.uninstall(targets, security, hooks?)`.
- `hooks.onTrashedContentId` is main-process-only and keeps install-status refresh outside the service result contract.

- [ ] **Step 1: Add failing root-resolution tests**

Extend `desktop/electron/services/__tests__/editor-scan-roots.test.ts`:

```ts
it("lists global roots without configured project roots", async () => {
  const roots = await listGlobalTrustedSkillRoots()
  expect(roots.every((root) => root.scope === "global")).toBe(true)
})

it("attributes a custom candidate through adapter project path rules", async () => {
  const ids = await inferProjectSkillEditors(
    "/repo/.cursor/skills/jenkins",
    "/repo",
  )
  expect(ids).toContain("cursor")
})
```

- [ ] **Step 2: Implement global roots and project attribution**

Refactor `editor-scan-roots.ts` so the existing `listTrustedSkillRoots()` composes a new global helper instead of duplicating adapter enumeration:

```ts
export async function listGlobalTrustedSkillRoots(): Promise<TrustedSkillRoot[]> {
  return collectGlobalRoots(editorAdapters)
}

export async function inferProjectSkillEditors(
  candidatePath: string,
  searchRootPath: string,
): Promise<SynapseEditorId[]> {
  const candidateParent = path.dirname(await physicalPath(candidatePath))
  const root = await physicalPath(searchRootPath)
  const editors = new Set<SynapseEditorId>()
  let possibleProjectRoot = candidateParent

  while (possibleProjectRoot === root || possibleProjectRoot.startsWith(`${root}${path.sep}`)) {
    for (const adapter of editorAdapters) {
      const expected = await physicalPath(
        adapter.getScanPathConfig().projectPaths(possibleProjectRoot).skillsPath,
      )
      if (expected === candidateParent) editors.add(adapter.id)
    }
    if (possibleProjectRoot === root) break
    possibleProjectRoot = path.dirname(possibleProjectRoot)
  }

  return [...editors].sort((left, right) => left.localeCompare(right))
}
```

- [ ] **Step 3: Write failing service tests**

Create `service.test.ts` with injected filesystem-safe hooks. Cover external Skill scan, read denial, target substitution, sequential execution, skip, and partial failure:

```ts
it("trashes external Skills sequentially and keeps later targets after one failure", async () => {
  const order: string[] = []
  const service = createTestService({
    trashItem: async (targetPath) => {
      order.push(targetPath)
      if (targetPath.endsWith("first")) throw new Error("denied")
    },
  })

  const result = await service.uninstall([
    { query: { name: "first", searchRootPath: root }, path: firstPath },
    { query: { name: "second", searchRootPath: root }, path: secondPath },
  ], allowSecurity())

  expect(order).toEqual([firstPath, secondPath])
  expect(result.results.map((item) => item.status)).toEqual(["failed", "trashed"])
})

it("skips a target that changes name after scanning", async () => {
  await writeFile(path.join(targetPath, "SKILL.md"), "---\nname: changed\n---\n")
  const result = await service.uninstall([
    { query: { name: "jenkins", searchRootPath: root }, path: targetPath },
  ], allowSecurity())
  expect(result.results[0]).toMatchObject({ status: "skipped" })
  expect(trashItem).not.toHaveBeenCalled()
})
```

Use test helpers with `PermissionGuard.check()` resolving `{ allowed: true }`, an `AuditSink.record` spy, and an injected `trashItem` function. Add a denied-read scan assertion and a target-outside-root assertion.

- [ ] **Step 4: Implement the service and immediate revalidation**

Create `service.ts` with explicit dependency injection:

```ts
import { shell } from "electron"
import type { ActorIdentity, AuditSink, PermissionGuard } from "../../../electron/runtime/security"
import type { SkillUninstallQuery, SkillUninstallTarget } from "../shared/schema"

export type SkillUninstallerSecurity = {
  readonly actor: ActorIdentity
  readonly auditSink: AuditSink
  readonly permissionGuard: PermissionGuard
}

export type SkillUninstallerHooks = {
  readonly onTrashedContentId?: (contentId: string) => Promise<void>
}

export type SkillUninstallerServiceDeps = {
  readonly trashItem: (targetPath: string) => Promise<void>
}

export class SkillUninstallerService {
  constructor(private readonly deps: SkillUninstallerServiceDeps = {
    trashItem: (targetPath) => shell.trashItem(targetPath),
  }) {}

  async scan(
    query: SkillUninstallQuery,
    security: SkillUninstallerSecurity,
    signal?: AbortSignal,
  ): Promise<SkillUninstallScanResult>

  async uninstall(
    targets: readonly SkillUninstallTarget[],
    security: SkillUninstallerSecurity,
    hooks: SkillUninstallerHooks = {},
  ): Promise<SkillUninstallBatchResult>
}

export const skillUninstallerService = new SkillUninstallerService()
```

For custom roots, call permission action `fs.read.outside-userdata` once before scanning and record allowed/denied/failed audit outcomes. For every trash target, call action `fs.write` and record operation `skill-uninstall`. Before trashing, `lstat` the target and `SKILL.md`, reject symlinks, resolve both real paths, assert the target is equal to or below one allowed root, read current frontmatter, and repeat the exact-name match. Read `.synapse.json` before trashing; if it has a non-empty string `id`, invoke `hooks.onTrashedContentId(id)` after successful trash. Hook failure is logged and does not change `trashed` status.

Use stable user-facing messages:

```ts
"搜索目录不存在或无法读取。"
"目标已发生变化，已跳过。"
"目标不在本次扫描范围内，已跳过。"
"没有写入该位置的权限。"
"移到废纸篓失败。"
```

- [ ] **Step 5: Run service/root tests and commit**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  electron/services/__tests__/editor-scan-roots.test.ts \
  app-capabilities/skill-uninstaller/main/__tests__/scanner.test.ts \
  app-capabilities/skill-uninstaller/main/__tests__/service.test.ts
```

Expected: PASS.

```bash
git add desktop/electron/services/editor-scan-roots.ts desktop/electron/services/__tests__/editor-scan-roots.test.ts desktop/app-capabilities/skill-uninstaller/main
git commit -m "feat: add secure skill uninstall service"
```

---

### Task 4: IPC, Cancellation, Preload, And Status Refresh

**Files:**
- Create: `desktop/app-capabilities/skill-uninstaller/main/ipc.ts`
- Modify: `desktop/app-capabilities/skill-uninstaller/main/__tests__/ipc.test.ts`
- Modify: `desktop/electron/bootstrap/ipc-registry.ts`
- Modify: `desktop/scripts/build/generate-ipc.mjs`
- Modify: `desktop/electron/generated/ipc-channels.generated.ts` (generated)
- Modify: `desktop/electron/preload.ts`
- Modify: `desktop/electron/__tests__/preload.test.ts`
- Modify: `desktop/src/types/bridge.ts`

**Interfaces:**
- Produces IPC domain `skill-uninstaller` with `scan`, `cancelScan`, and `uninstall`.
- Produces bridge domain `window.synapse.skillUninstaller` with the same methods.
- Consumes `notifyInstallStatusChanged()` for successful Synapse-owned targets.

- [ ] **Step 1: Add failing IPC and preload tests**

Append to `ipc.test.ts`:

```ts
it("registers scan, cancel, and uninstall channels", async () => {
  const { skillUninstallerIpcModule } = await import("../ipc")
  expect(Object.keys(skillUninstallerIpcModule.methods)).toEqual(["scan", "cancelScan", "uninstall"])
})

it("removes a scan controller after cancellation", async () => {
  const { createSkillUninstallerIpcModule } = await import("../ipc")
  const scan = vi.fn((_query, _security, signal: AbortSignal) => new Promise((resolve) => {
    signal.addEventListener("abort", () => resolve({ candidates: [], complete: false, warnings: ["扫描已取消。"] }))
  }))
  const module = createSkillUninstallerIpcModule({ scan, uninstall: vi.fn() } as never)
  const scanPromise = module.methods.scan.handler(ctx, { scanId: "scan-1", query: { name: "jenkins" } })
  await module.methods.cancelScan.handler(ctx, { scanId: "scan-1" })
  await expect(scanPromise).resolves.toMatchObject({ complete: false })
})
```

Append to `desktop/electron/__tests__/preload.test.ts`:

```ts
it("maps skill uninstaller methods to IPC channels", async () => {
  const bridge = await loadPreloadBridge()
  await bridge.skillUninstaller.scan({ scanId: "scan-1", query: { name: "jenkins" } })
  await bridge.skillUninstaller.cancelScan({ scanId: "scan-1" })
  await bridge.skillUninstaller.uninstall({
    targets: [{ query: { name: "jenkins" }, path: "/tmp/jenkins" }],
  })
  expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
    "synapse:skill-uninstaller:scan",
    { scanId: "scan-1", query: { name: "jenkins" } },
  )
})
```

- [ ] **Step 2: Implement the IPC module**

Create `main/ipc.ts` with a factory for test isolation and a singleton export:

```ts
const activeScans = new Map<string, AbortController>()

function securityFrom(ctx: IpcHandlerContext): SkillUninstallerSecurity {
  return {
    actor: { kind: "user" },
    auditSink: ctx.resolve<AuditSink>("core.audit-sink"),
    permissionGuard: ctx.resolve<PermissionGuard>("core.permission-guard"),
  }
}

export function createSkillUninstallerIpcModule(
  service: Pick<SkillUninstallerService, "scan" | "uninstall"> = skillUninstallerService,
): IpcModule {
  return {
    id: "skill-uninstaller",
    methods: {
      scan: {
        kind: "invoke",
        channel: "synapse:skill-uninstaller:scan",
        request: skillUninstallScanRequestSchema,
        response: skillUninstallScanResultSchema,
        handler: async (ctx, request: SkillUninstallScanRequest) => {
          activeScans.get(request.scanId)?.abort()
          const controller = new AbortController()
          activeScans.set(request.scanId, controller)
          try {
            return await service.scan(request.query, securityFrom(ctx), controller.signal)
          } finally {
            if (activeScans.get(request.scanId) === controller) activeScans.delete(request.scanId)
          }
        },
      },
      cancelScan: {
        kind: "invoke",
        channel: "synapse:skill-uninstaller:scan:cancel",
        request: skillUninstallCancelRequestSchema,
        response: z.object({ cancelled: z.boolean() }).strict(),
        handler: async (_ctx, request: SkillUninstallCancelRequest) => {
          const controller = activeScans.get(request.scanId)
          controller?.abort()
          return { cancelled: Boolean(controller) }
        },
      },
      uninstall: {
        kind: "invoke",
        channel: "synapse:skill-uninstaller:uninstall",
        request: z.object({ targets: z.array(skillUninstallTargetSchema) }).strict(),
        response: skillUninstallBatchResultSchema,
        handler: async (ctx, request: { targets: SkillUninstallTarget[] }) => {
          const eventBus = ctx.resolve<EventBus>("core.event-bus")
          return service.uninstall(request.targets, securityFrom(ctx), {
            onTrashedContentId: (contentId) => notifyInstallStatusChanged(eventBus, contentId, {
              logger,
              warningMessage: "Failed to refresh install status after Skill uninstall.",
            }),
          })
        },
      },
    },
    events: {},
  }
}

export const skillUninstallerIpcModule = createSkillUninstallerIpcModule()
```

- [ ] **Step 3: Register and generate channels**

Import/register/list `skillUninstallerIpcModule` in `desktop/electron/bootstrap/ipc-registry.ts`. Add this source entry to `MODULE_SOURCES` in `desktop/scripts/build/generate-ipc.mjs`:

```js
{ id: "skillUninstaller", outputId: "skill-uninstaller", importPath: "app-capabilities/skill-uninstaller/main/ipc.ts" },
```

Run:

```bash
pnpm --filter @synapse/desktop run generate:ipc
```

Expected: `desktop/electron/generated/ipc-channels.generated.ts` gains the three channels and no unrelated diff.

- [ ] **Step 4: Add bridge types and preload methods**

Import shared request/result types into `desktop/src/types/bridge.ts` and add:

```ts
skillUninstaller: {
  scan: (request: SkillUninstallScanRequest) => Promise<SkillUninstallScanResult>
  cancelScan: (request: SkillUninstallCancelRequest) => Promise<{ cancelled: boolean }>
  uninstall: (request: { targets: SkillUninstallTarget[] }) => Promise<SkillUninstallBatchResult>
}
```

Add the channel map and bridge methods in `desktop/electron/preload.ts`:

```ts
"skill-uninstaller": {
  scan: "synapse:skill-uninstaller:scan",
  cancelScan: "synapse:skill-uninstaller:scan:cancel",
  uninstall: "synapse:skill-uninstaller:uninstall",
},

skillUninstaller: {
  scan: invoke(IPC_CHANNELS["skill-uninstaller"].scan),
  cancelScan: invoke(IPC_CHANNELS["skill-uninstaller"].cancelScan),
  uninstall: invoke(IPC_CHANNELS["skill-uninstaller"].uninstall),
},
```

- [ ] **Step 5: Verify IPC and commit**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  app-capabilities/skill-uninstaller/main/__tests__/ipc.test.ts \
  electron/__tests__/preload.test.ts
pnpm --filter @synapse/desktop run check:ipc-codegen
```

Expected: tests PASS and codegen check exits 0.

```bash
git add desktop/app-capabilities/skill-uninstaller/main/ipc.ts desktop/app-capabilities/skill-uninstaller/main/__tests__/ipc.test.ts desktop/electron/bootstrap/ipc-registry.ts desktop/scripts/build/generate-ipc.mjs desktop/electron/generated/ipc-channels.generated.ts desktop/electron/preload.ts desktop/electron/__tests__/preload.test.ts desktop/src/types/bridge.ts
git commit -m "feat: expose skill uninstaller bridge"
```

---

### Task 5: Shared Renderer Flow And Callable Dialog

**Files:**
- Create: `desktop/app-capabilities/skill-uninstaller/renderer/skill-uninstaller-flow.tsx`
- Create: `desktop/app-capabilities/skill-uninstaller/renderer/skill-uninstaller-dialog.tsx`
- Create: `desktop/app-capabilities/skill-uninstaller/renderer/use-skill-uninstaller-dialog.tsx`
- Create: `desktop/app-capabilities/skill-uninstaller/renderer/__tests__/skill-uninstaller-flow.test.tsx`
- Create: `desktop/app-capabilities/skill-uninstaller/renderer/__tests__/skill-uninstaller-dialog.test.tsx`

**Interfaces:**
- Produces `SkillUninstallerFlow` with page/modal modes.
- Produces `SkillUninstallerDialog` with a locked prefilled query.
- Produces `useSkillUninstallerDialog()` returning `{ dialog, openSkillUninstaller, closeSkillUninstaller }`.

- [ ] **Step 1: Write failing flow tests**

Create `skill-uninstaller-flow.test.tsx` using jsdom and a mocked bridge. Cover these assertions:

```tsx
it("starts with no selected candidates and supports select all", async () => {
  mocks.scan.mockResolvedValue({
    candidates: [candidate("/one/jenkins"), candidate("/two/jenkins")],
    complete: true,
    warnings: [],
  })
  await renderFlow({ initialQuery: { name: "jenkins" } })
  await click("扫描")
  expect(document.querySelectorAll('[role="checkbox"][aria-label^="选择"]').length).toBe(2)
  expect(getButton("移到废纸篓").disabled).toBe(true)
  await click("全选")
  expect(getButton("移到废纸篓（2）").disabled).toBe(false)
})

it("confirms before submitting and keeps failed rows", async () => {
  mocks.uninstall.mockResolvedValue({
    results: [
      { path: "/one/jenkins", status: "trashed" },
      { path: "/two/jenkins", status: "failed", error: "没有写入该位置的权限。" },
    ],
  })
  // scan, select all, open confirmation, confirm
  expect(mocks.uninstall).toHaveBeenCalledWith({
    targets: expect.arrayContaining([
      { query: { name: "jenkins" }, path: "/one/jenkins" },
      { query: { name: "jenkins" }, path: "/two/jenkins" },
    ]),
  })
  expect(document.body.textContent).not.toContain("/one/jenkins")
  expect(document.body.textContent).toContain("没有写入该位置的权限。")
})
```

Use the same React `createRoot`/`act` harness as the existing IDE Manager dialog tests and define:

```ts
function getButton(text: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
    .find((candidate) => candidate.textContent === text)
  if (!button) throw new Error(`Button not found: ${text}`)
  return button
}
```

Also test `complete: false`, warnings, scan cancellation, empty result, and `onCompleted`.

- [ ] **Step 2: Implement `SkillUninstallerFlow`**

Use this public props contract:

```ts
export type SkillUninstallerFlowProps = {
  readonly mode: "page" | "modal"
  readonly initialQuery?: SkillUninstallQuery
  readonly queryReadOnly?: boolean
  readonly autoScan?: boolean
  readonly onCancel?: () => void
  readonly onCompleted?: (result: SkillUninstallBatchResult) => Promise<void> | void
}
```

Implement state for `query`, `scanId`, `scanning`, `scanResult`, `selectedPaths`, `confirmOpen`, `uninstalling`, and per-path failure messages. Generate scan ids with `crypto.randomUUID()`. On new scan, cancel the previous `scanId`; on unmount, cancel an active scan. Keep selection empty after every scan. Render:

```tsx
<FieldSet>
  <Field>{/* Skill 名称 Input */}</Field>
  <Field>{/* 搜索目录 InputGroup + 选择 */}</Field>
</FieldSet>
<Button>{scanning ? "取消扫描" : "扫描"}</Button>
<Checkbox aria-label="全选" />
{/* one flat row per candidate: checkbox, name, Agent labels, source, path */}
<Button variant="destructive" disabled={selectedPaths.size === 0 || uninstalling}>
  {selectedPaths.size > 0 ? `移到废纸篓（${selectedPaths.size}）` : "移到废纸篓"}
</Button>
```

Use `AlertDialog` for confirmation. Show selected count and up to five paths plus a remaining count. Do not select candidates automatically. Use `Spinner`, `Alert`, `Checkbox`, `Button`, `Field`, `InputGroup`, and `ScrollArea`; do not create CSS.

- [ ] **Step 3: Implement the callable dialog and hook**

Create `skill-uninstaller-dialog.tsx`:

```tsx
export type SkillUninstallerDialogProps = {
  readonly open: boolean
  readonly query: SkillUninstallQuery | null
  readonly onOpenChange: (open: boolean) => void
  readonly onCompleted?: (result: SkillUninstallBatchResult) => Promise<void> | void
}

export function SkillUninstallerDialog(props: SkillUninstallerDialogProps) {
  if (!props.query) return null
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="h-[min(42rem,calc(100vh-2rem))] sm:max-w-2xl" showCloseButton={false}>
        <DialogFrame>
          <DialogFrameHeader title="Skill 卸载器" bordered />
          <DialogFrameBody>
            <SkillUninstallerFlow
              mode="modal"
              initialQuery={props.query}
              queryReadOnly
              autoScan
              onCancel={() => props.onOpenChange(false)}
              onCompleted={props.onCompleted}
            />
          </DialogFrameBody>
        </DialogFrame>
      </DialogContent>
    </Dialog>
  )
}
```

Create the hook with a stable options type:

```tsx
export type OpenSkillUninstallerOptions = {
  readonly initialName: string
  readonly initialSearchRootPath?: string
  readonly onCompleted?: (result: SkillUninstallBatchResult) => Promise<void> | void
}

export function useSkillUninstallerDialog() {
  const [state, setState] = useState<OpenSkillUninstallerOptions | null>(null)
  const openSkillUninstaller = useCallback((options: OpenSkillUninstallerOptions) => setState(options), [])
  const closeSkillUninstaller = useCallback(() => setState(null), [])
  return {
    openSkillUninstaller,
    closeSkillUninstaller,
    dialog: (
      <SkillUninstallerDialog
        open={state !== null}
        query={state ? {
          name: state.initialName,
          searchRootPath: state.initialSearchRootPath,
        } : null}
        onOpenChange={(open) => { if (!open) closeSkillUninstaller() }}
        onCompleted={state?.onCompleted}
      />
    ),
  }
}
```

- [ ] **Step 4: Run renderer flow/dialog tests and commit**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  app-capabilities/skill-uninstaller/renderer/__tests__/skill-uninstaller-flow.test.tsx \
  app-capabilities/skill-uninstaller/renderer/__tests__/skill-uninstaller-dialog.test.tsx
```

Expected: PASS.

```bash
git add desktop/app-capabilities/skill-uninstaller/renderer/skill-uninstaller-flow.tsx desktop/app-capabilities/skill-uninstaller/renderer/skill-uninstaller-dialog.tsx desktop/app-capabilities/skill-uninstaller/renderer/use-skill-uninstaller-dialog.tsx desktop/app-capabilities/skill-uninstaller/renderer/__tests__
git commit -m "feat: add shared skill uninstaller flow"
```

---

### Task 6: Standalone Skill Uninstaller System App

**Files:**
- Create: `desktop/app-capabilities/skill-uninstaller/renderer/index.tsx`
- Create: `desktop/app-capabilities/skill-uninstaller/renderer/app-definition.ts`
- Create: `desktop/app-capabilities/skill-uninstaller/renderer/app-manifest.ts`
- Create: `desktop/app-capabilities/skill-uninstaller/renderer/__tests__/skill-uninstaller-module.test.tsx`
- Modify: `desktop/src/modules/apps/types.ts`
- Modify: `desktop/src/modules/apps/registry.ts`
- Modify: `desktop/src/modules/apps/definitions.ts`
- Modify: `desktop/src/modules/apps/components/system-app-content.tsx`
- Modify: `desktop/src/modules/apps/__tests__/registry.test.ts`
- Modify: `desktop/src/modules/apps/__tests__/system-app-window-app.test.tsx`
- Modify: `desktop/src/modules/apps/__tests__/system-app-content-launcher.test.tsx`

**Interfaces:**
- Produces system app id `skill-uninstaller`, namespace `skill_uninstaller`, name/window title `Skill 卸载器`, dock order `285`.
- Reuses `desktop/src/modules/installers/assets/icon.png`; no new visual asset is introduced.

- [ ] **Step 1: Write failing registry and module tests**

Update registry expectation so the new app sits immediately after `skill-installer`. Add:

```ts
expect(getSystemAppManifest("skill-uninstaller")).toMatchObject({
  id: "skill-uninstaller",
  namespace: "skill_uninstaller",
  name: "Skill 卸载器",
  windowTitle: "Skill 卸载器",
  dock: { pinnedByDefault: false, order: 285 },
  capabilities: { primaryMcpPrefix: "app_skill_uninstaller" },
})
```

Create `skill-uninstaller-module.test.tsx` and assert the page renders editable `Skill 名称`, optional `搜索目录`, `选择`, and `扫描` controls without auto-scanning.

- [ ] **Step 2: Implement the system app wrapper**

Create definition/manifest matching the interfaces. Create `renderer/index.tsx`:

```tsx
export function SkillUninstallerModule() {
  return (
    <SystemAppWindowShell>
      <ScrollArea className="h-full min-h-0">
        <div className="mx-auto w-full max-w-2xl p-3 sm:p-5">
          <Card className="py-0">
            <CardContent className="p-4 sm:p-5">
              <SkillUninstallerFlow mode="page" />
            </CardContent>
          </Card>
        </div>
      </ScrollArea>
    </SystemAppWindowShell>
  )
}

export { SkillUninstallerDialog } from "./skill-uninstaller-dialog"
export { useSkillUninstallerDialog } from "./use-skill-uninstaller-dialog"
```

- [ ] **Step 3: Register renderer content everywhere system apps are enumerated**

Add the id/namespace unions, import manifest/definition, insert it after the installer, import `SkillUninstallerModule` in `system-app-content.tsx`, and add:

```tsx
if (appId === "skill-uninstaller") return <SkillUninstallerModule />
```

Add equivalent mocks to the two system app rendering tests and assertions for embedded and standalone rendering.

- [ ] **Step 4: Run app tests and commit**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  app-capabilities/skill-uninstaller/renderer/__tests__/skill-uninstaller-module.test.tsx \
  src/modules/apps/__tests__/registry.test.ts \
  src/modules/apps/__tests__/system-app-window-app.test.tsx \
  src/modules/apps/__tests__/system-app-content-launcher.test.tsx
```

Expected: PASS.

```bash
git add desktop/app-capabilities/skill-uninstaller/renderer desktop/src/modules/apps
git commit -m "feat: add skill uninstaller system app"
```

---

### Task 7: IDE Manager Single-Skill Dialog Integration

**Files:**
- Modify: `desktop/src/modules/editor-scan/index.tsx`
- Modify: `desktop/src/modules/editor-scan/components/scan-item-detail-dialog.tsx`
- Modify: `desktop/src/modules/editor-scan/__tests__/editor-scan-module-state.test.tsx`
- Modify: `desktop/src/modules/editor-scan/__tests__/scan-item-detail-dialog-layout.test.ts`

**Interfaces:**
- `ScanItemDetailDialog` produces `onRequestSkillUninstall(item)` for Skill rows.
- `EditorScanModule` owns `useSkillUninstallerDialog()` and supplies global/project query scope.
- Rule removal continues using the existing `editorScan.trashItem` confirmation.

- [ ] **Step 1: Add failing integration tests**

In `editor-scan-module-state.test.tsx`, mock `useSkillUninstallerDialog` and assert:

```ts
expect(mocks.openSkillUninstaller).toHaveBeenCalledWith(expect.objectContaining({
  initialName: "jenkins",
  initialSearchRootPath: "/repo",
}))
```

Add a global case asserting `initialSearchRootPath` is absent. Update the static layout test so the Skill menu invokes `onRequestSkillUninstall(item)`, while the Rule branch still opens `isTrashConfirmOpen`.

- [ ] **Step 2: Move Skill dialog ownership to `EditorScanModule`**

In `index.tsx`:

```tsx
const { dialog: skillUninstallerDialog, openSkillUninstaller } = useSkillUninstallerDialog()

const requestSkillUninstall = useCallback((item: ScanItemForDetail) => {
  closeDialogThenNavigate(
    () => setDetailOpen(false),
    () => openSkillUninstaller({
      initialName: item.name,
      initialSearchRootPath: item.scope === "project" ? item.projectPath ?? item.path : undefined,
      onCompleted: async () => { await refresh() },
    }),
  )
}, [openSkillUninstaller, refresh])
```

Pass `onRequestSkillUninstall={requestSkillUninstall}` to the detail dialog and render `{skillUninstallerDialog}` as a sibling after the existing dialogs.

- [ ] **Step 3: Keep Rule trash local and delegate Skill trash**

Add the prop:

```ts
onRequestSkillUninstall?: (item: ScanItemForDetail) => void
```

In the destructive menu item:

```tsx
onSelect={() => {
  if (item.type === "skill") {
    onRequestSkillUninstall?.(item)
    return
  }
  setIsTrashConfirmOpen(true)
}}
```

Guard the existing `AlertDialog` and `handleTrashConfirm` for `item.type === "rule"`. Do not remove Rule section deletion behavior.

- [ ] **Step 4: Run IDE single-item tests and commit**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  src/modules/editor-scan/__tests__/editor-scan-module-state.test.tsx \
  src/modules/editor-scan/__tests__/scan-item-detail-dialog-layout.test.ts
```

Expected: PASS.

```bash
git add desktop/src/modules/editor-scan/index.tsx desktop/src/modules/editor-scan/components/scan-item-detail-dialog.tsx desktop/src/modules/editor-scan/__tests__/editor-scan-module-state.test.tsx desktop/src/modules/editor-scan/__tests__/scan-item-detail-dialog-layout.test.ts
git commit -m "refactor: use skill uninstaller in IDE manager"
```

---

### Task 8: IDE Manager Bulk Removal Uses The Public Batch Service

**Files:**
- Modify: `desktop/src/modules/editor-scan/lib/bulk-skill-trash.ts`
- Modify: `desktop/src/modules/editor-scan/components/editor-bulk-skill-trash-dialog.tsx`
- Modify: `desktop/src/modules/editor-scan/__tests__/editor-bulk-skill-trash-dialog.test.tsx`

**Interfaces:**
- Produces `createBulkSkillUninstallTargets(items): SkillUninstallTarget[]`.
- Produces `mapBulkSkillUninstallResults(items, result): BulkSkillTrashResultItem[]`.
- Calls `bridge.skillUninstaller.uninstall()` once per confirmed batch.

- [ ] **Step 1: Rewrite the failing bridge expectation**

Change the test bridge mock from `editorScan.trashItem` to:

```ts
skillUninstaller: {
  uninstall: mocks.uninstall,
}
```

Replace the sequential-call test with:

```ts
mocks.uninstall.mockResolvedValue({
  results: [
    { path: "/source/jenkins", status: "trashed" },
    { path: "/source/release", status: "trashed" },
  ],
})

expect(mocks.uninstall).toHaveBeenCalledTimes(1)
expect(mocks.uninstall).toHaveBeenCalledWith({
  targets: [
    { query: { name: "jenkins" }, path: "/source/jenkins" },
    { query: { name: "release" }, path: "/source/release" },
  ],
})
```

Add a project item and assert its query contains `searchRootPath: projectPath`.

- [ ] **Step 2: Replace legacy request mapping**

In `bulk-skill-trash.ts`, remove `createBulkSkillTrashRequest` and add:

```ts
export function createBulkSkillUninstallTargets(
  items: readonly EditorScanSkillCopyItem[],
): SkillUninstallTarget[] {
  return items.map((item) => ({
    path: item.path,
    query: {
      name: item.name,
      ...(item.scope === "project"
        ? { searchRootPath: item.projectPath ?? item.path }
        : {}),
    },
  }))
}
```

Map results by exact path. Missing service results become `failed` with `未返回卸载结果。`; `skipped` remains a failed-visible row using its returned error.

- [ ] **Step 3: Submit one batch request from the existing confirmation dialog**

Replace the per-item loop in `runTrash()` with:

```ts
const result = await bridge.skillUninstaller.uninstall({
  targets: createBulkSkillUninstallTargets(items),
})
const nextResults = mapBulkSkillUninstallResults(items, result)
```

Keep the existing confirmation, success/partial/failure notifications, selection key removal, and refresh callback. Change logger metadata to operation `skill-uninstall-batch` and do not log full paths.

- [ ] **Step 4: Run bulk tests and commit**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/editor-scan/__tests__/editor-bulk-skill-trash-dialog.test.tsx
```

Expected: PASS.

```bash
git add desktop/src/modules/editor-scan/lib/bulk-skill-trash.ts desktop/src/modules/editor-scan/components/editor-bulk-skill-trash-dialog.tsx desktop/src/modules/editor-scan/__tests__/editor-bulk-skill-trash-dialog.test.tsx
git commit -m "refactor: share bulk skill uninstall service"
```

---

### Task 9: Documentation, Release Note, And Full Verification

**Files:**
- Modify: `docs/reference/editor-integration-matrix.md`
- Modify: `AGENTS.md`
- Modify: `RELEASE_NOTES_PENDING.md`

**Interfaces:**
- Documents the stable product and safety boundaries implemented by Tasks 1–8.

- [ ] **Step 1: Update stable documentation**

Add a short Skill uninstall section to `docs/reference/editor-integration-matrix.md`:

```md
## Skill 卸载扫描

- 未指定搜索目录时，Synapse 只扫描已注册 Agent 的全局 Skill 根目录。
- 指定搜索目录时，Synapse 在该目录下受限递归查找 `SKILL.md`，排除依赖、版本控制、缓存和构建目录，不跟随符号链接。
- Skill 名称按目录名或 `SKILL.md` frontmatter `name` 忽略大小写精确匹配。
- Synapse 安装和外部安装的 Skill 都可以由用户选择后移入系统废纸篓。
```

Add one hard boundary bullet to the Rule/Skill installation area in `AGENTS.md`:

```md
- Skill 卸载统一走 `skill-uninstaller` 公共能力：无路径时只扫描已注册 Agent 的全局 Skill 根，传路径时在该根下受限递归；目标必须在执行前重新校验名称、真实路径和符号链接，用户确认后只移入系统废纸篓。IDE 管理不得另写 Skill 删除逻辑。
```

Add a concise user-facing release note to `RELEASE_NOTES_PENDING.md`:

```md
- 新增 Skill 卸载器，可按名称扫描所有全局安装位置，或在指定目录内查找项目 Skill；支持多选后统一移入系统废纸篓，IDE 管理也使用同一套安全卸载流程。
```

- [ ] **Step 2: Run focused feature tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  app-capabilities/skill-uninstaller/main/__tests__/scanner.test.ts \
  app-capabilities/skill-uninstaller/main/__tests__/service.test.ts \
  app-capabilities/skill-uninstaller/main/__tests__/ipc.test.ts \
  app-capabilities/skill-uninstaller/renderer/__tests__/skill-uninstaller-flow.test.tsx \
  app-capabilities/skill-uninstaller/renderer/__tests__/skill-uninstaller-dialog.test.tsx \
  app-capabilities/skill-uninstaller/renderer/__tests__/skill-uninstaller-module.test.tsx \
  electron/services/__tests__/editor-scan-roots.test.ts \
  electron/__tests__/preload.test.ts \
  src/modules/editor-scan/__tests__/editor-bulk-skill-trash-dialog.test.tsx \
  src/modules/editor-scan/__tests__/editor-scan-module-state.test.tsx \
  src/modules/editor-scan/__tests__/scan-item-detail-dialog-layout.test.ts \
  src/modules/apps/__tests__/registry.test.ts \
  src/modules/apps/__tests__/system-app-window-app.test.tsx \
  src/modules/apps/__tests__/system-app-content-launcher.test.tsx
```

Expected: all focused tests PASS.

- [ ] **Step 3: Run static and generated-file verification**

Run:

```bash
pnpm --filter @synapse/desktop run check:ipc-codegen
pnpm --filter @synapse/desktop run check:hard-constraints
pnpm --filter @synapse/desktop run typecheck
pnpm --filter @synapse/desktop run lint
git diff --check
```

Expected: every command exits 0; generated IPC is current; no hard-constraint or whitespace failure.

- [ ] **Step 4: Run the full desktop test suite**

Run:

```bash
pnpm --filter @synapse/desktop run test
```

Expected: full Vitest suite PASS. Do not start `pnpm dev:desktop` unless the user separately requests manual UI verification.

- [ ] **Step 5: Commit docs and verification state**

```bash
git add AGENTS.md RELEASE_NOTES_PENDING.md docs/reference/editor-integration-matrix.md
git commit -m "docs: document skill uninstaller"
```

Record the exact focused-test, typecheck, lint, hard-constraint, IPC-codegen, and full-suite outcomes in the final handoff.

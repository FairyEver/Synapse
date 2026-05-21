# Skill Update Indicator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a `可更新` badge on Skill list cards when any installed copy was installed from an older repository version.

**Architecture:** Store the repository snapshot version in each installed Skill directory's `.synapse.json`, read it during editor scans, and compare it against the current repository `latestHistoryDirname` when building install status. Keep UI scoped to the existing card footer install-status area and reuse the detail panel's existing `needs_update` status.

**Tech Stack:** Electron main process services, React 19, TypeScript, shadcn/ui `Badge`, Vitest.

---

## File Structure

- Modify `desktop/src/types/editor-scan.ts`: add `repositoryVersion` to scanned Skill items.
- Modify `desktop/src/types/install-status.ts`: add list badge install status values.
- Modify `desktop/src/types/editor-install-status.ts`: add repository version to `SynapseResolveEditorInstallStatusPayload`.
- Modify `desktop/src/definitions/editor/shared-skill-directory.ts`: write `repositoryVersion` into `.synapse.json`.
- Create `desktop/src/definitions/editor/__tests__/shared-skill-directory.test.ts`: lock the install metadata write format.
- Modify `desktop/electron/services/editor-scan-service.ts`: read `repositoryVersion` from `.synapse.json` and expose it in `EditorScanSkillItem`.
- Modify `desktop/electron/services/__tests__/editor-scan-service.test.ts`: verify scan metadata.
- Modify `desktop/electron/services/install-status-cache-service.ts`: compare installed repository version with current repository Skill versions.
- Modify `desktop/electron/services/__tests__/install-status-cache-service.test.ts`: verify `needs_update`, old metadata compatibility, and refresh behavior.
- Modify `desktop/electron/services/editor-install-status-service.ts`: mark Skill detail rows as `needs_update` when installed repository version differs from current version.
- Modify `desktop/electron/modules/editor-install-status/ipc.ts`: accept `repositoryVersion` through the existing install status IPC request.
- Modify `desktop/electron/services/__tests__/editor-install-status-service.test.ts`: verify Skill `needs_update` and legacy installed states.
- Modify `desktop/src/modules/content/hooks/use-editor-install-status.ts`: pass `latestHistoryDirname` into detail install status resolution.
- Modify `desktop/src/modules/content/components/editor-install-badges.tsx`: render the `可更新` badge beside editor icons.
- Modify `desktop/src/modules/content/__tests__/content-grid.test.tsx`: verify list badge placement and absence for current installs.

## Task 1: Persist Installed Skill Repository Version

**Files:**
- Modify: `desktop/src/definitions/editor/shared-skill-directory.ts`
- Create: `desktop/src/definitions/editor/__tests__/shared-skill-directory.test.ts`
- Modify: `desktop/src/types/editor-scan.ts`

- [ ] **Step 1: Write the failing test for `.synapse.json` metadata**

Create `desktop/src/definitions/editor/__tests__/shared-skill-directory.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"
import type { PrepareSkillDirectoryContext } from "../../main-types"
import { writeSynapseSkillDirectory } from "../shared-skill-directory"

function createContext(): {
  context: PrepareSkillDirectoryContext
  writeTextFile: ReturnType<typeof vi.fn>
} {
  const writeTextFile = vi.fn(async () => undefined)

  return {
    context: {
      copyAttachment: vi.fn(),
      detail: {
        attachmentCount: 0,
        attachments: [],
        category: "general",
        content: "# Review\n",
        createdAt: "2026-01-01T00:00:00.000Z",
        createdBy: "user-1",
        createdByDisplayName: "User",
        deleted: false,
        description: "Review carefully.",
        icon: "file",
        iconBg: "muted",
        id: "skill-1",
        latestHistoryDirname: "20260521010101",
        modifiedAt: "2026-05-21T01:01:01.000Z",
        modifiedBy: "user-1",
        modifiedByDisplayName: "User",
        name: "review",
        title: "Review",
        type: "skill",
      },
      payload: {
        contentId: "skill-1",
        contentType: "skill",
        editorId: "codex",
        scope: "global",
      },
      repositoryRootPath: "/repo",
      stagingDirectoryPath: "/tmp/staging",
      targetPath: "/tmp/skills/review",
      writeTextFile,
    },
    writeTextFile,
  }
}

describe("writeSynapseSkillDirectory", () => {
  it("writes the installed repository version into .synapse.json", async () => {
    const { context, writeTextFile } = createContext()

    await writeSynapseSkillDirectory(context)

    expect(writeTextFile).toHaveBeenCalledWith(
      "/tmp/staging/.synapse.json",
      JSON.stringify({
        id: "skill-1",
        repositoryVersion: "20260521010101",
      }, null, 2),
    )
  })
})
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/src/definitions/editor/__tests__/shared-skill-directory.test.ts
```

Expected: FAIL because `.synapse.json` only contains `id`.

- [ ] **Step 3: Write `repositoryVersion` during Skill install**

In `desktop/src/definitions/editor/shared-skill-directory.ts`, replace the `.synapse.json` write with:

```ts
  await writeTextFile(
    path.join(stagingDirectoryPath, SYNAPSE_SKILL_ID_FILE_NAME),
    JSON.stringify({
      id: detail.id,
      repositoryVersion: detail.latestHistoryDirname,
    }, null, 2),
  )
```

In `desktop/src/types/editor-scan.ts`, update `EditorScanSkillItem`:

```ts
export type EditorScanSkillItem = {
  name: string
  path: string
  source: EditorScanItemSource
  synapseContentId: string | null
  repositoryVersion: string | null
  preview: string
  fileCount: number
  trash: EditorScanTrashInfo
}
```

- [ ] **Step 4: Run the focused test and typecheck this slice**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/src/definitions/editor/__tests__/shared-skill-directory.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/definitions/editor/shared-skill-directory.ts desktop/src/definitions/editor/__tests__/shared-skill-directory.test.ts desktop/src/types/editor-scan.ts
git commit -m "feat: record installed skill version"
```

## Task 2: Read Installed Skill Repository Version During Scan

**Files:**
- Modify: `desktop/electron/services/editor-scan-service.ts`
- Modify: `desktop/electron/services/__tests__/editor-scan-service.test.ts`
- Update existing test fixtures that construct `EditorScanSkillItem` objects.

- [ ] **Step 1: Write the failing scan test**

Add this test near the existing `scanSkillDirectories` tests in `desktop/electron/services/__tests__/editor-scan-service.test.ts`:

```ts
  it("reads installed skill repository version from .synapse.json", async () => {
    const root = await createTempDir()
    const skillDir = path.join(root, "reviewer")
    await mkdir(skillDir, { recursive: true })
    await writeFile(path.join(skillDir, "SKILL.md"), "# Reviewer\n")
    await writeFile(path.join(skillDir, ".synapse.json"), JSON.stringify({
      id: "skill-1",
      repositoryVersion: "20260521010101",
    }))

    const result = await scanSkillDirectories([root])

    expect(result.skills).toContainEqual(expect.objectContaining({
      name: "reviewer",
      synapseContentId: "skill-1",
      repositoryVersion: "20260521010101",
    }))
  })
```

- [ ] **Step 2: Run the scan test and verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/electron/services/__tests__/editor-scan-service.test.ts
```

Expected: FAIL because scanned Skill items do not include `repositoryVersion`.

- [ ] **Step 3: Extend scan metadata parsing**

In `desktop/electron/services/editor-scan-service.ts`, change `readSynapseSkillMeta` to:

```ts
async function readSynapseSkillMeta(
  skillDir: string,
): Promise<{ id: string; repositoryVersion: string | null } | null> {
  try {
    const raw = await readFile(path.join(skillDir, SYNAPSE_SKILL_ID_FILE), "utf8")
    const meta = JSON.parse(raw) as { id?: unknown; repositoryVersion?: unknown }
    if (typeof meta.id !== "string" || meta.id.trim().length === 0) {
      return null
    }

    return {
      id: meta.id,
      repositoryVersion: typeof meta.repositoryVersion === "string" && meta.repositoryVersion.trim().length > 0
        ? meta.repositoryVersion
        : null,
    }
  } catch {
    return null
  }
}
```

In `scanSkillsDirectory`, add the property:

```ts
        synapseContentId: meta?.id ?? null,
        repositoryVersion: meta?.repositoryVersion ?? null,
```

Update test fixtures that manually build `EditorScanSkillItem` objects by adding `repositoryVersion: null` or a concrete version.

- [ ] **Step 4: Run the scan tests**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/electron/services/__tests__/editor-scan-service.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/electron/services/editor-scan-service.ts desktop/electron/services/__tests__/editor-scan-service.test.ts
git commit -m "feat: scan installed skill versions"
```

## Task 3: Mark List Install Entries as Needs Update

**Files:**
- Modify: `desktop/src/types/install-status.ts`
- Modify: `desktop/electron/services/install-status-cache-service.ts`
- Modify: `desktop/electron/services/__tests__/install-status-cache-service.test.ts`
- Modify: `desktop/electron/modules/content/__tests__/ipc.test.ts`

- [ ] **Step 1: Write failing cache tests**

In `desktop/electron/services/__tests__/install-status-cache-service.test.ts`, add a `contentService` mock before importing the service:

```ts
vi.mock("../content-service", () => ({
  contentService: {
    listContent: vi.fn(async () => [{
      id: "global-skill",
      latestHistoryDirname: "current-version",
      type: "skill",
    }, {
      id: "project-skill",
      latestHistoryDirname: "project-current",
      type: "skill",
    }]),
  },
}))
```

Update existing Skill fixtures to include versions:

```ts
        repositoryVersion: "old-version",
```

Add expectations to the first test:

```ts
      "global-skill": [{
        editorId: "codex",
        scope: "global",
        status: "needs_update",
      }],
```

Add a legacy compatibility test:

```ts
  it("treats installed skills without repositoryVersion as installed", async () => {
    const scan = createScan()
    scan.global[0]!.skills[0]!.repositoryVersion = null
    mocks.scanAll.mockResolvedValue(scan)

    await installStatusCacheService.buildCache()

    expect(installStatusCacheService.getAll()["global-skill"]).toEqual([{
      editorId: "codex",
      scope: "global",
      status: "installed",
    }])
  })
```

In `desktop/electron/modules/content/__tests__/ipc.test.ts`, update the mocked install status entries:

```ts
    mocks.installStatusCacheService.refresh.mockResolvedValue([{
      editorId: "codex",
      projectName: "Project",
      projectPath: "/project",
      scope: "project",
      status: "installed",
    }])
```

Update the corresponding broadcast expectation with the same `status: "installed"` field.

- [ ] **Step 2: Run cache tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/electron/services/__tests__/install-status-cache-service.test.ts
```

Expected: FAIL because `InstallStatusEntry` has no `status` and the cache does not compare versions.

- [ ] **Step 3: Extend list status types**

In `desktop/src/types/install-status.ts`:

```ts
export type InstallStatusValue = "installed" | "needs_update"

export type InstallStatusEntry = {
  editorId: SynapseEditorId
  scope: "global" | "project"
  projectName?: string
  projectPath?: string
  status: InstallStatusValue
}
```

- [ ] **Step 4: Add current Skill version lookup to the cache service**

In `desktop/electron/services/install-status-cache-service.ts`, import `contentService`:

```ts
import { contentService } from "./content-service"
```

Add helpers near the top:

```ts
type SkillVersionMap = Map<string, string>

async function loadSkillVersionMap(): Promise<SkillVersionMap> {
  try {
    const skills = await contentService.listContent("skill")
    return new Map(skills.map((skill) => [skill.id, skill.latestHistoryDirname]))
  } catch (error) {
    logger.warn("Failed to load skill versions for install status.", { error })
    return new Map()
  }
}

function resolveInstallStatus(
  contentId: string | null,
  repositoryVersion: string | null | undefined,
  skillVersions: SkillVersionMap,
): InstallStatusEntry["status"] {
  if (!contentId || !repositoryVersion) {
    return "installed"
  }

  const currentVersion = skillVersions.get(contentId)
  if (!currentVersion) {
    return "installed"
  }

  return currentVersion === repositoryVersion ? "installed" : "needs_update"
}
```

Change `collectGlobalEntry` and `collectProjectEntry` to receive `skillVersions`, and append Skill entries with status:

```ts
    appendEntry(next, skill.synapseContentId, {
      ...entry,
      status: resolveInstallStatus(skill.synapseContentId, skill.repositoryVersion, skillVersions),
    })
```

Append Rule entries with:

```ts
    appendEntry(next, rule.synapseContentId, {
      ...entry,
      status: "installed",
    })
```

At the start of both `buildCache` and `refresh`, load:

```ts
  const skillVersions = await loadSkillVersionMap()
```

Pass `skillVersions` into both collect functions.

- [ ] **Step 5: Run cache tests**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/electron/services/__tests__/install-status-cache-service.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add desktop/src/types/install-status.ts desktop/electron/services/install-status-cache-service.ts desktop/electron/services/__tests__/install-status-cache-service.test.ts desktop/electron/modules/content/__tests__/ipc.test.ts
git commit -m "feat: flag stale installed skills"
```

## Task 4: Mark Skill Detail Install Rows as Needs Update

**Files:**
- Modify: `desktop/src/types/editor-install-status.ts`
- Modify: `desktop/src/modules/content/hooks/use-editor-install-status.ts`
- Modify: `desktop/electron/modules/editor-install-status/ipc.ts`
- Modify: `desktop/electron/services/editor-install-status-service.ts`
- Modify: `desktop/electron/services/__tests__/editor-install-status-service.test.ts`

- [ ] **Step 1: Write failing detail status tests**

In `desktop/electron/services/__tests__/editor-install-status-service.test.ts`, update Skill fixtures with `repositoryVersion`.

Add:

```ts
  it("marks a Codex project skill with an older repository version as needing update", async () => {
    mocks.scanAll.mockResolvedValue(createScan({
      editorId: "codex",
      editorLabel: "Codex",
      rules: [],
      skills: [{
        name: "review",
        path: "/project/.codex/skills/review",
        source: "synapse",
        synapseContentId: "skill-1",
        repositoryVersion: "old-version",
        preview: "Review carefully.",
        fileCount: 2,
        trash: { mode: "path" },
      }],
    }))

    const result = await new EditorInstallStatusService().resolveForContent({
      contentType: "skill",
      contentId: "skill-1",
      contentName: "review",
      repositoryVersion: "current-version",
      title: "Review",
      projects: [{ id: "project-1", name: "Project", path: "/project" }],
    })

    expect(result.entries).toContainEqual(expect.objectContaining({
      scope: "project",
      projectId: "project-1",
      status: "needs_update",
      targetPath: "/project/skills/review",
    }))
  })
```

Add:

```ts
  it("keeps legacy installed skills without repository version as installed", async () => {
    mocks.scanAll.mockResolvedValue(createScan({
      editorId: "codex",
      editorLabel: "Codex",
      rules: [],
      skills: [{
        name: "review",
        path: "/project/.codex/skills/review",
        source: "synapse",
        synapseContentId: "skill-1",
        repositoryVersion: null,
        preview: "Review carefully.",
        fileCount: 2,
        trash: { mode: "path" },
      }],
    }))

    const result = await new EditorInstallStatusService().resolveForContent({
      contentType: "skill",
      contentId: "skill-1",
      contentName: "review",
      repositoryVersion: "current-version",
      title: "Review",
      projects: [{ id: "project-1", name: "Project", path: "/project" }],
    })

    expect(result.entries).toContainEqual(expect.objectContaining({
      scope: "project",
      projectId: "project-1",
      status: "installed",
    }))
  })
```

- [ ] **Step 2: Run detail status tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/electron/services/__tests__/editor-install-status-service.test.ts
```

Expected: FAIL because payload and Skill status comparison do not support repository versions.

- [ ] **Step 3: Add payload repository version**

In `desktop/src/types/editor-install-status.ts`, add:

```ts
  repositoryVersion?: string
```

to `SynapseResolveEditorInstallStatusPayload`.

In `desktop/src/modules/content/hooks/use-editor-install-status.ts`, pass:

```ts
        repositoryVersion: detail.latestHistoryDirname,
```

inside `resolveEditorInstallStatus({ ... })`.

In `desktop/electron/modules/editor-install-status/ipc.ts`, extend the request schema:

```ts
  repositoryVersion: z.string().optional(),
```

- [ ] **Step 4: Compare Skill versions in detail status service**

In `desktop/electron/services/editor-install-status-service.ts`, update `statusFromSkill`:

```ts
function statusFromSkill(
  item: EditorScanSkillItem | null,
  payload: SynapseResolveEditorInstallStatusPayload,
): SynapseEditorInstallStatusValue | null {
  if (!item) return null
  if (item.synapseContentId !== payload.contentId) return "external_same_name"

  if (
    payload.repositoryVersion
    && item.repositoryVersion
    && item.repositoryVersion !== payload.repositoryVersion
  ) {
    return "needs_update"
  }

  return "installed"
}
```

- [ ] **Step 5: Run detail status tests**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/electron/services/__tests__/editor-install-status-service.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add desktop/src/types/editor-install-status.ts desktop/src/modules/content/hooks/use-editor-install-status.ts desktop/electron/modules/editor-install-status/ipc.ts desktop/electron/services/editor-install-status-service.ts desktop/electron/services/__tests__/editor-install-status-service.test.ts
git commit -m "feat: show stale skill detail status"
```

## Task 5: Render `可更新` in the List Footer

**Files:**
- Modify: `desktop/src/modules/content/components/editor-install-badges.tsx`
- Modify: `desktop/src/modules/content/__tests__/content-grid.test.tsx`

- [ ] **Step 1: Write failing UI tests**

In `desktop/src/modules/content/__tests__/content-grid.test.tsx`, add a mock for install status context:

```ts
vi.mock("@/modules/content/contexts/install-status-context", () => ({
  useInstallStatus: (contentId: string) => {
    if (contentId === "stale-skill") {
      return [{
        editorId: "codex",
        scope: "global",
        status: "needs_update",
      }]
    }

    if (contentId === "current-skill") {
      return [{
        editorId: "codex",
        scope: "global",
        status: "installed",
      }]
    }

    return []
  },
  useUninstallFromEditor: () => vi.fn(async () => undefined),
}))
```

Add tests:

```ts
  it("shows update badge in the install status footer when an installed skill is stale", async () => {
    const { container } = await renderGrid([
      createContentItem("skill", {
        id: "stale-skill",
        name: "review",
      }),
    ])

    const badge = Array.from(container.querySelectorAll("[title='已安装版本落后']"))
      .find((element) => element.textContent === "可更新")

    expect(badge).toBeTruthy()
  })

  it("does not show update badge for current installed skills", async () => {
    const { container } = await renderGrid([
      createContentItem("skill", {
        id: "current-skill",
        name: "review",
      }),
    ])

    expect(container.textContent).not.toContain("可更新")
  })
```

- [ ] **Step 2: Run UI tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/src/modules/content/__tests__/content-grid.test.tsx
```

Expected: FAIL because `EditorInstallBadges` does not render the update badge.

- [ ] **Step 3: Render the shadcn Badge**

In `desktop/src/modules/content/components/editor-install-badges.tsx`, import `Badge`:

```ts
import { Badge } from "@/components/ui/badge"
```

Inside `EditorInstallBadges`, derive:

```ts
  const hasUpdate = entries.some((entry) => entry.status === "needs_update")
```

Render after the editor badges:

```tsx
      {hasUpdate ? (
        <Badge variant="secondary" title="已安装版本落后">
          可更新
        </Badge>
      ) : null}
```

Keep the existing wrapper class `flex min-w-0 items-center gap-1.5`.

- [ ] **Step 4: Run UI tests**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/src/modules/content/__tests__/content-grid.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/modules/content/components/editor-install-badges.tsx desktop/src/modules/content/__tests__/content-grid.test.tsx
git commit -m "feat: show skill update badge"
```

## Task 6: Final Verification

**Files:**
- No new files.

- [ ] **Step 1: Run focused regression tests**

Run:

```bash
pnpm --filter @synapse/desktop test -- \
  desktop/src/definitions/editor/__tests__/shared-skill-directory.test.ts \
  desktop/electron/services/__tests__/editor-scan-service.test.ts \
  desktop/electron/services/__tests__/install-status-cache-service.test.ts \
  desktop/electron/services/__tests__/editor-install-status-service.test.ts \
  desktop/src/modules/content/__tests__/content-grid.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run hard constraints**

Run:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: PASS.

- [ ] **Step 3: Run typecheck**

Run:

```bash
pnpm --filter @synapse/desktop run typecheck
```

Expected: PASS.

- [ ] **Step 4: Inspect final diff**

Run:

```bash
git diff --stat HEAD~5..HEAD
git diff HEAD~5..HEAD -- desktop/src/types desktop/src/definitions/editor desktop/electron/services desktop/src/modules/content
```

Expected: Diff is limited to version metadata, status comparison, and the list badge.

## Self-Review

- Spec coverage: covered install metadata, old install compatibility, scan/cache comparison, list footer badge, detail `needs_update`, no remote checks, no file-content comparison, no modifiedAt comparison.
- Placeholder scan: no unresolved placeholders; every task has concrete file paths, snippets, commands, and expected results.
- Type consistency: `repositoryVersion` is used consistently for installed Skill metadata, scan items, and detail payload; list status uses `InstallStatusEntry.status` with `"installed" | "needs_update"`.

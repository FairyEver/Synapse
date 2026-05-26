# 本机 Skill 批量复制 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add multi-select bulk Skill copy from the local editor scan page to another editor, with preflight overwrite summary and reuse of the existing single-item copy pipeline.

**Architecture:** Keep all new behavior in the renderer `editor-scan` module. Extract scan-item-to-copy-source conversion into a shared helper, add pure bulk preflight/result helpers, add a new bulk copy dialog that reuses `EditorWriteTargetSelector`, `resolveEditorCopyTarget`, and `copyToEditor`, then wire selected Skill state through the scan list views.

**Tech Stack:** Electron, React, TypeScript, Vitest, shadcn/Radix components, existing preload bridge APIs.

---

## File Structure

- Create `desktop/src/modules/editor-scan/lib/editor-copy-source.ts`: shared conversion from scan items to `SynapseEditorCopySource`.
- Create `desktop/src/modules/editor-scan/lib/bulk-skill-copy.ts`: pure types and helpers for preflight classification, executable queue creation, and result summaries.
- Create `desktop/src/modules/editor-scan/components/editor-bulk-skill-copy-dialog.tsx`: dialog for target editor selection, target scope selection, preflight, overwrite confirmation, execution, and result display.
- Modify `desktop/src/modules/editor-scan/components/editor-copy-dialog.tsx`: use `createCopySource` from the shared helper; preserve single-copy behavior.
- Modify `desktop/src/modules/editor-scan/components/scan-item-card.tsx`: add optional checkbox selection UI with event isolation.
- Modify `desktop/src/modules/editor-scan/components/global-overview.tsx`: pass selection props for Skill cards only.
- Modify `desktop/src/modules/editor-scan/components/project-overview.tsx`: pass selection props for project Skill cards only.
- Modify `desktop/src/modules/editor-scan/index.tsx`: own selected Skill keys, reset selection on context changes, build bulk copy items, and mount the bulk dialog.
- Modify `RELEASE_NOTES_PENDING.md`: add one user-facing release note.
- Test `desktop/src/modules/editor-scan/lib/__tests__/editor-copy-source.test.ts`.
- Test `desktop/src/modules/editor-scan/lib/__tests__/bulk-skill-copy.test.ts`.
- Test `desktop/src/modules/editor-scan/__tests__/scan-item-card-selection.test.tsx`.
- Test `desktop/src/modules/editor-scan/__tests__/editor-scan-bulk-selection.test.tsx`.
- Test `desktop/src/modules/editor-scan/__tests__/editor-bulk-skill-copy-dialog.test.tsx`.

## Task 1: Extract Copy Source Helper

**Files:**
- Create: `desktop/src/modules/editor-scan/lib/editor-copy-source.ts`
- Create: `desktop/src/modules/editor-scan/lib/__tests__/editor-copy-source.test.ts`
- Modify: `desktop/src/modules/editor-scan/components/editor-copy-dialog.tsx`

- [ ] **Step 1: Write failing tests for copy source conversion**

Create `desktop/src/modules/editor-scan/lib/__tests__/editor-copy-source.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { createCopySource, type EditorScanSkillCopyItem } from "../editor-copy-source"
import type { ScanItemForDetail } from "@/types/editor-scan"

describe("createCopySource", () => {
  it("builds a Skill copy source without rule content", () => {
    const item: ScanItemForDetail = {
      type: "skill",
      name: "bark-notification",
      path: "/Users/test/.claude/skills/bark-notification",
      source: "external",
      preview: "Send Bark notifications.",
      fileCount: 3,
      synapseContentId: null,
      editorId: "claude-code",
      editorLabel: "Claude Code",
      scope: "global",
      trash: { mode: "path" },
    }

    expect(createCopySource(item, "ignored content")).toEqual({
      content: undefined,
      editorId: "claude-code",
      itemName: "bark-notification",
      itemPath: "/Users/test/.claude/skills/bark-notification",
      itemType: "skill",
      metadata: undefined,
      scope: "global",
      synapseContentId: null,
    })
  })

  it("builds a Rule copy source with content and metadata", () => {
    const item: ScanItemForDetail = {
      type: "rule",
      name: "review-rule",
      path: "/repo/.cursor/rules/review-rule.mdc",
      source: "external",
      preview: "Review carefully.",
      metadata: { description: "Review" },
      synapseContentId: "rule-1",
      editorId: "cursor",
      editorLabel: "Cursor",
      scope: "project",
      projectName: "repo",
      projectPath: "/repo",
      content: "Review carefully.",
      trash: { mode: "path" },
    }

    expect(createCopySource(item, "Loaded body")).toEqual({
      content: "Loaded body",
      editorId: "cursor",
      itemName: "review-rule",
      itemPath: "/repo/.cursor/rules/review-rule.mdc",
      itemType: "rule",
      metadata: { description: "Review" },
      scope: "project",
      synapseContentId: "rule-1",
    })
  })

  it("builds a Skill copy source from bulk list items", () => {
    const item: EditorScanSkillCopyItem = {
      key: "global:/Users/test/.claude/skills/jenkins",
      name: "jenkins",
      path: "/Users/test/.claude/skills/jenkins",
      source: "external",
      preview: "Operate Jenkins.",
      fileCount: 2,
      synapseContentId: null,
      editorId: "claude-code",
      editorLabel: "Claude Code",
      scope: "global",
      trash: { mode: "path" },
    }

    expect(createCopySource(item)).toMatchObject({
      content: undefined,
      itemName: "jenkins",
      itemType: "skill",
      scope: "global",
    })
  })
})
```

- [ ] **Step 2: Run the new test and verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/editor-scan/lib/__tests__/editor-copy-source.test.ts
```

Expected: FAIL because `editor-copy-source.ts` does not exist.

- [ ] **Step 3: Implement the shared helper**

Create `desktop/src/modules/editor-scan/lib/editor-copy-source.ts`:

```ts
import type { SynapseEditorId } from "@/types/editor"
import type { SynapseEditorCopySource } from "@/types/editor-copy"
import type {
  EditorScanItemSource,
  EditorScanScope,
  EditorScanTrashInfo,
  ScanItemForDetail,
} from "@/types/editor-scan"

export type EditorScanSkillCopyItem = {
  key: string
  name: string
  path: string
  source: EditorScanItemSource
  preview: string
  fileCount: number
  synapseContentId: string | null
  editorId: SynapseEditorId
  editorLabel: string
  scope: EditorScanScope
  projectName?: string
  projectPath?: string
  trash: EditorScanTrashInfo
}

type CopySourceInput = ScanItemForDetail | EditorScanSkillCopyItem

function isDetailRuleItem(item: CopySourceInput): item is ScanItemForDetail & { type: "rule" } {
  return "type" in item && item.type === "rule"
}

function resolveCopyItemType(item: CopySourceInput): "skill" | "rule" {
  return "type" in item ? item.type : "skill"
}

function createCopySource(
  item: CopySourceInput,
  content: string | null = null,
): SynapseEditorCopySource {
  const itemType = resolveCopyItemType(item)

  return {
    content: itemType === "rule"
      ? content ?? (isDetailRuleItem(item) ? item.content : undefined)
      : undefined,
    editorId: item.editorId,
    itemName: item.name,
    itemPath: item.path,
    itemType,
    metadata: "metadata" in item ? item.metadata : undefined,
    scope: item.scope,
    synapseContentId: item.synapseContentId ?? null,
  }
}

export { createCopySource }
```

- [ ] **Step 4: Update the single copy dialog to use the helper**

In `desktop/src/modules/editor-scan/components/editor-copy-dialog.tsx`, remove the local `createCopySource` function and add this import:

```ts
import { createCopySource } from "@/modules/editor-scan/lib/editor-copy-source"
```

Keep this memo shape:

```ts
const source = useMemo(
  () => item ? createCopySource(item, content) : null,
  [content, item],
)
```

- [ ] **Step 5: Run tests for the helper and existing copy wording**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/editor-scan/lib/__tests__/editor-copy-source.test.ts src/modules/editor-scan/__tests__/scan-item-detail-dialog-layout.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add desktop/src/modules/editor-scan/lib/editor-copy-source.ts desktop/src/modules/editor-scan/lib/__tests__/editor-copy-source.test.ts desktop/src/modules/editor-scan/components/editor-copy-dialog.tsx
git commit -m "refactor(editor-scan): share editor copy source builder"
```

## Task 2: Add Pure Bulk Skill Copy Helpers

**Files:**
- Create: `desktop/src/modules/editor-scan/lib/bulk-skill-copy.ts`
- Create: `desktop/src/modules/editor-scan/lib/__tests__/bulk-skill-copy.test.ts`

- [ ] **Step 1: Write failing helper tests**

Create `desktop/src/modules/editor-scan/lib/__tests__/bulk-skill-copy.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import {
  buildBulkSkillCopySummary,
  classifyBulkSkillCopyPreflight,
  createBulkSkillCopyPayload,
  type BulkSkillCopyResultItem,
} from "../bulk-skill-copy"
import { createCopySource, type EditorScanSkillCopyItem } from "../editor-copy-source"
import type { SynapseEditorResolvedTarget } from "@/types/editor"

function createItem(name: string): EditorScanSkillCopyItem {
  return {
    key: `global:/source/${name}`,
    name,
    path: `/source/${name}`,
    source: "external",
    preview: name,
    fileCount: 1,
    synapseContentId: null,
    editorId: "claude-code",
    editorLabel: "Claude Code",
    scope: "global",
    trash: { mode: "path" },
  }
}

function createReadyTarget(targetPath: string, targetExists: boolean): SynapseEditorResolvedTarget {
  return {
    contentType: "skill",
    editorId: "codex",
    label: "Codex",
    message: null,
    scope: "global",
    status: "ready",
    targetExists,
    targetKind: "directory",
    targetPath,
  }
}

describe("bulk skill copy helpers", () => {
  it("classifies ready targets without existing content", () => {
    const item = createItem("jenkins")
    const source = createCopySource(item)
    const result = classifyBulkSkillCopyPreflight(item, source, createReadyTarget("/target/jenkins", false))

    expect(result).toEqual({
      item,
      overwrite: false,
      source,
      status: "ready",
      targetPath: "/target/jenkins",
    })
  })

  it("classifies existing targets as overwrite", () => {
    const item = createItem("jenkins")
    const source = createCopySource(item)
    const result = classifyBulkSkillCopyPreflight(item, source, createReadyTarget("/target/jenkins", true))

    expect(result).toMatchObject({
      item,
      overwrite: true,
      status: "overwrite",
      targetPath: "/target/jenkins",
    })
  })

  it("classifies unavailable targets with a message", () => {
    const item = createItem("jenkins")
    const source = createCopySource(item)
    const result = classifyBulkSkillCopyPreflight(item, source, {
      contentType: "skill",
      editorId: "codex",
      label: "Codex",
      message: "目标位置与源位置相同",
      scope: "global",
      status: "unavailable",
      targetKind: null,
      targetPath: null,
    })

    expect(result).toEqual({
      item,
      message: "目标位置与源位置相同",
      source,
      status: "unavailable",
    })
  })

  it("creates copy payloads with overwrite confirmation only for overwrite items", () => {
    const item = createItem("jenkins")
    const source = createCopySource(item)
    const ready = classifyBulkSkillCopyPreflight(item, source, createReadyTarget("/target/jenkins", false))
    const overwrite = classifyBulkSkillCopyPreflight(item, source, createReadyTarget("/target/jenkins", true))

    expect(createBulkSkillCopyPayload(ready, "codex", "global")).toMatchObject({
      overwriteConfirmed: undefined,
      targetEditorId: "codex",
      targetScope: "global",
    })
    expect(createBulkSkillCopyPayload(overwrite, "codex", "project", "/repo")).toMatchObject({
      overwriteConfirmed: true,
      targetEditorId: "codex",
      targetProjectPath: "/repo",
      targetScope: "project",
    })
  })

  it("summarizes copied, failed, and skipped results", () => {
    const item = createItem("jenkins")
    const results: BulkSkillCopyResultItem[] = [
      { status: "copied", item, targetPath: "/target/a", overwritten: false },
      { status: "failed", item, message: "写入失败" },
      { status: "skipped", item, message: "不可用" },
    ]

    expect(buildBulkSkillCopySummary(results)).toEqual({
      copied: 1,
      failed: 1,
      skipped: 1,
      total: 3,
    })
  })
})
```

- [ ] **Step 2: Run helper tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/editor-scan/lib/__tests__/bulk-skill-copy.test.ts
```

Expected: FAIL because `bulk-skill-copy.ts` does not exist.

- [ ] **Step 3: Implement pure bulk helpers**

Create `desktop/src/modules/editor-scan/lib/bulk-skill-copy.ts`:

```ts
import type {
  SynapseEditorId,
  SynapseEditorInstallFormValues,
  SynapseEditorInstallScope,
  SynapseEditorResolvedTarget,
} from "@/types/editor"
import type { SynapseCopyToEditorPayload, SynapseEditorCopySource } from "@/types/editor-copy"
import type { EditorScanSkillCopyItem } from "./editor-copy-source"

export type BulkSkillCopyPreflightItem =
  | {
      status: "ready"
      item: EditorScanSkillCopyItem
      source: SynapseEditorCopySource
      targetPath: string
      overwrite: false
    }
  | {
      status: "overwrite"
      item: EditorScanSkillCopyItem
      source: SynapseEditorCopySource
      targetPath: string
      overwrite: true
    }
  | {
      status: "unavailable"
      item: EditorScanSkillCopyItem
      source: SynapseEditorCopySource
      message: string
    }

export type BulkSkillCopyExecutableItem =
  Extract<BulkSkillCopyPreflightItem, { status: "ready" | "overwrite" }>

export type BulkSkillCopyResultItem =
  | { status: "copied"; item: EditorScanSkillCopyItem; targetPath: string; overwritten: boolean }
  | { status: "failed"; item: EditorScanSkillCopyItem; message: string }
  | { status: "skipped"; item: EditorScanSkillCopyItem; message: string }

export type BulkSkillCopySummary = {
  copied: number
  failed: number
  skipped: number
  total: number
}

function classifyBulkSkillCopyPreflight(
  item: EditorScanSkillCopyItem,
  source: SynapseEditorCopySource,
  target: SynapseEditorResolvedTarget,
): BulkSkillCopyPreflightItem {
  if (target.status === "ready") {
    return target.targetExists
      ? { item, overwrite: true, source, status: "overwrite", targetPath: target.targetPath }
      : { item, overwrite: false, source, status: "ready", targetPath: target.targetPath }
  }

  return {
    item,
    message: target.message ?? "当前环境暂时不能复制到这个位置。",
    source,
    status: "unavailable",
  }
}

function createUnavailablePreflightItem(
  item: EditorScanSkillCopyItem,
  source: SynapseEditorCopySource,
  error: unknown,
): BulkSkillCopyPreflightItem {
  return {
    item,
    message: error instanceof Error ? error.message : "解析复制位置失败。",
    source,
    status: "unavailable",
  }
}

function createBulkSkillCopyPayload(
  preflight: BulkSkillCopyExecutableItem,
  targetEditorId: SynapseEditorId,
  targetScope: SynapseEditorInstallScope,
  targetProjectPath?: string,
  installFormValues?: SynapseEditorInstallFormValues,
): SynapseCopyToEditorPayload {
  return {
    installFormValues,
    overwriteConfirmed: preflight.status === "overwrite" ? true : undefined,
    source: preflight.source,
    targetEditorId,
    targetProjectPath: targetScope === "project" ? targetProjectPath : undefined,
    targetScope,
  }
}

function buildBulkSkillCopySummary(results: BulkSkillCopyResultItem[]): BulkSkillCopySummary {
  return results.reduce<BulkSkillCopySummary>(
    (summary, result) => {
      summary.total += 1
      if (result.status === "copied") summary.copied += 1
      if (result.status === "failed") summary.failed += 1
      if (result.status === "skipped") summary.skipped += 1
      return summary
    },
    { copied: 0, failed: 0, skipped: 0, total: 0 },
  )
}

function isExecutablePreflightItem(
  item: BulkSkillCopyPreflightItem,
): item is BulkSkillCopyExecutableItem {
  return item.status === "ready" || item.status === "overwrite"
}

export {
  buildBulkSkillCopySummary,
  classifyBulkSkillCopyPreflight,
  createBulkSkillCopyPayload,
  createUnavailablePreflightItem,
  isExecutablePreflightItem,
}
```

- [ ] **Step 4: Run helper tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/editor-scan/lib/__tests__/bulk-skill-copy.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/modules/editor-scan/lib/bulk-skill-copy.ts desktop/src/modules/editor-scan/lib/__tests__/bulk-skill-copy.test.ts
git commit -m "feat(editor-scan): add bulk skill copy helpers"
```

## Task 3: Add Selectable Scan Cards

**Files:**
- Modify: `desktop/src/modules/editor-scan/components/scan-item-card.tsx`
- Create: `desktop/src/modules/editor-scan/__tests__/scan-item-card-selection.test.tsx`

- [ ] **Step 1: Write failing card selection tests**

Create `desktop/src/modules/editor-scan/__tests__/scan-item-card-selection.test.tsx`:

```tsx
/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ScanItemCard } from "../components/scan-item-card"

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }))
vi.mock("@/lib/electron-bridge", () => ({ getSynapseBridge: () => null }))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let roots: Root[] = []

async function renderCard(props: Partial<Parameters<typeof ScanItemCard>[0]> = {}) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  const onClick = props.onClick ?? vi.fn()
  const onSelectionChange = props.onSelectionChange ?? vi.fn()

  await act(async () => {
    root.render(
      <ScanItemCard
        name="jenkins"
        path="/skills/jenkins"
        source="external"
        preview="Operate Jenkins"
        onClick={onClick}
        selectable
        selected={false}
        onSelectionChange={onSelectionChange}
        {...props}
      />,
    )
  })

  return { onClick, onSelectionChange }
}

afterEach(() => {
  for (const root of roots) {
    act(() => root.unmount())
  }
  roots = []
  document.body.innerHTML = ""
  vi.clearAllMocks()
})

describe("ScanItemCard selection", () => {
  it("renders a checkbox when selectable", async () => {
    await renderCard()

    expect(document.querySelector('button[role="checkbox"]')).not.toBeNull()
  })

  it("toggles selection without opening the detail card", async () => {
    const { onClick, onSelectionChange } = await renderCard()
    const checkbox = document.querySelector<HTMLElement>('button[role="checkbox"]')

    await act(async () => {
      checkbox?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(onSelectionChange).toHaveBeenCalledWith(true)
    expect(onClick).not.toHaveBeenCalled()
  })

  it("keeps card click behavior for the card body", async () => {
    const { onClick } = await renderCard()
    const card = document.querySelector<HTMLElement>("[data-scan-item-card]")

    await act(async () => {
      card?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/editor-scan/__tests__/scan-item-card-selection.test.tsx
```

Expected: FAIL because `ScanItemCard` has no `selectable` props.

- [ ] **Step 3: Implement optional checkbox selection**

Modify `desktop/src/modules/editor-scan/components/scan-item-card.tsx`:

```tsx
import type { MouseEvent } from "react"
import { FolderOpen } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { getSynapseBridge } from "@/lib/electron-bridge"
import type { EditorScanItemSource } from "@/types/editor-scan"

type ScanItemCardProps = {
  name: string
  path: string
  source: EditorScanItemSource
  preview: string
  metadata?: Record<string, string>
  onClick?: () => void
  selectable?: boolean
  selected?: boolean
  onSelectionChange?: (selected: boolean) => void
}

function ScanItemCard({
  name,
  path: itemPath,
  source,
  preview,
  metadata,
  onClick,
  selectable = false,
  selected = false,
  onSelectionChange,
}: ScanItemCardProps) {
  const handleOpenInFinder = (e: MouseEvent) => {
    e.stopPropagation()
    const bridge = getSynapseBridge()
    bridge?.shell.showItemInFolder(itemPath).catch(() => {
      toast.error("无法在访达中打开文件。")
    })
  }

  const handleSelectionClick = (event: MouseEvent) => {
    event.stopPropagation()
  }

  const metaEntries = metadata
    ? Object.entries(metadata).filter(([, v]) => v)
    : []

  const firstLine = preview?.split("\n")[0] ?? ""

  return (
    <div
      data-scan-item-card
      className="group cursor-pointer rounded-lg bg-card px-3.5 py-3"
      onClick={onClick}
    >
      <div className="flex items-center gap-2">
        {selectable ? (
          <Checkbox
            checked={selected}
            aria-label={`选择 ${name}`}
            onClick={handleSelectionClick}
            onCheckedChange={(value) => onSelectionChange?.(value === true)}
          />
        ) : null}
        <span className="truncate text-sm font-medium">{name}</span>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge
                variant={source === "synapse" ? "default" : "secondary"}
                className="shrink-0 text-xs px-1.5 py-0"
              >
                {source === "synapse" ? "Synapse" : "外部"}
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              {source === "synapse"
                ? "由 Synapse 安装"
                : "用户自行管理"}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      {firstLine ? (
        <p className="mt-1 truncate text-xs text-muted-foreground">
          {firstLine}
        </p>
      ) : null}
      {metaEntries.length > 0 ? (
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {metaEntries.map(([k, v]) => `${k}: ${v}`).join(" · ")}
        </p>
      ) : null}
      <button
        type="button"
        className="mt-1.5 flex max-w-full items-center gap-1 text-xs text-muted-foreground/50 transition-colors hover:text-foreground"
        onClick={handleOpenInFinder}
      >
        <FolderOpen className="size-3 shrink-0" />
        <span className="truncate">{itemPath}</span>
      </button>
    </div>
  )
}

export { ScanItemCard }
```

- [ ] **Step 4: Run card tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/editor-scan/__tests__/scan-item-card-selection.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/modules/editor-scan/components/scan-item-card.tsx desktop/src/modules/editor-scan/__tests__/scan-item-card-selection.test.tsx
git commit -m "feat(editor-scan): make skill cards selectable"
```

## Task 4: Wire Selection Through Overview Components

**Files:**
- Modify: `desktop/src/modules/editor-scan/components/global-overview.tsx`
- Modify: `desktop/src/modules/editor-scan/components/project-overview.tsx`
- Modify: `desktop/src/modules/editor-scan/index.tsx`
- Create: `desktop/src/modules/editor-scan/__tests__/editor-scan-bulk-selection.test.tsx`

- [ ] **Step 1: Write failing module selection tests**

Create `desktop/src/modules/editor-scan/__tests__/editor-scan-bulk-selection.test.tsx`:

```tsx
/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { EditorScanModule } from "../index"
import type { EditorScanResult } from "@/types/editor-scan"

const mocks = vi.hoisted(() => ({
  data: {
    global: [{
      editorId: "claude-code",
      editorLabel: "Claude Code",
      status: "detected",
      skills: [{
        name: "jenkins",
        path: "/Users/test/.claude/skills/jenkins",
        source: "external",
        synapseContentId: null,
        repositoryVersion: null,
        preview: "Operate Jenkins.",
        fileCount: 2,
        trash: { mode: "path" },
      }],
      duplicateSkillNames: [],
      rules: [{
        name: "review",
        path: "/Users/test/.claude/rules/review.md",
        source: "external",
        synapseContentId: null,
        preview: "Review.",
        metadata: {},
        content: "Review.",
        trash: { mode: "path" },
      }],
      rulesSupported: true,
    }],
    projects: [],
  } satisfies EditorScanResult,
  refresh: vi.fn(),
}))

vi.mock("../hooks/use-editor-scan", () => ({
  useEditorScan: () => ({
    data: mocks.data,
    loading: false,
    error: null,
    refresh: mocks.refresh,
  }),
}))

vi.mock("@/app-shell/notifications", () => ({
  useAppNotifications: () => ({
    success: vi.fn(),
    error: vi.fn(),
  }),
}))

vi.mock("../components/scan-item-detail-dialog", () => ({
  ScanItemDetailDialog: () => null,
}))

vi.mock("../components/editor-bulk-skill-copy-dialog", () => ({
  EditorBulkSkillCopyDialog: ({ items }: { items: Array<{ name: string }> }) => (
    <div data-bulk-copy-dialog>{items.map((item) => item.name).join(",")}</div>
  ),
}))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let roots: Root[] = []

async function renderModule() {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(<EditorScanModule />)
  })
}

function clickText(text: string) {
  const target = Array.from(document.querySelectorAll<HTMLElement>("button,[role='tab'],[role='checkbox']"))
    .find((node) => node.textContent === text || node.getAttribute("aria-label") === text)
  target?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
}

afterEach(() => {
  for (const root of roots) {
    act(() => root.unmount())
  }
  roots = []
  document.body.innerHTML = ""
  vi.clearAllMocks()
})

describe("EditorScanModule bulk Skill selection", () => {
  it("shows selection actions after selecting a Skill", async () => {
    await renderModule()

    await act(async () => {
      clickText("选择 jenkins")
    })

    expect(document.body.textContent).toContain("已选 1 个")
    expect(document.body.textContent).toContain("复制到...")
  })

  it("does not show selection checkboxes on the Rule tab", async () => {
    await renderModule()

    await act(async () => {
      clickText("Rule")
    })

    expect(document.querySelector("[role='checkbox']")).toBeNull()
    expect(document.body.textContent).not.toContain("复制到...")
  })

  it("clears selection when switching away from Skill", async () => {
    await renderModule()

    await act(async () => {
      clickText("选择 jenkins")
    })
    await act(async () => {
      clickText("Rule")
    })

    expect(document.body.textContent).not.toContain("已选 1 个")
  })
})
```

- [ ] **Step 2: Run module selection test and verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/editor-scan/__tests__/editor-scan-bulk-selection.test.tsx
```

Expected: FAIL because selection state and bulk copy dialog are not wired.

- [ ] **Step 3: Add overview selection props**

In `desktop/src/modules/editor-scan/components/global-overview.tsx`, extend props:

```ts
  selectedSkillKeys?: Set<string>
  buildSkillKey?: (input: { path: string; scope: EditorScanScope }) => string
  onSkillSelectionChange?: (
    item: EditorScanSkillItem,
    context: { editorId: SynapseEditorId; editorLabel: string; scope: EditorScanScope },
    selected: boolean,
  ) => void
```

Pass these props to Skill cards:

```tsx
const key = buildSkillKey?.({ path: skill.path, scope: "global" }) ?? skill.path

<ScanItemCard
  key={skill.path}
  name={skill.name}
  path={skill.path}
  source={skill.source}
  preview={skill.preview}
  selectable={Boolean(onSkillSelectionChange)}
  selected={selectedSkillKeys?.has(key) ?? false}
  onSelectionChange={(selected) => onSkillSelectionChange?.(skill, {
    editorId: result.editorId,
    editorLabel: result.editorLabel,
    scope: "global",
  }, selected)}
  onClick={() => onItemClick?.(skill, "skill", {
    editorId: result.editorId,
    editorLabel: result.editorLabel,
    scope: "global",
  })}
/>
```

In `desktop/src/modules/editor-scan/components/project-overview.tsx`, add matching props with project context:

```ts
  selectedSkillKeys?: Set<string>
  buildSkillKey?: (input: { path: string; scope: EditorScanScope; projectPath?: string }) => string
  onSkillSelectionChange?: (
    item: EditorScanSkillItem,
    context: {
      editorId: SynapseEditorId
      editorLabel: string
      scope: EditorScanScope
      projectName: string
      projectPath: string
    },
    selected: boolean,
  ) => void
```

Pass props only when `contentTab === "skill"`:

```tsx
const selectionKey = buildSkillKey?.({
  path: item.path,
  projectPath: project.projectPath,
  scope: "project",
}) ?? `${project.projectPath}:${item.path}`

<ScanItemCard
  key={`${item.path}-${item.name}`}
  name={item.name}
  path={item.path}
  source={item.source}
  preview={item.preview}
  metadata={"metadata" in item ? item.metadata : undefined}
  selectable={contentTab === "skill" && Boolean(onSkillSelectionChange)}
  selected={selectedSkillKeys?.has(selectionKey) ?? false}
  onSelectionChange={(selected) => {
    if (contentTab !== "skill") return
    onSkillSelectionChange?.(item as EditorScanSkillItem, {
      editorId: selectedEditorId,
      editorLabel: selectedEditorLabel,
      scope: "project",
      projectName: project.projectName,
      projectPath: project.projectPath,
    }, selected)
  }}
  onClick={() => onItemClick?.(item, contentTab, {
    editorId: selectedEditorId,
    editorLabel: selectedEditorLabel,
    scope: "project",
    projectName: project.projectName,
    projectPath: project.projectPath,
  })}
/>
```

- [ ] **Step 4: Add selection state to the module**

In `desktop/src/modules/editor-scan/index.tsx`, add imports:

```ts
import { useCallback, useEffect, useMemo, useState } from "react"
import { Copy, LoaderCircle, RotateCcw, TriangleAlert, X } from "lucide-react"
import { EditorBulkSkillCopyDialog } from "./components/editor-bulk-skill-copy-dialog"
import type { EditorScanSkillCopyItem } from "./lib/editor-copy-source"
```

Add state and helpers:

```ts
const [selectedSkillMap, setSelectedSkillMap] = useState<Map<string, EditorScanSkillCopyItem>>(() => new Map())
const [bulkCopyOpen, setBulkCopyOpen] = useState(false)

const selectedSkillKeys = useMemo(() => new Set(selectedSkillMap.keys()), [selectedSkillMap])
const selectedSkills = useMemo(() => Array.from(selectedSkillMap.values()), [selectedSkillMap])

const buildSkillKey = useCallback((input: {
  path: string
  scope: EditorScanScope
  projectPath?: string
}) => `${input.scope}:${input.projectPath ?? "global"}:${input.path}`, [])

const clearSkillSelection = useCallback(() => {
  setSelectedSkillMap(new Map())
  setBulkCopyOpen(false)
}, [])

useEffect(() => {
  clearSkillSelection()
}, [clearSkillSelection, selectedEditorId, contentTab, scopeTab])

const handleSkillSelectionChange = useCallback((
  item: EditorScanSkillItem,
  context: {
    editorId: SynapseEditorId
    editorLabel: string
    scope: EditorScanScope
    projectName?: string
    projectPath?: string
  },
  selected: boolean,
) => {
  const key = buildSkillKey({
    path: item.path,
    projectPath: context.projectPath,
    scope: context.scope,
  })

  setSelectedSkillMap((current) => {
    const next = new Map(current)
    if (!selected) {
      next.delete(key)
      return next
    }

    next.set(key, {
      key,
      name: item.name,
      path: item.path,
      source: item.source,
      preview: item.preview,
      fileCount: item.fileCount,
      synapseContentId: item.synapseContentId,
      editorId: context.editorId,
      editorLabel: context.editorLabel,
      scope: context.scope,
      projectName: context.projectName,
      projectPath: context.projectPath,
      trash: item.trash,
    })
    return next
  })
}, [buildSkillKey])
```

Update `handleRefresh` so success clears selection:

```ts
const handleRefresh = useCallback(async () => {
  try {
    await refresh()
    clearSkillSelection()
    showSuccess("扫描结果已刷新")
  } catch {
    showError("刷新失败，请稍后重试。")
  }
}, [clearSkillSelection, refresh, showSuccess, showError])
```

Add toolbar actions near the existing refresh button:

```tsx
{contentTab === "skill" && selectedSkills.length > 0 ? (
  <div className="flex items-center gap-2">
    <span className="text-sm text-muted-foreground">已选 {selectedSkills.length} 个</span>
    <Button variant="outline" size="sm" onClick={clearSkillSelection}>
      <X data-icon="inline-start" />
      取消选择
    </Button>
    <Button variant="outline" size="sm" onClick={() => setBulkCopyOpen(true)}>
      <Copy data-icon="inline-start" />
      复制到...
    </Button>
  </div>
) : null}
```

Pass selection props to overview components:

```tsx
<GlobalOverview
  result={globalResult}
  contentTab={contentTab}
  onItemClick={handleItemClick}
  selectedSkillKeys={selectedSkillKeys}
  buildSkillKey={buildSkillKey}
  onSkillSelectionChange={handleSkillSelectionChange}
/>
```

```tsx
<ProjectOverview
  projects={data?.projects ?? []}
  selectedEditorId={selectedEditorId}
  selectedEditorLabel={globalResult.editorLabel}
  contentTab={contentTab}
  onItemClick={handleItemClick}
  selectedSkillKeys={selectedSkillKeys}
  buildSkillKey={buildSkillKey}
  onSkillSelectionChange={handleSkillSelectionChange}
/>
```

Mount the dialog at the bottom:

```tsx
<EditorBulkSkillCopyDialog
  items={selectedSkills}
  open={bulkCopyOpen}
  onCopied={async () => {
    await refresh()
    clearSkillSelection()
  }}
  onOpenChange={setBulkCopyOpen}
/>
```

- [ ] **Step 5: Add a temporary dialog stub for tests**

Create `desktop/src/modules/editor-scan/components/editor-bulk-skill-copy-dialog.tsx`:

```tsx
import type { EditorScanSkillCopyItem } from "@/modules/editor-scan/lib/editor-copy-source"

type EditorBulkSkillCopyDialogProps = {
  items: EditorScanSkillCopyItem[]
  onCopied?: () => Promise<void> | void
  onOpenChange: (open: boolean) => void
  open: boolean
}

function EditorBulkSkillCopyDialog(_props: EditorBulkSkillCopyDialogProps) {
  return null
}

export { EditorBulkSkillCopyDialog }
export type { EditorBulkSkillCopyDialogProps }
```

- [ ] **Step 6: Run selection tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/editor-scan/__tests__/editor-scan-bulk-selection.test.tsx src/modules/editor-scan/__tests__/scan-item-card-selection.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add desktop/src/modules/editor-scan/index.tsx desktop/src/modules/editor-scan/components/global-overview.tsx desktop/src/modules/editor-scan/components/project-overview.tsx desktop/src/modules/editor-scan/components/editor-bulk-skill-copy-dialog.tsx desktop/src/modules/editor-scan/__tests__/editor-scan-bulk-selection.test.tsx
git commit -m "feat(editor-scan): add skill multi-select state"
```

## Task 5: Implement Bulk Copy Dialog

**Files:**
- Modify: `desktop/src/modules/editor-scan/components/editor-bulk-skill-copy-dialog.tsx`
- Create: `desktop/src/modules/editor-scan/__tests__/editor-bulk-skill-copy-dialog.test.tsx`

- [ ] **Step 1: Write failing dialog tests**

Create `desktop/src/modules/editor-scan/__tests__/editor-bulk-skill-copy-dialog.test.tsx`:

```tsx
/**
 * @vitest-environment jsdom
 */
import { act, type ButtonHTMLAttributes, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { EditorBulkSkillCopyDialog } from "../components/editor-bulk-skill-copy-dialog"
import type { EditorWriteTargetSelection } from "@/modules/content/components/editor-write-target-selector"
import type { EditorScanSkillCopyItem } from "../lib/editor-copy-source"

const mocks = vi.hoisted(() => ({
  copyToEditor: vi.fn(),
  resolveEditorCopyTarget: vi.fn(),
  onCopied: vi.fn(),
  promise: vi.fn(async <T,>(factory: () => Promise<T>) => factory()),
}))

vi.mock("@/app-shell/editor-copy", () => ({
  copyToEditor: mocks.copyToEditor,
  resolveEditorCopyTarget: mocks.resolveEditorCopyTarget,
}))

vi.mock("@/app-shell/config", () => ({
  useAppConfig: () => ({
    config: { global: { projects: [] } },
  }),
}))

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => ({
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}))

vi.mock("@/app-shell/notifications", () => ({
  useAppNotifications: () => ({
    error: vi.fn(),
    promise: mocks.promise,
    success: vi.fn(),
    warning: vi.fn(),
  }),
}))

vi.mock("@/modules/content/hooks/use-editor-adapters-for-content-type", () => ({
  useEditorAdaptersForContentType: () => ({
    error: null,
    filteredAdapters: [{
      id: "codex",
      label: "Codex",
      order: 1,
      supportsGlobal: true,
      supportsProject: true,
      supportedContentTypes: ["skill"],
    }],
    isLoading: false,
    load: vi.fn(),
  }),
}))

vi.mock("@/modules/content/components/editor-write-target-selector", () => ({
  EditorWriteTargetSelector: ({
    onSelectionChange,
  }: {
    onSelectionChange: (selection: EditorWriteTargetSelection) => void
  }) => (
    <button
      type="button"
      onClick={() => {
        const activeTarget: EditorWriteTargetSelection["activeTarget"] = {
          contentType: "skill",
          editorId: "codex",
          label: "Codex",
          message: null,
          scope: "global",
          status: "ready",
          targetExists: false,
          targetKind: "directory",
          targetPath: "/target/base",
        }
        onSelectionChange({
          activeTarget,
          activeTargetState: { error: null, isLoading: false, value: activeTarget },
          projectPath: "",
          scope: "global",
        })
      }}
    >
      选择目标
    </button>
  ),
}))

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children, open }: { children: ReactNode; open: boolean }) => open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  DialogFooter: ({ children }: { children: ReactNode }) => <footer>{children}</footer>,
  DialogHeader: ({ children }: { children: ReactNode }) => <header>{children}</header>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}))

vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({ children, open }: { children: ReactNode; open: boolean }) => open ? <div>{children}</div> : null,
  AlertDialogAction: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => <button type="button" {...props}>{children}</button>,
  AlertDialogCancel: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => <button type="button" {...props}>{children}</button>,
  AlertDialogContent: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  AlertDialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  AlertDialogFooter: ({ children }: { children: ReactNode }) => <footer>{children}</footer>,
  AlertDialogHeader: ({ children }: { children: ReactNode }) => <header>{children}</header>,
  AlertDialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let roots: Root[] = []

function createItem(name: string): EditorScanSkillCopyItem {
  return {
    key: `global:/source/${name}`,
    name,
    path: `/source/${name}`,
    source: "external",
    preview: name,
    fileCount: 1,
    synapseContentId: null,
    editorId: "claude-code",
    editorLabel: "Claude Code",
    scope: "global",
    trash: { mode: "path" },
  }
}

async function renderDialog(items = [createItem("jenkins")]) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(
      <EditorBulkSkillCopyDialog
        items={items}
        onCopied={mocks.onCopied}
        onOpenChange={vi.fn()}
        open
      />,
    )
  })
}

function clickButton(text: string) {
  const button = Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
    .find((node) => node.textContent === text)
  button?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
}

afterEach(() => {
  for (const root of roots) {
    act(() => root.unmount())
  }
  roots = []
  document.body.innerHTML = ""
  vi.clearAllMocks()
})

describe("EditorBulkSkillCopyDialog", () => {
  it("preflights selected skills and copies ready items", async () => {
    mocks.resolveEditorCopyTarget.mockResolvedValue({
      contentType: "skill",
      editorId: "codex",
      label: "Codex",
      message: null,
      scope: "global",
      status: "ready",
      targetExists: false,
      targetKind: "directory",
      targetPath: "/target/jenkins",
    })
    mocks.copyToEditor.mockResolvedValue({
      contentType: "skill",
      editorId: "codex",
      label: "Codex",
      overwritten: false,
      scope: "global",
      targetKind: "directory",
      targetPath: "/target/jenkins",
    })

    await renderDialog()

    await act(async () => clickButton("Codex"))
    await act(async () => clickButton("选择目标"))

    expect(document.body.textContent).toContain("可复制 1 个")

    await act(async () => clickButton("复制"))

    expect(mocks.copyToEditor).toHaveBeenCalledWith(expect.objectContaining({
      overwriteConfirmed: undefined,
      targetEditorId: "codex",
      targetScope: "global",
    }))
    expect(mocks.onCopied).toHaveBeenCalledTimes(1)
  })

  it("asks once before copying overwrite items", async () => {
    mocks.resolveEditorCopyTarget.mockResolvedValue({
      contentType: "skill",
      editorId: "codex",
      label: "Codex",
      message: null,
      scope: "global",
      status: "ready",
      targetExists: true,
      targetKind: "directory",
      targetPath: "/target/jenkins",
    })
    mocks.copyToEditor.mockResolvedValue({
      contentType: "skill",
      editorId: "codex",
      label: "Codex",
      overwritten: true,
      scope: "global",
      targetKind: "directory",
      targetPath: "/target/jenkins",
    })

    await renderDialog()

    await act(async () => clickButton("Codex"))
    await act(async () => clickButton("选择目标"))

    expect(document.body.textContent).toContain("将覆盖 1 个")

    await act(async () => clickButton("复制并覆盖"))

    expect(mocks.copyToEditor).toHaveBeenCalledWith(expect.objectContaining({
      overwriteConfirmed: true,
    }))
  })
})
```

- [ ] **Step 2: Run dialog tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/editor-scan/__tests__/editor-bulk-skill-copy-dialog.test.tsx
```

Expected: FAIL because the dialog stub has no UI.

- [ ] **Step 3: Implement the dialog**

Replace `desktop/src/modules/editor-scan/components/editor-bulk-skill-copy-dialog.tsx` with:

```tsx
import { useCallback, useEffect, useMemo, useState } from "react"
import { LoaderCircle } from "lucide-react"
import { copyToEditor, resolveEditorCopyTarget } from "@/app-shell/editor-copy"
import { useAppConfig } from "@/app-shell/config"
import { createRendererLogger } from "@/app-shell/logging"
import { useAppNotifications } from "@/app-shell/notifications"
import { EditorIcon } from "@/components/editor-icon"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  EditorWriteTargetSelector,
  type EditorWriteTargetSelection,
  type ResolveEditorTargetInput,
} from "@/modules/content/components/editor-write-target-selector"
import { useEditorAdaptersForContentType } from "@/modules/content/hooks/use-editor-adapters-for-content-type"
import {
  buildBulkSkillCopySummary,
  classifyBulkSkillCopyPreflight,
  createBulkSkillCopyPayload,
  createUnavailablePreflightItem,
  isExecutablePreflightItem,
  type BulkSkillCopyPreflightItem,
  type BulkSkillCopyResultItem,
} from "@/modules/editor-scan/lib/bulk-skill-copy"
import { createCopySource, type EditorScanSkillCopyItem } from "@/modules/editor-scan/lib/editor-copy-source"
import type { SynapseEditorAdapterSummary } from "@/types/editor"

type EditorBulkSkillCopyDialogProps = {
  items: EditorScanSkillCopyItem[]
  onCopied?: () => Promise<void> | void
  onOpenChange: (open: boolean) => void
  open: boolean
}

const logger = createRendererLogger("editor-scan.bulk-copy")

function EditorBulkSkillCopyDialog({
  items,
  onCopied,
  onOpenChange,
  open,
}: EditorBulkSkillCopyDialogProps) {
  const { config } = useAppConfig()
  const { error: notifyError, promise, success, warning } = useAppNotifications()
  const [selectedEditor, setSelectedEditor] = useState<SynapseEditorAdapterSummary | null>(null)
  const [selection, setSelection] = useState<EditorWriteTargetSelection | null>(null)
  const [preflightItems, setPreflightItems] = useState<BulkSkillCopyPreflightItem[]>([])
  const [results, setResults] = useState<BulkSkillCopyResultItem[]>([])
  const [isPreflighting, setIsPreflighting] = useState(false)
  const [isCopying, setIsCopying] = useState(false)
  const [copyError, setCopyError] = useState<string | null>(null)
  const [isOverwriteConfirmOpen, setIsOverwriteConfirmOpen] = useState(false)

  const {
    error: adaptersError,
    filteredAdapters,
    isLoading: isLoadingAdapters,
    load: loadEditors,
  } = useEditorAdaptersForContentType({
    contentType: "skill",
    enabled: open,
    loggerName: "editor-scan.bulk-copy",
  })

  const scope = selection?.scope ?? "global"
  const projectPath = selection?.projectPath ?? ""
  const executableItems = preflightItems.filter(isExecutablePreflightItem)
  const overwriteCount = preflightItems.filter((item) => item.status === "overwrite").length
  const readyCount = preflightItems.filter((item) => item.status === "ready").length
  const unavailableCount = preflightItems.filter((item) => item.status === "unavailable").length
  const canCopy = Boolean(selectedEditor && executableItems.length > 0 && !isPreflighting && !isCopying)
  const resultSummary = useMemo(() => buildBulkSkillCopySummary(results), [results])

  useEffect(() => {
    if (!open) {
      setSelectedEditor(null)
      setSelection(null)
      setPreflightItems([])
      setResults([])
      setIsPreflighting(false)
      setIsCopying(false)
      setCopyError(null)
      setIsOverwriteConfirmOpen(false)
      return
    }

    loadEditors()
  }, [loadEditors, open])

  const resolveTarget = useCallback((input: ResolveEditorTargetInput) => {
    const firstItem = items[0]
    if (!firstItem) {
      throw new Error("当前没有可复制的 Skill。")
    }

    return resolveEditorCopyTarget({
      source: createCopySource(firstItem),
      targetEditorId: input.editorId,
      targetProjectPath: input.scope === "project" ? input.projectPath : undefined,
      targetScope: input.scope,
    })
  }, [items])

  const runPreflight = useCallback(async () => {
    if (!selectedEditor || !selection?.activeTarget || (scope === "project" && !projectPath)) {
      setPreflightItems([])
      return
    }

    setIsPreflighting(true)
    setCopyError(null)
    setResults([])

    const nextItems: BulkSkillCopyPreflightItem[] = []
    for (const item of items) {
      const source = createCopySource(item)
      try {
        const target = await resolveEditorCopyTarget({
          source,
          targetEditorId: selectedEditor.id,
          targetProjectPath: scope === "project" ? projectPath : undefined,
          targetScope: scope,
        })
        nextItems.push(classifyBulkSkillCopyPreflight(item, source, target))
      } catch (error) {
        logger.warn("Bulk Skill copy preflight item failed.", {
          editorId: selectedEditor.id,
          error,
          itemName: item.name,
          scope,
        })
        nextItems.push(createUnavailablePreflightItem(item, source, error))
      }
    }

    setPreflightItems(nextItems)
    setIsPreflighting(false)
  }, [items, projectPath, scope, selectedEditor, selection?.activeTarget])

  useEffect(() => {
    if (!open || !selectedEditor || !selection?.activeTarget) return
    void runPreflight()
  }, [open, runPreflight, selectedEditor, selection?.activeTarget])

  const runCopy = async () => {
    if (!selectedEditor || isCopying) return

    setIsCopying(true)
    setCopyError(null)
    const nextResults: BulkSkillCopyResultItem[] = preflightItems
      .filter((item): item is Extract<BulkSkillCopyPreflightItem, { status: "unavailable" }> => item.status === "unavailable")
      .map((item) => ({ status: "skipped", item: item.item, message: item.message }))

    for (const item of executableItems) {
      try {
        const result = await promise(
          () => copyToEditor(createBulkSkillCopyPayload(
            item,
            selectedEditor.id,
            scope,
            scope === "project" ? projectPath : undefined,
          )),
          {
            loading: `正在复制 ${item.item.name}...`,
            success: () => `已复制 ${item.item.name}`,
            error: (error) => error instanceof Error ? error.message : "复制失败。",
          },
        )
        nextResults.push({
          status: "copied",
          item: item.item,
          targetPath: result.targetPath,
          overwritten: item.status === "overwrite",
        })
      } catch (error) {
        logger.error("Bulk Skill copy item failed.", {
          editorId: selectedEditor.id,
          error,
          itemName: item.item.name,
          scope,
        })
        nextResults.push({
          status: "failed",
          item: item.item,
          message: error instanceof Error ? error.message : "复制失败。",
        })
      }
    }

    setResults(nextResults)
    const summary = buildBulkSkillCopySummary(nextResults)
    try {
      await onCopied?.()
    } catch (error) {
      logger.warn("Scan refresh after bulk Skill copy failed.", { error })
      warning("复制完成，刷新失败")
    }

    if (summary.copied === items.length) {
      success(`已复制 ${summary.copied} 个 Skill`)
      onOpenChange(false)
    } else if (summary.copied > 0) {
      warning(`已复制 ${summary.copied}/${items.length} 个 Skill`)
    } else {
      notifyError("复制失败")
    }

    setIsCopying(false)
  }

  if (items.length === 0) return null

  return (
    <>
      <AlertDialog open={isOverwriteConfirmOpen} onOpenChange={setIsOverwriteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>将覆盖 {overwriteCount} 个 Skill</AlertDialogTitle>
            <AlertDialogDescription>
              目标位置已有同名 Skill，确认后会替换这些目录。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isCopying}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={isCopying}
              onClick={() => {
                setIsOverwriteConfirmOpen(false)
                void runCopy()
              }}
            >
              复制并覆盖
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={open && !selectedEditor} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>选择编辑器</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            {isLoadingAdapters ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <LoaderCircle className="size-4 animate-spin" />
                正在读取编辑器
              </p>
            ) : adaptersError ? (
              <p className="text-sm text-destructive">{adaptersError}</p>
            ) : filteredAdapters.length > 0 ? (
              filteredAdapters.map((editor) => (
                <Button
                  key={editor.id}
                  type="button"
                  variant="ghost"
                  className="h-auto justify-start gap-2.5 bg-muted/30 p-2.5 hover:bg-muted/60"
                  onClick={() => setSelectedEditor(editor)}
                >
                  <EditorIcon editorId={editor.id} className="size-8" />
                  {editor.label}
                </Button>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">当前没有可用的复制目标。</p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={open && Boolean(selectedEditor)} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>复制到 {selectedEditor?.label}</DialogTitle>
          </DialogHeader>
          {selectedEditor ? (
            <div className="flex flex-col gap-5">
              <EditorWriteTargetSelector
                actionKind="copy"
                contentType="skill"
                editor={selectedEditor}
                loggerName="editor-scan.bulk-copy"
                onError={setCopyError}
                onSelectionChange={setSelection}
                open={open}
                projects={config.global.projects}
                resolveTarget={resolveTarget}
              />

              <div className="flex flex-wrap gap-2 text-sm">
                <Badge variant="secondary">可复制 {readyCount} 个</Badge>
                <Badge variant="secondary">将覆盖 {overwriteCount} 个</Badge>
                <Badge variant="secondary">不可用 {unavailableCount} 个</Badge>
              </div>

              {isPreflighting ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <LoaderCircle className="size-4 animate-spin" />
                  正在检查目标
                </p>
              ) : null}

              {copyError ? <p className="text-sm text-destructive">{copyError}</p> : null}

              {preflightItems.length > 0 ? (
                <ScrollArea className="max-h-44 rounded-md border border-border">
                  <div className="flex flex-col gap-2 p-3 text-sm">
                    {preflightItems.map((item) => (
                      <div key={item.item.key} className="min-w-0">
                        <p className="truncate font-medium">{item.item.name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {item.status === "unavailable" ? item.message : item.targetPath}
                        </p>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              ) : null}

              {results.length > 0 ? (
                <p className="text-sm text-muted-foreground">
                  已复制 {resultSummary.copied}/{items.length} 个 Skill
                </p>
              ) : null}
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={isCopying} onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button
              type="button"
              disabled={!canCopy}
              onClick={() => {
                if (overwriteCount > 0) {
                  setIsOverwriteConfirmOpen(true)
                  return
                }
                void runCopy()
              }}
            >
              {isCopying ? <LoaderCircle className="animate-spin" /> : null}
              {overwriteCount > 0 ? "复制并覆盖" : "复制"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

export { EditorBulkSkillCopyDialog }
export type { EditorBulkSkillCopyDialogProps }
```

- [ ] **Step 4: Run dialog tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/editor-scan/__tests__/editor-bulk-skill-copy-dialog.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Run all editor-scan tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/editor-scan
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add desktop/src/modules/editor-scan/components/editor-bulk-skill-copy-dialog.tsx desktop/src/modules/editor-scan/__tests__/editor-bulk-skill-copy-dialog.test.tsx
git commit -m "feat(editor-scan): copy selected skills in bulk"
```

## Task 6: Release Notes and Final Verification

**Files:**
- Modify: `RELEASE_NOTES_PENDING.md`

- [ ] **Step 1: Add release note**

Add this bullet directly under `## 新增功能` in `RELEASE_NOTES_PENDING.md`:

```md
- 本机 Skill 扫描页支持多选后批量复制到其它编辑器，复制前会汇总覆盖项，适合在多个编辑器之间同步 Skill。
```

- [ ] **Step 2: Run targeted tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/editor-scan
```

Expected: PASS.

- [ ] **Step 3: Run typecheck**

Run:

```bash
pnpm --filter @synapse/desktop run typecheck
```

Expected: PASS.

- [ ] **Step 4: Run hard constraints**

Run:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: PASS.

- [ ] **Step 5: Inspect final diff**

Run:

```bash
git diff --stat HEAD
git diff --check
```

Expected: diff only covers editor-scan renderer files, tests, and `RELEASE_NOTES_PENDING.md`; `git diff --check` reports no whitespace errors.

- [ ] **Step 6: Commit**

```bash
git add RELEASE_NOTES_PENDING.md
git commit -m "docs: note bulk skill copy support"
```

## Self-Review

Spec coverage:

-本机扫描页 Skill 多选：Task 3 and Task 4.
- 当前上下文内生效 and context reset: Task 4.
- 批量复制 dialog and target selection reuse: Task 5.
- Preflight overwrite/unavailable summary: Task 2 and Task 5.
- Single confirmation for overwrite: Task 5.
- Existing copy IPC reuse: Task 5 uses `resolveEditorCopyTarget` and `copyToEditor`.
- Single copy behavior unchanged: Task 1 keeps `EditorCopyDialog` shape and runs existing wording tests.
- Release notes: Task 6.

Placeholder scan:

- No unresolved implementation markers are intentionally left in this plan.
- Each new file has concrete code or test snippets.
- Each verification step has exact commands and expected outcomes.

Type consistency:

- `EditorScanSkillCopyItem` is defined in `editor-copy-source.ts` and imported by helper, dialog, and module tasks.
- `BulkSkillCopyPreflightItem` and `BulkSkillCopyResultItem` are defined once in `bulk-skill-copy.ts`.
- `EditorBulkSkillCopyDialogProps` uses the same `EditorScanSkillCopyItem[]` item type built in `EditorScanModule`.

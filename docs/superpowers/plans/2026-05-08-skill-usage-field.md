# Skill 使用说明字段 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `usage` field to skills that displays in the detail modal header (replacing description's position) and in the edit form, while moving description into the scrollable body area.

**Architecture:** The `usage` field is added to the shared content type system (`SynapseContentSnapshotRecord`, `SynapseContentSummaryBase`, payloads) as an optional string. The detail dialog passes `usage` (or placeholder) to `ContentItemMeta` for header display. `SkillVersionView` gains a description block above the markdown content. The edit form adds a textarea before the description field.

**Tech Stack:** React 19, TypeScript, shadcn/ui (Textarea, Label), Tailwind CSS 4

---

### Task 1: Add `usage` field to type definitions

**Files:**
- Modify: `desktop/src/types/content.ts:18-37` (SynapseContentSnapshotRecord)
- Modify: `desktop/src/types/content.ts:50-72` (SynapseContentSummaryBase)
- Modify: `desktop/src/types/content.ts:128-138` (SynapseCreateContentPayloadBase)
- Modify: `desktop/src/types/content.ts:165-169` (SynapseUpdateContentPayloadBase)

- [ ] **Step 1: Add `usage` to `SynapseContentSnapshotRecord`**

In `desktop/src/types/content.ts`, add `usage?: string` after the `name` field:

```typescript
export type SynapseContentSnapshotRecord = {
  schemaVersion: SynapseContentSchemaVersion
  title: string
  name?: string
  usage?: string
  description: string
  // ... rest unchanged
}
```

- [ ] **Step 2: Add `usage` to `SynapseContentSummaryBase`**

```typescript
type SynapseContentSummaryBase = {
  id: string
  title: string
  name?: string
  usage?: string
  description: string
  // ... rest unchanged
}
```

- [ ] **Step 3: Add `usage` to `SynapseCreateContentPayloadBase`**

```typescript
type SynapseCreateContentPayloadBase = {
  title: string
  usage?: string
  description: string
  // ... rest unchanged
}
```

- [ ] **Step 4: Add `usage` to `SynapseUpdateContentPayloadBase`**

The update payload extends `SynapseCreateContentPayloadBase`, so it inherits `usage` automatically. No change needed here.

- [ ] **Step 5: Verify TypeScript compiles**

Run: `cd /Users/liyang/Documents/code/github/Synapse/desktop && npx tsc --noEmit 2>&1 | head -30`
Expected: No new errors (field is optional everywhere)

- [ ] **Step 6: Commit**

```bash
git add desktop/src/types/content.ts
git commit -m "feat(types): add optional usage field to content types"
```

---

### Task 2: Update main process snapshot read/write to handle `usage`

**Files:**
- Modify: `desktop/electron/services/content-write-service.ts:121-145` (createSnapshotRecord)
- Modify: `desktop/electron/services/content-history-service.ts:134-178` (parseSnapshotRecord)
- Modify: `desktop/electron/services/repository-maintenance-service.ts:176+` (parseSnapshotRecord duplicate)

- [ ] **Step 1: Update `createSnapshotRecord` in content-write-service.ts**

In the `createSnapshotRecord` function, add `usage` handling after the `name` spread:

```typescript
function createSnapshotRecord(
  payload: ContentCreatePayload | ContentUpdatePayload,
  identity: SynapseContentAuthor,
  modifiedAt: string,
  deleted: boolean,
): SynapseContentSnapshotRecord {
  const payloadName = (payload as { name?: unknown }).name
  const trimmedName = typeof payloadName === "string" ? payloadName.trim() : ""
  const payloadUsage = (payload as { usage?: unknown }).usage
  const trimmedUsage = typeof payloadUsage === "string" ? payloadUsage.trim() : ""

  return {
    schemaVersion: 1,
    title: payload.title.trim(),
    ...(trimmedName.length > 0 ? { name: trimmedName } : {}),
    ...(trimmedUsage.length > 0 ? { usage: trimmedUsage } : {}),
    description: payload.description.trim(),
    // ... rest unchanged
  }
}
```

- [ ] **Step 2: Update `parseSnapshotRecord` in content-history-service.ts**

Add `usage` parsing after the `name` parsing block:

```typescript
const rawName = rawValue.name
const trimmedName = typeof rawName === "string" ? rawName.trim() : ""
const rawUsage = rawValue.usage
const trimmedUsage = typeof rawUsage === "string" ? rawUsage.trim() : ""
const rawIconImage = rawValue.iconImage
const trimmedIconImage = typeof rawIconImage === "string" ? rawIconImage.trim() : ""

return {
  schemaVersion: 1,
  title: rawValue.title.trim(),
  ...(trimmedName.length > 0 ? { name: trimmedName } : {}),
  ...(trimmedUsage.length > 0 ? { usage: trimmedUsage } : {}),
  description: rawValue.description.trim(),
  // ... rest unchanged
}
```

- [ ] **Step 3: Update `parseSnapshotRecord` in repository-maintenance-service.ts**

Apply the same `usage` parsing pattern as Step 2.

- [ ] **Step 4: Update `buildSummary` in content-history-service.ts**

Add `usage` to the summary object:

```typescript
function buildSummary(
  contentType: SynapseContentType,
  meta: SynapseContentMetaRecord,
  snapshot: SynapseContentSnapshotRecord,
  historyDirname: string,
  attachments: SynapseContentAttachmentRecord[],
): SynapseContentMeta {
  const baseSummary = {
    id: meta.id,
    title: snapshot.title,
    ...(snapshot.name ? { name: snapshot.name } : {}),
    ...(snapshot.usage ? { usage: snapshot.usage } : {}),
    description: snapshot.description,
    // ... rest unchanged
  }
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `cd /Users/liyang/Documents/code/github/Synapse/desktop && npx tsc --noEmit 2>&1 | head -30`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add desktop/electron/services/content-write-service.ts desktop/electron/services/content-history-service.ts desktop/electron/services/repository-maintenance-service.ts
git commit -m "feat(electron): persist and parse usage field in snapshots"
```

---

### Task 3: Add `usage` to the skill edit form

**Files:**
- Modify: `desktop/src/modules/content/lib/content-payload.ts:4-13` (ContentPayload type)
- Modify: `desktop/src/modules/content/lib/content-payload.ts:33-47` (createEmptyContentPayload)
- Modify: `desktop/src/modules/content/lib/content-payload.ts:49-58` (normalizeContentPayload)
- Modify: `desktop/src/modules/content/lib/content-payload.ts:100-114` (isContentPayloadDirty)
- Modify: `desktop/src/modules/content/lib/content-payload.ts:116-127` (buildBaseContentInitialValue)
- Modify: `desktop/src/modules/skills/components/skill-create-dialog.tsx:323-340` (add usage field before description)
- Modify: `desktop/src/modules/skills/components/skill-detail-dialog.tsx:59-74` (buildInitialValue)

- [ ] **Step 1: Add `usage` to `ContentPayload` type**

In `desktop/src/modules/content/lib/content-payload.ts`:

```typescript
type ContentPayload = {
  title: string
  usage?: string
  description: string
  category: string
  icon: string
  iconBg: string
  iconType: SynapseContentIconType
  iconImage: string
  content: string
}
```

- [ ] **Step 2: Update `createEmptyContentPayload`**

Add `usage: ""` to the defaults:

```typescript
function createEmptyContentPayload<T extends ContentPayload>(
  defaults: Partial<T> = {},
): T {
  return {
    title: "",
    usage: "",
    description: "",
    category: "",
    icon: "",
    iconBg: DEFAULT_SYNAPSE_CONTENT_COLOR_VALUE,
    iconType: "icon",
    iconImage: "",
    content: "",
    ...defaults,
  } as T
}
```

- [ ] **Step 3: Update `normalizeContentPayload`**

Add `usage` trimming:

```typescript
function normalizeContentPayload<T extends ContentPayload>(payload: T): T {
  return {
    ...payload,
    iconBg: payload.iconBg || DEFAULT_SYNAPSE_CONTENT_COLOR_VALUE,
    iconType: payload.iconType || "icon",
    title: payload.title.trim(),
    usage: payload.usage?.trim() ?? "",
    description: payload.description.trim(),
    content: payload.content.trim(),
  }
}
```

- [ ] **Step 4: Update `isContentPayloadDirty`**

Add `usage` check:

```typescript
function isContentPayloadDirty<T extends ContentPayload>(
  payload: T,
  extraChecks: (payload: T) => boolean = () => false,
): boolean {
  return (
    payload.title !== ""
    || (payload.usage ?? "") !== ""
    || payload.description !== ""
    || payload.category !== ""
    || payload.icon !== ""
    || payload.iconBg !== DEFAULT_SYNAPSE_CONTENT_COLOR_VALUE
    || payload.iconImage !== ""
    || payload.content !== ""
    || extraChecks(payload)
  )
}
```

- [ ] **Step 5: Update `buildBaseContentInitialValue`**

Add `usage`:

```typescript
function buildBaseContentInitialValue(detail: Partial<Pick<ContentPayload, "iconType" | "iconImage" | "usage">> & Omit<ContentPayload, "iconType" | "iconImage" | "usage">): ContentPayload {
  return {
    title: detail.title,
    usage: detail.usage ?? "",
    description: detail.description,
    category: detail.category,
    icon: detail.icon,
    iconBg: detail.iconBg,
    iconType: detail.iconType || "icon",
    iconImage: detail.iconImage || "",
    content: detail.content,
  }
}
```

- [ ] **Step 6: Add usage textarea to `SkillCreateDialog`**

In `desktop/src/modules/skills/components/skill-create-dialog.tsx`, add a `usageField` variable after `categoryField` (around line 321), before `descriptionField`:

```typescript
const usageField = (
  <div className="flex flex-col gap-2">
    <Label htmlFor="skill-create-usage">使用说明</Label>
    <Textarea
      id="skill-create-usage"
      value={form.usage ?? ""}
      onChange={(event) => updateField("usage", event.target.value)}
      placeholder="输入 /my-skill 触发，适用于..."
      rows={2}
      className="min-h-0 resize-none"
    />
    <p className="text-xs text-muted-foreground">
      显示在详情头部，不会安装到编辑器。
    </p>
  </div>
)
```

Then insert `{usageField}` before `{descriptionField}` in the JSX (around line 481):

```tsx
{descriptionField}
```

becomes:

```tsx
{usageField}
{descriptionField}
```

- [ ] **Step 7: Update `buildInitialValue` in `SkillDetailDialog`**

In `desktop/src/modules/skills/components/skill-detail-dialog.tsx`, add `usage` to the initial value builder:

```typescript
buildInitialValue={(detail: SynapseContentDetail): CreateSkillPayload => ({
  title: detail.title,
  name: detail.name ?? "",
  usage: detail.usage ?? "",
  description: detail.description,
  category: detail.category,
  // ... rest unchanged
})}
```

- [ ] **Step 8: Verify TypeScript compiles**

Run: `cd /Users/liyang/Documents/code/github/Synapse/desktop && npx tsc --noEmit 2>&1 | head -30`
Expected: No errors

- [ ] **Step 9: Commit**

```bash
git add desktop/src/modules/content/lib/content-payload.ts desktop/src/modules/skills/components/skill-create-dialog.tsx desktop/src/modules/skills/components/skill-detail-dialog.tsx
git commit -m "feat(skills): add usage field to skill edit form"
```

---

### Task 4: Update detail modal header to show `usage` instead of `description`

**Files:**
- Modify: `desktop/src/modules/content/components/content-item-meta.tsx` (add optional subtitle prop)
- Modify: `desktop/src/modules/content/components/content-detail-dialog.tsx:504-511` (pass usage for skills)

- [ ] **Step 1: Add `subtitle` prop to `ContentItemMeta`**

The cleanest approach: the `ContentDetailDialog` already passes `description` to `ContentItemMeta`. For skills, we want to pass `usage` (or placeholder) instead. Since `ContentDetailDialog` is generic, we add an optional `headerSubtitle` override prop to the dialog that, when provided, replaces the description in the header.

In `desktop/src/modules/content/components/content-detail-dialog.tsx`, add a new prop to `ContentDetailDialogProps`:

```typescript
type ContentDetailDialogProps<TPayload, TContentType extends SynapseContentType> = {
  // ... existing props
  headerSubtitle?: (item: SynapseContentMeta<TContentType> | SynapseContentDetail<TContentType>) => string
}
```

- [ ] **Step 2: Use `headerSubtitle` in the dialog header**

In the dialog's JSX where `ContentItemMeta` is rendered (around line 505-510):

```tsx
<ContentItemMeta
  author={authorLabel}
  category={categoryLabel}
  description={headerSubtitle ? headerSubtitle(resolvedItem) : resolvedItem.description}
  descriptionWrap
  title={resolvedItem.title}
/>
```

- [ ] **Step 3: Pass `headerSubtitle` from `SkillDetailDialog`**

In `desktop/src/modules/skills/components/skill-detail-dialog.tsx`:

```typescript
<ContentDetailDialog
  contentType="skill"
  item={item}
  labels={SKILL_LABELS}
  logCategory="skills.detail"
  headerSubtitle={(resolved) => resolved.usage || "暂无使用说明"}
  // ... rest unchanged
/>
```

- [ ] **Step 4: Style the placeholder state**

The placeholder "暂无使用说明" will render in `text-muted-foreground` via `ContentItemMeta`'s existing styling, which is already a lighter gray. This matches the spec's "灰色占位" requirement without additional changes.

- [ ] **Step 5: Verify TypeScript compiles**

Run: `cd /Users/liyang/Documents/code/github/Synapse/desktop && npx tsc --noEmit 2>&1 | head -30`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add desktop/src/modules/content/components/content-item-meta.tsx desktop/src/modules/content/components/content-detail-dialog.tsx desktop/src/modules/skills/components/skill-detail-dialog.tsx
git commit -m "feat(skills): show usage in detail modal header instead of description"
```

---

### Task 5: Add description block to skill version view body

**Files:**
- Modify: `desktop/src/modules/skills/components/skill-version-view.tsx`
- Modify: `desktop/src/modules/content/hooks/use-content-detail-state.ts` (check if description is available on version)

- [ ] **Step 1: Check what data `version` carries**

The `SynapseLoadedContentVersion` type extends `SynapseContentDetail`, which includes `description`. So `version.description` is already available.

- [ ] **Step 2: Add description block to `SkillVersionView`**

In `desktop/src/modules/skills/components/skill-version-view.tsx`, add a description block before the `ContentVersionView`:

```typescript
import { ContentVersionView } from "@/modules/content/components/content-version-view"
import type { SynapseLoadedContentVersion } from "@/modules/content/hooks/use-content-detail-state"
import type { MarkdownViewerSurface } from "@/components/markdown-viewer"
import type { SynapseContentViewMode } from "@/types/content"

type SkillVersionViewProps = {
  mode: SynapseContentViewMode
  surface?: MarkdownViewerSurface
  version: SynapseLoadedContentVersion<"skill">
}

function SkillVersionView({ mode, surface, version }: SkillVersionViewProps) {
  return (
    <div className="flex flex-col gap-2">
      {version.description ? (
        <div className="rounded-lg bg-muted px-3 py-2.5">
          <p className="text-[11px] font-medium text-muted-foreground">description</p>
          <p className="mt-1 text-sm leading-relaxed text-foreground whitespace-pre-wrap break-words">
            {version.description}
          </p>
        </div>
      ) : null}

      <ContentVersionView
        deletedMessage="该 Skill 已被删除。"
        mode={mode}
        surface={surface}
        version={version}
      >
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-foreground">附件</p>
          {version.attachments.length > 0 ? (
            <div className="rounded-lg border border-border">
              <ul className="divide-y divide-border">
                {version.attachments.map((attachment) => (
                  <li
                    key={`${attachment.sha256}:${attachment.originalName}`}
                    className="flex items-center justify-between gap-2 px-4 py-3 text-sm"
                  >
                    <span className="min-w-0 break-all text-foreground">
                      {attachment.originalName}
                    </span>
                    <span className="shrink-0 text-muted-foreground">
                      {attachment.size} B
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">没有附件。</p>
          )}
        </div>
      </ContentVersionView>
    </div>
  )
}

export { SkillVersionView }
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd /Users/liyang/Documents/code/github/Synapse/desktop && npx tsc --noEmit 2>&1 | head -30`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add desktop/src/modules/skills/components/skill-version-view.tsx
git commit -m "feat(skills): show description block in skill detail body"
```

---

### Task 6: Manual verification

- [ ] **Step 1: Start dev server**

Run: `cd /Users/liyang/Documents/code/github/Synapse && pnpm dev`

- [ ] **Step 2: Test creating a new skill with usage**

1. Open Synapse desktop app
2. Navigate to Skills tab
3. Click "新建 Skill"
4. Fill in all fields including the new "使用说明" field
5. Verify the field appears between 分类 and 简介
6. Save the skill

- [ ] **Step 3: Test viewing the skill detail**

1. Click the newly created skill to open detail modal
2. Verify header shows the usage text (not description)
3. Verify scrollable body shows: description block (gray bg, "description" label) → markdown content → attachments

- [ ] **Step 4: Test empty usage state**

1. Create or edit a skill with empty usage field
2. Open detail modal
3. Verify header shows "暂无使用说明" in gray

- [ ] **Step 5: Test empty description state**

1. This shouldn't happen (description is required), but verify the description block in body gracefully hides if somehow empty

- [ ] **Step 6: Test existing skills (backward compatibility)**

1. Open an existing skill that was created before this change
2. Verify header shows "暂无使用说明" (since old skills have no usage)
3. Verify description still appears in the body block
4. Edit the skill, add usage, save
5. Verify header now shows the usage text

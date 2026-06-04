# Default Quick Inputs Seeding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Seed six built-in `片段` entries for users whose quick input list is empty, without touching users who already have snippets or re-adding snippets after deletion.

**Architecture:** Keep the behavior in the shared config layer so Settings, Agent composer, config import/export, and tests see one normalized config shape. Add stable built-in quick input constants, add `defaultQuickInputsSeededVersion`, and run a version-gated seed check during global config normalization.

**Tech Stack:** TypeScript, React renderer config utilities, Electron config backup service, Vitest.

---

## File Structure

- Modify `desktop/src/types/config.ts`: add `defaultQuickInputsSeededVersion` to `SynapseGlobalConfig`.
- Modify `desktop/src/constants/defaults.ts`: replace the empty default quick input list with stable built-in quick inputs and add the default seed version field.
- Create `desktop/src/lib/app-version.ts`: expose the current desktop app version from `desktop/package.json`.
- Modify `desktop/src/lib/config.ts`: normalize the seed version and apply version-gated default quick input seeding.
- Modify `desktop/src/lib/__tests__/config.test.ts`: cover default seeding, preservation, version guard, and deletion guard.
- Modify `desktop/electron/services/config-backup-service.ts`: preserve and validate `defaultQuickInputsSeededVersion` during backup import/export.
- Modify `desktop/electron/services/__tests__/config-backup-service.test.ts`: cover import/export of the seed version.
- Modify `RELEASE_NOTES_PENDING.md`: add one user-facing note.

## Implementation Tasks

### Task 1: Add Built-In Quick Input Defaults And Seed Version Type

**Files:**
- Modify: `desktop/src/types/config.ts`
- Modify: `desktop/src/constants/defaults.ts`
- Create: `desktop/src/lib/app-version.ts`
- Test: `desktop/src/lib/__tests__/config.test.ts`

- [ ] **Step 1: Write the failing config default test**

Add these imports near the top of `desktop/src/lib/__tests__/config.test.ts`:

```ts
import { SYNAPSE_APP_VERSION } from "../app-version"
import { DEFAULT_QUICK_INPUTS } from "../../constants/defaults"
```

Replace the existing test named `defaults quick inputs to an empty list` with:

```ts
  it("seeds built-in quick inputs in a default config", () => {
    const config = createDefaultConfig()

    expect(config.global.defaultQuickInputsSeededVersion).toBe(SYNAPSE_APP_VERSION)
    expect(config.global.quickInputs).toEqual(DEFAULT_QUICK_INPUTS)
    expect(config.global.quickInputs).toHaveLength(6)
    expect(config.global.quickInputs.every((item) => item.directSend)).toBe(true)
  })
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/lib/__tests__/config.test.ts -t "seeds built-in quick inputs"
```

Expected: FAIL because `SYNAPSE_APP_VERSION` and `defaultQuickInputsSeededVersion` do not exist, and `DEFAULT_QUICK_INPUTS` is still empty.

- [ ] **Step 3: Add the app version helper**

Create `desktop/src/lib/app-version.ts`:

```ts
import desktopPackage from "../../package.json"

export const SYNAPSE_APP_VERSION = desktopPackage.version
```

- [ ] **Step 4: Extend config types**

In `desktop/src/types/config.ts`, update `SynapseGlobalConfig`:

```ts
export type SynapseGlobalConfig = {
  themeMode: SynapseThemeMode
  projects: SynapseProjectConfig[]
  quickInputs: SynapseQuickInput[]
  defaultQuickInputsSeededVersion: string | null
  favorites: SynapseFavorites
  recentlyViewed: SynapseRecentlyViewed
  contentSortOrder: SynapseContentSortOrder
}
```

- [ ] **Step 5: Add stable built-in defaults**

In `desktop/src/constants/defaults.ts`, import the app version:

```ts
import { SYNAPSE_APP_VERSION } from "../lib/app-version"
```

Replace `DEFAULT_QUICK_INPUTS` with:

```ts
export const DEFAULT_QUICK_INPUTS = [
  {
    id: "builtin-quick-input-sort",
    content: "帮我捋一下\n把这里的信息重新整理一下，重点放在结论、分歧和下一步。",
    directSend: true,
  },
  {
    id: "builtin-quick-input-conclusion",
    content: "给个结论\n先说结论，再用几条要点说明理由。",
    directSend: true,
  },
  {
    id: "builtin-quick-input-problems",
    content: "哪里有问题\n帮我挑一下毛病，重点看不清楚、不完整、前后打架的地方。",
    directSend: true,
  },
  {
    id: "builtin-quick-input-formal-doc",
    content: "改得像正式文档\n保持原意，把表达改得更清楚、更克制、更适合放进文档。",
    directSend: true,
  },
  {
    id: "builtin-quick-input-todos",
    content: "整理成待办\n拆成可执行的待办事项，按优先级排一下。",
    directSend: true,
  },
  {
    id: "builtin-quick-input-desktop-md",
    content: "存到桌面\n整理成一份 Markdown 文件，保存到我的桌面。",
    directSend: true,
  },
] as const satisfies SynapseQuickInput[]
```

Update `DEFAULT_GLOBAL_CONFIG`:

```ts
export const DEFAULT_GLOBAL_CONFIG: SynapseGlobalConfig = {
  themeMode: DEFAULT_THEME_MODE,
  projects: [],
  quickInputs: DEFAULT_QUICK_INPUTS,
  defaultQuickInputsSeededVersion: SYNAPSE_APP_VERSION,
  favorites: DEFAULT_FAVORITES,
  recentlyViewed: DEFAULT_RECENTLY_VIEWED,
  contentSortOrder: DEFAULT_CONTENT_SORT_ORDER,
}
```

- [ ] **Step 6: Run the focused test**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/lib/__tests__/config.test.ts -t "seeds built-in quick inputs"
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add desktop/src/types/config.ts desktop/src/constants/defaults.ts desktop/src/lib/app-version.ts desktop/src/lib/__tests__/config.test.ts
git commit -m "feat(settings): add built-in quick input defaults"
```

### Task 2: Implement Version-Gated Seeding During Config Normalization

**Files:**
- Modify: `desktop/src/lib/config.ts`
- Test: `desktop/src/lib/__tests__/config.test.ts`

- [ ] **Step 1: Write failing normalization tests**

Append these tests inside `describe("Synapse quick inputs config", () => { ... })` in `desktop/src/lib/__tests__/config.test.ts`:

```ts
  it("seeds built-in quick inputs for an empty legacy config", () => {
    const config = sanitizeSynapseConfig({
      activeRepoUuid: null,
      repositories: [],
      global: {
        themeMode: "light",
        projects: [],
        quickInputs: [],
      },
    })

    expect(config.global.defaultQuickInputsSeededVersion).toBe(SYNAPSE_APP_VERSION)
    expect(config.global.quickInputs).toEqual(DEFAULT_QUICK_INPUTS)
  })

  it("does not add built-in quick inputs when user snippets already exist", () => {
    const config = sanitizeSynapseConfig({
      activeRepoUuid: null,
      repositories: [],
      global: {
        themeMode: "light",
        projects: [],
        quickInputs: [
          { id: "quick-1", content: "用户自己的片段", directSend: true },
        ],
      },
    })

    expect(config.global.defaultQuickInputsSeededVersion).toBe(SYNAPSE_APP_VERSION)
    expect(config.global.quickInputs).toEqual([
      { id: "quick-1", content: "用户自己的片段", directSend: true },
    ])
  })

  it("does not re-add defaults after the current version already ran the seed check", () => {
    const config = sanitizeSynapseConfig({
      activeRepoUuid: null,
      repositories: [],
      global: {
        themeMode: "light",
        projects: [],
        quickInputs: [],
        defaultQuickInputsSeededVersion: SYNAPSE_APP_VERSION,
      },
    })

    expect(config.global.defaultQuickInputsSeededVersion).toBe(SYNAPSE_APP_VERSION)
    expect(config.global.quickInputs).toEqual([])
  })

  it("records the current seed version without replacing existing snippets from older versions", () => {
    const config = sanitizeSynapseConfig({
      activeRepoUuid: null,
      repositories: [],
      global: {
        themeMode: "light",
        projects: [],
        quickInputs: [
          { id: "quick-1", content: "保留我", directSend: false },
        ],
        defaultQuickInputsSeededVersion: "0.2.238",
      },
    })

    expect(config.global.defaultQuickInputsSeededVersion).toBe(SYNAPSE_APP_VERSION)
    expect(config.global.quickInputs).toEqual([
      { id: "quick-1", content: "保留我", directSend: false },
    ])
  })
```

Update existing quick input tests that construct legacy configs without `defaultQuickInputsSeededVersion` and expect user snippets to remain unchanged. Those expectations should also assert:

```ts
expect(config.global.defaultQuickInputsSeededVersion).toBe(SYNAPSE_APP_VERSION)
```

- [ ] **Step 2: Run tests to verify failures**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/lib/__tests__/config.test.ts
```

Expected: FAIL because normalization does not yet preserve or calculate `defaultQuickInputsSeededVersion`.

- [ ] **Step 3: Implement the seed helper**

In `desktop/src/lib/config.ts`, import the app version:

```ts
import { SYNAPSE_APP_VERSION } from "./app-version"
```

Add this helper near `normalizeQuickInputs`:

```ts
function normalizeQuickInputSeededVersion(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null
}

function applyDefaultQuickInputSeed(
  quickInputs: SynapseQuickInput[],
  seededVersion: string | null,
): { quickInputs: SynapseQuickInput[]; seededVersion: string } {
  if (seededVersion === SYNAPSE_APP_VERSION) {
    return {
      quickInputs,
      seededVersion: SYNAPSE_APP_VERSION,
    }
  }

  return {
    quickInputs: quickInputs.length === 0 ? structuredClone(DEFAULT_QUICK_INPUTS) : quickInputs,
    seededVersion: SYNAPSE_APP_VERSION,
  }
}
```

- [ ] **Step 4: Use the seed helper in global config normalization**

Replace `normalizeGlobalConfig` with:

```ts
function normalizeGlobalConfig(value: unknown): SynapseGlobalConfig {
  if (!isRecord(value)) {
    return structuredClone(DEFAULT_GLOBAL_CONFIG)
  }

  const seeded = applyDefaultQuickInputSeed(
    normalizeQuickInputs(value.quickInputs),
    normalizeQuickInputSeededVersion(value.defaultQuickInputsSeededVersion),
  )

  return {
    themeMode: normalizeThemeMode(value.themeMode, DEFAULT_THEME_MODE),
    projects: normalizeProjects(value.projects),
    quickInputs: seeded.quickInputs,
    defaultQuickInputsSeededVersion: seeded.seededVersion,
    favorites: normalizeFavorites(value.favorites),
    recentlyViewed: normalizeRecentlyViewed(value.recentlyViewed),
    contentSortOrder: isSynapseContentSortOrder(value.contentSortOrder)
      ? value.contentSortOrder
      : DEFAULT_CONTENT_SORT_ORDER,
  }
}
```

- [ ] **Step 5: Run config tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/lib/__tests__/config.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add desktop/src/lib/config.ts desktop/src/lib/__tests__/config.test.ts
git commit -m "feat(settings): seed default quick inputs once per version"
```

### Task 3: Preserve Seed Version In Config Backup Import And Export

**Files:**
- Modify: `desktop/electron/services/config-backup-service.ts`
- Test: `desktop/electron/services/__tests__/config-backup-service.test.ts`

- [ ] **Step 1: Write failing backup tests**

Add an import in `desktop/electron/services/__tests__/config-backup-service.test.ts`:

```ts
import { SYNAPSE_APP_VERSION } from "../../../src/lib/app-version"
```

In the successful import test that asserts `configStore.replace`, add this expectation inside `global: expect.objectContaining({ ... })`:

```ts
defaultQuickInputsSeededVersion: "0.2.238",
```

Change that test's `writeBackupFile` call to pass:

```ts
defaultQuickInputsSeededVersion: "0.2.238",
```

Add a focused export assertion to `preserves configured quick inputs in export payloads`:

```ts
expect(backup.config.global.defaultQuickInputsSeededVersion).toBe(SYNAPSE_APP_VERSION)
```

Add this test near the malformed quick input test:

```ts
  it("rejects malformed quick input seed versions when importing a backup", async () => {
    const filePath = await writeBackupFile({
      defaultQuickInputsSeededVersion: 123,
    })

    try {
      await expect(configBackupService.readImport(filePath)).rejects.toThrow(
        "config.global.defaultQuickInputsSeededVersion 必须是字符串或 null。",
      )
      expect(configStore.replace).not.toHaveBeenCalled()
    } finally {
      await rm(path.dirname(filePath), { recursive: true, force: true })
    }
  })
```

- [ ] **Step 2: Run focused backup tests to verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/config-backup-service.test.ts -t "quick input"
```

Expected: FAIL because backup validation/export does not yet include `defaultQuickInputsSeededVersion`.

- [ ] **Step 3: Validate the seed version field**

In `desktop/electron/services/config-backup-service.ts`, add this helper near `validateQuickInputs`:

```ts
function validateQuickInputSeededVersion(rawValue: unknown, errors: string[]): string | null {
  if (rawValue === undefined || rawValue === null) {
    return null
  }

  if (typeof rawValue !== "string") {
    errors.push("config.global.defaultQuickInputsSeededVersion 必须是字符串或 null。")
    return null
  }

  const normalized = rawValue.trim()
  return normalized.length > 0 ? normalized : null
}
```

Inside `validateConfigBackupPayload`, after `const quickInputs = validateQuickInputs(global.quickInputs, errors)`, add:

```ts
  const defaultQuickInputsSeededVersion = validateQuickInputSeededVersion(
    global.defaultQuickInputsSeededVersion,
    errors,
  )
```

Include it in the returned `global` object:

```ts
      defaultQuickInputsSeededVersion,
```

- [ ] **Step 4: Update test backup helper**

In `createBackup` inside `desktop/electron/services/__tests__/config-backup-service.test.ts`, add a default seed field to `globalConfig`:

```ts
    defaultQuickInputsSeededVersion: null,
```

- [ ] **Step 5: Run backup tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/config-backup-service.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add desktop/electron/services/config-backup-service.ts desktop/electron/services/__tests__/config-backup-service.test.ts
git commit -m "fix(settings): preserve quick input seed version in backups"
```

### Task 4: Release Note And Final Verification

**Files:**
- Modify: `RELEASE_NOTES_PENDING.md`

- [ ] **Step 1: Add the release note**

Add one bullet under the current pending notes section in `RELEASE_NOTES_PENDING.md`:

```md
- 片段为空的用户会自动获得一组内置常用片段，方便整理讨论、总结结论、检查问题和保存 Markdown 文档；已有片段的用户不会被覆盖或追加。
```

- [ ] **Step 2: Run targeted tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/lib/__tests__/config.test.ts electron/services/__tests__/config-backup-service.test.ts
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

- [ ] **Step 5: Review diff**

Run:

```bash
git diff --stat
git diff -- desktop/src/types/config.ts desktop/src/constants/defaults.ts desktop/src/lib/app-version.ts desktop/src/lib/config.ts desktop/electron/services/config-backup-service.ts RELEASE_NOTES_PENDING.md
```

Expected: Only config defaults, seeding logic, backup preservation, tests, and release note changed. No UI styling changes.

- [ ] **Step 6: Commit**

```bash
git add RELEASE_NOTES_PENDING.md
git commit -m "docs: note default quick input snippets"
```

## Plan Self-Review

- Spec coverage: built-in content, `directSend: true`, empty-list-only append, no replacement of existing snippets, version-gated duplicate prevention, backup preservation, tests, and release note are covered.
- Deferred-marker scan: none remain.
- Type consistency: the field is consistently named `defaultQuickInputsSeededVersion`; app version constant is consistently `SYNAPSE_APP_VERSION`; built-in list is consistently `DEFAULT_QUICK_INPUTS`.

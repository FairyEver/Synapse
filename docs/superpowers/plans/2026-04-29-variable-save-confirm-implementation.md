# Variable Save Confirmation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the confusing inline save switch with a second confirmation dialog that can save new variables and update changed existing variables.

**Architecture:** Keep substitution values and persistence decisions separate. Add pure repository-variable diff helpers, keep the first dialog focused on replacement values, add a second dialog for save decisions, and wire both through the existing install flow.

**Tech Stack:** Electron, React, TypeScript, Vitest, shadcn/ui, Tailwind token classes.

---

## File Structure

- Modify `desktop/src/modules/content/lib/repository-variables.ts`
  - Compute new and updated repository-local variables.
  - Build a config patch from those computed changes.
- Modify `desktop/src/modules/content/lib/__tests__/repository-variables.test.ts`
  - Cover new variables, changed existing variables, empty values, unchanged existing variables, and case-insensitive matching.
- Modify `desktop/src/modules/content/components/variable-substitution-dialog.tsx`
  - Remove the save switch and `saveToRepo` state.
  - Keep existing prefill behavior.
- Create `desktop/src/modules/content/components/variable-save-confirmation-dialog.tsx`
  - Render new and updated variable names.
  - Provide `仅本次使用` and `保存并继续` actions.
- Modify `desktop/src/modules/content/components/content-install-dialog.tsx`
  - Store pending variable change set after substitution.
  - Show the second dialog only when there are changes to save.
  - Continue installation whether variables are saved or not.

## Task 1: Repository Variable Change Helpers

**Files:**
- Modify: `desktop/src/modules/content/lib/repository-variables.ts`
- Modify: `desktop/src/modules/content/lib/__tests__/repository-variables.test.ts`

- [ ] **Step 1: Replace the repository variable tests with behavior for new and updated variables**

Use this complete test file:

```ts
import { describe, expect, it } from "vitest"

import {
  buildRepositoryVariableChangeSet,
  buildRepositoryVariablesPatch,
  hasRepositoryVariableChanges,
} from "../repository-variables"
import type { SynapseRepositoryConfig } from "@/types/config"

const repository: SynapseRepositoryConfig = {
  uuid: "repo-1",
  name: "Main",
  localPath: "/repo",
  contentDirs: {},
  variables: [
    { name: "TOKEN", value: "old", description: "Existing token" },
    { name: "UNCHANGED", value: "same" },
  ],
}

describe("repository variable change helpers", () => {
  it("detects new and updated variables from submitted substitutions", () => {
    const changeSet = buildRepositoryVariableChangeSet(repository, {
      token: "new",
      API_URL: "https://example.test",
      EMPTY: "",
      UNCHANGED: "same",
    })

    expect(changeSet).toEqual({
      newVariables: [
        { name: "API_URL", value: "https://example.test" },
      ],
      updatedVariables: [
        { name: "TOKEN", value: "new", description: "Existing token" },
      ],
    })
    expect(hasRepositoryVariableChanges(changeSet)).toBe(true)
  })

  it("ignores empty values and unchanged existing values", () => {
    const changeSet = buildRepositoryVariableChangeSet(repository, {
      EMPTY: "",
      unchanged: "same",
    })

    expect(changeSet).toEqual({
      newVariables: [],
      updatedVariables: [],
    })
    expect(hasRepositoryVariableChanges(changeSet)).toBe(false)
  })

  it("builds a patch that appends new variables and updates existing variables", () => {
    const changeSet = buildRepositoryVariableChangeSet(repository, {
      token: "new",
      API_URL: "https://example.test",
    })

    expect(buildRepositoryVariablesPatch(repository, changeSet)).toEqual({
      variables: [
        { name: "TOKEN", value: "new", description: "Existing token" },
        { name: "UNCHANGED", value: "same" },
        { name: "API_URL", value: "https://example.test" },
      ],
    })
  })

  it("returns null when there are no changes to persist", () => {
    const changeSet = buildRepositoryVariableChangeSet(repository, {
      TOKEN: "old",
      UNCHANGED: "same",
    })

    expect(buildRepositoryVariablesPatch(repository, changeSet)).toBeNull()
  })
})
```

- [ ] **Step 2: Run the focused test and verify it fails before implementation**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/src/modules/content/lib/__tests__/repository-variables.test.ts
```

Expected: FAIL because `buildRepositoryVariableChangeSet` and `hasRepositoryVariableChanges` are not exported yet, and `buildRepositoryVariablesPatch` still accepts substitutions directly.

- [ ] **Step 3: Implement the repository variable helpers**

Replace `desktop/src/modules/content/lib/repository-variables.ts` with:

```ts
import type { SynapseRepositoryConfig, SynapseVariable } from "@/types/config"

type RepositoryVariableChangeSet = {
  newVariables: SynapseVariable[]
  updatedVariables: SynapseVariable[]
}

function findVariable(
  name: string,
  variables: SynapseVariable[],
): SynapseVariable | undefined {
  const normalizedName = name.toLowerCase()

  return variables.find((variable) => variable.name.toLowerCase() === normalizedName)
}

function buildRepositoryVariableChangeSet(
  repository: SynapseRepositoryConfig,
  substitutions: Record<string, string>,
): RepositoryVariableChangeSet {
  const existingVariables = repository.variables ?? []
  const newVariables: SynapseVariable[] = []
  const updatedVariables: SynapseVariable[] = []

  for (const [name, value] of Object.entries(substitutions)) {
    if (!value) continue

    const existing = findVariable(name, existingVariables)

    if (!existing) {
      newVariables.push({ name, value })
      continue
    }

    if (existing.value !== value) {
      updatedVariables.push({ ...existing, value })
    }
  }

  return { newVariables, updatedVariables }
}

function hasRepositoryVariableChanges(changeSet: RepositoryVariableChangeSet): boolean {
  return changeSet.newVariables.length > 0 || changeSet.updatedVariables.length > 0
}

function buildRepositoryVariablesPatch(
  repository: SynapseRepositoryConfig,
  changeSet: RepositoryVariableChangeSet,
): Pick<SynapseRepositoryConfig, "variables"> | null {
  if (!hasRepositoryVariableChanges(changeSet)) {
    return null
  }

  const updatedByName = new Map(
    changeSet.updatedVariables.map((variable) => [
      variable.name.toLowerCase(),
      variable,
    ]),
  )
  const existingVariables = repository.variables ?? []
  const nextExistingVariables = existingVariables.map((variable) =>
    updatedByName.get(variable.name.toLowerCase()) ?? variable,
  )

  return {
    variables: [...nextExistingVariables, ...changeSet.newVariables],
  }
}

export {
  buildRepositoryVariableChangeSet,
  buildRepositoryVariablesPatch,
  hasRepositoryVariableChanges,
}
export type { RepositoryVariableChangeSet }
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/src/modules/content/lib/__tests__/repository-variables.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

```bash
git add desktop/src/modules/content/lib/repository-variables.ts desktop/src/modules/content/lib/__tests__/repository-variables.test.ts
git commit -m "test: cover variable save changes"
```

## Task 2: Variable Save Confirmation Dialog

**Files:**
- Create: `desktop/src/modules/content/components/variable-save-confirmation-dialog.tsx`

- [ ] **Step 1: Create the confirmation dialog component**

Create `desktop/src/modules/content/components/variable-save-confirmation-dialog.tsx`:

```tsx
import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { FormDialog } from "@/components/form-dialog"
import type { RepositoryVariableChangeSet } from "@/modules/content/lib/repository-variables"
import type { SynapseVariable } from "@/types/config"

type VariableSaveConfirmationDialogProps = {
  changes: RepositoryVariableChangeSet | null
  isSubmitting: boolean
  onOpenChange: (open: boolean) => void
  onSave: () => Promise<void> | void
  onSkip: () => Promise<void> | void
  open: boolean
}

type VariableSectionProps = {
  label: string
  variables: SynapseVariable[]
}

function VariableSection({ label, variables }: VariableSectionProps) {
  if (variables.length === 0) {
    return null
  }

  return (
    <div className="flex flex-col gap-2">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <ul className="flex flex-col gap-1">
        {variables.map((variable) => (
          <li key={variable.name} className="font-mono text-sm">
            {variable.name}
          </li>
        ))}
      </ul>
    </div>
  )
}

function VariableSaveConfirmationDialog({
  changes,
  isSubmitting,
  onOpenChange,
  onSave,
  onSkip,
  open,
}: VariableSaveConfirmationDialogProps) {
  const newVariables = changes?.newVariables ?? []
  const updatedVariables = changes?.updatedVariables ?? []
  const hasBothSections = newVariables.length > 0 && updatedVariables.length > 0

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!isSubmitting) onOpenChange(next)
      }}
    >
      <FormDialog
        title="保存变量变更"
        description="这些变量可在当前仓库复用。"
        footer={
          <>
            <Button
              type="button"
              variant="outline"
              disabled={isSubmitting}
              onClick={() => { void onSkip() }}
            >
              仅本次使用
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting}
            >
              {isSubmitting ? "保存中..." : "保存并继续"}
            </Button>
          </>
        }
        onSubmit={(event) => {
          event.preventDefault()
          void onSave()
        }}
      >
        <div className="flex flex-col gap-2">
          <VariableSection label="新增变量" variables={newVariables} />
          {hasBothSections ? <Separator /> : null}
          <VariableSection label="更新变量" variables={updatedVariables} />
        </div>
      </FormDialog>
    </Dialog>
  )
}

export { VariableSaveConfirmationDialog }
```

- [ ] **Step 2: Run TypeScript to catch component contract errors**

Run:

```bash
pnpm desktop:typecheck
```

Expected: PASS. The file is included by the TypeScript project even before it is imported elsewhere.

- [ ] **Step 3: Commit Task 2**

```bash
git add desktop/src/modules/content/components/variable-save-confirmation-dialog.tsx
git commit -m "feat: add variable save confirmation dialog"
```

## Task 3: Simplify Variable Substitution Dialog

**Files:**
- Modify: `desktop/src/modules/content/components/variable-substitution-dialog.tsx`

- [ ] **Step 1: Remove the save switch contract**

Make these changes in `desktop/src/modules/content/components/variable-substitution-dialog.tsx`:

```tsx
type VariableSubstitutionDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  placeholders: string[]
  repositoryVariables: SynapseVariable[]
  onConfirm: (substitutions: Record<string, string>) => Promise<void> | void
}
```

Remove these imports and props:

```tsx
import { Switch } from "@/components/ui/switch"
```

```tsx
repositoryUuid: string | null
```

Remove this state:

```tsx
const [saveToRepo, setSaveToRepo] = useState(false)
```

Remove this reset line:

```tsx
setSaveToRepo(false)
```

Change submit handling to:

```tsx
await onConfirm(values)
```

Change the callback dependencies to:

```tsx
}, [isSubmitting, onConfirm, values])
```

- [ ] **Step 2: Replace the footer with a single primary action**

Replace the footer JSX with:

```tsx
footer={
  <Button type="submit" disabled={isSubmitting}>
    {isSubmitting ? "安装中..." : "继续安装"}
  </Button>
}
```

Keep the dialog description as:

```tsx
description="留空则保留原文。"
```

- [ ] **Step 3: Run TypeScript and expect the parent component to fail**

Run:

```bash
pnpm desktop:typecheck
```

Expected: FAIL in `content-install-dialog.tsx` because it still passes `repositoryUuid` and an `onConfirm` handler with the old `saveToRepo` argument.

- [ ] **Step 4: Commit Task 3 after Task 4 is complete**

Do not commit yet if the repository does not typecheck. Stage and commit this file together with Task 4.

## Task 4: Wire the Two-Step Install Flow

**Files:**
- Modify: `desktop/src/modules/content/components/content-install-dialog.tsx`

- [ ] **Step 1: Update imports**

Change the repository variable import to:

```ts
import {
  buildRepositoryVariableChangeSet,
  buildRepositoryVariablesPatch,
  hasRepositoryVariableChanges,
  type RepositoryVariableChangeSet,
} from "@/modules/content/lib/repository-variables"
```

Add:

```ts
import { VariableSaveConfirmationDialog } from "./variable-save-confirmation-dialog"
```

- [ ] **Step 2: Add save confirmation state**

Near the existing variable dialog state, add:

```ts
const [isVariableSaveConfirmOpen, setIsVariableSaveConfirmOpen] = useState(false)
const [pendingVariableChanges, setPendingVariableChanges] =
  useState<RepositoryVariableChangeSet | null>(null)
const [isSavingVariables, setIsSavingVariables] = useState(false)
```

In the `useEffect` that resets install dialog state when opened, add:

```ts
setIsVariableSaveConfirmOpen(false)
setPendingVariableChanges(null)
setIsSavingVariables(false)
```

- [ ] **Step 3: Add a helper that closes variable save confirmation and continues installation**

Add this helper before `handleVariableConfirm`:

```ts
const continueInstallAfterVariableSaveDecision = async () => {
  setIsVariableSaveConfirmOpen(false)
  setPendingVariableChanges(null)
  await handleInstall()
}
```

This helper references `handleInstall`, which is a function declaration in the same component and is safe to call before its textual declaration.

- [ ] **Step 4: Replace the variable confirm handler**

Replace `handleVariableConfirm` with:

```ts
const handleVariableConfirm = async (
  substitutions: Record<string, string>,
) => {
  const filtered = Object.fromEntries(
    Object.entries(substitutions).filter(([, v]) => v.length > 0),
  )
  pendingSubstitutionsRef.current = Object.keys(filtered).length > 0 ? filtered : undefined
  variableConfirmPassedRef.current = true

  if (activeRepository) {
    const changes = buildRepositoryVariableChangeSet(activeRepository, substitutions)

    if (hasRepositoryVariableChanges(changes)) {
      setPendingVariableChanges(changes)
      setIsVariableConfirmOpen(false)
      setIsVariableSaveConfirmOpen(true)
      return
    }
  }

  setIsVariableConfirmOpen(false)
  await handleInstall()
}
```

- [ ] **Step 5: Add save and skip handlers**

Add these handlers after `handleVariableConfirm`:

```ts
const handleSkipVariableSave = async () => {
  await continueInstallAfterVariableSaveDecision()
}

const handleSaveVariableChanges = async () => {
  if (isSavingVariables) {
    return
  }

  setIsSavingVariables(true)
  try {
    if (activeRepository && pendingVariableChanges) {
      const patch = buildRepositoryVariablesPatch(activeRepository, pendingVariableChanges)
      if (patch) {
        await updateRepository(activeRepository.uuid, patch)
      }
    }
  } catch (error) {
    logger.warn("Failed to save variables to repository.", { error })
    warning("变量未保存，安装会继续。")
  } finally {
    setIsSavingVariables(false)
  }

  await continueInstallAfterVariableSaveDecision()
}
```

- [ ] **Step 6: Render the new confirmation dialog**

Render this immediately after `VariableSubstitutionDialog`:

```tsx
<VariableSaveConfirmationDialog
  changes={pendingVariableChanges}
  isSubmitting={isSavingVariables}
  onOpenChange={(next) => {
    if (!next) {
      setPendingVariableChanges(null)
      variableConfirmPassedRef.current = false
    }
    setIsVariableSaveConfirmOpen(next)
  }}
  onSave={handleSaveVariableChanges}
  onSkip={handleSkipVariableSave}
  open={isVariableSaveConfirmOpen}
/>
```

- [ ] **Step 7: Update the substitution dialog usage**

Change the existing `VariableSubstitutionDialog` props to:

```tsx
<VariableSubstitutionDialog
  open={isVariableConfirmOpen}
  onOpenChange={(next) => {
    if (!next) {
      variableConfirmPassedRef.current = false
    }
    setIsVariableConfirmOpen(next)
  }}
  placeholders={detectedPlaceholders}
  repositoryVariables={activeRepository?.variables ?? []}
  onConfirm={handleVariableConfirm}
/>
```

- [ ] **Step 8: Run the focused test and typecheck**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/src/modules/content/lib/__tests__/repository-variables.test.ts
pnpm desktop:typecheck
```

Expected: both commands PASS.

- [ ] **Step 9: Commit Tasks 3 and 4 together**

```bash
git add desktop/src/modules/content/components/variable-substitution-dialog.tsx desktop/src/modules/content/components/variable-save-confirmation-dialog.tsx desktop/src/modules/content/components/content-install-dialog.tsx
git commit -m "feat: confirm variable persistence during install"
```

## Task 5: Final Verification

**Files:**
- No new source files.

- [ ] **Step 1: Run the focused variable tests**

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/src/modules/content/lib/__tests__/repository-variables.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run the desktop test suite**

```bash
pnpm desktop:test
```

Expected: PASS.

- [ ] **Step 3: Run typecheck**

```bash
pnpm desktop:typecheck
```

Expected: PASS.

- [ ] **Step 4: Run hard constraints**

```bash
pnpm desktop:check:hard-constraints
```

Expected: PASS.

- [ ] **Step 5: Inspect final diff**

```bash
git diff --stat HEAD
git diff HEAD -- desktop/src/modules/content/lib/repository-variables.ts desktop/src/modules/content/components/variable-substitution-dialog.tsx desktop/src/modules/content/components/variable-save-confirmation-dialog.tsx desktop/src/modules/content/components/content-install-dialog.tsx
```

Expected: diff only covers repository variable helpers, the substitution dialog, the new save confirmation dialog, and install flow wiring.

## Self-Review

- Spec coverage: The plan removes the inline switch, prefill stays in the first dialog, new and updated variables are detected, empty and unchanged values are ignored, save and skip paths continue installation, and save failure remains non-blocking.
- Placeholder scan: The plan has no unresolved placeholder markers.
- Type consistency: `RepositoryVariableChangeSet`, `newVariables`, `updatedVariables`, `buildRepositoryVariableChangeSet`, `buildRepositoryVariablesPatch`, and `hasRepositoryVariableChanges` are named consistently across tests, UI, and wiring.

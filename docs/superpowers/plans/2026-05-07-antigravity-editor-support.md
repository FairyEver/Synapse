# Antigravity Editor Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Google Antigravity as a supported editor in Synapse, enabling rule/skill installation and MCP configuration management.

**Architecture:** Follow the existing editor adapter pattern — create a self-contained definition module at `src/definitions/editor/antigravity/` with adapter, install strategy, scan strategy, and MCP definition, then register in both renderer and main process registries.

**Tech Stack:** TypeScript, Node.js path/fs APIs, existing shared modules (shared-rule-section, shared-skill-directory, shared-rule-scanners, editor-adapters/utils)

---

### Task 1: Create editor definition and icon

**Files:**
- Create: `desktop/src/definitions/editor/antigravity/icon.png`
- Create: `desktop/src/definitions/editor/antigravity/editor.ts`

- [ ] **Step 1: Copy icon file**

```bash
cp /Users/liyang/Desktop/antigravity.png desktop/src/definitions/editor/antigravity/icon.png
```

- [ ] **Step 2: Create editor.ts**

```ts
import antigravityIcon from "./icon.png"
import type { SynapseEditorDefinition } from "../../types"

export const editorDefinition = {
  id: "antigravity",
  label: "Antigravity",
  order: 50,
  icon: antigravityIcon,
  supportsGlobal: true,
  supportsProject: true,
  supportedContentTypes: ["rule", "skill"],
} as const satisfies SynapseEditorDefinition
```

- [ ] **Step 3: Commit**

```bash
git add desktop/src/definitions/editor/antigravity/icon.png desktop/src/definitions/editor/antigravity/editor.ts
git commit -m "feat(editor): add Antigravity editor definition and icon"
```

---

### Task 2: Create MCP definition

**Files:**
- Create: `desktop/src/definitions/editor/antigravity/mcp.ts`

- [ ] **Step 1: Create mcp.ts**

```ts
import type { SynapseMcpDefinition } from "../../types"

export const mcpDefinition = {
  target: "antigravity",
  label: "Antigravity",
  order: 50,
  settingsPathSegments: [".gemini", "antigravity", "mcp_config.json"],
  settingsFormat: "json-mcp-servers",
} as const satisfies SynapseMcpDefinition
```

- [ ] **Step 2: Commit**

```bash
git add desktop/src/definitions/editor/antigravity/mcp.ts
git commit -m "feat(editor): add Antigravity MCP definition"
```

---

### Task 3: Create adapter

**Files:**
- Create: `desktop/src/definitions/editor/antigravity/adapter.ts`

- [ ] **Step 1: Create adapter.ts**

```ts
import path from "node:path"
import type { EditorAdapter } from "../../main-types"
import { resolveSkillSlug } from "../../../../electron/services/editor-adapters/skill-slug"
import { checkSkillNameConflict } from "../../../../electron/services/editor-adapters/skill-identity"
import {
  createConflictTarget,
  createReadyTarget,
  createUnavailableTarget,
  createUnsupportedPlatformTarget,
  getHomePath,
  isSupportedEditorPlatform,
  pathExists,
  resolveExistingProjectPath,
  toSynapseRuleName,
} from "../../../../electron/services/editor-adapters/utils"

function resolveAntigravityHomePath(): string {
  return getHomePath(".gemini", "antigravity")
}

const antigravityAdapter: EditorAdapter = {
  id: "antigravity",
  label: "Antigravity",
  supportsGlobal: true,
  supportsProject: true,
  supportedContentTypes: ["rule", "skill"],
  resolveGlobalDirectoryPaths() {
    return {
      rulesPath: getHomePath(".gemini", "GEMINI.md"),
      skillsPath: path.join(resolveAntigravityHomePath(), "skills"),
    }
  },
  async resolveGlobalTarget({ contentId, contentType, skillName, skillTitle }) {
    if (!isSupportedEditorPlatform()) {
      return createUnsupportedPlatformTarget({
        adapter: antigravityAdapter,
        contentType,
        scope: "global",
      })
    }

    const antigravityHomePath = resolveAntigravityHomePath()

    if (!(await pathExists(antigravityHomePath))) {
      return createUnavailableTarget({
        adapter: antigravityAdapter,
        contentType,
        message: "未检测到 Antigravity 的用户目录，暂时不能解析全局安装位置。",
        scope: "global",
      })
    }

    switch (contentType) {
      case "rule":
        return createReadyTarget({
          adapter: antigravityAdapter,
          contentType,
          scope: "global",
          targetKind: "file",
          targetPath: getHomePath(".gemini", "GEMINI.md"),
        })
      case "skill": {
        const parentDirectoryPath = path.join(antigravityHomePath, "skills")
        const slug = resolveSkillSlug(skillName, skillTitle, contentId)
        const conflict = await checkSkillNameConflict(parentDirectoryPath, slug, contentId)

        if (conflict.hasConflict) {
          return createConflictTarget({
            adapter: antigravityAdapter,
            contentType,
            scope: "global",
            targetKind: "directory",
            targetPath: conflict.existingPath,
            conflictContentId: conflict.existingContentId,
            message: `该位置已存在名为 "${slug}" 的 Skill，是否替换？`,
          })
        }

        const targetPath = path.join(parentDirectoryPath, slug)

        return createReadyTarget({
          adapter: antigravityAdapter,
          contentType,
          scope: "global",
          targetKind: "directory",
          targetPath,
          targetExists: conflict.targetExists,
        })
      }
      default:
        throw new Error(`${antigravityAdapter.label} 暂不支持 ${contentType} 类型。`)
    }
  },
  async resolveProjectTarget(projectPath, { contentId, contentType, skillName, skillTitle, ruleName }) {
    if (!isSupportedEditorPlatform()) {
      return createUnsupportedPlatformTarget({
        adapter: antigravityAdapter,
        contentType,
        scope: "project",
      })
    }

    const resolvedProjectPath = await resolveExistingProjectPath(projectPath)

    if (!resolvedProjectPath) {
      return createUnavailableTarget({
        adapter: antigravityAdapter,
        contentType,
        message: "项目路径不存在，无法解析 Antigravity 的项目安装位置。",
        scope: "project",
      })
    }

    switch (contentType) {
      case "rule": {
        const effectiveRuleName = ruleName?.trim() || toSynapseRuleName(contentId)
        return createReadyTarget({
          adapter: antigravityAdapter,
          contentType,
          scope: "project",
          targetKind: "file",
          targetPath: path.join(resolvedProjectPath, ".agents", "rules", `${effectiveRuleName}.md`),
        })
      }
      case "skill": {
        const parentDirectoryPath = path.join(resolvedProjectPath, ".agents", "skills")
        const slug = resolveSkillSlug(skillName, skillTitle, contentId)
        const conflict = await checkSkillNameConflict(parentDirectoryPath, slug, contentId)

        if (conflict.hasConflict) {
          return createConflictTarget({
            adapter: antigravityAdapter,
            contentType,
            scope: "project",
            targetKind: "directory",
            targetPath: conflict.existingPath,
            conflictContentId: conflict.existingContentId,
            message: `该位置已存在名为 "${slug}" 的 Skill，是否替换？`,
          })
        }

        const targetPath = path.join(parentDirectoryPath, slug)

        return createReadyTarget({
          adapter: antigravityAdapter,
          contentType,
          scope: "project",
          targetKind: "directory",
          targetPath,
          targetExists: conflict.targetExists,
        })
      }
      default:
        throw new Error(`${antigravityAdapter.label} 暂不支持 ${contentType} 类型。`)
    }
  },
  getScanPathConfig() {
    return {
      globalSkillsPath: path.join(resolveAntigravityHomePath(), "skills"),
      globalRulesPath: getHomePath(".gemini", "GEMINI.md"),
      rulesSupported: true,
      detectionDir: resolveAntigravityHomePath(),
      projectPaths: (projectPath: string) => ({
        skillsPath: path.join(projectPath, ".agents", "skills"),
        rulesPath: path.join(projectPath, ".agents", "rules"),
      }),
    }
  },
}

const editorAdapter = antigravityAdapter

export { antigravityAdapter, editorAdapter, resolveAntigravityHomePath }
```

- [ ] **Step 2: Commit**

```bash
git add desktop/src/definitions/editor/antigravity/adapter.ts
git commit -m "feat(editor): add Antigravity editor adapter with path resolution"
```

---

### Task 4: Create install strategy

**Files:**
- Create: `desktop/src/definitions/editor/antigravity/install.ts`

- [ ] **Step 1: Create install.ts**

```ts
import type { EditorInstallStrategy } from "../../main-types"
import { writeSynapseSkillDirectory } from "../shared-skill-directory"
import { applyRuleSection } from "../shared-rule-section"

export const installStrategy: EditorInstallStrategy = {
  async prepareRuleFileContent({ payload, targetPath, ruleBody, readExistingTextFile }) {
    if (payload.scope === "global") {
      const existing = await readExistingTextFile(targetPath)
      return applyRuleSection(existing, payload.contentId, ruleBody)
    }

    return ruleBody
  },
  async prepareSkillDirectory(context) {
    await writeSynapseSkillDirectory(context)
  },
}
```

- [ ] **Step 2: Commit**

```bash
git add desktop/src/definitions/editor/antigravity/install.ts
git commit -m "feat(editor): add Antigravity install strategy"
```

---

### Task 5: Create scan strategy

**Files:**
- Create: `desktop/src/definitions/editor/antigravity/scan.ts`

- [ ] **Step 1: Create scan.ts**

```ts
import { stat } from "node:fs/promises"
import type { EditorScanStrategy } from "../../main-types"
import { scanClaudeCodeRules, scanCodexRules } from "../shared-rule-scanners"

export const scanStrategy: EditorScanStrategy = {
  async scanRules(rulesPath) {
    if (!rulesPath) {
      return []
    }

    try {
      const info = await stat(rulesPath)
      return info.isDirectory()
        ? scanClaudeCodeRules(rulesPath)
        : scanCodexRules(rulesPath)
    } catch {
      return []
    }
  },
}
```

- [ ] **Step 2: Commit**

```bash
git add desktop/src/definitions/editor/antigravity/scan.ts
git commit -m "feat(editor): add Antigravity scan strategy"
```

---

### Task 6: Register in renderer registry

**Files:**
- Modify: `desktop/src/definitions/generated/renderer-registry.ts`

- [ ] **Step 1: Add imports and register Antigravity**

Add the following import at the top (after the windsurf imports):

```ts
import { editorDefinition as antigravityEditorDefinition } from "../editor/antigravity/editor"
import { mcpDefinition as antigravityMcpDefinition } from "../editor/antigravity/mcp"
```

Add `antigravityEditorDefinition` to the `editorDefinitions` array:

```ts
export const editorDefinitions = [
  claudeCodeEditorDefinition,
  codexEditorDefinition,
  cursorEditorDefinition,
  windsurfEditorDefinition,
  antigravityEditorDefinition,
].sort((left, right) => left.order - right.order) satisfies SynapseEditorDefinition[]
```

Add Antigravity to the `mcpDefinitions` array:

```ts
export const mcpDefinitions = [
  { ...claudeCodeMcpDefinition, icon: claudeCodeEditorDefinition.icon },
  { ...codexMcpDefinition, icon: codexEditorDefinition.icon },
  { ...cursorMcpDefinition, icon: cursorEditorDefinition.icon },
  { ...windsurfMcpDefinition, icon: windsurfEditorDefinition.icon },
  { ...antigravityMcpDefinition, icon: antigravityEditorDefinition.icon },
].sort((left, right) => left.order - right.order) satisfies SynapseRendererMcpDefinition[]
```

No change to `installFormDefinitionByEditorId` (Antigravity has no install form).

- [ ] **Step 2: Commit**

```bash
git add desktop/src/definitions/generated/renderer-registry.ts
git commit -m "feat(editor): register Antigravity in renderer registry"
```

---

### Task 7: Register in main process registry

**Files:**
- Modify: `desktop/electron/services/definitions/generated/main-registry.ts`

- [ ] **Step 1: Add imports and register Antigravity**

Add imports (after windsurf imports):

```ts
import { editorAdapter as antigravityEditorAdapter } from "../../../../src/definitions/editor/antigravity/adapter"
import { mcpDefinition as antigravityMcpDefinition } from "../../../../src/definitions/editor/antigravity/mcp"
import { installStrategy as antigravityInstallStrategy } from "../../../../src/definitions/editor/antigravity/install"
import { scanStrategy as antigravityScanStrategy } from "../../../../src/definitions/editor/antigravity/scan"
```

Add to `editorAdapters` array:

```ts
export const editorAdapters = [
  claudeCodeEditorAdapter,
  codexEditorAdapter,
  cursorEditorAdapter,
  windsurfEditorAdapter,
  antigravityEditorAdapter,
] satisfies EditorAdapter[]
```

Add to `mcpDefinitions` array:

```ts
export const mcpDefinitions = [
  claudeCodeMcpDefinition,
  codexMcpDefinition,
  cursorMcpDefinition,
  windsurfMcpDefinition,
  antigravityMcpDefinition,
].sort((left, right) => left.order - right.order) satisfies SynapseMcpDefinition[]
```

Add to `editorInstallStrategyById` Map:

```ts
export const editorInstallStrategyById = new Map<string, EditorInstallStrategy>([
  [claudeCodeEditorAdapter.id, claudeCodeInstallStrategy],
  [codexEditorAdapter.id, codexInstallStrategy],
  [cursorEditorAdapter.id, cursorInstallStrategy],
  [windsurfEditorAdapter.id, windsurfInstallStrategy],
  [antigravityEditorAdapter.id, antigravityInstallStrategy],
])
```

Add to `editorScanStrategyById` Map:

```ts
export const editorScanStrategyById = new Map<string, EditorScanStrategy>([
  [claudeCodeEditorAdapter.id, claudeCodeScanStrategy],
  [codexEditorAdapter.id, codexScanStrategy],
  [cursorEditorAdapter.id, cursorScanStrategy],
  [windsurfEditorAdapter.id, windsurfScanStrategy],
  [antigravityEditorAdapter.id, antigravityScanStrategy],
])
```

- [ ] **Step 2: Commit**

```bash
git add desktop/electron/services/definitions/generated/main-registry.ts
git commit -m "feat(editor): register Antigravity in main process registry"
```

---

### Task 8: Verify build

**Files:** None (verification only)

- [ ] **Step 1: Run TypeScript type check**

```bash
cd desktop && pnpm tsc --noEmit
```

Expected: No type errors.

- [ ] **Step 2: Run existing tests**

```bash
cd desktop && pnpm vitest run src/definitions/__tests__/editor-registry.test.ts
```

Expected: All tests pass (the registry test should pick up the new editor automatically since it reads from the generated registry).

- [ ] **Step 3: Run full test suite to check for regressions**

```bash
cd desktop && pnpm vitest run
```

Expected: All tests pass.

- [ ] **Step 4: Start dev server and verify Antigravity appears in editor list**

```bash
pnpm dev
```

Open the app, navigate to a rule or skill, and verify:
- Antigravity appears in the editor install target selector
- Antigravity icon renders correctly
- MCP configuration shows Antigravity as an option

---

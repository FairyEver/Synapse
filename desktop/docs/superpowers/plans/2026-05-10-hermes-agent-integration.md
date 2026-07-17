# Hermes Agent Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Hermes Agent as a fully supported editor (MCP + Rules + Skills installation) and agent (conversation + scheduled tasks) in Synapse.

**Architecture:** Hermes registers as both an editor definition (for content installation) and an agent definition (for runtime execution), following the same dual-registration pattern as Claude Code and Codex. MCP registration introduces a new YAML format handler. The agent adapter uses Hermes's `-z` black-box execution mode.

**Tech Stack:** TypeScript, React, `yaml` npm package (for config.yaml parsing), Hermes CLI (`hermes -z`)

> **2026-07-17 更正：** 本计划中的 Hermes 专属 Skill frontmatter、category/tags/version 安装表单和附件迁移到 `references/` 的步骤已撤销，不得继续执行。Hermes 与其他已注册 Agent 统一使用标准 Skill 格式，当前决策见 `CONTEXT.md` 和 ADR 0022。

---

## File Structure

### New Files

| Path | Responsibility |
|------|---------------|
| `src/definitions/editor/hermes/editor.ts` | Editor definition metadata |
| `src/definitions/editor/hermes/adapter.ts` | Path resolution for rules/skills targets |
| `src/definitions/editor/hermes/install.ts` | Content transformation for Hermes formats |
| `src/definitions/editor/hermes/scan.ts` | Scan installed rules from SOUL.md |
| `src/definitions/editor/hermes/mcp.ts` | MCP definition (YAML format) |
| `src/definitions/editor/hermes/forms.tsx` | Skill install form (category, tags) |
| `src/definitions/editor/hermes/frontmatter.ts` | Hermes SKILL.md frontmatter serialization |
| `src/definitions/editor/hermes/icon.png` | Hermes icon asset |
| `src/definitions/agent/hermes/agent.ts` | Agent definition with icon |
| `src/definitions/agent/hermes/agent-shared.ts` | Agent base definition (modes, commands) |
| `src/definitions/agent/hermes/agent-main.ts` | Runtime definition (createAdapter, buildEnv) |
| `src/definitions/agent/hermes/icon.png` | Agent icon asset (same as editor) |
| `electron/services/agent-runtime/adapters/hermes.ts` | HermesAdapter implementation |

### Modified Files

| Path | Change |
|------|--------|
| `src/definitions/types.ts` | Add `"hermes-yaml"` to `SynapseMcpDefinition.settingsFormat` |
| `electron/database/mcp-installer.ts` | Add YAML format read/write/detect logic |
| `package.json` | Add `yaml` dependency |

---

## Task 1: Add `yaml` dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install yaml package**

```bash
pnpm add yaml
```

- [ ] **Step 2: Verify installation**

```bash
pnpm list yaml
```

Expected: `yaml` appears in dependencies.

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: add yaml package for Hermes config parsing"
```

---

## Task 2: Extend MCP types for hermes-yaml format

**Files:**
- Modify: `src/definitions/types.ts`

- [ ] **Step 1: Update SynapseMcpDefinition type**

In `src/definitions/types.ts`, change the `settingsFormat` union:

```typescript
export type SynapseMcpDefinition = {
  target: DatabaseMcpTarget
  label: string
  order: number
  settingsPathSegments: readonly string[]
  settingsFormat: "json-mcp-servers" | "codex-toml" | "hermes-yaml"
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
pnpm exec tsc --noEmit --project tsconfig.json
```

- [ ] **Step 3: Commit**

```bash
git add src/definitions/types.ts
git commit -m "feat(types): add hermes-yaml to MCP settings format union"
```

---

## Task 3: Add YAML format support to MCP installer

**Files:**
- Modify: `electron/database/mcp-installer.ts`

- [ ] **Step 1: Add YAML import and format detection helper**

At the top of `electron/database/mcp-installer.ts`, add:

```typescript
import { parse as parseYaml, stringify as stringifyYaml } from "yaml"
```

Add the format detection helper alongside existing ones:

```typescript
function usesHermesYamlSettings(definition: SynapseMcpDefinition): boolean {
  return definition.settingsFormat === "hermes-yaml"
}
```

Update `assertSupportedSettingsFormat`:

```typescript
function assertSupportedSettingsFormat(definition: SynapseMcpDefinition): void {
  if (!usesJsonSettings(definition) && !usesCodexTomlSettings(definition) && !usesHermesYamlSettings(definition)) {
    throw new Error(`不支持的 MCP 设置格式：${definition.settingsFormat}`)
  }
}
```

- [ ] **Step 2: Add YAML detection function**

```typescript
function detectHermesYamlRegistration(raw: string): { registered: boolean; mode: McpRegistrationMode; url: string | null } {
  if (!raw.trim()) return { registered: false, mode: null, url: null }

  let config: unknown
  try {
    config = parseYaml(raw)
  } catch {
    return { registered: false, mode: null, url: null }
  }

  if (!isRecord(config)) return { registered: false, mode: null, url: null }

  const servers = config.mcp_servers
  if (!isRecord(servers)) return { registered: false, mode: null, url: null }

  const server = servers[SYNAPSE_MCP_SERVER_NAME]
  if (!isRecord(server)) return { registered: false, mode: null, url: null }

  if (typeof server.url === "string" && server.url.startsWith("http://127.0.0.1:")) {
    return { registered: true, mode: "http", url: server.url }
  }

  if (typeof server.command === "string") {
    return { registered: true, mode: "stdio", url: null }
  }

  return { registered: false, mode: null, url: null }
}
```

- [ ] **Step 3: Add YAML registration function**

```typescript
function registerHermesYamlMcp(settingsPath: string, mcpUrl: string): void {
  const raw = existsSync(settingsPath) ? readFileSync(settingsPath, "utf-8") : ""
  let config: Record<string, unknown>

  try {
    const parsed = raw.trim() ? parseYaml(raw) : null
    config = isRecord(parsed) ? parsed : {}
  } catch {
    throw new Error(`配置文件 YAML 格式损坏：${settingsPath}`)
  }

  if (!isRecord(config.mcp_servers)) {
    config.mcp_servers = {}
  }

  const servers = config.mcp_servers as Record<string, unknown>
  servers[SYNAPSE_MCP_SERVER_NAME] = { url: mcpUrl }

  writeFileSync(settingsPath, stringifyYaml(config, { lineWidth: 0 }), "utf-8")
}
```

- [ ] **Step 4: Add YAML removal function**

```typescript
function removeHermesYamlMcp(settingsPath: string, serverName: string): boolean {
  if (!existsSync(settingsPath)) return false

  const raw = readFileSync(settingsPath, "utf-8")
  let config: unknown

  try {
    config = parseYaml(raw)
  } catch {
    return false
  }

  if (!isRecord(config)) return false

  const servers = config.mcp_servers
  if (!isRecord(servers) || !(serverName in servers)) return false

  delete servers[serverName]
  writeFileSync(settingsPath, stringifyYaml(config as Record<string, unknown>, { lineWidth: 0 }), "utf-8")
  return true
}
```

- [ ] **Step 5: Wire YAML format into registerMcp**

Update the `registerMcp` function body to handle the new format:

```typescript
if (usesJsonSettings(definition)) {
  registerJsonMcp(settingsPath, mcpUrl)
} else if (usesCodexTomlSettings(definition)) {
  registerCodexMcp(settingsPath, mcpUrl)
} else {
  registerHermesYamlMcp(settingsPath, mcpUrl)
}
```

- [ ] **Step 6: Wire YAML format into getMcpServers detection**

Find the `getMcpServers` function and add YAML detection in the per-target loop. The pattern follows existing code — where it checks `usesJsonSettings` / `usesCodexTomlSettings`, add:

```typescript
} else if (usesHermesYamlSettings(definition)) {
  const raw = readFileSync(settingsPath, "utf-8")
  const detection = detectHermesYamlRegistration(raw)
  registered = detection.registered
  mode = detection.mode
  url = detection.url
}
```

- [ ] **Step 7: Wire YAML format into unregisterMcp**

In the `unregisterMcp` function, add the YAML branch:

```typescript
} else if (usesHermesYamlSettings(definition)) {
  return removeHermesYamlMcp(settingsPath, serverName)
}
```

- [ ] **Step 8: Verify TypeScript compiles**

```bash
pnpm exec tsc --noEmit --project tsconfig.json
```

- [ ] **Step 9: Commit**

```bash
git add electron/database/mcp-installer.ts
git commit -m "feat(mcp): add hermes-yaml format support to MCP installer"
```

---

## Task 4: Create Hermes editor definition

**Files:**
- Create: `src/definitions/editor/hermes/editor.ts`
- Create: `src/definitions/editor/hermes/mcp.ts`
- Create: `src/definitions/editor/hermes/icon.png`

- [ ] **Step 1: Add Hermes icon**

Copy a placeholder icon (or the actual Hermes logo) to `src/definitions/editor/hermes/icon.png`. For now use a placeholder — the user can replace it later.

```bash
# Use an existing icon as placeholder
cp src/definitions/editor/codex/icon.png src/definitions/editor/hermes/icon.png
```

- [ ] **Step 2: Create editor definition**

Create `src/definitions/editor/hermes/editor.ts`:

```typescript
import hermesIcon from "./icon.png"
import type { SynapseEditorDefinition } from "../../types"

export const editorDefinition = {
  id: "hermes",
  label: "Hermes",
  order: 60,
  icon: hermesIcon,
  supportsGlobal: true,
  supportsProject: true,
  supportedContentTypes: ["rule", "skill"],
} as const satisfies SynapseEditorDefinition
```

- [ ] **Step 3: Create MCP definition**

Create `src/definitions/editor/hermes/mcp.ts`:

```typescript
import type { SynapseMcpDefinition } from "../../types"

export const mcpDefinition = {
  target: "hermes",
  label: "Hermes",
  order: 60,
  settingsPathSegments: [".hermes", "config.yaml"],
  settingsFormat: "hermes-yaml",
} as const satisfies SynapseMcpDefinition
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
pnpm exec tsc --noEmit --project tsconfig.json
```

- [ ] **Step 5: Commit**

```bash
git add src/definitions/editor/hermes/
git commit -m "feat(editor): add Hermes editor and MCP definitions"
```

---

## Task 5: Create Hermes editor adapter

**Files:**
- Create: `src/definitions/editor/hermes/adapter.ts`

- [ ] **Step 1: Implement the adapter**

Create `src/definitions/editor/hermes/adapter.ts`:

```typescript
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
} from "../../../../electron/services/editor-adapters/utils"

function resolveHermesHomePath(): string {
  const configuredHome = process.env.HERMES_HOME?.trim()
  if (configuredHome) {
    return path.resolve(configuredHome)
  }
  return getHomePath(".hermes")
}

function resolveHermesGlobalSkillsPath(): string {
  return path.join(resolveHermesHomePath(), "skills")
}

const hermesAdapter: EditorAdapter = {
  id: "hermes",
  label: "Hermes",
  supportsGlobal: true,
  supportsProject: true,
  supportedContentTypes: ["rule", "skill"],
  resolveGlobalDirectoryPaths() {
    return {
      rulesPath: resolveHermesHomePath(),
      skillsPath: resolveHermesGlobalSkillsPath(),
    }
  },
  async resolveGlobalTarget({ contentId, contentType, skillName, skillTitle }) {
    if (!isSupportedEditorPlatform()) {
      return createUnsupportedPlatformTarget({
        adapter: hermesAdapter,
        contentType,
        scope: "global",
      })
    }

    switch (contentType) {
      case "rule": {
        const hermesHome = resolveHermesHomePath()
        if (!(await pathExists(hermesHome))) {
          return createUnavailableTarget({
            adapter: hermesAdapter,
            contentType,
            message: "未检测到 Hermes 的用户目录（~/.hermes），暂时不能解析全局安装位置。",
            scope: "global",
          })
        }
        return createReadyTarget({
          adapter: hermesAdapter,
          contentType,
          scope: "global",
          targetKind: "file",
          targetPath: path.join(hermesHome, "SOUL.md"),
        })
      }
      case "skill": {
        const parentDirectoryPath = resolveHermesGlobalSkillsPath()
        const slug = resolveSkillSlug(skillName, skillTitle, contentId)
        const conflict = await checkSkillNameConflict(parentDirectoryPath, slug, contentId)

        if (conflict.hasConflict) {
          return createConflictTarget({
            adapter: hermesAdapter,
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
          adapter: hermesAdapter,
          contentType,
          scope: "global",
          targetKind: "directory",
          targetPath,
          targetExists: conflict.targetExists,
        })
      }
      default:
        throw new Error(`${hermesAdapter.label} 暂不支持 ${contentType} 类型。`)
    }
  },
  async resolveProjectTarget(projectPath, { contentId, contentType, skillName, skillTitle }) {
    if (!isSupportedEditorPlatform()) {
      return createUnsupportedPlatformTarget({
        adapter: hermesAdapter,
        contentType,
        scope: "project",
      })
    }

    const resolvedProjectPath = await resolveExistingProjectPath(projectPath)
    if (!resolvedProjectPath) {
      return createUnavailableTarget({
        adapter: hermesAdapter,
        contentType,
        message: "项目路径不存在，无法解析 Hermes 的项目安装位置。",
        scope: "project",
      })
    }

    switch (contentType) {
      case "rule":
        return createReadyTarget({
          adapter: hermesAdapter,
          contentType,
          scope: "project",
          targetKind: "file",
          targetPath: path.join(resolvedProjectPath, ".hermes.md"),
        })
      case "skill": {
        const parentDirectoryPath = path.join(resolvedProjectPath, ".hermes", "skills")
        const slug = resolveSkillSlug(skillName, skillTitle, contentId)
        const conflict = await checkSkillNameConflict(parentDirectoryPath, slug, contentId)

        if (conflict.hasConflict) {
          return createConflictTarget({
            adapter: hermesAdapter,
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
          adapter: hermesAdapter,
          contentType,
          scope: "project",
          targetKind: "directory",
          targetPath,
          targetExists: conflict.targetExists,
        })
      }
      default:
        throw new Error(`${hermesAdapter.label} 暂不支持 ${contentType} 类型。`)
    }
  },
  getScanPathConfig() {
    const hermesHome = resolveHermesHomePath()
    return {
      globalSkillsPath: resolveHermesGlobalSkillsPath(),
      globalRulesPath: path.join(hermesHome, "SOUL.md"),
      rulesSupported: true,
      detectionDir: hermesHome,
      projectPaths: (projectPath: string) => ({
        skillsPath: path.join(projectPath, ".hermes", "skills"),
        rulesPath: path.join(projectPath, ".hermes.md"),
      }),
    }
  },
}

const editorAdapter = hermesAdapter

export { hermesAdapter, editorAdapter, resolveHermesHomePath, resolveHermesGlobalSkillsPath }
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
pnpm exec tsc --noEmit --project tsconfig.json
```

- [ ] **Step 3: Commit**

```bash
git add src/definitions/editor/hermes/adapter.ts
git commit -m "feat(editor): implement Hermes editor adapter with path resolution"
```

---

## Task 6: Create Hermes install strategy

**Files:**
- Create: `src/definitions/editor/hermes/install.ts`
- Create: `src/definitions/editor/hermes/frontmatter.ts`

- [ ] **Step 1: Create Hermes skill frontmatter serializer**

Create `src/definitions/editor/hermes/frontmatter.ts`:

```typescript
type HermesSkillFrontmatter = {
  name: string
  description: string
  version: string
  category: string
  tags: string[]
}

function encodeYamlScalar(value: string): string {
  if (value.length === 0) return '""'
  if (/[\n\r:#]/.test(value) || /^[&*!|>'"%@`\-?,\[\]{}]/.test(value)) {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
  }
  return value
}

function serializeHermesSkillFrontmatter(frontmatter: HermesSkillFrontmatter): string {
  const name = encodeYamlScalar(frontmatter.name.trim())
  const description = encodeYamlScalar(frontmatter.description.trim())
  const version = encodeYamlScalar(frontmatter.version.trim())
  const tagsLine = frontmatter.tags.length > 0
    ? `    tags: [${frontmatter.tags.map((t) => encodeYamlScalar(t.trim())).join(", ")}]`
    : "    tags: []"

  return [
    "---",
    `name: ${name}`,
    `description: ${description}`,
    `version: ${version}`,
    "metadata:",
    "  hermes:",
    tagsLine,
    `    category: ${encodeYamlScalar(frontmatter.category.trim())}`,
    "---",
    "",
    "",
  ].join("\n")
}

export { serializeHermesSkillFrontmatter }
export type { HermesSkillFrontmatter }
```

- [ ] **Step 2: Create install strategy**

Create `src/definitions/editor/hermes/install.ts`:

```typescript
import path from "node:path"
import type { EditorInstallStrategy } from "../../main-types"
import { normalizeContentAttachmentPath } from "../../../lib/content-attachments"
import { SYNAPSE_SKILL_ID_FILE_NAME } from "../../../../electron/services/editor-adapters/skill-identity"
import { applyRuleSection } from "../shared-rule-section"
import { serializeHermesSkillFrontmatter } from "./frontmatter"

export const installStrategy: EditorInstallStrategy = {
  async prepareRuleFileContent({ payload, targetPath, ruleBody, readExistingTextFile }) {
    const existing = await readExistingTextFile(targetPath)
    return applyRuleSection(existing, payload.contentId, ruleBody)
  },
  async prepareSkillDirectory({ copyAttachment, detail, stagingDirectoryPath, targetPath, writeTextFile }) {
    const category = (detail as { formValues?: { category?: string } }).formValues?.category || "general"
    const tags = (detail as { formValues?: { tags?: string } }).formValues?.tags?.split(",").map((t: string) => t.trim()).filter(Boolean) || []
    const version = (detail as { formValues?: { version?: string } }).formValues?.version || "1.0.0"

    const skillMainContent = serializeHermesSkillFrontmatter({
      name: path.basename(targetPath),
      description: detail.description,
      version,
      category,
      tags,
    }) + detail.content

    await writeTextFile(
      path.join(stagingDirectoryPath, "SKILL.md"),
      skillMainContent.endsWith("\n") ? skillMainContent : `${skillMainContent}\n`,
    )

    await writeTextFile(
      path.join(stagingDirectoryPath, SYNAPSE_SKILL_ID_FILE_NAME),
      JSON.stringify({ id: detail.id }, null, 2),
    )

    for (const attachment of detail.attachments) {
      const originalName = normalizeContentAttachmentPath(attachment.originalName)
      if (!originalName) {
        throw new Error("附件文件名不能为空。")
      }
      await copyAttachment(
        { ...attachment, originalName },
        path.join(stagingDirectoryPath, "references", originalName),
      )
    }
  },
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
pnpm exec tsc --noEmit --project tsconfig.json
```

- [ ] **Step 4: Commit**

```bash
git add src/definitions/editor/hermes/install.ts src/definitions/editor/hermes/frontmatter.ts
git commit -m "feat(editor): implement Hermes install strategy with skill frontmatter"
```

---

## Task 7: Create Hermes scan strategy

**Files:**
- Create: `src/definitions/editor/hermes/scan.ts`

- [ ] **Step 1: Implement scan strategy**

Create `src/definitions/editor/hermes/scan.ts`:

```typescript
import type { EditorScanStrategy } from "../../main-types"
import { scanCodexRules } from "../shared-rule-scanners"

export const scanStrategy: EditorScanStrategy = {
  async scanRules(rulesPath) {
    return rulesPath ? scanCodexRules(rulesPath) : []
  },
}
```

Note: We reuse `scanCodexRules` because Hermes SOUL.md uses the same `<!-- synapse-rule:id:begin/end -->` marker format as Codex's AGENTS.md.

- [ ] **Step 2: Commit**

```bash
git add src/definitions/editor/hermes/scan.ts
git commit -m "feat(editor): add Hermes scan strategy reusing rule-section scanner"
```

---

## Task 8: Create Hermes skill install form

**Files:**
- Create: `src/definitions/editor/hermes/forms.tsx`

- [ ] **Step 1: Implement the form component**

Create `src/definitions/editor/hermes/forms.tsx`:

```tsx
import { AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { SynapseRuleProjectInstallFormProps } from "../../types"

function HermesRuleProjectInstallForm({
  isSubmitting,
  onConfirm,
  onOpenChange,
  open,
  target,
}: SynapseRuleProjectInstallFormProps) {
  const isSoulMd = target?.targetPath?.endsWith("SOUL.md") ?? false

  function handleConfirm() {
    onConfirm({})
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>安装到 Hermes</DialogTitle>
        </DialogHeader>

        {isSoulMd && (
          <div className="flex items-start gap-2 rounded-md border border-border bg-muted p-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              此规则将追加到 ~/.hermes/SOUL.md（Hermes 人格文件）。SOUL.md 超过 20,000 字符会被截断。
            </p>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleConfirm} disabled={isSubmitting}>
            {isSubmitting ? "安装中…" : "确认安装"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export const installFormDefinition = {
  RuleProjectInstallForm: HermesRuleProjectInstallForm,
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
pnpm exec tsc --noEmit --project tsconfig.json
```

- [ ] **Step 3: Commit**

```bash
git add src/definitions/editor/hermes/forms.tsx
git commit -m "feat(editor): add Hermes rule install form with SOUL.md warning"
```

---

## Task 9: Create Hermes agent definition

**Files:**
- Create: `src/definitions/agent/hermes/agent.ts`
- Create: `src/definitions/agent/hermes/agent-shared.ts`
- Create: `src/definitions/agent/hermes/icon.png`

- [ ] **Step 1: Add icon**

```bash
cp src/definitions/editor/hermes/icon.png src/definitions/agent/hermes/icon.png
```

- [ ] **Step 2: Create agent-shared definition**

Create `src/definitions/agent/hermes/agent-shared.ts`:

```typescript
import type { SynapseAgentBaseDefinition } from "../../types"

export const agentBaseDefinition = {
  id: "hermes",
  label: "Hermes",
  order: 30,
  relatedEditorId: "hermes",
  runtime: {
    kind: "local-cli",
    binaries: ["hermes"],
  },
  modes: [
    { key: "default", label: "Default" },
    { key: "yolo", label: "YOLO", unattended: true },
  ],
  commands: [
    { name: "model", description: "Switch model" },
    { name: "skills", description: "Browse skills" },
    { name: "cron", description: "Manage scheduled tasks" },
    { name: "new", description: "Start a new session" },
  ],
  capabilities: {
    chat: true,
    projectContext: true,
    permissions: false,
    mcp: true,
  },
  displayProfile: {
    agentLabel: "Hermes",
    thinkingDefaultCollapsed: true,
    toolDefaultCollapsed: "collapsed",
    toolPreviewLines: 4,
    toolPreviewChars: 800,
    aliases: {},
    tools: {},
    statusLabels: {
      pending: "Pending",
      running: "Running",
      success: "Done",
      error: "Failed",
      denied: "Denied",
    },
  },
} as const satisfies SynapseAgentBaseDefinition
```

- [ ] **Step 3: Create agent definition**

Create `src/definitions/agent/hermes/agent.ts`:

```typescript
import hermesIcon from "./icon.png"
import type { SynapseAgentDefinition } from "../../types"
import { agentBaseDefinition } from "./agent-shared"

export const agentDefinition = {
  ...agentBaseDefinition,
  icon: hermesIcon,
} as const satisfies SynapseAgentDefinition
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
pnpm exec tsc --noEmit --project tsconfig.json
```

- [ ] **Step 5: Commit**

```bash
git add src/definitions/agent/hermes/
git commit -m "feat(agent): add Hermes agent definition with modes and capabilities"
```

---

## Task 10: Create Hermes agent adapter

**Files:**
- Create: `electron/services/agent-runtime/adapters/hermes.ts`

- [ ] **Step 1: Implement HermesAdapter**

Create `electron/services/agent-runtime/adapters/hermes.ts`:

```typescript
import type {
  AgentAdapter,
  AgentEvent,
  AgentExecutionContext,
  AgentExecutionResult,
  AgentMessage,
  AgentResultEvent,
  AgentErrorEvent,
} from "../types"

export interface HermesProcessRunner {
  run(request: { command: string; args: string[]; env?: Record<string, string | undefined>; cwd?: string; timeoutMs?: number }): Promise<{ stdout: string; stderr: string; exitCode: number }>
}

export interface HermesAdapterOptions {
  readonly command?: string
  readonly env?: Record<string, string | undefined>
  readonly envAllowlist?: readonly string[]
  readonly timeoutMs?: number
  readonly mode?: string
}

export class HermesAdapter implements AgentAdapter {
  readonly agentType = "hermes"

  private readonly runner: HermesProcessRunner
  private readonly options: HermesAdapterOptions

  constructor(runner: HermesProcessRunner, options: HermesAdapterOptions = {}) {
    this.runner = runner
    this.options = options
  }

  async execute(
    message: AgentMessage,
    context: AgentExecutionContext,
  ): Promise<AgentExecutionResult> {
    const command = this.options.command || "hermes"
    const args = ["-z", message.content, "--quiet"]

    if (this.options.mode === "yolo") {
      args.push("--yolo")
    }

    const events: AgentEvent[] = []
    let resultText = ""
    let error: string | undefined

    try {
      const result = await this.runner.run({
        command,
        args,
        env: this.options.env,
        cwd: context.workDir,
        timeoutMs: this.options.timeoutMs ?? 30 * 60 * 1000,
      })

      resultText = result.stdout.trim()

      if (result.exitCode !== 0 && !resultText) {
        error = result.stderr.trim() || `Hermes exited with code ${result.exitCode}`
        const errorEvent: AgentErrorEvent = {
          type: "error",
          message: error,
        }
        events.push(errorEvent)
      } else {
        const resultEvent: AgentResultEvent = {
          type: "result",
          content: resultText,
          done: true,
        }
        events.push(resultEvent)
        context.onEvent?.(resultEvent)
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
      const errorEvent: AgentErrorEvent = {
        type: "error",
        message: error,
      }
      events.push(errorEvent)
      context.onEvent?.(errorEvent)
    }

    return {
      events,
      resultText,
      error,
    }
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
pnpm exec tsc --noEmit --project tsconfig.json
```

- [ ] **Step 3: Commit**

```bash
git add electron/services/agent-runtime/adapters/hermes.ts
git commit -m "feat(agent): implement HermesAdapter with black-box -z execution"
```

---

## Task 11: Create Hermes agent runtime definition

**Files:**
- Create: `src/definitions/agent/hermes/agent-main.ts`

- [ ] **Step 1: Implement runtime definition**

Create `src/definitions/agent/hermes/agent-main.ts`:

```typescript
import { HermesAdapter } from "../../../../electron/services/agent-runtime/adapters/hermes"
import type { AgentRuntimeDefinition } from "../../main-types"
import { agentBaseDefinition } from "./agent-shared"

export const agentRuntimeDefinition = {
  ...agentBaseDefinition,
  createAdapter(view, runner) {
    return new HermesAdapter(runner, {
      command: view.runtimeCommand,
      mode: view.mode,
      env: view.env,
      envAllowlist: view.envAllowlist,
    })
  },
  buildEnv({ provider, apiKey }) {
    const env: Record<string, string | undefined> = {}
    if (apiKey) env.HERMES_API_KEY = apiKey
    if (provider?.baseUrl) env.HERMES_BASE_URL = provider.baseUrl
    return { env: { ...env, ...provider?.env } }
  },
} satisfies AgentRuntimeDefinition
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
pnpm exec tsc --noEmit --project tsconfig.json
```

- [ ] **Step 3: Commit**

```bash
git add src/definitions/agent/hermes/agent-main.ts
git commit -m "feat(agent): add Hermes agent runtime definition"
```

---

## Task 12: Regenerate registries and verify build

**Files:**
- Modify: `electron/services/definitions/generated/main-registry.ts` (auto-generated)
- Modify: `src/definitions/generated/renderer-registry.ts` (auto-generated)

- [ ] **Step 1: Run registry generation**

```bash
pnpm run generate
```

If there's no `generate` script, check how registries are built:

```bash
grep -r "generated" package.json
```

And run the appropriate command.

- [ ] **Step 2: Verify full build**

```bash
pnpm build
```

- [ ] **Step 3: Verify dev mode starts**

```bash
pnpm dev
```

Check that:
- The app starts without errors
- Hermes appears in the MCP settings panel
- Hermes appears in the editor list for content installation

- [ ] **Step 4: Commit generated files**

```bash
git add electron/services/definitions/generated/ src/definitions/generated/
git commit -m "chore: regenerate registries with Hermes editor and agent"
```

---

## Task 13: Manual verification

- [ ] **Step 1: Verify MCP registration**

Create `~/.hermes/` directory if it doesn't exist, then check:
1. Open Synapse → Settings → MCP
2. Hermes should appear in the list
3. Click register — verify `~/.hermes/config.yaml` gets a `mcp_servers.synapse` entry

- [ ] **Step 2: Verify rule installation**

1. Select a rule in Synapse
2. Choose "Install to Hermes" → Global
3. Verify the SOUL.md warning appears
4. Confirm — verify content is appended to `~/.hermes/SOUL.md` with markers

- [ ] **Step 3: Verify skill installation**

1. Select a skill in Synapse
2. Choose "Install to Hermes" → Global
3. Verify a directory is created at `~/.hermes/skills/{category}/{name}/`
4. Verify `SKILL.md` has correct Hermes frontmatter format

- [ ] **Step 4: Verify agent appears**

1. Check that Hermes appears in agent selection
2. If `hermes` binary is in PATH, verify a simple conversation works

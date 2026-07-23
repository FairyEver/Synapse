# Content MCP Publishing Implementation Plan

> Superseded note: Synapse-owned CLI and stdio MCP capability entrypoints were retired after this document was written. Current external capability access uses loopback HTTP MCP; local HTTP `/api` remains an authenticated internal API.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose Synapse Rule, Skill, and Prompt publishing and management through MCP without editor installation support.

**Architecture:** Add a new `content` capability domain with explicit Rule/Skill/Prompt tools. Route these tools through a new Electron-side content dispatcher that reuses existing content services, centralized metadata definitions, attachment normalization, and content submission flows. Keep MCP update/delete stricter than UI by requiring ownership and `baseHistoryDirname`.

**Tech Stack:** Electron main process, TypeScript, Vitest, existing Synapse MCP capability registry, existing content repository services, Electron `nativeImage` for icon image processing.

---

## File Structure

Create:

- `desktop/synapse-capabilities/shared/content-domain.ts`  
  Defines `content.*` capabilities and MCP tool schemas. Imports content metadata only through shared/renderer-safe modules.

- `desktop/electron/capabilities/content-dispatcher.ts`  
  Routes `content.*` actions to content services, applies owner and conflict checks, and returns `DispatchResult`.

- `desktop/electron/capabilities/__tests__/content-dispatcher.test.ts`  
  Unit tests for create, update, delete, owner checks, conflict checks, and attachment behavior.

- `desktop/electron/services/content-capability-errors.ts`  
  Small typed error helper for structured MCP failures.

- `desktop/electron/services/content-capability-validator.ts`  
  Normalizes and validates Rule, Skill, Prompt MCP payloads. Reuses categories, icon options, name validators, and attachment helpers.

- `desktop/electron/services/content-skill-attachment-constraints.ts`  
  Shared Skill attachment limits and sensitive filename rules used by UI, quick publish, and MCP.

- `desktop/electron/services/content-skill-source-service.ts`  
  Reads a local Skill directory into a normalized draft with content, metadata, and attachments.

- `desktop/electron/services/content-icon-image-service.ts`  
  Reads `iconImagePath` or `iconImageBase64`, validates size, decodes with `nativeImage`, center-crops, resizes to `256x256`, and returns PNG bytes.

- `desktop/electron/services/__tests__/content-capability-validator.test.ts`
- `desktop/electron/services/__tests__/content-skill-source-service.test.ts`
- `desktop/electron/services/__tests__/content-icon-image-service.test.ts`

- `desktop/resources/templates/skills/synapse-content-mcp/meta.json`
- `desktop/resources/templates/skills/synapse-content-mcp/content.md`

Modify:

- `desktop/synapse-capabilities/shared/registry.ts`  
  Add `CONTENT_DOMAIN`, `CONTENT_MCP_TOOL_ACTIONS`, and `buildContentTools()`.

- `desktop/electron/capabilities/action-router.ts`  
  Add `contentDispatch` dependency and route content actions.

- `desktop/electron/bootstrap/descriptors.ts`  
  Instantiate `createContentDispatcher` inside `core.database` and pass it to `createSynapseActionRouter`.

- `desktop/electron/bootstrap/__tests__/descriptors.test.ts`  
  Update dependency expectations only if needed by the dispatcher wiring.

- `desktop/electron/services/editor-scan-service.ts`  
  Replace duplicated quick-publish Skill directory scanning constants/functions with `content-skill-source-service` exports.

- `desktop/src/modules/skills/utils.ts`  
  Import attachment limits from the shared Electron-safe constraints module only if renderer build can resolve it. If renderer cannot import Electron-side files, move constants to `desktop/src/lib/content-skill-attachment-constraints.ts` and import from both sides.

- `desktop/tests/unit/synapse-capabilities.test.ts`
- `desktop/tests/unit/database-mcp-rpc.test.ts`
- `docs/reference/capability-naming-matrix.md`
- `website/reference/synapse-mcp-capabilities.md`

---

### Task 1: Add Content Domain Capability Definitions

**Files:**
- Create: `desktop/synapse-capabilities/shared/content-domain.ts`
- Modify: `desktop/synapse-capabilities/shared/registry.ts`
- Test: `desktop/tests/unit/synapse-capabilities.test.ts`

- [ ] **Step 1: Write failing capability registry tests**

Append to `desktop/tests/unit/synapse-capabilities.test.ts`:

```ts
import {
  CONTENT_DOMAIN,
  CONTENT_MCP_TOOL_ACTIONS,
  buildContentTools,
} from "../../synapse-capabilities/shared/content-domain"
```

Add tests:

```ts
describe("Content capability domain", () => {
  it("registers content actions separately from other domains", () => {
    expect(CONTENT_DOMAIN.id).toBe("content")
    expect(CONTENT_DOMAIN.capabilities.map((capability) => capability.id)).toEqual([
      "content.type.describe",
      "content.rule.list",
      "content.rule.get",
      "content.rule.create",
      "content.rule.update",
      "content.rule.delete",
      "content.skill.list",
      "content.skill.get",
      "content.skill.create",
      "content.skill.update",
      "content.skill.delete",
      "content.prompt.list",
      "content.prompt.get",
      "content.prompt.create",
      "content.prompt.update",
      "content.prompt.delete",
    ])
  })

  it("maps content MCP tool names to canonical actions", () => {
    expect(CONTENT_MCP_TOOL_ACTIONS.content_type_describe).toBe("content.type.describe")
    expect(CONTENT_MCP_TOOL_ACTIONS.content_rule_create).toBe("content.rule.create")
    expect(CONTENT_MCP_TOOL_ACTIONS.content_skill_update).toBe("content.skill.update")
    expect(CONTENT_MCP_TOOL_ACTIONS.content_prompt_delete).toBe("content.prompt.delete")
  })

  it("combines content tools with all MCP tools", () => {
    const toolNames = buildAllMcpTools().map((tool) => tool.name)
    expect(toolNames).toContain("content_type_describe")
    expect(toolNames).toContain("content_rule_create")
    expect(toolNames).toContain("content_skill_create")
    expect(toolNames).toContain("content_prompt_create")
    expect(MCP_TOOL_ACTIONS.content_skill_delete).toBe("content.skill.delete")
    expect(getActionDomainId("content.prompt.update")).toBe("content")
  })

  it("documents list/get/create/update/delete tool schemas for each content type", () => {
    const tools = buildContentTools()
    for (const type of ["rule", "skill", "prompt"] as const) {
      expect(tools.find((tool) => tool.name === `content_${type}_list`)).toBeDefined()
      expect(tools.find((tool) => tool.name === `content_${type}_get`)?.inputSchema.required).toEqual(["id"])
      expect(tools.find((tool) => tool.name === `content_${type}_create`)).toBeDefined()
      expect(tools.find((tool) => tool.name === `content_${type}_update`)?.inputSchema.required).toContain("baseHistoryDirname")
      expect(tools.find((tool) => tool.name === `content_${type}_delete`)?.inputSchema.required).toEqual(["id", "baseHistoryDirname"])
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run tests/unit/synapse-capabilities.test.ts
```

Expected: FAIL because `content-domain.ts` does not exist.

- [ ] **Step 3: Implement content domain**

Create `desktop/synapse-capabilities/shared/content-domain.ts`:

```ts
import type { CapabilityDefinition, CapabilityDomainDefinition, McpToolDefinition } from "./types"
import type { CapabilityId } from "./naming"
import { capabilityIdToMcpTool } from "./naming"

const contentCapabilities: readonly CapabilityDefinition[] = [
  { id: "content.type.describe" as CapabilityId, title: "Describe content types", description: "Return content fields, categories, appearance options, and publishing constraints.", mutates: false },
  { id: "content.rule.list" as CapabilityId, title: "List rules", description: "List Synapse Rule resources.", mutates: false },
  { id: "content.rule.get" as CapabilityId, title: "Get rule", description: "Get one Synapse Rule resource by id.", mutates: false },
  { id: "content.rule.create" as CapabilityId, title: "Create rule", description: "Create a Synapse Rule resource.", mutates: true },
  { id: "content.rule.update" as CapabilityId, title: "Update rule", description: "Update a Synapse Rule created by the current repo profile.", mutates: true },
  { id: "content.rule.delete" as CapabilityId, title: "Delete rule", description: "Delete a Synapse Rule created by the current repo profile.", mutates: true },
  { id: "content.skill.list" as CapabilityId, title: "List skills", description: "List Synapse Skill resources.", mutates: false },
  { id: "content.skill.get" as CapabilityId, title: "Get skill", description: "Get one Synapse Skill resource by id.", mutates: false },
  { id: "content.skill.create" as CapabilityId, title: "Create skill", description: "Create a Synapse Skill resource.", mutates: true },
  { id: "content.skill.update" as CapabilityId, title: "Update skill", description: "Update a Synapse Skill created by the current repo profile.", mutates: true },
  { id: "content.skill.delete" as CapabilityId, title: "Delete skill", description: "Delete a Synapse Skill created by the current repo profile.", mutates: true },
  { id: "content.prompt.list" as CapabilityId, title: "List prompts", description: "List Synapse Prompt resources.", mutates: false },
  { id: "content.prompt.get" as CapabilityId, title: "Get prompt", description: "Get one Synapse Prompt resource by id.", mutates: false },
  { id: "content.prompt.create" as CapabilityId, title: "Create prompt", description: "Create a Synapse Prompt resource.", mutates: true },
  { id: "content.prompt.update" as CapabilityId, title: "Update prompt", description: "Update a Synapse Prompt created by the current repo profile.", mutates: true },
  { id: "content.prompt.delete" as CapabilityId, title: "Delete prompt", description: "Delete a Synapse Prompt created by the current repo profile.", mutates: true },
]

export const CONTENT_DOMAIN: CapabilityDomainDefinition = {
  id: "content",
  capabilities: contentCapabilities,
}

export const CONTENT_MCP_TOOL_ACTIONS: Record<string, string> = Object.fromEntries(
  contentCapabilities.map((capability) => [capabilityIdToMcpTool(capability.id), capability.id]),
)

const stringField = (description: string) => ({ type: "string", description })
const iconFields = {
  iconType: { type: "string", enum: ["icon", "image"], description: "Use \"icon\" for built-in icon + background, or \"image\" for a PNG icon generated from iconImagePath/iconImageBase64." },
  icon: stringField("Built-in icon value. Call content_type_describe for allowed values. Required when iconType is icon."),
  iconBg: stringField("Built-in background color value. Call content_type_describe for allowed values. Required when iconType is icon."),
  iconImagePath: stringField("Local image path. Used only when iconType is image. Mutually exclusive with iconImageBase64."),
  iconImageBase64: stringField("Base64 image bytes. Used only when iconType is image. Mutually exclusive with iconImagePath."),
}

const baseCreateProperties = {
  title: stringField("Display title."),
  description: stringField("Short description."),
  category: stringField("Category id. Call content_type_describe for allowed values."),
  content: stringField("Markdown body."),
  usage: stringField("Optional usage guidance."),
  ...iconFields,
}

const skillFileSchema = {
  type: "object",
  properties: {
    path: stringField("Relative path inside the Skill, such as references/checklist.md."),
    contentText: stringField("Text file content. Mutually exclusive with contentBase64."),
    contentBase64: stringField("Base64 file bytes. Mutually exclusive with contentText."),
  },
  required: ["path"],
}

function listTool(type: "rule" | "skill" | "prompt"): McpToolDefinition {
  return {
    name: `content_${type}_list`,
    description: `List Synapse ${type} resources. Returns repository and builtin items when available.`,
    inputSchema: {
      type: "object",
      properties: {
        includeDeleted: { type: "boolean", description: "When true, include deleted repository content." },
      },
    },
  }
}

function getTool(type: "rule" | "skill" | "prompt"): McpToolDefinition {
  return {
    name: `content_${type}_get`,
    description: `Get one Synapse ${type} resource. Use latestHistoryDirname from this response as baseHistoryDirname for update/delete.`,
    inputSchema: { type: "object", properties: { id: stringField("Content id.") }, required: ["id"] },
  }
}

function createTool(type: "rule" | "skill" | "prompt"): McpToolDefinition {
  const properties: Record<string, unknown> = { ...baseCreateProperties }
  const required = ["title", "description", "category", "content"]
  if (type === "rule" || type === "skill") {
    properties.name = stringField("Stable content slug/name.")
    required.unshift("name")
  }
  if (type === "skill") {
    properties.files = { type: "array", items: skillFileSchema, description: "Attachment files. Mutually exclusive with sourceDirectoryPath." }
    properties.sourceDirectoryPath = stringField("Local Skill directory to import. Mutually exclusive with files.")
  }
  return {
    name: `content_${type}_create`,
    description: `Create a Synapse ${type}. Call content_type_describe first for categories, icons, backgrounds, and constraints.`,
    inputSchema: { type: "object", properties, required },
  }
}

function updateTool(type: "rule" | "skill" | "prompt"): McpToolDefinition {
  const create = createTool(type)
  return {
    name: `content_${type}_update`,
    description: `Update a Synapse ${type} created by the current repo profile. First call content_${type}_get and pass latestHistoryDirname as baseHistoryDirname. Force update is not supported.`,
    inputSchema: {
      type: "object",
      properties: {
        id: stringField("Content id."),
        baseHistoryDirname: stringField("Version token from latestHistoryDirname."),
        ...create.inputSchema.properties,
      },
      required: ["id", "baseHistoryDirname", ...(create.inputSchema.required ?? [])],
    },
  }
}

function deleteTool(type: "rule" | "skill" | "prompt"): McpToolDefinition {
  return {
    name: `content_${type}_delete`,
    description: `Delete a Synapse ${type} created by the current repo profile. First call content_${type}_get and pass latestHistoryDirname as baseHistoryDirname. Force delete is not supported.`,
    inputSchema: {
      type: "object",
      properties: {
        id: stringField("Content id."),
        baseHistoryDirname: stringField("Version token from latestHistoryDirname."),
      },
      required: ["id", "baseHistoryDirname"],
    },
  }
}

export function buildContentTools(): McpToolDefinition[] {
  return [
    {
      name: "content_type_describe",
      description: "Return content field requirements, categories, icon values, background values, and constraints for Rule, Skill, and Prompt publishing. Call this before create/update.",
      inputSchema: {
        type: "object",
        properties: {
          contentType: { type: "string", enum: ["rule", "skill", "prompt"], description: "Optional content type filter." },
        },
      },
    },
    ...(["rule", "skill", "prompt"] as const).flatMap((type) => [
      listTool(type),
      getTool(type),
      createTool(type),
      updateTool(type),
      deleteTool(type),
    ]),
  ]
}
```

Modify `desktop/synapse-capabilities/shared/registry.ts`:

```ts
import {
  CONTENT_DOMAIN,
  CONTENT_MCP_TOOL_ACTIONS,
  buildContentTools,
} from "./content-domain"
```

Add `CONTENT_DOMAIN` to `CAPABILITY_DOMAINS`, add `...CONTENT_MCP_TOOL_ACTIONS` to `MCP_TOOL_ACTIONS`, and add `...buildContentTools()` to `buildAllMcpTools()`.

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run tests/unit/synapse-capabilities.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/synapse-capabilities/shared/content-domain.ts desktop/synapse-capabilities/shared/registry.ts desktop/tests/unit/synapse-capabilities.test.ts
git commit -m "feat(content): add mcp capability domain"
```

---

### Task 2: Add Shared Metadata and Attachment Validation

**Files:**
- Create: `desktop/electron/services/content-capability-errors.ts`
- Create: `desktop/electron/services/content-skill-attachment-constraints.ts`
- Create: `desktop/electron/services/content-capability-validator.ts`
- Test: `desktop/electron/services/__tests__/content-capability-validator.test.ts`

- [ ] **Step 1: Write failing validator tests**

Create `desktop/electron/services/__tests__/content-capability-validator.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import {
  describeContentTypes,
  normalizeCreateContentParams,
  normalizeDeleteContentParams,
  normalizeUpdateContentParams,
} from "../content-capability-validator"
import { ContentCapabilityError } from "../content-capability-errors"

describe("content capability metadata", () => {
  it("describes categories, icons, colors, and constraints from shared definitions", () => {
    const result = describeContentTypes({})
    const skill = result.contentTypes.find((item) => item.type === "skill")
    expect(skill?.categories.map((item) => item.id)).toContain("development")
    expect(skill?.icons.map((item) => item.value)).toContain("wrench")
    expect(skill?.backgroundColors.map((item) => item.value)).toContain("graphite")
    expect(skill?.constraints.attachments).toMatchObject({
      maxFileSizeBytes: 10 * 1024 * 1024,
      maxTotalSizeBytes: 50 * 1024 * 1024,
      maxCount: 100,
    })
    expect(skill?.constraints.iconImage).toMatchObject({
      maxInputBytes: 5 * 1024 * 1024,
      outputFormat: "png",
      outputSizePx: 256,
    })
  })
})

describe("content capability validator", () => {
  it("normalizes a valid rule create payload", () => {
    expect(normalizeCreateContentParams("rule", {
      name: "review-rule",
      title: "Review Rule",
      description: "Review code changes.",
      category: "coding",
      iconType: "icon",
      icon: "file-text",
      iconBg: "graphite",
      content: "# Rule",
    })).toMatchObject({
      name: "review-rule",
      title: "Review Rule",
      category: "coding",
      icon: "file-text",
      iconBg: "graphite",
    })
  })

  it("rejects unknown categories, icons, and backgrounds", () => {
    expect(() => normalizeCreateContentParams("prompt", {
      title: "Prompt",
      description: "Prompt description",
      category: "missing",
      iconType: "icon",
      icon: "missing-icon",
      iconBg: "missing-bg",
      content: "Run this.",
    })).toThrow(ContentCapabilityError)
  })

  it("rejects invalid skill attachment paths and duplicate normalized paths", () => {
    expect(() => normalizeCreateContentParams("skill", {
      name: "skill-one",
      title: "Skill One",
      description: "Skill description",
      category: "development",
      iconType: "icon",
      icon: "wrench",
      iconBg: "graphite",
      content: "# Skill",
      files: [
        { path: "refs/a.md", contentText: "A" },
        { path: "refs\\\\a.md", contentText: "B" },
      ],
    })).toThrow(/附件文件名重复/)
  })

  it("requires baseHistoryDirname for updates and deletes", () => {
    expect(() => normalizeUpdateContentParams("prompt", {
      id: "prompt-1",
      title: "Prompt",
      description: "Prompt description",
      category: "coding",
      iconType: "icon",
      icon: "file-text",
      iconBg: "graphite",
      content: "Body",
    })).toThrow(/baseHistoryDirname/)

    expect(() => normalizeDeleteContentParams({ id: "prompt-1" }))
      .toThrow(/baseHistoryDirname/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/content-capability-validator.test.ts
```

Expected: FAIL because validator modules do not exist.

- [ ] **Step 3: Implement structured error helper**

Create `desktop/electron/services/content-capability-errors.ts`:

```ts
export type ContentCapabilityErrorCode =
  | "validation_error"
  | "not_owner"
  | "conflict"
  | "not_found"
  | "image_error"
  | "source_read_error"
  | "repository_not_ready"

export class ContentCapabilityError extends Error {
  readonly code: ContentCapabilityErrorCode
  readonly fields?: Record<string, string>
  readonly data?: Record<string, unknown>

  constructor(
    code: ContentCapabilityErrorCode,
    message: string,
    options: { fields?: Record<string, string>; data?: Record<string, unknown> } = {},
  ) {
    super(message)
    this.name = "ContentCapabilityError"
    this.code = code
    this.fields = options.fields
    this.data = options.data
  }
}

export function contentCapabilityErrorPayload(error: unknown): { ok: false; code: ContentCapabilityErrorCode; message: string; fields?: Record<string, string> } | null {
  if (!(error instanceof ContentCapabilityError)) return null
  return {
    ok: false,
    code: error.code,
    message: error.message,
    ...(error.fields ? { fields: error.fields } : {}),
    ...(error.data ?? {}),
  }
}
```

- [ ] **Step 4: Implement shared attachment constraints**

Create `desktop/electron/services/content-skill-attachment-constraints.ts`:

```ts
export const MAX_SKILL_ATTACHMENT_SIZE = 10 * 1024 * 1024
export const MAX_SKILL_ATTACHMENT_TOTAL_SIZE = 50 * 1024 * 1024
export const MAX_SKILL_ATTACHMENT_COUNT = 100

export const SENSITIVE_SKILL_ATTACHMENT_NAMES = new Set([
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
  "id_rsa",
])

export const SENSITIVE_SKILL_ATTACHMENT_EXTENSIONS = new Set([
  ".key",
  ".p12",
  ".pem",
  ".pfx",
])

export const MAX_CONTENT_ICON_IMAGE_INPUT_SIZE = 5 * 1024 * 1024
export const CONTENT_ICON_IMAGE_OUTPUT_SIZE = 256
export const CONTENT_ICON_IMAGE_FILE_NAME = "icon.png"
```

- [ ] **Step 5: Implement validator**

Create `desktop/electron/services/content-capability-validator.ts` with exports used by tests:

```ts
import path from "node:path"
import { getAllContentTypeIds, getContentTypeDefinition } from "../../src/config/content-types"
import { DEFAULT_SYNAPSE_CONTENT_COLOR_VALUE, SYNAPSE_CONTENT_COLOR_OPTIONS, SYNAPSE_CONTENT_ICON_OPTIONS, getContentColorOption, getContentIconOption } from "../../src/lib/content-appearance"
import { normalizeContentAttachmentPath, assertUniqueContentAttachmentPaths } from "../../src/lib/content-attachments"
import { normalizeContentNameInput, validateContentNameInput } from "../../src/lib/content-name-input"
import { normalizeSkillNameInput, validateSkillNameInput } from "../../src/lib/skill-name-input"
import type { SynapseContentIconType, SynapseContentType, SynapseCreateContentPayload, SynapseCreateSkillFilePayload, SynapseUpdateContentPayload } from "../../src/types/content"
import { ContentCapabilityError } from "./content-capability-errors"
import {
  CONTENT_ICON_IMAGE_OUTPUT_SIZE,
  MAX_CONTENT_ICON_IMAGE_INPUT_SIZE,
  MAX_SKILL_ATTACHMENT_COUNT,
  MAX_SKILL_ATTACHMENT_SIZE,
  MAX_SKILL_ATTACHMENT_TOTAL_SIZE,
  SENSITIVE_SKILL_ATTACHMENT_EXTENSIONS,
  SENSITIVE_SKILL_ATTACHMENT_NAMES,
} from "./content-skill-attachment-constraints"

type SkillFileInput = {
  path?: unknown
  contentText?: unknown
  contentBase64?: unknown
}

type NormalizedSkillFile = SynapseCreateSkillFilePayload

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ContentCapabilityError("validation_error", "参数必须是对象。")
  }
  return value as Record<string, unknown>
}

function stringParam(record: Record<string, unknown>, field: string): string {
  const value = record[field]
  return typeof value === "string" ? value.trim() : ""
}

function requiredString(record: Record<string, unknown>, field: string): string {
  const value = stringParam(record, field)
  if (!value) {
    throw new ContentCapabilityError("validation_error", "内容字段校验失败。", { fields: { [field]: `${field} 不能为空。` } })
  }
  return value
}

function validateCategory(type: SynapseContentType, category: string): void {
  const definition = getContentTypeDefinition(type)
  if (!definition.categories.some((item) => item.id === category)) {
    throw new ContentCapabilityError("validation_error", "内容字段校验失败。", { fields: { category: `未知分类：${category}` } })
  }
}

function normalizeAppearance(record: Record<string, unknown>): { iconType: SynapseContentIconType; icon: string; iconBg: string; iconImage: string } {
  const iconType = stringParam(record, "iconType") || "icon"
  if (iconType !== "icon" && iconType !== "image") {
    throw new ContentCapabilityError("validation_error", "内容字段校验失败。", { fields: { iconType: "iconType 必须是 icon 或 image。" } })
  }
  if (iconType === "image") {
    return { iconType, icon: "", iconBg: "", iconImage: "" }
  }
  const icon = requiredString(record, "icon")
  const iconBg = stringParam(record, "iconBg") || DEFAULT_SYNAPSE_CONTENT_COLOR_VALUE
  if (!getContentIconOption(icon)) {
    throw new ContentCapabilityError("validation_error", "内容字段校验失败。", { fields: { icon: `未知图标：${icon}` } })
  }
  if (!getContentColorOption(iconBg)) {
    throw new ContentCapabilityError("validation_error", "内容字段校验失败。", { fields: { iconBg: `未知背景色：${iconBg}` } })
  }
  return { iconType, icon, iconBg, iconImage: "" }
}

function isSensitiveAttachmentPath(relativePath: string): boolean {
  const baseName = path.basename(relativePath).toLowerCase()
  return SENSITIVE_SKILL_ATTACHMENT_NAMES.has(baseName) || SENSITIVE_SKILL_ATTACHMENT_EXTENSIONS.has(path.extname(baseName))
}

function normalizeSkillFiles(value: unknown): NormalizedSkillFile[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) {
    throw new ContentCapabilityError("validation_error", "内容字段校验失败。", { fields: { files: "files 必须是数组。" } })
  }

  const files: NormalizedSkillFile[] = value.map((raw, index) => {
    const item = asRecord(raw) as SkillFileInput
    const originalPath = typeof item.path === "string" ? item.path : ""
    const originalName = normalizeContentAttachmentPath(originalPath)
    if (!originalName) {
      throw new ContentCapabilityError("validation_error", "内容字段校验失败。", { fields: { files: `第 ${index + 1} 个附件路径不能为空。` } })
    }
    if (isSensitiveAttachmentPath(originalName)) {
      throw new ContentCapabilityError("validation_error", "内容字段校验失败。", { fields: { files: `附件包含敏感文件：${originalName}` } })
    }
    const hasText = typeof item.contentText === "string"
    const hasBase64 = typeof item.contentBase64 === "string"
    if (hasText === hasBase64) {
      throw new ContentCapabilityError("validation_error", "内容字段校验失败。", { fields: { files: `${originalName} 必须且只能提供 contentText 或 contentBase64。` } })
    }
    const bytes = hasText
      ? new Uint8Array(Buffer.from(item.contentText as string, "utf8"))
      : new Uint8Array(Buffer.from(item.contentBase64 as string, "base64"))
    if (bytes.byteLength > MAX_SKILL_ATTACHMENT_SIZE) {
      throw new ContentCapabilityError("validation_error", "内容字段校验失败。", { fields: { files: `附件超过 10MB：${originalName}` } })
    }
    return { originalName, size: bytes.byteLength, bytes }
  })

  if (files.length > MAX_SKILL_ATTACHMENT_COUNT) {
    throw new ContentCapabilityError("validation_error", "内容字段校验失败。", { fields: { files: `附件数量超过 ${MAX_SKILL_ATTACHMENT_COUNT} 个。` } })
  }
  const totalSize = files.reduce((sum, file) => sum + file.size, 0)
  if (totalSize > MAX_SKILL_ATTACHMENT_TOTAL_SIZE) {
    throw new ContentCapabilityError("validation_error", "内容字段校验失败。", { fields: { files: "附件总大小超过 50MB。" } })
  }
  assertUniqueContentAttachmentPaths(files.map((file) => file.originalName))
  return files
}

function normalizeBase(type: SynapseContentType, params: unknown): SynapseCreateContentPayload {
  const record = asRecord(params)
  const title = requiredString(record, "title")
  const description = requiredString(record, "description")
  const category = requiredString(record, "category")
  const content = requiredString(record, "content")
  validateCategory(type, category)
  return {
    title,
    description,
    category,
    content,
    usage: stringParam(record, "usage"),
    ...normalizeAppearance(record),
  } as SynapseCreateContentPayload
}

export function normalizeCreateContentParams(type: SynapseContentType, params: unknown): SynapseCreateContentPayload {
  const base = normalizeBase(type, params)
  const record = asRecord(params)
  if (type === "rule") {
    const name = normalizeContentNameInput(requiredString(record, "name"))
    const nameError = validateContentNameInput(name)
    if (nameError) throw new ContentCapabilityError("validation_error", "内容字段校验失败。", { fields: { name: nameError } })
    return { ...base, name }
  }
  if (type === "skill") {
    const name = normalizeSkillNameInput(requiredString(record, "name"))
    const nameError = validateSkillNameInput(name)
    if (nameError) throw new ContentCapabilityError("validation_error", "内容字段校验失败。", { fields: { name: nameError } })
    const hasFiles = record.files !== undefined
    const hasSourceDirectoryPath = stringParam(record, "sourceDirectoryPath").length > 0
    if (hasFiles && hasSourceDirectoryPath) {
      throw new ContentCapabilityError("validation_error", "内容字段校验失败。", { fields: { files: "files 和 sourceDirectoryPath 不能同时传。" } })
    }
    return { ...base, name, files: normalizeSkillFiles(record.files) }
  }
  return base
}

export function normalizeUpdateContentParams(type: SynapseContentType, params: unknown): SynapseUpdateContentPayload {
  const record = asRecord(params)
  const id = requiredString(record, "id")
  const baseHistoryDirname = requiredString(record, "baseHistoryDirname")
  return {
    ...normalizeCreateContentParams(type, params),
    id,
    baseHistoryDirname,
  } as SynapseUpdateContentPayload
}

export function normalizeDeleteContentParams(params: unknown): { id: string; baseHistoryDirname: string } {
  const record = asRecord(params)
  return {
    id: requiredString(record, "id"),
    baseHistoryDirname: requiredString(record, "baseHistoryDirname"),
  }
}

export function describeContentTypes(params: { contentType?: SynapseContentType }) {
  const contentTypes = params.contentType ? [params.contentType] : getAllContentTypeIds()
  return {
    contentTypes: contentTypes.map((type) => {
      const definition = getContentTypeDefinition(type)
      return {
        type,
        label: definition.singularLabel,
        requiredFields: type === "prompt"
          ? ["title", "description", "category", "content"]
          : ["name", "title", "description", "category", "content"],
        optionalFields: type === "skill"
          ? ["usage", "files", "sourceDirectoryPath", "iconType", "icon", "iconBg", "iconImagePath", "iconImageBase64"]
          : ["usage", "iconType", "icon", "iconBg", "iconImagePath", "iconImageBase64"],
        categories: definition.categories.map(({ id, label, description }) => ({ id, label, description })),
        defaults: { iconType: "icon", iconBg: DEFAULT_SYNAPSE_CONTENT_COLOR_VALUE },
        icons: SYNAPSE_CONTENT_ICON_OPTIONS.map(({ value, label }) => ({ value, label })),
        backgroundColors: SYNAPSE_CONTENT_COLOR_OPTIONS.map(({ value, label }) => ({ value, label })),
        constraints: {
          attachments: type === "skill"
            ? {
                maxFileSizeBytes: MAX_SKILL_ATTACHMENT_SIZE,
                maxTotalSizeBytes: MAX_SKILL_ATTACHMENT_TOTAL_SIZE,
                maxCount: MAX_SKILL_ATTACHMENT_COUNT,
              }
            : null,
          iconImage: {
            maxInputBytes: MAX_CONTENT_ICON_IMAGE_INPUT_SIZE,
            outputFormat: "png",
            outputSizePx: CONTENT_ICON_IMAGE_OUTPUT_SIZE,
          },
        },
      }
    }),
  }
}
```

- [ ] **Step 6: Run validator tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/content-capability-validator.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add desktop/electron/services/content-capability-errors.ts desktop/electron/services/content-skill-attachment-constraints.ts desktop/electron/services/content-capability-validator.ts desktop/electron/services/__tests__/content-capability-validator.test.ts
git commit -m "feat(content): validate mcp publishing payloads"
```

---

### Task 3: Implement Skill Source Directory Import

**Files:**
- Create: `desktop/electron/services/content-skill-source-service.ts`
- Test: `desktop/electron/services/__tests__/content-skill-source-service.test.ts`
- Modify: `desktop/electron/services/editor-scan-service.ts`

- [ ] **Step 1: Write failing source directory tests**

Create `desktop/electron/services/__tests__/content-skill-source-service.test.ts`:

```ts
import { randomUUID } from "node:crypto"
import { mkdir, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { readSkillDraftFromDirectory } from "../content-skill-source-service"

const roots: string[] = []

async function makeRoot() {
  const root = path.join(os.tmpdir(), `synapse-skill-source-${randomUUID()}`)
  await mkdir(root, { recursive: true })
  roots.push(root)
  return root
}

describe("readSkillDraftFromDirectory", () => {
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  it("reads SKILL.md frontmatter and preserves nested attachments", async () => {
    const root = await makeRoot()
    await mkdir(path.join(root, "references"), { recursive: true })
    await writeFile(path.join(root, "SKILL.md"), [
      "---",
      "name: api-reviewer",
      "title: API Reviewer",
      "description: Reviews APIs",
      "category: development",
      "---",
      "# API Reviewer",
      "",
      "Use this skill.",
    ].join("\n"), "utf8")
    await writeFile(path.join(root, "references", "checklist.md"), "checklist", "utf8")
    await writeFile(path.join(root, ".synapse.json"), "{}", "utf8")
    await writeFile(path.join(root, ".hidden"), "hidden", "utf8")

    const draft = await readSkillDraftFromDirectory(root)
    expect(draft.metadata).toMatchObject({
      name: "api-reviewer",
      title: "API Reviewer",
      description: "Reviews APIs",
      category: "development",
    })
    expect(draft.content).toContain("# API Reviewer")
    expect(draft.files.map((file) => file.originalName)).toEqual(["references/checklist.md"])
    expect(Buffer.from(draft.files[0]!.bytes).toString("utf8")).toBe("checklist")
  })

  it("skips symlinks and rejects sensitive attachment extensions", async () => {
    const root = await makeRoot()
    await writeFile(path.join(root, "SKILL.md"), "# Skill", "utf8")
    await writeFile(path.join(root, "secret.pem"), "secret", "utf8")
    await symlink(path.join(root, "secret.pem"), path.join(root, "linked.pem"))

    await expect(readSkillDraftFromDirectory(root)).rejects.toThrow(/敏感文件/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/content-skill-source-service.test.ts
```

Expected: FAIL because service does not exist.

- [ ] **Step 3: Implement source service**

Create `desktop/electron/services/content-skill-source-service.ts`:

```ts
import { lstat, readFile, readdir, stat } from "node:fs/promises"
import path from "node:path"
import { parseFrontmatterBlock } from "../../src/definitions/editor/shared-yaml-scalar"
import { ContentCapabilityError } from "./content-capability-errors"
import {
  MAX_SKILL_ATTACHMENT_COUNT,
  MAX_SKILL_ATTACHMENT_SIZE,
  MAX_SKILL_ATTACHMENT_TOTAL_SIZE,
  SENSITIVE_SKILL_ATTACHMENT_EXTENSIONS,
  SENSITIVE_SKILL_ATTACHMENT_NAMES,
} from "./content-skill-attachment-constraints"

const SYNAPSE_SKILL_ID_FILE = ".synapse.json"
const SKILL_MAIN_FILE_PRIORITY = ["SKILL.md", "skill.md", "README.md", "readme.md"]

export type SkillDirectoryDraftFile = {
  originalName: string
  size: number
  bytes: Uint8Array
}

export type SkillDirectoryDraft = {
  content: string
  files: SkillDirectoryDraftFile[]
  metadata: Record<string, string>
}

function toPortableRelativePath(relativeName: string): string {
  return relativeName.split(path.sep).join("/")
}

function stripFrontmatter(content: string): { metadata: Record<string, string>; body: string } {
  if (!content.startsWith("---")) return { metadata: {}, body: content }
  const end = content.indexOf("\n---", 3)
  if (end < 0) return { metadata: {}, body: content }
  const { metadata } = parseFrontmatterBlock(content.slice(3, end))
  return { metadata, body: content.slice(end + 4).replace(/^\r?\n/u, "") }
}

async function resolveSkillMainFile(dirPath: string): Promise<string | null> {
  let children: string[]
  try {
    children = await readdir(dirPath)
  } catch {
    return null
  }
  for (const candidate of SKILL_MAIN_FILE_PRIORITY) {
    if (children.includes(candidate)) return path.join(dirPath, candidate)
  }
  const mdFiles = children.filter((name) => name.endsWith(".md")).sort()
  return mdFiles.length > 0 ? path.join(dirPath, mdFiles[0]) : null
}

function isSensitiveAttachmentPath(relativePath: string): boolean {
  const baseName = path.basename(relativePath).toLowerCase()
  return SENSITIVE_SKILL_ATTACHMENT_NAMES.has(baseName) || SENSITIVE_SKILL_ATTACHMENT_EXTENSIONS.has(path.extname(baseName))
}

async function collectFiles(
  baseDir: string,
  currentDir: string,
  skipRootNames: Set<string>,
  entries: SkillDirectoryDraftFile[],
  state: { fileCount: number; totalSize: number },
): Promise<void> {
  let children: string[]
  try {
    children = await readdir(currentDir)
  } catch {
    return
  }
  for (const name of children) {
    if (name.startsWith(".")) continue
    if (currentDir === baseDir && skipRootNames.has(name)) continue

    const fullPath = path.join(currentDir, name)
    const relativeName = toPortableRelativePath(path.relative(baseDir, fullPath))
    const fileStat = await lstat(fullPath).catch(() => null)
    if (!fileStat || fileStat.isSymbolicLink()) continue
    if (fileStat.isDirectory()) {
      await collectFiles(baseDir, fullPath, skipRootNames, entries, state)
      continue
    }
    if (!fileStat.isFile()) continue
    if (isSensitiveAttachmentPath(relativeName)) {
      throw new ContentCapabilityError("validation_error", "内容字段校验失败。", { fields: { files: `附件包含敏感文件：${relativeName}` } })
    }
    if (fileStat.size > MAX_SKILL_ATTACHMENT_SIZE) {
      throw new ContentCapabilityError("validation_error", "内容字段校验失败。", { fields: { files: `附件超过 10MB：${relativeName}` } })
    }
    state.fileCount += 1
    if (state.fileCount > MAX_SKILL_ATTACHMENT_COUNT) {
      throw new ContentCapabilityError("validation_error", "内容字段校验失败。", { fields: { files: `附件数量超过 ${MAX_SKILL_ATTACHMENT_COUNT} 个。` } })
    }
    state.totalSize += fileStat.size
    if (state.totalSize > MAX_SKILL_ATTACHMENT_TOTAL_SIZE) {
      throw new ContentCapabilityError("validation_error", "内容字段校验失败。", { fields: { files: "附件总大小超过 50MB。" } })
    }
    entries.push({
      originalName: relativeName,
      size: fileStat.size,
      bytes: new Uint8Array(await readFile(fullPath)),
    })
  }
}

export async function readSkillDraftFromDirectory(sourceDirectoryPath: string): Promise<SkillDirectoryDraft> {
  const info = await stat(sourceDirectoryPath).catch(() => null)
  if (!info?.isDirectory()) {
    throw new ContentCapabilityError("source_read_error", "Skill 路径不是文件夹。")
  }
  const mainFile = await resolveSkillMainFile(sourceDirectoryPath)
  if (!mainFile) {
    throw new ContentCapabilityError("source_read_error", "未找到 Skill 主文件。")
  }
  const rawContent = await readFile(mainFile, "utf8")
  if (!rawContent.trim()) {
    throw new ContentCapabilityError("validation_error", "Skill 主说明为空。")
  }
  const parsed = stripFrontmatter(rawContent)
  const files: SkillDirectoryDraftFile[] = []
  await collectFiles(sourceDirectoryPath, sourceDirectoryPath, new Set([path.basename(mainFile), SYNAPSE_SKILL_ID_FILE]), files, {
    fileCount: 0,
    totalSize: 0,
  })
  files.sort((left, right) => left.originalName.localeCompare(right.originalName))
  return {
    content: parsed.body,
    files,
    metadata: parsed.metadata,
  }
}
```

- [ ] **Step 4: Replace quick-publish duplication**

Modify `desktop/electron/services/editor-scan-service.ts`:

- Import `readSkillDraftFromDirectory`.
- In `prepareQuickPublishDraft`, replace local `resolveSkillMainFile`/`collectSkillFileSnapshots` usage for quick publish with `readSkillDraftFromDirectory(request.itemPath)`.
- Keep `readItemContent` and `listSkillFiles` helpers unchanged unless their local helpers are still needed.

Patch shape:

```ts
import { readSkillDraftFromDirectory } from "./content-skill-source-service"
```

Inside Skill branch of `prepareQuickPublishDraft`:

```ts
const draftFromDirectory = await readSkillDraftFromDirectory(request.itemPath)

const draft = {
  itemType: "skill" as const,
  itemPath: request.itemPath,
  itemName: request.itemName,
  content: draftFromDirectory.content,
  files: draftFromDirectory.files,
  metadata: {
    ...draftFromDirectory.metadata,
    ...(request.metadata ?? {}),
  },
}
```

- [ ] **Step 5: Run source and existing editor scan tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/content-skill-source-service.test.ts electron/services/__tests__/editor-scan-service.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add desktop/electron/services/content-skill-source-service.ts desktop/electron/services/__tests__/content-skill-source-service.test.ts desktop/electron/services/editor-scan-service.ts
git commit -m "feat(content): import skill directories for mcp publishing"
```

---

### Task 4: Implement Icon Image Processing

**Files:**
- Create: `desktop/electron/services/content-icon-image-service.ts`
- Test: `desktop/electron/services/__tests__/content-icon-image-service.test.ts`

- [ ] **Step 1: Write failing image service tests**

Create `desktop/electron/services/__tests__/content-icon-image-service.test.ts`:

```ts
import { randomUUID } from "node:crypto"
import { mkdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

const nativeImageMock = vi.hoisted(() => ({
  createFromBuffer: vi.fn(),
}))

vi.mock("electron", () => ({
  nativeImage: nativeImageMock,
}))

import { prepareContentIconImage } from "../content-icon-image-service"
import { CONTENT_ICON_IMAGE_OUTPUT_SIZE } from "../content-skill-attachment-constraints"

const roots: string[] = []

async function makeRoot() {
  const root = path.join(os.tmpdir(), `synapse-icon-image-${randomUUID()}`)
  await mkdir(root, { recursive: true })
  roots.push(root)
  return root
}

describe("prepareContentIconImage", () => {
  afterEach(async () => {
    nativeImageMock.createFromBuffer.mockReset()
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  it("center-crops and resizes a local image path to png bytes", async () => {
    const root = await makeRoot()
    const filePath = path.join(root, "icon.png")
    await writeFile(filePath, Buffer.from("image-bytes"))
    const cropped = { resize: vi.fn(() => ({ toPNG: () => Buffer.from("png") })) }
    const image = {
      isEmpty: () => false,
      getSize: () => ({ width: 400, height: 200 }),
      crop: vi.fn(() => cropped),
    }
    nativeImageMock.createFromBuffer.mockReturnValue(image)

    const result = await prepareContentIconImage({ iconImagePath: filePath })
    expect(image.crop).toHaveBeenCalledWith({ x: 100, y: 0, width: 200, height: 200 })
    expect(cropped.resize).toHaveBeenCalledWith({ width: CONTENT_ICON_IMAGE_OUTPUT_SIZE, height: CONTENT_ICON_IMAGE_OUTPUT_SIZE, quality: "best" })
    expect(Buffer.from(result.bytes).toString("utf8")).toBe("png")
  })

  it("rejects invalid images and oversized input", async () => {
    nativeImageMock.createFromBuffer.mockReturnValue({ isEmpty: () => true })
    await expect(prepareContentIconImage({ iconImageBase64: Buffer.from("x").toString("base64") }))
      .rejects.toThrow(/有效图片/)

    const tooLarge = Buffer.alloc(5 * 1024 * 1024 + 1).toString("base64")
    await expect(prepareContentIconImage({ iconImageBase64: tooLarge })).rejects.toThrow(/超过 5MB/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/content-icon-image-service.test.ts
```

Expected: FAIL because service does not exist.

- [ ] **Step 3: Implement image service**

Create `desktop/electron/services/content-icon-image-service.ts`:

```ts
import { readFile } from "node:fs/promises"
import { nativeImage } from "electron"
import { ContentCapabilityError } from "./content-capability-errors"
import {
  CONTENT_ICON_IMAGE_FILE_NAME,
  CONTENT_ICON_IMAGE_OUTPUT_SIZE,
  MAX_CONTENT_ICON_IMAGE_INPUT_SIZE,
} from "./content-skill-attachment-constraints"

type PrepareContentIconImageInput = {
  iconImagePath?: unknown
  iconImageBase64?: unknown
}

export type PreparedContentIconImage = {
  iconImage: typeof CONTENT_ICON_IMAGE_FILE_NAME
  bytes: Uint8Array
}

async function readInputBuffer(input: PrepareContentIconImageInput): Promise<Buffer | null> {
  const pathValue = typeof input.iconImagePath === "string" ? input.iconImagePath.trim() : ""
  const base64Value = typeof input.iconImageBase64 === "string" ? input.iconImageBase64.trim() : ""
  if (pathValue && base64Value) {
    throw new ContentCapabilityError("validation_error", "内容字段校验失败。", { fields: { iconImage: "iconImagePath 和 iconImageBase64 不能同时传。" } })
  }
  if (!pathValue && !base64Value) return null
  if (pathValue) {
    try {
      return await readFile(pathValue)
    } catch {
      throw new ContentCapabilityError("source_read_error", "读取图片失败。")
    }
  }
  return Buffer.from(base64Value, "base64")
}

export async function prepareContentIconImage(input: PrepareContentIconImageInput): Promise<PreparedContentIconImage | null> {
  const buffer = await readInputBuffer(input)
  if (!buffer) return null
  if (buffer.byteLength > MAX_CONTENT_ICON_IMAGE_INPUT_SIZE) {
    throw new ContentCapabilityError("image_error", "图片超过 5MB。")
  }

  const image = nativeImage.createFromBuffer(buffer)
  if (image.isEmpty()) {
    throw new ContentCapabilityError("image_error", "图片不是有效图片。")
  }

  const size = image.getSize()
  const side = Math.min(size.width, size.height)
  if (side <= 0) {
    throw new ContentCapabilityError("image_error", "图片尺寸无效。")
  }

  const cropped = image.crop({
    x: Math.floor((size.width - side) / 2),
    y: Math.floor((size.height - side) / 2),
    width: side,
    height: side,
  })
  const resized = cropped.resize({
    width: CONTENT_ICON_IMAGE_OUTPUT_SIZE,
    height: CONTENT_ICON_IMAGE_OUTPUT_SIZE,
    quality: "best",
  })

  return {
    iconImage: CONTENT_ICON_IMAGE_FILE_NAME,
    bytes: new Uint8Array(resized.toPNG()),
  }
}
```

- [ ] **Step 4: Run image service tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/content-icon-image-service.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/electron/services/content-icon-image-service.ts desktop/electron/services/__tests__/content-icon-image-service.test.ts
git commit -m "feat(content): prepare mcp icon images"
```

---

### Task 5: Implement Content Dispatcher

**Files:**
- Create: `desktop/electron/capabilities/content-dispatcher.ts`
- Test: `desktop/electron/capabilities/__tests__/content-dispatcher.test.ts`

- [ ] **Step 1: Write failing dispatcher tests**

Create `desktop/electron/capabilities/__tests__/content-dispatcher.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"
import { createContentDispatcher } from "../content-dispatcher"
import type { SynapseContentDetail } from "../../../src/types/content"

function detail(overrides: Partial<SynapseContentDetail> = {}): SynapseContentDetail {
  return {
    id: "skill-1",
    type: "skill",
    title: "Skill",
    name: "skill-one",
    description: "Description",
    category: "development",
    icon: "wrench",
    iconBg: "graphite",
    iconType: "icon",
    iconImage: "",
    createdBy: "user-1",
    createdByDisplayName: "User One",
    createdAt: "2026-05-21T00:00:00.000Z",
    modifiedBy: "user-1",
    modifiedByDisplayName: "User One",
    modifiedAt: "2026-05-21T00:00:00.000Z",
    deleted: false,
    latestHistoryDirname: "hist-1",
    attachmentCount: 0,
    content: "# Skill",
    attachments: [],
    source: "repository",
    isReadonly: false,
    ...overrides,
  }
}

function makeDeps(overrides: Record<string, unknown> = {}) {
  return {
    contentService: {
      listContent: vi.fn(async () => [detail()]),
      getDetail: vi.fn(async () => detail()),
    },
    contentSubmissionService: {
      createContent: vi.fn(async () => ({ status: "saved", id: "new-1", type: "skill", title: "Skill", latestHistoryDirname: "hist-2", modifiedAt: "now", pushed: false, pendingPushCount: 0, message: "saved" })),
      updateContent: vi.fn(async () => ({ status: "saved", id: "skill-1", type: "skill", title: "Skill", latestHistoryDirname: "hist-2", modifiedAt: "now", pushed: false, pendingPushCount: 0, message: "saved" })),
      deleteContent: vi.fn(async () => ({ status: "saved", id: "skill-1", type: "skill", title: "Skill", latestHistoryDirname: "hist-2", modifiedAt: "now", pushed: false, pendingPushCount: 0, message: "saved" })),
    },
    getCurrentIdentity: vi.fn(async () => ({ userId: "user-1", displayName: "User One" })),
    readSkillDraftFromDirectory: vi.fn(),
    prepareContentIconImage: vi.fn(async () => null),
    ...overrides,
  }
}

describe("content dispatcher", () => {
  it("lists and gets content", async () => {
    const deps = makeDeps()
    const dispatcher = createContentDispatcher(deps)
    await expect(dispatcher.dispatch("content.skill.list", {}, { source: "api" })).resolves.toMatchObject({ ok: true })
    await expect(dispatcher.dispatch("content.skill.get", { id: "skill-1" }, { source: "api" })).resolves.toMatchObject({ ok: true, data: { id: "skill-1" } })
  })

  it("creates skill content through contentSubmissionService", async () => {
    const deps = makeDeps()
    const dispatcher = createContentDispatcher(deps)
    await expect(dispatcher.dispatch("content.skill.create", {
      name: "skill-one",
      title: "Skill",
      description: "Description",
      category: "development",
      iconType: "icon",
      icon: "wrench",
      iconBg: "graphite",
      content: "# Skill",
    }, { source: "api" })).resolves.toMatchObject({ ok: true, data: { status: "saved" } })
    expect(deps.contentSubmissionService.createContent).toHaveBeenCalledWith(expect.objectContaining({ contentType: "skill" }))
  })

  it("rejects update by non-owner", async () => {
    const deps = makeDeps({
      contentService: {
        listContent: vi.fn(),
        getDetail: vi.fn(async () => detail({ createdBy: "user-2" })),
      },
    })
    const dispatcher = createContentDispatcher(deps)
    await expect(dispatcher.dispatch("content.skill.update", {
      id: "skill-1",
      baseHistoryDirname: "hist-1",
      name: "skill-one",
      title: "Skill",
      description: "Description",
      category: "development",
      iconType: "icon",
      icon: "wrench",
      iconBg: "graphite",
      content: "# Updated",
    }, { source: "api" })).resolves.toMatchObject({
      ok: true,
      data: { ok: false, code: "not_owner" },
    })
  })

  it("returns conflict when baseHistoryDirname is stale", async () => {
    const deps = makeDeps()
    const dispatcher = createContentDispatcher(deps)
    await expect(dispatcher.dispatch("content.skill.delete", {
      id: "skill-1",
      baseHistoryDirname: "old",
    }, { source: "api" })).resolves.toMatchObject({
      ok: true,
      data: { ok: false, code: "conflict", latestHistoryDirname: "hist-1" },
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/capabilities/__tests__/content-dispatcher.test.ts
```

Expected: FAIL because dispatcher does not exist.

- [ ] **Step 3: Implement dispatcher**

Create `desktop/electron/capabilities/content-dispatcher.ts`:

```ts
import type { DispatchContext, DispatchResult } from "../../synapse-capabilities/shared/types"
import type { SynapseContentDetail, SynapseContentType, SynapseCreateContentRequest, SynapseDeleteContentPayload, SynapseUpdateContentRequest } from "../../src/types/content"
import { ContentCapabilityError, contentCapabilityErrorPayload } from "../services/content-capability-errors"
import { describeContentTypes, normalizeCreateContentParams, normalizeDeleteContentParams, normalizeUpdateContentParams } from "../services/content-capability-validator"
import type { readSkillDraftFromDirectory as readSkillDraftFromDirectoryFn } from "../services/content-skill-source-service"
import type { prepareContentIconImage as prepareContentIconImageFn } from "../services/content-icon-image-service"

type ContentServiceLike = {
  listContent: (type: SynapseContentType) => Promise<unknown>
  getDetail: (type: SynapseContentType, id: string) => Promise<SynapseContentDetail>
}

type ContentSubmissionServiceLike = {
  createContent: (request: SynapseCreateContentRequest) => Promise<unknown>
  updateContent: (request: SynapseUpdateContentRequest) => Promise<unknown>
  deleteContent: (payload: SynapseDeleteContentPayload) => Promise<unknown>
}

export type ContentDispatchDeps = {
  contentService: ContentServiceLike
  contentSubmissionService: ContentSubmissionServiceLike
  getCurrentIdentity: () => Promise<{ userId: string; displayName: string }>
  readSkillDraftFromDirectory: typeof readSkillDraftFromDirectoryFn
  prepareContentIconImage: typeof prepareContentIconImageFn
}

function ok(data: unknown): DispatchResult {
  return { ok: true, data }
}

function actionType(action: string): SynapseContentType | null {
  if (action.startsWith("content.rule.")) return "rule"
  if (action.startsWith("content.skill.")) return "skill"
  if (action.startsWith("content.prompt.")) return "prompt"
  return null
}

async function assertOwnerAndVersion(deps: ContentDispatchDeps, type: SynapseContentType, id: string, baseHistoryDirname: string) {
  const [detail, identity] = await Promise.all([
    deps.contentService.getDetail(type, id),
    deps.getCurrentIdentity(),
  ])
  if (detail.createdBy !== identity.userId) {
    throw new ContentCapabilityError("not_owner", "只能更新或删除自己创建的内容。")
  }
  if (detail.latestHistoryDirname !== baseHistoryDirname) {
    throw new ContentCapabilityError("conflict", "内容已被更新，请重新读取后再提交。", {
      data: {
        latestHistoryDirname: detail.latestHistoryDirname,
        latestModifiedAt: detail.modifiedAt,
        latestModifiedByDisplayName: detail.modifiedByDisplayName,
      },
    })
  }
  return detail
}

async function withIconImage(deps: ContentDispatchDeps, payload: Record<string, unknown>) {
  if (payload.iconType !== "image") return payload
  const prepared = await deps.prepareContentIconImage(payload)
  if (!prepared) {
    throw new ContentCapabilityError("validation_error", "内容字段校验失败。", { fields: { iconImage: "请提供 iconImagePath 或 iconImageBase64。" } })
  }
  return {
    ...payload,
    iconImage: prepared.iconImage,
    iconImageBytes: prepared.bytes,
  }
}

async function mergeSkillSourceDirectory(deps: ContentDispatchDeps, params: Record<string, unknown>) {
  const sourceDirectoryPath = typeof params.sourceDirectoryPath === "string" ? params.sourceDirectoryPath.trim() : ""
  if (!sourceDirectoryPath) return params
  const draft = await deps.readSkillDraftFromDirectory(sourceDirectoryPath)
  return {
    ...draft.metadata,
    content: draft.content,
    files: draft.files.map((file) => ({
      path: file.originalName,
      contentBase64: Buffer.from(file.bytes).toString("base64"),
    })),
    ...params,
    sourceDirectoryPath: undefined,
  }
}

export function createContentDispatcher(deps: ContentDispatchDeps) {
  return {
    async dispatch(action: string, params: Record<string, unknown>, _context: DispatchContext): Promise<DispatchResult> {
      try {
        if (action === "content.type.describe") {
          return ok(describeContentTypes({ contentType: params.contentType as SynapseContentType | undefined }))
        }
        const type = actionType(action)
        if (!type) throw new Error(`Unknown content action: ${action}`)
        if (action.endsWith(".list")) {
          return ok(await deps.contentService.listContent(type))
        }
        if (action.endsWith(".get")) {
          const id = typeof params.id === "string" ? params.id.trim() : ""
          if (!id) throw new ContentCapabilityError("validation_error", "内容字段校验失败。", { fields: { id: "id 不能为空。" } })
          return ok(await deps.contentService.getDetail(type, id))
        }
        if (action.endsWith(".create")) {
          const merged = type === "skill" ? await mergeSkillSourceDirectory(deps, params) : params
          const payload = normalizeCreateContentParams(type, await withIconImage(deps, merged))
          return ok(await deps.contentSubmissionService.createContent({ contentType: type, payload } as SynapseCreateContentRequest))
        }
        if (action.endsWith(".update")) {
          const merged = type === "skill" ? await mergeSkillSourceDirectory(deps, params) : params
          const payload = normalizeUpdateContentParams(type, await withIconImage(deps, merged))
          await assertOwnerAndVersion(deps, type, payload.id, payload.baseHistoryDirname)
          return ok(await deps.contentSubmissionService.updateContent({ contentType: type, payload } as SynapseUpdateContentRequest))
        }
        if (action.endsWith(".delete")) {
          const payload = normalizeDeleteContentParams(params)
          await assertOwnerAndVersion(deps, type, payload.id, payload.baseHistoryDirname)
          return ok(await deps.contentSubmissionService.deleteContent({ id: payload.id, type, baseHistoryDirname: payload.baseHistoryDirname }))
        }
        throw new Error(`Unknown content action: ${action}`)
      } catch (error) {
        const structured = contentCapabilityErrorPayload(error)
        if (structured) return ok(structured)
        throw error
      }
    },
  }
}
```

- [ ] **Step 4: Run dispatcher tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/capabilities/__tests__/content-dispatcher.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/electron/capabilities/content-dispatcher.ts desktop/electron/capabilities/__tests__/content-dispatcher.test.ts
git commit -m "feat(content): dispatch mcp publishing actions"
```

---

### Task 6: Wire Content Dispatcher Into Action Router and MCP

**Files:**
- Modify: `desktop/electron/capabilities/action-router.ts`
- Modify: `desktop/electron/capabilities/__tests__/action-router.test.ts`
- Modify: `desktop/electron/bootstrap/descriptors.ts`
- Modify: `desktop/electron/bootstrap/__tests__/descriptors.test.ts`
- Test: `desktop/tests/unit/database-mcp-rpc.test.ts`

- [ ] **Step 1: Write failing router test**

Append to `desktop/electron/capabilities/__tests__/action-router.test.ts`:

```ts
it("routes Content actions to the Content dispatcher", async () => {
  const databaseDispatch = vi.fn()
  const schedulerDispatch = vi.fn()
  const workflowDispatch = vi.fn()
  const contentDispatch = vi.fn(async () => ({ ok: true as const, data: [] }))
  const router = createSynapseActionRouter({
    databaseDispatch,
    schedulerDispatch,
    workflowDispatch,
    contentDispatch,
  })

  await expect(router.dispatch("content.skill.list", {}, { source: "api" })).resolves.toEqual({
    ok: true,
    data: [],
  })
  expect(contentDispatch).toHaveBeenCalledWith("content.skill.list", {}, { source: "api" })
  expect(databaseDispatch).not.toHaveBeenCalled()
  expect(schedulerDispatch).not.toHaveBeenCalled()
  expect(workflowDispatch).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run router test to verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/capabilities/__tests__/action-router.test.ts
```

Expected: FAIL because `contentDispatch` is not accepted.

- [ ] **Step 3: Update action router**

Modify `desktop/electron/capabilities/action-router.ts`:

```ts
export type SynapseActionRouterDeps = {
  readonly databaseDispatch: DomainDispatch
  readonly schedulerDispatch: DomainDispatch
  readonly workflowDispatch: DomainDispatch
  readonly contentDispatch: DomainDispatch
}
```

Add route:

```ts
if (domainId === "content") return deps.contentDispatch(action, params, context)
```

Update existing tests in `action-router.test.ts` to provide `contentDispatch: vi.fn()` in every `createSynapseActionRouter` call.

- [ ] **Step 4: Wire bootstrap descriptor**

Modify imports in `desktop/electron/bootstrap/descriptors.ts`:

```ts
import { createContentDispatcher } from "../capabilities/content-dispatcher"
import { contentService } from "../services/content-service"
import { contentSubmissionService } from "../services/content-submission-service"
import { userIdentityService } from "../services/user-identity-service"
import { getActiveRepositoryConfig } from "../../src/lib/config"
import { configStore } from "../services/config-store"
import { readSkillDraftFromDirectory } from "../services/content-skill-source-service"
import { prepareContentIconImage } from "../services/content-icon-image-service"
```

Inside `coreDatabaseDescriptor.create`, before `createSynapseActionRouter`:

```ts
const contentDispatcher = createContentDispatcher({
  contentService,
  contentSubmissionService,
  readSkillDraftFromDirectory,
  prepareContentIconImage,
  getCurrentIdentity: async () => {
    const config = await configStore.load()
    const repository = getActiveRepositoryConfig(config)
    if (!repository) {
      throw new Error("当前还没有选中的本地目录。")
    }
    return userIdentityService.requireReadyRepoProfile(repository.uuid)
  },
})
```

Pass into router:

```ts
contentDispatch: (action, params, context) => contentDispatcher.dispatch(action, params, context),
```

- [ ] **Step 5: Run router and bootstrap tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/capabilities/__tests__/action-router.test.ts electron/bootstrap/__tests__/descriptors.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run MCP RPC smoke test**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run tests/unit/database-mcp-rpc.test.ts tests/unit/synapse-capabilities.test.ts
```

Expected: PASS and `tools/list` includes `content_*` tools through `buildAllMcpTools()`.

- [ ] **Step 7: Commit**

```bash
git add desktop/electron/capabilities/action-router.ts desktop/electron/capabilities/__tests__/action-router.test.ts desktop/electron/bootstrap/descriptors.ts desktop/electron/bootstrap/__tests__/descriptors.test.ts
git commit -m "feat(content): route content mcp actions"
```

---

### Task 7: Add Built-In Synapse Content MCP Skill

**Files:**
- Create: `desktop/resources/templates/skills/synapse-content-mcp/meta.json`
- Create: `desktop/resources/templates/skills/synapse-content-mcp/content.md`

- [ ] **Step 1: Create built-in skill metadata**

Create `desktop/resources/templates/skills/synapse-content-mcp/meta.json`:

```json
{
  "id": "synapse-content-mcp",
  "name": "synapse-content-mcp",
  "title": "Synapse 内容 MCP",
  "usage": "让 AI 通过 Synapse MCP 发布和管理 Rule、Skill、Prompt 内容资源。\n\n- **适合**：创建、发布、更新、删除 Synapse 内容仓库中的规则、技能和提示词。\n- **会做**：先调用 content_type_describe 获取字段、分类、图标、背景色和限制；更新/删除前先 get；只更新或删除当前用户创建的资源。\n- **不做**：安装到编辑器、修改别人创建的资源、绕过版本冲突保护。",
  "description": "Use when working with Synapse content publishing through MCP tools, including rules, skills, prompts, skill attachments, content metadata, and content updates or deletion."
}
```

- [ ] **Step 2: Create built-in skill content**

Create `desktop/resources/templates/skills/synapse-content-mcp/content.md`:

```md
# Synapse Content MCP

You have access to Synapse Content MCP tools for publishing and managing Rule, Skill, and Prompt resources in the Synapse content repository.

Use this skill when the user asks to create, publish, upload, update, or delete Synapse content resources.

Do not use this skill for editor installation. Content MCP first version only manages Synapse content repository resources.

## Required Flow

1. Call `content_type_describe` before creating or updating content.
2. Choose the specific tool for the resource type: Rule, Skill, or Prompt.
3. For update or delete, call the matching `content_*_get` tool first.
4. Pass `latestHistoryDirname` from get as `baseHistoryDirname`.
5. Do not attempt to update or delete resources where `createdBy` is not the current Synapse repo profile.

## Resource Differences

Rule requires `name`, `title`, `description`, `category`, `content`, and appearance fields.

Skill requires `name`, `title`, `description`, `category`, `content`, appearance fields, and may include attachments.

Prompt requires `title`, `description`, `category`, `content`, and appearance fields. Prompt does not support editor installation.

## Skill Attachments

For new generated files, pass `files` with relative `path` values:

```json
[
  {
    "path": "references/checklist.md",
    "contentText": "# Checklist\n..."
  }
]
```

For binary files, use `contentBase64`.

When publishing an existing local Skill directory, use `sourceDirectoryPath`.

Do not pass both `files` and `sourceDirectoryPath`.

## Appearance

Use `iconType: "icon"` with `icon` and `iconBg`, or `iconType: "image"` with `iconImagePath` or `iconImageBase64`.

Allowed categories, icons, backgrounds, and limits come from `content_type_describe`.
```

- [ ] **Step 3: Verify template appears in resource tree**

Run:

```bash
find desktop/resources/templates/skills/synapse-content-mcp -type f -maxdepth 2 | sort
```

Expected:

```text
desktop/resources/templates/skills/synapse-content-mcp/content.md
desktop/resources/templates/skills/synapse-content-mcp/meta.json
```

- [ ] **Step 4: Commit**

```bash
git add desktop/resources/templates/skills/synapse-content-mcp
git commit -m "feat(content): add content mcp built-in skill"
```

---

### Task 8: Update Documentation Matrix and Run Full Verification

**Files:**
- Modify: `docs/reference/capability-naming-matrix.md`
- Modify: `website/reference/synapse-mcp-capabilities.md`
- Modify: `website/developer/capability-naming-matrix.md`

- [ ] **Step 1: Add content tools to capability matrix**

In `docs/reference/capability-naming-matrix.md`, add rows after workflow or scheduler rows:

```md
| `content.type.describe` | `content_type_describe` | `synapse content type describe` | `contentTypeDescribe` |
| `content.rule.list` | `content_rule_list` | `synapse content rule list` | `contentRuleList` |
| `content.rule.get` | `content_rule_get` | `synapse content rule get` | `contentRuleGet` |
| `content.rule.create` | `content_rule_create` | `synapse content rule create` | `contentRuleCreate` |
| `content.rule.update` | `content_rule_update` | `synapse content rule update` | `contentRuleUpdate` |
| `content.rule.delete` | `content_rule_delete` | `synapse content rule delete` | `contentRuleDelete` |
| `content.skill.list` | `content_skill_list` | `synapse content skill list` | `contentSkillList` |
| `content.skill.get` | `content_skill_get` | `synapse content skill get` | `contentSkillGet` |
| `content.skill.create` | `content_skill_create` | `synapse content skill create` | `contentSkillCreate` |
| `content.skill.update` | `content_skill_update` | `synapse content skill update` | `contentSkillUpdate` |
| `content.skill.delete` | `content_skill_delete` | `synapse content skill delete` | `contentSkillDelete` |
| `content.prompt.list` | `content_prompt_list` | `synapse content prompt list` | `contentPromptList` |
| `content.prompt.get` | `content_prompt_get` | `synapse content prompt get` | `contentPromptGet` |
| `content.prompt.create` | `content_prompt_create` | `synapse content prompt create` | `contentPromptCreate` |
| `content.prompt.update` | `content_prompt_update` | `synapse content prompt update` | `contentPromptUpdate` |
| `content.prompt.delete` | `content_prompt_delete` | `synapse content prompt delete` | `contentPromptDelete` |
```

Mirror the same domain summary in `website/reference/synapse-mcp-capabilities.md` and `website/developer/capability-naming-matrix.md`.

- [ ] **Step 2: Run targeted tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  tests/unit/synapse-capabilities.test.ts \
  tests/unit/database-mcp-rpc.test.ts \
  electron/capabilities/__tests__/action-router.test.ts \
  electron/capabilities/__tests__/content-dispatcher.test.ts \
  electron/services/__tests__/content-capability-validator.test.ts \
  electron/services/__tests__/content-skill-source-service.test.ts \
  electron/services/__tests__/content-icon-image-service.test.ts \
  electron/services/__tests__/editor-scan-service.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run hard constraints and typecheck**

Run:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
pnpm --filter @synapse/desktop run typecheck
```

Expected: PASS. If typecheck reports generated registry drift, run the project’s documented generation command:

```bash
pnpm --filter @synapse/desktop run generate:definitions-registry
```

Then rerun typecheck.

- [ ] **Step 4: Commit documentation and verification fixes**

```bash
git add docs/reference/capability-naming-matrix.md website/reference/synapse-mcp-capabilities.md website/developer/capability-naming-matrix.md
git commit -m "docs: document content mcp capabilities"
```

---

## Self-Review Notes

- Spec coverage: The plan covers the content domain, three explicit resource tool families, describe metadata, create/update/delete ownership checks, `baseHistoryDirname`, Skill attachments, source directory import, image icons, structured errors, built-in Skill, docs, and tests.
- Scope: Editor installation is excluded throughout the plan.
- Fact sources: Categories, icons, backgrounds, names, and attachment path helpers are imported from existing modules instead of copied into MCP-only lists.
- Type consistency: Public action ids use `content.<resource>.<action>`, MCP tools use underscore names, and dispatcher methods use existing content service request shapes.

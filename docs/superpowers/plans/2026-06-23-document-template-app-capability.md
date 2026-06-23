# Document Template App Capability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `document-template` system app and expose the same `.docx` template generation capability through App UI, MCP, and Workflow.

**Architecture:** Add an App Capability Package at `desktop/app-capabilities/document-template/`. Keep all `.docx` rendering and local file behavior in one main-process service, with IPC, MCP dispatcher, and Workflow node as thin adapters. Keep first-version registry wiring explicit, while preserving package-local ownership for future app capabilities.

**Tech Stack:** Electron 41, React 19, TypeScript 6, shadcn/ui, Zod, Vitest, Docxtemplater, PizZip.

---

## File Structure

Create the capability package:

```text
desktop/app-capabilities/document-template/
├── shared/
│   ├── capability.ts
│   ├── manifest.ts
│   └── schema.ts
├── main/
│   ├── dispatcher.ts
│   ├── ipc.ts
│   ├── service.ts
│   └── __tests__/
│       ├── dispatcher.test.ts
│       ├── ipc.test.ts
│       └── service.test.ts
├── renderer/
│   ├── app-definition.ts
│   ├── app-manifest.ts
│   ├── icon.png
│   ├── index.tsx
│   └── __tests__/
│       └── document-template-module.test.tsx
└── workflow-node/
    ├── card.tsx
    ├── executor.main.ts
    ├── manifest.ts
    ├── panel.tsx
    ├── schema.ts
    └── __tests__/
        ├── executor.test.ts
        └── schema.test.ts
```

Modify existing integration files:

```text
desktop/package.json
pnpm-lock.yaml
desktop/synapse-capabilities/shared/naming.ts
desktop/synapse-capabilities/shared/registry.ts
desktop/electron/capabilities/action-router.ts
desktop/electron/bootstrap/descriptors.ts
desktop/electron/bootstrap/ipc-registry.ts
desktop/electron/runtime/security/permission-guard.ts
desktop/electron/preload.ts
desktop/src/types/bridge.ts
desktop/src/modules/apps/types.ts
desktop/src/modules/apps/definitions.ts
desktop/src/modules/apps/registry.ts
desktop/src/modules/apps/components/system-app-content.tsx
desktop/workflow-nodes/register.main.ts
desktop/workflow-nodes/panel-registry.ts
desktop/resources/templates/skills/synapse-skill/content.md
desktop/resources/templates/skills/synapse-skill/meta.json
desktop/resources/templates/skills/synapse-skill/files/app/index.md
desktop/resources/templates/skills/synapse-skill/files/app/api-reference.md
RELEASE_NOTES_PENDING.md
```

Modify tests:

```text
desktop/tests/unit/api-mcp-capability-surface.test.ts
desktop/tests/unit/synapse-capabilities.test.ts
desktop/electron/capabilities/__tests__/action-router.test.ts
desktop/src/modules/apps/__tests__/registry.test.ts
desktop/electron/modules/apps/__tests__/ipc.test.ts
```

Generated files to refresh after IPC changes:

```text
desktop/electron/generated/ipc-channels.generated.ts
```

Run `pnpm --filter @synapse/desktop run generate:ipc` after adding the IPC module and preload bridge entries.

---

### Task 1: Dependencies And Shared Capability Contract

**Files:**
- Modify: `desktop/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `desktop/synapse-capabilities/shared/naming.ts`
- Create: `desktop/app-capabilities/document-template/shared/schema.ts`
- Create: `desktop/app-capabilities/document-template/shared/capability.ts`
- Create: `desktop/app-capabilities/document-template/shared/manifest.ts`
- Test: `desktop/app-capabilities/document-template/main/__tests__/service.test.ts`
- Test: `desktop/tests/unit/synapse-capabilities.test.ts`

- [ ] **Step 1: Add dependency entries**

Run:

```bash
pnpm --filter @synapse/desktop add docxtemplater pizzip
```

Expected: `desktop/package.json` and `pnpm-lock.yaml` include the new runtime dependencies.

- [ ] **Step 2: Write shared schema**

Create `desktop/app-capabilities/document-template/shared/schema.ts`:

```ts
import { z } from "zod"

export const documentTemplateInlineDataSchema = z.record(z.string(), z.unknown())

export const generateDocxInputSchema = z.object({
  templatePath: z.string().min(1),
  outputPath: z.string().min(1),
  dataPath: z.string().min(1).optional(),
  data: documentTemplateInlineDataSchema.optional(),
  overwrite: z.boolean().optional(),
}).superRefine((value, ctx) => {
  const hasDataPath = typeof value.dataPath === "string" && value.dataPath.trim().length > 0
  const hasData = value.data !== undefined
  if (hasDataPath === hasData) {
    ctx.addIssue({
      code: "custom",
      path: ["data"],
      message: "Exactly one of dataPath or data is required.",
    })
  }
})

export const generateDocxResultSchema = z.object({
  outputPath: z.string(),
  fileName: z.string(),
  size: z.number().int().nonnegative(),
  generatedAt: z.string(),
})

export type GenerateDocxInput = z.infer<typeof generateDocxInputSchema>
export type GenerateDocxResult = z.infer<typeof generateDocxResultSchema>
```

- [ ] **Step 3: Write capability constants**

Create `desktop/app-capabilities/document-template/shared/capability.ts`:

```ts
import type { CapabilityId } from "../../../synapse-capabilities/shared/naming"

export const DOCUMENT_TEMPLATE_APP_ID = "document-template" as const
export const DOCUMENT_TEMPLATE_CAPABILITY_ID =
  "app.document_template.docx.generate" as CapabilityId
export const DOCUMENT_TEMPLATE_MCP_TOOL_NAME = "app_document_template_docx_generate" as const
export const DOCUMENT_TEMPLATE_WORKFLOW_NODE_TYPE = "document_template_docx_generate" as const
```

- [ ] **Step 4: Write package manifest**

Create `desktop/app-capabilities/document-template/shared/manifest.ts`:

```ts
import {
  DOCUMENT_TEMPLATE_APP_ID,
  DOCUMENT_TEMPLATE_CAPABILITY_ID,
  DOCUMENT_TEMPLATE_MCP_TOOL_NAME,
  DOCUMENT_TEMPLATE_WORKFLOW_NODE_TYPE,
} from "./capability"

export const documentTemplateCapabilityManifest = {
  id: DOCUMENT_TEMPLATE_APP_ID,
  app: {
    id: DOCUMENT_TEMPLATE_APP_ID,
  },
  capabilities: [DOCUMENT_TEMPLATE_CAPABILITY_ID],
  mcpTools: [DOCUMENT_TEMPLATE_MCP_TOOL_NAME],
  workflowNodes: [DOCUMENT_TEMPLATE_WORKFLOW_NODE_TYPE],
} as const
```

- [ ] **Step 5: Extend canonical capability actions**

Modify `desktop/synapse-capabilities/shared/naming.ts` by adding `"generate"` to `CAPABILITY_ACTIONS`:

```ts
const CAPABILITY_ACTIONS = [
  "list",
  "get",
  "create",
  "update",
  "upsert",
  "delete",
  "count",
  "rename",
  "describe",
  "inspect",
  "enable",
  "disable",
  "read",
  "execute",
  "reorder",
  "move",
  "upload",
  "restore",
  "generate",
] as const
```

- [ ] **Step 6: Add capability action tests**

Append to `desktop/tests/unit/synapse-capabilities.test.ts`:

```ts
import { isCanonicalCapabilityId } from "../../synapse-capabilities/shared/naming"

describe("App capability naming", () => {
  it("accepts generate as a canonical app capability action", () => {
    expect(isCanonicalCapabilityId("app.document_template.docx.generate")).toBe(true)
  })
})
```

- [ ] **Step 7: Run the focused naming test**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run tests/unit/synapse-capabilities.test.ts
```

Expected before implementation: fails if `generate` is not accepted. Expected after Step 5: passes.

- [ ] **Step 8: Commit**

```bash
git add desktop/package.json pnpm-lock.yaml desktop/synapse-capabilities/shared/naming.ts desktop/app-capabilities/document-template/shared desktop/tests/unit/synapse-capabilities.test.ts
git commit -m "feat(document-template): define shared capability contract"
```

---

### Task 2: Core Docx Generation Service

**Files:**
- Create: `desktop/app-capabilities/document-template/main/service.ts`
- Test: `desktop/app-capabilities/document-template/main/__tests__/service.test.ts`

- [ ] **Step 1: Write failing service tests**

Create `desktop/app-capabilities/document-template/main/__tests__/service.test.ts`:

```ts
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import PizZip from "pizzip"
import { describe, expect, it } from "vitest"
import { createDocumentTemplateService } from "../service"

async function createTempDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "synapse-doc-template-"))
}

async function writeTemplate(filePath: string): Promise<void> {
  const zip = new PizZip()
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`)
  zip.folder("_rels")?.file(".rels", `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`)
  zip.folder("word")?.file("document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Hello {name}</w:t></w:r></w:p>
    <w:sectPr/>
  </w:body>
</w:document>`)
  const buffer = zip.generate({ type: "nodebuffer" })
  await writeFile(filePath, buffer)
}

describe("DocumentTemplateService", () => {
  it("generates a docx from inline JSON data", async () => {
    const dir = await createTempDir()
    try {
      const templatePath = path.join(dir, "template.docx")
      const outputPath = path.join(dir, "output.docx")
      await writeTemplate(templatePath)

      const result = await createDocumentTemplateService().generateDocx({
        templatePath,
        outputPath,
        data: { name: "Ada" },
      })

      expect(result.outputPath).toBe(outputPath)
      expect(result.fileName).toBe("output.docx")
      expect(result.size).toBeGreaterThan(0)
      expect(result.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
      await expect(stat(outputPath)).resolves.toMatchObject({ isFile: expect.any(Function) })
      const outputZip = new PizZip(await readFile(outputPath))
      expect(outputZip.file("word/document.xml")?.asText()).toContain("Hello Ada")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("generates a docx from a JSON file", async () => {
    const dir = await createTempDir()
    try {
      const templatePath = path.join(dir, "template.docx")
      const dataPath = path.join(dir, "data.json")
      const outputPath = path.join(dir, "output.docx")
      await writeTemplate(templatePath)
      await writeFile(dataPath, JSON.stringify({ name: "Grace" }))

      await createDocumentTemplateService().generateDocx({ templatePath, dataPath, outputPath })

      const outputZip = new PizZip(await readFile(outputPath))
      expect(outputZip.file("word/document.xml")?.asText()).toContain("Hello Grace")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("rejects existing output without overwrite", async () => {
    const dir = await createTempDir()
    try {
      const templatePath = path.join(dir, "template.docx")
      const outputPath = path.join(dir, "output.docx")
      await writeTemplate(templatePath)
      await writeFile(outputPath, "existing")

      await expect(createDocumentTemplateService().generateDocx({
        templatePath,
        outputPath,
        data: { name: "Ada" },
      })).rejects.toThrow("输出文件已存在")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("rejects invalid input combinations", async () => {
    await expect(createDocumentTemplateService().generateDocx({
      templatePath: "/tmp/template.docx",
      outputPath: "/tmp/output.docx",
    })).rejects.toThrow("Exactly one of dataPath or data is required")
  })
})
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run app-capabilities/document-template/main/__tests__/service.test.ts
```

Expected: fails because `../service` does not exist.

- [ ] **Step 3: Implement the service**

Create `desktop/app-capabilities/document-template/main/service.ts`:

```ts
import { constants } from "node:fs"
import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import Docxtemplater from "docxtemplater"
import PizZip from "pizzip"
import { generateDocxInputSchema, type GenerateDocxInput, type GenerateDocxResult } from "../shared/schema"

export type DocumentTemplateService = {
  generateDocx(input: GenerateDocxInput): Promise<GenerateDocxResult>
}

export function createDocumentTemplateService(now: () => Date = () => new Date()): DocumentTemplateService {
  return {
    async generateDocx(input) {
      const parsed = generateDocxInputSchema.parse(input)
      await assertDocxPath(parsed.templatePath, "模板文件")
      await assertDocxOutputPath(parsed.outputPath)
      await assertFileReadable(parsed.templatePath, "模板文件不存在或不可读取")
      await assertOutputWritable(parsed.outputPath, parsed.overwrite === true)

      const data = parsed.dataPath
        ? await readJsonObject(parsed.dataPath)
        : parsed.data

      if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw new Error("JSON 数据必须是对象")
      }

      const templateBytes = await readFile(parsed.templatePath)
      let output: Buffer
      try {
        const zip = new PizZip(templateBytes)
        const doc = new Docxtemplater(zip, {
          paragraphLoop: true,
          linebreaks: true,
        })
        doc.render(data)
        output = doc.getZip().generate({
          type: "nodebuffer",
          compression: "DEFLATE",
          mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        }) as Buffer
      } catch (error) {
        throw new Error(`Word 模板渲染失败：${formatTemplateError(error)}`)
      }

      await mkdir(path.dirname(parsed.outputPath), { recursive: false })
      await writeFile(parsed.outputPath, output, { flag: parsed.overwrite ? "w" : "wx" })
      const outputStat = await stat(parsed.outputPath)

      return {
        outputPath: parsed.outputPath,
        fileName: path.basename(parsed.outputPath),
        size: outputStat.size,
        generatedAt: now().toISOString(),
      }
    },
  }
}

async function assertDocxPath(filePath: string, label: string): Promise<void> {
  if (path.extname(filePath).toLowerCase() !== ".docx") {
    throw new Error(`${label}必须是 .docx 文件`)
  }
}

async function assertDocxOutputPath(filePath: string): Promise<void> {
  if (path.extname(filePath).toLowerCase() !== ".docx") {
    throw new Error("输出文件必须是 .docx 文件")
  }
}

async function assertFileReadable(filePath: string, message: string): Promise<void> {
  try {
    await access(filePath, constants.R_OK)
  } catch {
    throw new Error(message)
  }
}

async function assertOutputWritable(outputPath: string, overwrite: boolean): Promise<void> {
  try {
    await access(outputPath, constants.F_OK)
    if (!overwrite) throw new Error("输出文件已存在，请启用覆盖后重试")
  } catch (error) {
    if (error instanceof Error && error.message.includes("输出文件已存在")) throw error
  }
}

async function readJsonObject(dataPath: string): Promise<Record<string, unknown>> {
  if (path.extname(dataPath).toLowerCase() !== ".json") {
    throw new Error("JSON 文件必须是 .json 文件")
  }
  const text = await readFile(dataPath, "utf-8")
  const parsed = JSON.parse(text) as unknown
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("JSON 文件内容必须是对象")
  }
  return parsed as Record<string, unknown>
}

function formatTemplateError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return String(error)
}
```

- [ ] **Step 4: Run service tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run app-capabilities/document-template/main/__tests__/service.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/app-capabilities/document-template/main/service.ts desktop/app-capabilities/document-template/main/__tests__/service.test.ts
git commit -m "feat(document-template): add docx generation service"
```

---

### Task 3: MCP App Domain And Dispatcher

**Files:**
- Create: `desktop/synapse-capabilities/shared/app-domain.ts`
- Modify: `desktop/synapse-capabilities/shared/registry.ts`
- Modify: `desktop/electron/capabilities/action-router.ts`
- Create: `desktop/app-capabilities/document-template/main/dispatcher.ts`
- Test: `desktop/app-capabilities/document-template/main/__tests__/dispatcher.test.ts`
- Test: `desktop/electron/capabilities/__tests__/action-router.test.ts`
- Test: `desktop/tests/unit/api-mcp-capability-surface.test.ts`
- Test: `desktop/tests/unit/synapse-capabilities.test.ts`

- [ ] **Step 1: Write app domain**

Create `desktop/synapse-capabilities/shared/app-domain.ts`:

```ts
import {
  DOCUMENT_TEMPLATE_CAPABILITY_ID,
  DOCUMENT_TEMPLATE_MCP_TOOL_NAME,
} from "../../app-capabilities/document-template/shared/capability"
import type { CapabilityDefinition, CapabilityDomainDefinition, McpToolDefinition } from "./types"

const appCapabilities: readonly CapabilityDefinition[] = [
  {
    id: DOCUMENT_TEMPLATE_CAPABILITY_ID,
    title: "Generate Word document from template",
    description: "Generate a local .docx file from a local .docx template and JSON object data.",
    mutates: true,
  },
]

export const APP_DOMAIN: CapabilityDomainDefinition = {
  id: "app",
  capabilities: appCapabilities,
}

export const APP_MCP_TOOL_ACTIONS: Record<string, string> = {
  [DOCUMENT_TEMPLATE_MCP_TOOL_NAME]: DOCUMENT_TEMPLATE_CAPABILITY_ID,
}

const stringField = (description: string) => ({ type: "string", description })

export function buildAppTools(): McpToolDefinition[] {
  return [
    {
      name: DOCUMENT_TEMPLATE_MCP_TOOL_NAME,
      description: "Generate a local .docx file from a .docx template and JSON data. Provide exactly one of dataPath or data. Existing outputPath is rejected unless overwrite is true.",
      inputSchema: {
        type: "object",
        properties: {
          templatePath: stringField("Absolute local .docx template path."),
          outputPath: stringField("Absolute local .docx output path."),
          dataPath: stringField("Absolute local .json data path. Mutually exclusive with data."),
          data: {
            type: "object",
            description: "Inline JSON object data. Mutually exclusive with dataPath.",
          },
          overwrite: {
            type: "boolean",
            description: "When true, replace outputPath if it already exists. Defaults to false.",
          },
        },
        required: ["templatePath", "outputPath"],
        anyOf: [
          { required: ["dataPath"] },
          { required: ["data"] },
        ],
      },
    },
  ]
}
```

- [ ] **Step 2: Register app domain in shared registry**

Modify `desktop/synapse-capabilities/shared/registry.ts`:

```ts
import {
  APP_DOMAIN,
  APP_MCP_TOOL_ACTIONS,
  buildAppTools,
} from "./app-domain"
```

Add `APP_DOMAIN` to `CAPABILITY_DOMAINS`, add `...APP_MCP_TOOL_ACTIONS` to `MCP_TOOL_ACTIONS`, and add `...buildAppTools()` to `buildAllMcpTools()`.

- [ ] **Step 3: Add dispatcher**

Create `desktop/app-capabilities/document-template/main/dispatcher.ts`:

```ts
import { DOCUMENT_TEMPLATE_CAPABILITY_ID } from "../shared/capability"
import type { DispatchContext, DispatchResult } from "../../../synapse-capabilities/shared/types"
import type { DocumentTemplateService } from "./service"

export type DocumentTemplateCapabilityDispatcher = {
  dispatch(action: string, params: Record<string, unknown>, context: DispatchContext): Promise<DispatchResult>
}

export function createDocumentTemplateCapabilityDispatcher(deps: {
  readonly service: DocumentTemplateService
}): DocumentTemplateCapabilityDispatcher {
  return {
    async dispatch(action, params) {
      if (action !== DOCUMENT_TEMPLATE_CAPABILITY_ID) {
        throw new Error(`Unknown document template action: ${action}`)
      }
      const result = await deps.service.generateDocx(params)
      return { ok: true, data: result, affected: 1 }
    },
  }
}
```

- [ ] **Step 4: Route app actions**

Modify `desktop/electron/capabilities/action-router.ts`:

```ts
export type SynapseActionRouterDeps = {
  readonly appDispatch: DomainDispatch
  readonly automationDispatch: DomainDispatch
  readonly contentDispatch: DomainDispatch
  readonly databaseDispatch: DomainDispatch
  readonly driveDispatch: DomainDispatch
  readonly modelPriceDispatch: DomainDispatch
  readonly repositoryDispatch: DomainDispatch
  readonly variableDispatch: DomainDispatch
  readonly workflowDispatch: DomainDispatch
}
```

Inside `dispatch`:

```ts
if (domainId === "app") return deps.appDispatch(action, params, context)
```

- [ ] **Step 5: Wire dispatcher in bootstrap descriptors**

Modify `desktop/electron/bootstrap/descriptors.ts` near the other capability dispatchers:

```ts
import { createDocumentTemplateService } from "../../app-capabilities/document-template/main/service"
import { createDocumentTemplateCapabilityDispatcher } from "../../app-capabilities/document-template/main/dispatcher"
```

Create dispatcher:

```ts
const documentTemplateDispatcher = createDocumentTemplateCapabilityDispatcher({
  service: createDocumentTemplateService(),
})
```

Pass it to `createSynapseActionRouter`:

```ts
appDispatch: (action, params, context) => documentTemplateDispatcher.dispatch(action, params, context),
```

- [ ] **Step 6: Update tests**

In `desktop/electron/capabilities/__tests__/action-router.test.ts`, extend `createRouterDeps` with `appDispatch: vi.fn()`, then add:

```ts
it("routes App actions to the App dispatcher", async () => {
  const appDispatch = vi.fn(async () => ({ ok: true as const, data: { outputPath: "/tmp/output.docx" } }))
  const deps = createRouterDeps({ appDispatch })
  const router = createSynapseActionRouter(deps)

  await expect(router.dispatch("app.document_template.docx.generate", {}, { source: "api" })).resolves.toEqual({
    ok: true,
    data: { outputPath: "/tmp/output.docx" },
  })
  expect(appDispatch).toHaveBeenCalledWith("app.document_template.docx.generate", {}, { source: "api" })
  expect(deps.workflowDispatch).not.toHaveBeenCalled()
})
```

In `desktop/tests/unit/api-mcp-capability-surface.test.ts`, add `app: vi.fn(...)` to dispatchers and `appDispatch: dispatchers.app` to router construction.

In `desktop/tests/unit/synapse-capabilities.test.ts`, import `APP_DOMAIN`, `APP_MCP_TOOL_ACTIONS`, and `buildAppTools`, then add:

```ts
describe("App capability domain", () => {
  it("registers document template docx generation", () => {
    expect(APP_DOMAIN.id).toBe("app")
    expect(APP_DOMAIN.capabilities.map((capability) => capability.id)).toContain("app.document_template.docx.generate")
    expect(APP_MCP_TOOL_ACTIONS.app_document_template_docx_generate).toBe("app.document_template.docx.generate")
    expect(buildAppTools().map((tool) => tool.name)).toEqual(["app_document_template_docx_generate"])
  })
})
```

- [ ] **Step 7: Run MCP capability tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run tests/unit/synapse-capabilities.test.ts tests/unit/api-mcp-capability-surface.test.ts electron/capabilities/__tests__/action-router.test.ts app-capabilities/document-template/main/__tests__/dispatcher.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add desktop/synapse-capabilities/shared/app-domain.ts desktop/synapse-capabilities/shared/registry.ts desktop/electron/capabilities/action-router.ts desktop/electron/bootstrap/descriptors.ts desktop/app-capabilities/document-template/main/dispatcher.ts desktop/app-capabilities/document-template/main/__tests__/dispatcher.test.ts desktop/electron/capabilities/__tests__/action-router.test.ts desktop/tests/unit/api-mcp-capability-surface.test.ts desktop/tests/unit/synapse-capabilities.test.ts
git commit -m "feat(document-template): expose app mcp capability"
```

---

### Task 4: IPC Bridge For The System App

**Files:**
- Create: `desktop/app-capabilities/document-template/main/ipc.ts`
- Test: `desktop/app-capabilities/document-template/main/__tests__/ipc.test.ts`
- Modify: `desktop/electron/bootstrap/ipc-registry.ts`
- Modify: `desktop/electron/preload.ts`
- Modify: `desktop/src/types/bridge.ts`
- Generate: `desktop/electron/generated/ipc-channels.generated.ts`

- [ ] **Step 1: Create IPC module**

Create `desktop/app-capabilities/document-template/main/ipc.ts`:

```ts
import { z } from "zod"
import type { IpcModule } from "../../../electron/runtime/ipc/types"
import { generateDocxInputSchema, generateDocxResultSchema } from "../shared/schema"
import { createDocumentTemplateService } from "./service"

export const documentTemplateIpcModule: IpcModule = {
  id: "documentTemplate",
  methods: {
    generateDocx: {
      channel: "synapse:document-template:docx:generate",
      kind: "invoke",
      request: generateDocxInputSchema,
      response: generateDocxResultSchema,
      handler: async (_ctx, request: z.infer<typeof generateDocxInputSchema>) =>
        createDocumentTemplateService().generateDocx(request),
    },
  },
  events: {},
}
```

- [ ] **Step 2: Write IPC test**

Create `desktop/app-capabilities/document-template/main/__tests__/ipc.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { documentTemplateIpcModule } from "../ipc"

describe("documentTemplateIpcModule", () => {
  it("declares the generate docx channel", () => {
    expect(documentTemplateIpcModule.id).toBe("documentTemplate")
    expect(documentTemplateIpcModule.methods.generateDocx.channel).toBe("synapse:document-template:docx:generate")
  })

  it("validates dataPath and inline data alternatives", () => {
    const request = documentTemplateIpcModule.methods.generateDocx.request
    expect(request.safeParse({
      templatePath: "/tmp/template.docx",
      outputPath: "/tmp/output.docx",
      data: { name: "Ada" },
    }).success).toBe(true)
    expect(request.safeParse({
      templatePath: "/tmp/template.docx",
      outputPath: "/tmp/output.docx",
      dataPath: "/tmp/data.json",
    }).success).toBe(true)
    expect(request.safeParse({
      templatePath: "/tmp/template.docx",
      outputPath: "/tmp/output.docx",
    }).success).toBe(false)
  })
})
```

- [ ] **Step 3: Register IPC module**

Modify `desktop/electron/bootstrap/ipc-registry.ts`:

```ts
import { documentTemplateIpcModule } from "../../app-capabilities/document-template/main/ipc"
```

Add `registry.register(documentTemplateIpcModule, ctx)` in `createIpcRegistry`, and add `documentTemplateIpcModule` to `registeredIpcModules`.

- [ ] **Step 4: Add bridge type**

Modify `desktop/src/types/bridge.ts` by adding a `documentTemplate` bridge domain with:

```ts
documentTemplate: {
  generateDocx: (input: GenerateDocxInput) => Promise<GenerateDocxResult>
}
```

Import the shared types from `../../app-capabilities/document-template/shared/schema` using the path style already used by nearby bridge imports.

- [ ] **Step 5: Expose preload bridge**

Modify `desktop/electron/preload.ts`:

```ts
documentTemplate: {
  generateDocx: (input) => invoke(IPC_CHANNELS.documentTemplate.generateDocx)(input),
},
```

Place it next to other domain bridge objects, not under `apps`.

- [ ] **Step 6: Regenerate IPC constants**

Run:

```bash
pnpm --filter @synapse/desktop run generate:ipc
```

Expected: `desktop/electron/generated/ipc-channels.generated.ts` includes `documentTemplate.generateDocx`.

- [ ] **Step 7: Run IPC tests and codegen check**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run app-capabilities/document-template/main/__tests__/ipc.test.ts
pnpm --filter @synapse/desktop run check:ipc-codegen
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add desktop/app-capabilities/document-template/main/ipc.ts desktop/app-capabilities/document-template/main/__tests__/ipc.test.ts desktop/electron/bootstrap/ipc-registry.ts desktop/electron/preload.ts desktop/src/types/bridge.ts desktop/electron/generated/ipc-channels.generated.ts
git commit -m "feat(document-template): add renderer ipc bridge"
```

---

### Task 5: System App Registration And UI

**Files:**
- Create: `desktop/app-capabilities/document-template/renderer/app-definition.ts`
- Create: `desktop/app-capabilities/document-template/renderer/app-manifest.ts`
- Create: `desktop/app-capabilities/document-template/renderer/index.tsx`
- Add: `desktop/app-capabilities/document-template/renderer/icon.png`
- Test: `desktop/app-capabilities/document-template/renderer/__tests__/document-template-module.test.tsx`
- Modify: `desktop/src/modules/apps/types.ts`
- Modify: `desktop/src/modules/apps/definitions.ts`
- Modify: `desktop/src/modules/apps/registry.ts`
- Modify: `desktop/src/modules/apps/components/system-app-content.tsx`
- Test: `desktop/src/modules/apps/__tests__/registry.test.ts`
- Test: `desktop/electron/modules/apps/__tests__/ipc.test.ts`

- [ ] **Step 1: Add app definition**

Create `desktop/app-capabilities/document-template/renderer/app-definition.ts`:

```ts
import type { SynapseSystemAppDefinition } from "../../../src/modules/apps/types"
import { DOCUMENT_TEMPLATE_APP_ID } from "../shared/capability"

export const documentTemplateAppDefinition = {
  id: DOCUMENT_TEMPLATE_APP_ID,
  type: "system",
  name: "从模板生成 Word 文档",
  windowTitle: "从模板生成 Word 文档",
  removable: false,
  renameable: false,
  iconEditable: false,
} as const satisfies SynapseSystemAppDefinition
```

Create `desktop/app-capabilities/document-template/renderer/app-manifest.ts`:

```ts
import type { SynapseSystemAppManifest } from "../../../src/modules/apps/types"
import { documentTemplateAppDefinition } from "./app-definition"
import icon from "./icon.png"

export const documentTemplateAppManifest = {
  ...documentTemplateAppDefinition,
  icon,
} as const satisfies SynapseSystemAppManifest
```

- [ ] **Step 2: Add a simple icon asset**

Add `desktop/app-capabilities/document-template/renderer/icon.png`. Use a small neutral PNG asset consistent with existing app icons. Do not create an SVG-only icon for this app manifest.

- [ ] **Step 3: Register the app id and order**

Modify `desktop/src/modules/apps/types.ts`:

```ts
export const SYSTEM_APP_IDS = [
  "resource-repository",
  "git",
  "database",
  "document-template",
  "editor-scan",
  "usage-monitor",
  "model-price",
] as const
```

Modify `desktop/src/modules/apps/definitions.ts` to import and include `documentTemplateAppDefinition` after `databaseAppDefinition`.

Modify `desktop/src/modules/apps/registry.ts` to import and include `documentTemplateAppManifest` after `databaseAppManifest`.

- [ ] **Step 4: Implement the UI**

Create `desktop/app-capabilities/document-template/renderer/index.tsx`:

```tsx
import { useMemo, useState } from "react"
import { FileJson, FileText, FolderOutput, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { createRendererLogger } from "../../../src/app-shell/logging"
import { Button } from "../../../src/components/ui/button"
import { Input } from "../../../src/components/ui/input"
import { Label } from "../../../src/components/ui/label"
import { ScrollArea } from "../../../src/components/ui/scroll-area"
import { Switch } from "../../../src/components/ui/switch"
import { SystemAppWindowShell } from "../../../src/modules/apps/components/system-app-window-shell"
import { requireBridgeDomain } from "../../../src/lib/electron-bridge"

const logger = createRendererLogger("document-template.app")

export function DocumentTemplateModule() {
  const [templatePath, setTemplatePath] = useState("")
  const [dataPath, setDataPath] = useState("")
  const [outputPath, setOutputPath] = useState("")
  const [overwrite, setOverwrite] = useState(false)
  const [busy, setBusy] = useState(false)
  const [resultPath, setResultPath] = useState("")
  const canGenerate = useMemo(
    () => templatePath.trim() && dataPath.trim() && outputPath.trim() && !busy,
    [templatePath, dataPath, outputPath, busy],
  )

  const chooseTemplate = async () => {
    const selected = await requireBridgeDomain("repository").chooseFile({
      title: "选择 Word 模板",
      filters: [{ name: "Word 文档", extensions: ["docx"] }],
    })
    if (selected) setTemplatePath(selected)
  }

  const chooseJson = async () => {
    const selected = await requireBridgeDomain("repository").chooseFile({
      title: "选择 JSON 文件",
      filters: [{ name: "JSON", extensions: ["json"] }],
    })
    if (selected) setDataPath(selected)
  }

  const chooseOutput = async () => {
    const selected = await requireBridgeDomain("repository").chooseSaveFile({
      title: "选择输出文件",
      defaultPath: "output.docx",
      filters: [{ name: "Word 文档", extensions: ["docx"] }],
    })
    if (selected) setOutputPath(selected)
  }

  const generate = async () => {
    try {
      setBusy(true)
      setResultPath("")
      const result = await requireBridgeDomain("documentTemplate").generateDocx({
        templatePath,
        dataPath,
        outputPath,
        overwrite,
      })
      setResultPath(result.outputPath)
      toast.success("生成完成")
    } catch (error) {
      logger.error("Document generation failed.", error)
      toast.error(error instanceof Error ? error.message : "生成失败")
    } finally {
      setBusy(false)
    }
  }

  return (
    <SystemAppWindowShell>
      <ScrollArea className="h-full min-h-0">
        <div className="mx-auto grid max-w-3xl gap-4 p-4">
          <div className="grid gap-3">
            <FileRow
              id="template-path"
              label="Word 模板文件"
              icon={<FileText className="size-4 text-muted-foreground" />}
              value={templatePath}
              onChoose={chooseTemplate}
            />
            <FileRow
              id="json-path"
              label="JSON 文件"
              icon={<FileJson className="size-4 text-muted-foreground" />}
              value={dataPath}
              onChoose={chooseJson}
            />
            <FileRow
              id="output-path"
              label="输出文件"
              icon={<FolderOutput className="size-4 text-muted-foreground" />}
              value={outputPath}
              onChoose={chooseOutput}
            />
          </div>
          <div className="flex items-center justify-between rounded-md border px-3 py-2">
            <Label htmlFor="overwrite-output" className="text-sm font-normal">覆盖已存在文件</Label>
            <Switch id="overwrite-output" checked={overwrite} onCheckedChange={setOverwrite} />
          </div>
          <div className="flex items-center justify-between gap-3">
            <p className="min-w-0 truncate text-sm text-muted-foreground">{resultPath || ""}</p>
            <Button type="button" disabled={!canGenerate} onClick={() => void generate()}>
              {busy ? <Loader2 data-icon="inline-start" className="animate-spin" /> : null}
              {busy ? "生成中" : "生成"}
            </Button>
          </div>
        </div>
      </ScrollArea>
    </SystemAppWindowShell>
  )
}

function FileRow(props: {
  id: string
  label: string
  icon: React.ReactNode
  value: string
  onChoose: () => Promise<void>
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={props.id}>{props.label}</Label>
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <div className="relative">
          <div className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2">{props.icon}</div>
          <Input id={props.id} value={props.value} readOnly className="pl-8" />
        </div>
        <Button type="button" variant="outline" onClick={() => void props.onChoose()}>选择</Button>
      </div>
    </div>
  )
}
```

If `repository.chooseFile` or `repository.chooseSaveFile` does not exist, add narrow dialog methods to the document template IPC module instead of broadening renderer filesystem access.

- [ ] **Step 5: Register renderer content**

Modify `desktop/src/modules/apps/components/system-app-content.tsx`:

```tsx
import { DocumentTemplateModule } from "../../../../app-capabilities/document-template/renderer"
```

Add:

```tsx
if (appId === "document-template") return <DocumentTemplateModule />
```

- [ ] **Step 6: Update registry and apps IPC tests**

Modify expected order in `desktop/src/modules/apps/__tests__/registry.test.ts`:

```ts
expect(listSystemApps().map((app) => app.id)).toEqual([
  "resource-repository",
  "git",
  "database",
  "document-template",
  "editor-scan",
  "usage-monitor",
  "model-price",
])
```

Modify `desktop/electron/modules/apps/__tests__/ipc.test.ts`:

```ts
expect(appsIpcModule.methods.openSystemApp.request.safeParse({ appId: "document-template" }).success).toBe(true)
```

- [ ] **Step 7: Run app tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/apps/__tests__/registry.test.ts electron/modules/apps/__tests__/ipc.test.ts app-capabilities/document-template/renderer/__tests__/document-template-module.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add desktop/app-capabilities/document-template/renderer desktop/src/modules/apps/types.ts desktop/src/modules/apps/definitions.ts desktop/src/modules/apps/registry.ts desktop/src/modules/apps/components/system-app-content.tsx desktop/src/modules/apps/__tests__/registry.test.ts desktop/electron/modules/apps/__tests__/ipc.test.ts
git commit -m "feat(document-template): add system app ui"
```

---

### Task 6: Workflow Node Adapter

**Files:**
- Create: `desktop/app-capabilities/document-template/workflow-node/schema.ts`
- Create: `desktop/app-capabilities/document-template/workflow-node/manifest.ts`
- Create: `desktop/app-capabilities/document-template/workflow-node/executor.main.ts`
- Create: `desktop/app-capabilities/document-template/workflow-node/panel.tsx`
- Create: `desktop/app-capabilities/document-template/workflow-node/card.tsx`
- Test: `desktop/app-capabilities/document-template/workflow-node/__tests__/schema.test.ts`
- Test: `desktop/app-capabilities/document-template/workflow-node/__tests__/executor.test.ts`
- Modify: `desktop/workflow-nodes/register.main.ts`
- Modify: `desktop/workflow-nodes/panel-registry.ts`

- [ ] **Step 1: Define node schema**

Create `desktop/app-capabilities/document-template/workflow-node/schema.ts`:

```ts
import { z } from "zod"
import { variableBindingSchema } from "../../../workflow-nodes/schemas/variable-binding"

export const documentTemplateNodeConfigSchema = z.object({
  templatePath: z.string(),
  outputPath: z.string(),
  dataSource: z.enum(["dataPath", "inline"]),
  dataPath: z.string().optional(),
  dataJson: z.string().optional(),
  overwrite: z.boolean(),
  variables: z.array(variableBindingSchema),
}).superRefine((value, ctx) => {
  if (value.dataSource === "dataPath" && !value.dataPath?.trim()) {
    ctx.addIssue({ code: "custom", path: ["dataPath"], message: "JSON 文件路径必填" })
  }
  if (value.dataSource === "inline" && !value.dataJson?.trim()) {
    ctx.addIssue({ code: "custom", path: ["dataJson"], message: "内联 JSON 必填" })
  }
})

export type DocumentTemplateNodeConfig = z.infer<typeof documentTemplateNodeConfigSchema>
```

- [ ] **Step 2: Define node manifest**

Create `desktop/app-capabilities/document-template/workflow-node/manifest.ts`:

```ts
import { FileText } from "lucide-react"
import type { NodeManifest } from "../../../workflow-nodes/types"
import { DOCUMENT_TEMPLATE_WORKFLOW_NODE_TYPE } from "../shared/capability"
import { documentTemplateNodeConfigSchema, type DocumentTemplateNodeConfig } from "./schema"

export const documentTemplateNodeManifest: NodeManifest<DocumentTemplateNodeConfig> = {
  type: DOCUMENT_TEMPLATE_WORKFLOW_NODE_TYPE,
  title: "生成 Word 文档",
  icon: FileText,
  color: "bg-primary/10",
  defaultConfig: {
    templatePath: "",
    outputPath: "",
    dataSource: "dataPath",
    dataPath: "",
    dataJson: "",
    overwrite: false,
    variables: [],
  },
  ports: { inputs: [{ id: "in", label: "输入" }], outputs: [{ id: "out", label: "输出" }] },
  cardSummary: (config) => ({
    title: "生成 Word 文档",
    subtitle: config.outputPath || "未设置输出文件",
  }),
  configFields: [
    { name: "templatePath", kind: "text", label: "模板文件" },
    { name: "outputPath", kind: "text", label: "输出文件" },
    { name: "dataSource", kind: "select", label: "数据来源" },
    { name: "dataPath", kind: "text", label: "JSON 文件", optional: true },
    { name: "dataJson", kind: "text", label: "内联 JSON", optional: true },
    { name: "overwrite", kind: "record", label: "覆盖", optional: true },
    { name: "variables", kind: "variable-binding-list", label: "变量绑定" },
  ],
  configSchema: documentTemplateNodeConfigSchema,
}
```

- [ ] **Step 3: Implement executor**

Create `desktop/app-capabilities/document-template/workflow-node/executor.main.ts`:

```ts
import { interpolatePrompt } from "../../../electron/services/workflow/variable-resolver"
import { createDocumentTemplateService } from "../main/service"
import type { NodeExecutor, NodeExecutionInput, NodeExecutionResult } from "../../../workflow-nodes/types"
import type { DocumentTemplateNodeConfig } from "./schema"

export const documentTemplateNodeExecutor: NodeExecutor<DocumentTemplateNodeConfig> = {
  async execute(input: NodeExecutionInput<DocumentTemplateNodeConfig>): Promise<NodeExecutionResult> {
    const start = Date.now()
    try {
      const templatePath = interpolatePrompt(input.config.templatePath, input.resolvedVariables)
      const outputPath = interpolatePrompt(input.config.outputPath, input.resolvedVariables)
      const dataPath = input.config.dataPath
        ? interpolatePrompt(input.config.dataPath, input.resolvedVariables)
        : undefined
      const dataJson = input.config.dataJson
        ? interpolatePrompt(input.config.dataJson, input.resolvedVariables)
        : undefined
      const data = input.config.dataSource === "inline" && dataJson
        ? JSON.parse(dataJson) as Record<string, unknown>
        : undefined

      input.onProgress?.("generating", "生成 Word 文档")
      const result = await createDocumentTemplateService().generateDocx({
        templatePath,
        outputPath,
        overwrite: input.config.overwrite,
        ...(input.config.dataSource === "dataPath" ? { dataPath } : { data }),
      })

      return {
        status: "success",
        output: result.outputPath,
        outputs: result,
        durationMs: Date.now() - start,
      }
    } catch (error) {
      return {
        status: "failed",
        output: "",
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - start,
      }
    }
  },
}
```

- [ ] **Step 4: Register node**

Modify `desktop/workflow-nodes/register.main.ts`:

```ts
import { documentTemplateNodeManifest } from "../app-capabilities/document-template/workflow-node/manifest"
import { documentTemplateNodeExecutor } from "../app-capabilities/document-template/workflow-node/executor.main"
```

Add:

```ts
nodeTypeRegistry.register(documentTemplateNodeManifest, documentTemplateNodeExecutor)
```

Modify `desktop/workflow-nodes/panel-registry.ts`:

```ts
import { DocumentTemplateNodePanel } from "../app-capabilities/document-template/workflow-node/panel"
```

Add:

```ts
["document_template_docx_generate", DocumentTemplateNodePanel as unknown as PanelComponent],
```

- [ ] **Step 5: Implement panel and card**

Create a panel that uses existing components only: `Input`, `Textarea`, `Label`, `Select`, `Switch`, `VariableBindingEditor`, and `CollapsibleSection`. The panel must expose template path, output path, data source, data path or inline JSON, overwrite, and variables.

Create `desktop/app-capabilities/document-template/workflow-node/panel.tsx`:

```tsx
import { Input } from "../../../src/components/ui/input"
import { Label } from "../../../src/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../src/components/ui/select"
import { Switch } from "../../../src/components/ui/switch"
import { Textarea } from "../../../src/components/ui/textarea"
import type { NodePanelProps } from "../../../workflow-nodes/panel-registry"
import { CollapsibleSection } from "../../../workflow-nodes/collapsible-section"
import { VariableBindingEditor } from "../../../workflow-nodes/variable-binding-editor"
import type { DocumentTemplateNodeConfig } from "./schema"

export function DocumentTemplateNodePanel({
  config,
  onChange,
  upstreamNodes,
  workflowParams,
}: NodePanelProps) {
  const typedConfig = config as DocumentTemplateNodeConfig
  const commit = (patch: Partial<DocumentTemplateNodeConfig>) =>
    onChange({ ...typedConfig, ...patch })

  return (
    <div className="grid gap-2">
      <CollapsibleSection title="文件">
        <div className="grid gap-2">
          <div className="grid gap-1">
            <Label htmlFor="document-template-node-template" className="text-xs">模板文件</Label>
            <Input
              id="document-template-node-template"
              value={typedConfig.templatePath}
              onChange={(event) => commit({ templatePath: event.target.value })}
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="document-template-node-output" className="text-xs">输出文件</Label>
            <Input
              id="document-template-node-output"
              value={typedConfig.outputPath}
              onChange={(event) => commit({ outputPath: event.target.value })}
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="document-template-node-overwrite" className="text-xs font-normal">覆盖已存在文件</Label>
            <Switch
              id="document-template-node-overwrite"
              checked={typedConfig.overwrite}
              onCheckedChange={(checked) => commit({ overwrite: checked === true })}
            />
          </div>
        </div>
      </CollapsibleSection>
      <CollapsibleSection title="数据">
        <div className="grid gap-2">
          <div className="grid gap-1">
            <Label htmlFor="document-template-node-data-source" className="text-xs">数据来源</Label>
            <Select
              value={typedConfig.dataSource}
              onValueChange={(value) => commit({ dataSource: value as DocumentTemplateNodeConfig["dataSource"] })}
            >
              <SelectTrigger id="document-template-node-data-source" className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="dataPath">JSON 文件</SelectItem>
                <SelectItem value="inline">内联 JSON</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {typedConfig.dataSource === "dataPath" ? (
            <div className="grid gap-1">
              <Label htmlFor="document-template-node-data-path" className="text-xs">JSON 文件</Label>
              <Input
                id="document-template-node-data-path"
                value={typedConfig.dataPath ?? ""}
                onChange={(event) => commit({ dataPath: event.target.value })}
              />
            </div>
          ) : (
            <div className="grid gap-1">
              <Label htmlFor="document-template-node-data-json" className="text-xs">内联 JSON</Label>
              <Textarea
                id="document-template-node-data-json"
                value={typedConfig.dataJson ?? ""}
                onChange={(event) => commit({ dataJson: event.target.value })}
                className="min-h-32 font-mono text-xs"
              />
            </div>
          )}
        </div>
      </CollapsibleSection>
      <CollapsibleSection title="输入映射">
        <VariableBindingEditor
          variables={typedConfig.variables}
          onChange={(variables) => commit({ variables })}
          upstreamNodes={upstreamNodes}
          workflowParams={workflowParams}
        />
      </CollapsibleSection>
    </div>
  )
}
```

Create `desktop/app-capabilities/document-template/workflow-node/card.tsx`:

```tsx
import type { DocumentTemplateNodeConfig } from "./schema"

export function documentTemplateNodeCardSummary(config: DocumentTemplateNodeConfig) {
  return {
    title: "生成 Word 文档",
    subtitle: config.outputPath || "未设置输出文件",
  }
}
```

- [ ] **Step 6: Write node tests**

Create schema test asserting:

```ts
expect(documentTemplateNodeConfigSchema.safeParse({
  templatePath: "/tmp/t.docx",
  outputPath: "/tmp/o.docx",
  dataSource: "dataPath",
  dataPath: "/tmp/d.json",
  overwrite: false,
  variables: [],
}).success).toBe(true)
```

Create executor test by mocking `createDocumentTemplateService` and asserting `generateDocx` receives interpolated paths and returns outputs.

- [ ] **Step 7: Run node tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run app-capabilities/document-template/workflow-node/__tests__/schema.test.ts app-capabilities/document-template/workflow-node/__tests__/executor.test.ts workflow-nodes/__tests__/registry.test.ts src/modules/workflow/editor/__tests__/node-palette.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add desktop/app-capabilities/document-template/workflow-node desktop/workflow-nodes/register.main.ts desktop/workflow-nodes/panel-registry.ts
git commit -m "feat(document-template): add workflow node"
```

---

### Task 7: Built-In Skill, Release Notes, And Capability Docs

**Files:**
- Modify: `desktop/resources/templates/skills/synapse-skill/content.md`
- Modify: `desktop/resources/templates/skills/synapse-skill/meta.json`
- Create: `desktop/resources/templates/skills/synapse-skill/files/app/index.md`
- Create: `desktop/resources/templates/skills/synapse-skill/files/app/api-reference.md`
- Modify: `docs/reference/capability-naming-matrix.md`
- Modify: `website/developer/capability-naming-matrix.md`
- Modify: `website/reference/synapse-mcp-capabilities.md`
- Modify: `RELEASE_NOTES_PENDING.md`
- Test: `desktop/tests/unit/api-mcp-capability-surface.test.ts`

- [ ] **Step 1: Add app domain guidance to built-in skill**

Create `desktop/resources/templates/skills/synapse-skill/files/app/index.md`:

```md
# Synapse App MCP

Use App MCP tools for capabilities provided by Synapse system apps.

## Document Template

Use `app_document_template_docx_generate` when the user asks to generate a Word `.docx` document from a `.docx` template and JSON data.

Rules:

- Provide exactly one of `dataPath` or `data`.
- Use local absolute paths for `templatePath`, `dataPath`, and `outputPath`.
- Do not overwrite an existing output file unless the user explicitly asks to replace it.
- Do not rewrite or enrich JSON data. Pass the user data as-is.
- Do not repeat large JSON payloads or secret-looking values in the final answer.
```

Create `desktop/resources/templates/skills/synapse-skill/files/app/api-reference.md`:

```md
# Synapse App MCP API Reference

## `app_document_template_docx_generate`

Generate a local `.docx` file from a local `.docx` template and JSON object data.

Input:

- `templatePath` required: absolute local `.docx` template path.
- `outputPath` required: absolute local `.docx` output path.
- `dataPath` optional: absolute local `.json` file path. Mutually exclusive with `data`.
- `data` optional: inline JSON object. Mutually exclusive with `dataPath`.
- `overwrite` optional: when `true`, replace an existing output file. Defaults to `false`.

Output:

- `outputPath`: generated file path.
- `fileName`: generated file name.
- `size`: generated file size in bytes.
- `generatedAt`: ISO timestamp.
```

Modify `desktop/resources/templates/skills/synapse-skill/content.md` so the domain list includes App:

```md
- App: read `files/app/index.md` and `files/app/api-reference.md` for app-provided MCP capabilities.
```

Modify `desktop/resources/templates/skills/synapse-skill/meta.json` description and usage to mention App capabilities.

- [ ] **Step 2: Update capability docs**

Add `app.document_template.docx.generate` and `app_document_template_docx_generate` to:

```text
docs/reference/capability-naming-matrix.md
website/developer/capability-naming-matrix.md
website/reference/synapse-mcp-capabilities.md
```

Use the same table format already present in those files.

- [ ] **Step 3: Update release notes**

Append to `RELEASE_NOTES_PENDING.md`:

```md
- 新增“从模板生成 Word 文档”能力：可以用本地 Word 模板和 JSON 数据生成 `.docx` 文件，并为后续 App、MCP、工作流节点共用同一能力打好基础。
```

- [ ] **Step 4: Run docs and capability tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run tests/unit/api-mcp-capability-surface.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/resources/templates/skills/synapse-skill docs/reference/capability-naming-matrix.md website/developer/capability-naming-matrix.md website/reference/synapse-mcp-capabilities.md RELEASE_NOTES_PENDING.md
git commit -m "docs(document-template): document app mcp capability"
```

---

### Task 8: Final Verification

**Files:**
- Verify all changed files.

- [ ] **Step 1: Run focused tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  app-capabilities/document-template/main/__tests__/service.test.ts \
  app-capabilities/document-template/main/__tests__/dispatcher.test.ts \
  app-capabilities/document-template/main/__tests__/ipc.test.ts \
  app-capabilities/document-template/workflow-node/__tests__/schema.test.ts \
  app-capabilities/document-template/workflow-node/__tests__/executor.test.ts \
  app-capabilities/document-template/renderer/__tests__/document-template-module.test.tsx \
  tests/unit/synapse-capabilities.test.ts \
  tests/unit/api-mcp-capability-surface.test.ts \
  electron/capabilities/__tests__/action-router.test.ts \
  src/modules/apps/__tests__/registry.test.ts \
  electron/modules/apps/__tests__/ipc.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```bash
pnpm --filter @synapse/desktop run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run hard constraint check**

Run:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: PASS.

- [ ] **Step 4: Inspect package and asar impact**

Run:

```bash
pnpm --filter @synapse/desktop run check:packaged-asar
```

Expected: PASS when a packaged release directory is available. If no release directory exists in the local environment, record that this verification is blocked by missing package output and run it during release packaging.

- [ ] **Step 5: Final git status**

Run:

```bash
git status --short
```

Expected: clean working tree.

- [ ] **Step 6: Commit any verification-only doc fixes**

Only if verification reveals documentation or generated IPC drift, commit the fix:

```bash
git add <changed-files>
git commit -m "chore(document-template): finalize verification fixes"
```

---

## Self-Review

- Spec coverage: The plan covers shared schema, `generate` action, `app` MCP domain, dispatcher, IPC, system app UI, Workflow node, built-in skill, capability docs, release notes, tests, and verification.
- Placeholder scan: No implementation step relies on unresolved decisions. The only conditional branch is the UI file picker note, with a concrete fallback: add narrow document-template IPC dialog methods if reusable repository file pickers do not exist.
- Type consistency: The plan consistently uses `document-template`, `app.document_template.docx.generate`, `app_document_template_docx_generate`, `document_template_docx_generate`, `GenerateDocxInput`, and `GenerateDocxResult`.

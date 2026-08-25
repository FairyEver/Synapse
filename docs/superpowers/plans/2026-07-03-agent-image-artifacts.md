# Agent Image Artifacts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render Claude Code SDK image tool results in Synapse Agent conversations by capturing SDK image blocks, storing bytes as local artifacts, and showing previews in the timeline.

**Architecture:** Keep `sdk-event-bridge` responsible for synchronous SDK block parsing only. Store decoded image bytes through an Agent artifact store before events are broadcast, persisted, converted to history, or exported. Public event/timeline data carries artifact metadata and read URLs/paths only; raw base64 is never written into SQLite, conversation history, timeline JSON, or export JSON.

**Tech Stack:** Electron main process, Claude Agent SDK event bridge, Synapse DataRepository SQLite namespaces, React 19 renderer, shadcn/ui, Tailwind tokens, Vitest.

---

## Verified Facts

- `Read` on a PNG returns a Claude SDK `tool_result.content` array containing an `image` block.
- Synapse currently reduces tool results to text, so image-only results become `content: undefined` and render as an empty tool output.
- Creating an image file without a tool returning an image block does not produce a displayable image event.
- Markdown image syntax in assistant text is text unless Synapse explicitly renders it from a trusted artifact path.
- User input attachments and SDK output artifacts have different semantics; do not merge SDK output artifacts into `attachments.json`.
- The shared artifact root distinguishes those semantics with `origin`: user inputs are `user-message`, tool outputs are `tool-result`, and legacy rows without an origin remain tool outputs.

## File Structure

- Modify: `desktop/electron/services/agent-runtime/types.ts`
  - Add runtime-only image block type and persisted artifact metadata type.
- Modify: `desktop/src/types/agent.ts`
  - Add renderer-facing artifact metadata on tool result events and timeline items.
- Create: `desktop/electron/services/agent-runtime/artifact-store.ts`
  - Decode base64 image blocks, write binary files under an Agent artifact root, and persist metadata.
- Modify: `desktop/electron/runtime/data-repo/schemas/placeholders.ts`
  - Add `agent.artifacts` SQLite namespace schema for metadata only.
- Modify: `desktop/electron/runtime/data-repo/schemas/index.ts`
  - Export and register the `agent.artifacts` schema.
- Modify: `desktop/electron/runtime/data-repo/index.ts`
  - Re-export `AgentArtifactEntryV1`.
- Modify: `desktop/electron/runtime/data-repo/factory.ts`
  - Add indexes for `agent.artifacts` by `projectId` and `conversationId`.
- Modify: `desktop/electron/services/agent-runtime/index.ts`
  - Wire `AgentArtifactStore` into `AgentRuntimeService`.
- Modify: `desktop/electron/services/agent-runtime/conversation-router.ts`
  - Materialize runtime-only image blocks before emit/persist/history and strip raw base64 from all stored payloads.
- Modify: `desktop/electron/services/agent-runtime/sdk-event-bridge.ts`
  - Extract image blocks into runtime-only event data and keep text extraction unchanged.
- Modify: `desktop/electron/services/agent-runtime/claude-sdk-session.ts`
  - Preserve runtime-only image blocks while resolving tool names.
- Modify: `desktop/src/lib/agent-timeline.ts`
  - Carry `imageArtifacts` through live events and history fallback.
- Modify: `desktop/src/modules/agent/components/agent-tool-event.tsx`
  - Render image artifact thumbnails inside the existing tool result body.
- Create: `desktop/src/modules/agent/components/agent-tool-image-artifacts.tsx`
  - Small focused component for image previews.
- Modify: `desktop/src/lib/agent-transcript.ts`
  - Include concise artifact references in transcript text.
- Modify: `desktop/electron/services/agent-runtime/conversation-export-service.ts`
  - Add `agent-artifacts.json` metadata and optional copied artifact files.
- Modify: `RELEASE_NOTES_PENDING.md`
  - Add one user-facing release note for image tool result previews.

## Storage Contract

Artifact bytes live outside DataRepository:

```text
<electron-user-data>/agent-artifacts/<projectId>/<conversationId>/<artifactId>.<ext>
```

DataRepository stores only metadata:

```ts
export interface AgentArtifactEntryV1 extends Record<string, unknown> {
  id: string
  schemaVersion: 1
  projectId: string
  conversationId: string
  turnId: string
  toolUseId?: string
  toolName?: string
  origin?: "user-message" | "tool-result"
  originalName?: string
  kind: "image"
  mimeType: "image/png" | "image/jpeg" | "image/gif" | "image/webp"
  byteSize: number
  sha256: string
  storagePath: string
  createdAt: string
}
```

User-message images may reuse this controlled byte store, but their bytes are never copied into conversation debug bundles. `attachments.json`, versioned user presentation metadata and transcript text may contain safe metadata only. Tool-result export continues to copy `tool-result` rows, including legacy rows without `origin`. Conversation deletion cleans both origins; failed cleanup retains metadata for initialization-time orphan retry.

Runtime-only SDK image block shape:

```ts
export interface AgentToolResultImageBlock {
  readonly kind: "image"
  readonly mimeType: "image/png" | "image/jpeg" | "image/gif" | "image/webp"
  readonly base64: string
}
```

Renderer-facing artifact shape:

```ts
export interface SynapseAgentImageArtifact {
  readonly id: string
  readonly kind: "image"
  readonly mimeType: "image/png" | "image/jpeg" | "image/gif" | "image/webp"
  readonly byteSize: number
  readonly url: string
  readonly sha256?: string
}
```

## Task 1: Add Artifact Metadata Schema

**Files:**
- Modify: `desktop/electron/runtime/data-repo/schemas/placeholders.ts`
- Modify: `desktop/electron/runtime/data-repo/schemas/index.ts`
- Modify: `desktop/electron/runtime/data-repo/index.ts`
- Modify: `desktop/electron/runtime/data-repo/factory.ts`
- Test: `desktop/electron/runtime/data-repo/__tests__/schemas.test.ts`
- Test: `desktop/electron/runtime/data-repo/__tests__/sqlite-backend.test.ts`

- [ ] **Step 1: Write failing schema tests**

Add to `desktop/electron/runtime/data-repo/__tests__/schemas.test.ts`:

```ts
import { agentArtifactsSchema, allSchemas } from "../schemas"

it("registers agent artifact metadata as a sqlite namespace", () => {
  expect(agentArtifactsSchema.name).toBe("agent.artifacts")
  expect(agentArtifactsSchema.backend).toBe("sqlite")
  expect(allSchemas.map((schema) => schema.name)).toContain("agent.artifacts")
})

it("validates image artifact metadata without storing bytes", () => {
  expect(agentArtifactsSchema.validate({
    id: "artifact_1",
    schemaVersion: 1,
    projectId: "project_1",
    conversationId: "conversation_1",
    turnId: "turn_1",
    toolUseId: "toolu_1",
    toolName: "Read",
    kind: "image",
    mimeType: "image/png",
    byteSize: 68,
    sha256: "a".repeat(64),
    storagePath: "/tmp/synapse/agent-artifacts/project_1/conversation_1/artifact_1.png",
    createdAt: "2026-07-03T00:00:00.000Z",
  })).toBe(true)

  expect(agentArtifactsSchema.validate({
    id: "artifact_1",
    schemaVersion: 1,
    projectId: "project_1",
    conversationId: "conversation_1",
    turnId: "turn_1",
    kind: "image",
    mimeType: "image/png",
    byteSize: 68,
    sha256: "a".repeat(64),
    storagePath: "/tmp/file.png",
    base64: "must-not-be-valid",
    createdAt: "2026-07-03T00:00:00.000Z",
  })).toBe(false)
})
```

Add to `desktop/electron/runtime/data-repo/__tests__/sqlite-backend.test.ts`:

```ts
it("indexes agent artifacts by conversation without scanning the whole table", async () => {
  const db = await openSqliteDatabase({ filePath: dbPath })
  const namespace = new SqliteNamespace({
    db,
    schema: agentArtifactsSchema,
    indexes: sqliteIndexesFor("agent.artifacts"),
  })
  await namespace.upsert({
    id: "artifact_1",
    schemaVersion: 1,
    projectId: "project_1",
    conversationId: "conversation_1",
    turnId: "turn_1",
    kind: "image",
    mimeType: "image/png",
    byteSize: 68,
    sha256: "a".repeat(64),
    storagePath: "/tmp/artifact_1.png",
    createdAt: "2026-07-03T00:00:00.000Z",
  })

  const plan = await db.all<{ detail: string }[]>(`
    EXPLAIN QUERY PLAN SELECT value FROM ns_agent_artifacts
    WHERE json_extract(value, '$.projectId') = 'project_1'
      AND json_extract(value, '$.conversationId') = 'conversation_1'
  `)
  expect(plan.some((row) => row.detail.includes("SCAN ns_agent_artifacts"))).toBe(false)
})
```

- [ ] **Step 2: Run schema tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/runtime/data-repo/__tests__/schemas.test.ts electron/runtime/data-repo/__tests__/sqlite-backend.test.ts
```

Expected: FAIL because `agentArtifactsSchema` and indexes are not defined.

- [ ] **Step 3: Add schema and exports**

Add to `desktop/electron/runtime/data-repo/schemas/placeholders.ts` near `AgentEventEntryV1`:

```ts
const supportedAgentArtifactImageMimeTypes = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
])

const isSha256Hex = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/i.test(value)

const hasNoArtifactBytes = (value: Record<string, unknown>): boolean =>
  value.base64 === undefined && value.data === undefined && value.bytes === undefined

export interface AgentArtifactEntryV1 extends Record<string, unknown> {
  id: string
  schemaVersion: 1
  projectId: string
  conversationId: string
  turnId: string
  toolUseId?: string
  toolName?: string
  kind: "image"
  mimeType: "image/png" | "image/jpeg" | "image/gif" | "image/webp"
  byteSize: number
  sha256: string
  storagePath: string
  createdAt: string
}

export const agentArtifactsSchema: NamespaceSchema<AgentArtifactEntryV1> = {
  name: "agent.artifacts",
  backend: "sqlite",
  currentVersion: 1,
  migrations: noMigrations,
  validate: (v): v is AgentArtifactEntryV1 =>
    isAnyRecord<AgentArtifactEntryV1>(v)
    && (v as AgentArtifactEntryV1).schemaVersion === 1
    && typeof (v as AgentArtifactEntryV1).id === "string"
    && typeof (v as AgentArtifactEntryV1).projectId === "string"
    && typeof (v as AgentArtifactEntryV1).conversationId === "string"
    && typeof (v as AgentArtifactEntryV1).turnId === "string"
    && isOptionalString((v as AgentArtifactEntryV1).toolUseId)
    && isOptionalString((v as AgentArtifactEntryV1).toolName)
    && (v as AgentArtifactEntryV1).kind === "image"
    && supportedAgentArtifactImageMimeTypes.has((v as AgentArtifactEntryV1).mimeType)
    && typeof (v as AgentArtifactEntryV1).byteSize === "number"
    && Number.isInteger((v as AgentArtifactEntryV1).byteSize)
    && (v as AgentArtifactEntryV1).byteSize > 0
    && isSha256Hex((v as AgentArtifactEntryV1).sha256)
    && typeof (v as AgentArtifactEntryV1).storagePath === "string"
    && typeof (v as AgentArtifactEntryV1).createdAt === "string"
    && hasNoArtifactBytes(v as Record<string, unknown>),
}
```

Export and register it in `desktop/electron/runtime/data-repo/schemas/index.ts` and `desktop/electron/runtime/data-repo/index.ts`:

```ts
export {
  agentArtifactsSchema,
  type AgentArtifactEntryV1,
} from "./placeholders"
```

Add `agentArtifactsSchema` to `allSchemas` near `agentEventsSchema`.

Add to `desktop/electron/runtime/data-repo/factory.ts` inside `sqliteIndexesFor`:

```ts
case "agent.artifacts":
  return [
    "CREATE INDEX IF NOT EXISTS idx_ns_agent_artifacts_conversation ON ns_agent_artifacts(json_extract(value, '$.projectId'), json_extract(value, '$.conversationId'))",
    "CREATE INDEX IF NOT EXISTS idx_ns_agent_artifacts_turn ON ns_agent_artifacts(json_extract(value, '$.conversationId'), json_extract(value, '$.turnId'))",
  ]
```

- [ ] **Step 4: Run schema tests and verify they pass**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/runtime/data-repo/__tests__/schemas.test.ts electron/runtime/data-repo/__tests__/sqlite-backend.test.ts
```

Expected: PASS.

## Task 2: Parse SDK Image Blocks Without Persisting Bytes

**Files:**
- Modify: `desktop/electron/services/agent-runtime/types.ts`
- Modify: `desktop/electron/services/agent-runtime/sdk-event-bridge.ts`
- Modify: `desktop/electron/services/agent-runtime/claude-sdk-session.ts`
- Test: `desktop/electron/services/agent-runtime/__tests__/sdk-event-bridge.test.ts`

- [ ] **Step 1: Write failing bridge tests**

Add to `desktop/electron/services/agent-runtime/__tests__/sdk-event-bridge.test.ts`:

```ts
it("extracts image tool result blocks into runtime-only imageBlocks", () => {
  const result = bridgeSdkMessage({
    type: "user",
    message: {
      role: "user",
      content: [{
        type: "tool_result",
        tool_use_id: "toolu_image",
        content: [{
          type: "image",
          file: {
            type: "image/png",
            base64: "iVBORw0KGgo=",
          },
        }],
      }],
    },
  } as SDKMessage)

  expect(result).toEqual([expect.objectContaining({
    type: "toolResult",
    toolUseId: "toolu_image",
    content: undefined,
    imageBlocks: [{
      kind: "image",
      mimeType: "image/png",
      base64: "iVBORw0KGgo=",
    }],
    contentDiagnostics: expect.objectContaining({
      kind: "array",
      contentTypes: ["image"],
      imageCount: 1,
    }),
  })])
})

it("ignores unsupported image mime types from tool results", () => {
  const result = bridgeSdkMessage({
    type: "user",
    message: {
      role: "user",
      content: [{
        type: "tool_result",
        tool_use_id: "toolu_svg",
        content: [{
          type: "image",
          data: "PHN2Zz4=",
          mimeType: "image/svg+xml",
        }],
      }],
    },
  } as SDKMessage)

  expect(result).toEqual([expect.objectContaining({
    type: "toolResult",
    imageBlocks: undefined,
    contentDiagnostics: expect.objectContaining({
      imageCount: 1,
    }),
  })])
})
```

- [ ] **Step 2: Run bridge tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/agent-runtime/__tests__/sdk-event-bridge.test.ts
```

Expected: FAIL because `imageBlocks` is not extracted.

- [ ] **Step 3: Add runtime-only block types**

Add to `desktop/electron/services/agent-runtime/types.ts`:

```ts
export type AgentArtifactImageMimeType =
  | "image/png"
  | "image/jpeg"
  | "image/gif"
  | "image/webp"

export interface AgentToolResultImageBlock {
  readonly kind: "image"
  readonly mimeType: AgentArtifactImageMimeType
  readonly base64: string
}

export interface AgentImageArtifact {
  readonly id: string
  readonly kind: "image"
  readonly mimeType: AgentArtifactImageMimeType
  readonly byteSize: number
  readonly url: string
  readonly sha256?: string
}
```

Extend `AgentToolResultEvent`:

```ts
readonly imageBlocks?: readonly AgentToolResultImageBlock[]
readonly imageArtifacts?: readonly AgentImageArtifact[]
```

- [ ] **Step 4: Extract image blocks in the bridge**

In `desktop/electron/services/agent-runtime/sdk-event-bridge.ts`, add helpers:

```ts
const SUPPORTED_IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
])

function toolResultImageBlocks(value: unknown): readonly AgentToolResultImageBlock[] | undefined {
  if (!Array.isArray(value)) return undefined
  const images: AgentToolResultImageBlock[] = []
  for (const item of value) {
    const record = isRecord(item) ? item : undefined
    if (stringValue(record?.type) !== "image") continue
    const file = isRecord(record.file) ? record.file : undefined
    const source = isRecord(record.source) ? record.source : undefined
    const base64 = stringValue(file?.base64)
      ?? stringValue(record.data)
      ?? stringValue(source?.data)
    const mimeType = stringValue(file?.type)
      ?? stringValue(record.mimeType)
      ?? stringValue(record.mime_type)
      ?? stringValue(source?.media_type)
      ?? stringValue(source?.mimeType)
    if (!base64 || !isSupportedImageMimeType(mimeType)) continue
    images.push({ kind: "image", mimeType, base64 })
  }
  return images.length > 0 ? images : undefined
}

function isSupportedImageMimeType(value: string | undefined): value is AgentArtifactImageMimeType {
  return Boolean(value && SUPPORTED_IMAGE_MIME_TYPES.has(value))
}
```

Attach the transient field inside `toolResultEventsFromBlocks`:

```ts
const imageBlocks = toolResultImageBlocks(record.content)
return [{
  type: "toolResult",
  sdkSessionId,
  toolUseId,
  toolName: toolUseId ?? "tool_result",
  content: toolResultContent(record.content),
  contentDiagnostics: toolResultContentDiagnostics(record.content),
  ...(imageBlocks ? { imageBlocks } : {}),
  status: isError ? "error" : "success",
  success: !isError,
  ...envelope,
}]
```

- [ ] **Step 5: Preserve fields when resolving tool result names**

Verify `desktop/electron/services/agent-runtime/claude-sdk-session.ts` keeps all fields:

```ts
return toolName ? { ...event, toolName } : { ...event, toolName: "tool_result" }
```

No code change is needed if this spread remains intact.

- [ ] **Step 6: Run bridge tests and verify they pass**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/agent-runtime/__tests__/sdk-event-bridge.test.ts
```

Expected: PASS.

## Task 3: Materialize Image Blocks Into Local Artifact Files

**Files:**
- Create: `desktop/electron/services/agent-runtime/artifact-store.ts`
- Modify: `desktop/electron/services/agent-runtime/index.ts`
- Modify: `desktop/electron/services/agent-runtime/conversation-router.ts`
- Test: `desktop/electron/services/agent-runtime/__tests__/artifact-store.test.ts`
- Test: `desktop/electron/services/agent-runtime/__tests__/conversation-router.test.ts`

- [ ] **Step 1: Write failing artifact store tests**

Create `desktop/electron/services/agent-runtime/__tests__/artifact-store.test.ts`:

```ts
import { mkdtemp, readFile, stat } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { MemoryNamespace } from "../../../runtime/data-repo/__tests__/memory-namespace"
import type { AgentArtifactEntryV1 } from "../../../runtime/data-repo"
import { AgentArtifactStore } from "../artifact-store"

describe("AgentArtifactStore", () => {
  it("writes image bytes and stores metadata without base64", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-agent-artifacts-"))
    const namespace = new MemoryNamespace<AgentArtifactEntryV1>("agent.artifacts")
    const store = new AgentArtifactStore({
      rootDirectory: root,
      artifacts: namespace,
      now: () => new Date("2026-07-03T00:00:00.000Z"),
      randomId: () => "artifact_1",
    })

    const artifacts = await store.materializeToolResultImages({
      projectId: "project_1",
      conversationId: "conversation_1",
      turnId: "turn_1",
      toolUseId: "toolu_1",
      toolName: "Read",
      imageBlocks: [{
        kind: "image",
        mimeType: "image/png",
        base64: Buffer.from([137, 80, 78, 71]).toString("base64"),
      }],
    })

    expect(artifacts).toEqual([expect.objectContaining({
      id: "artifact_1",
      kind: "image",
      mimeType: "image/png",
      byteSize: 4,
      url: expect.stringContaining("artifact_1.png"),
    })])
    const rows = await namespace.list()
    expect(rows).toHaveLength(1)
    expect(rows[0]).not.toHaveProperty("base64")
    expect(rows[0]).toEqual(expect.objectContaining({
      id: "artifact_1",
      projectId: "project_1",
      conversationId: "conversation_1",
      turnId: "turn_1",
      toolUseId: "toolu_1",
      toolName: "Read",
      byteSize: 4,
    }))
    expect(await readFile(rows[0].storagePath)).toEqual(Buffer.from([137, 80, 78, 71]))
    await expect(stat(rows[0].storagePath)).resolves.toMatchObject({ size: 4 })
  })
})
```

- [ ] **Step 2: Run artifact store test and verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/agent-runtime/__tests__/artifact-store.test.ts
```

Expected: FAIL because `AgentArtifactStore` does not exist.

- [ ] **Step 3: Implement artifact store**

Create `desktop/electron/services/agent-runtime/artifact-store.ts`:

```ts
import { createHash, randomUUID } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import type { AgentArtifactEntryV1, DataNamespace } from "../../runtime/data-repo"
import type { AgentImageArtifact, AgentToolResultImageBlock } from "./types"

interface AgentArtifactStoreDeps {
  readonly rootDirectory: string
  readonly artifacts: DataNamespace<AgentArtifactEntryV1>
  readonly now?: () => Date
  readonly randomId?: () => string
}

interface MaterializeToolResultImagesInput {
  readonly projectId: string
  readonly conversationId: string
  readonly turnId: string
  readonly toolUseId?: string
  readonly toolName?: string
  readonly imageBlocks?: readonly AgentToolResultImageBlock[]
}

export class AgentArtifactStore {
  private readonly deps: AgentArtifactStoreDeps

  constructor(deps: AgentArtifactStoreDeps) {
    this.deps = deps
  }

  async materializeToolResultImages(input: MaterializeToolResultImagesInput): Promise<readonly AgentImageArtifact[]> {
    const blocks = input.imageBlocks ?? []
    if (blocks.length === 0) return []
    const artifacts: AgentImageArtifact[] = []
    for (const block of blocks) {
      const bytes = Buffer.from(block.base64, "base64")
      if (bytes.length === 0) continue
      const id = this.deps.randomId?.() ?? randomUUID()
      const extension = extensionForMimeType(block.mimeType)
      const directory = path.join(this.deps.rootDirectory, safePathSegment(input.projectId), safePathSegment(input.conversationId))
      const storagePath = path.join(directory, `${safePathSegment(id)}.${extension}`)
      const sha256 = createHash("sha256").update(bytes).digest("hex")
      await mkdir(directory, { recursive: true })
      await writeFile(storagePath, bytes)
      await this.deps.artifacts.upsert({
        id,
        schemaVersion: 1,
        projectId: input.projectId,
        conversationId: input.conversationId,
        turnId: input.turnId,
        ...(input.toolUseId ? { toolUseId: input.toolUseId } : {}),
        ...(input.toolName ? { toolName: input.toolName } : {}),
        kind: "image",
        mimeType: block.mimeType,
        byteSize: bytes.length,
        sha256,
        storagePath,
        createdAt: (this.deps.now?.() ?? new Date()).toISOString(),
      })
      artifacts.push({
        id,
        kind: "image",
        mimeType: block.mimeType,
        byteSize: bytes.length,
        url: storagePath,
        sha256,
      })
    }
    return artifacts
  }
}

function extensionForMimeType(mimeType: AgentToolResultImageBlock["mimeType"]): string {
  switch (mimeType) {
    case "image/png":
      return "png"
    case "image/jpeg":
      return "jpg"
    case "image/gif":
      return "gif"
    case "image/webp":
      return "webp"
    default: {
      const exhaustive: never = mimeType
      return exhaustive
    }
  }
}

function safePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "artifact"
}
```

- [ ] **Step 4: Run artifact store test and verify it passes**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/agent-runtime/__tests__/artifact-store.test.ts
```

Expected: PASS.

- [ ] **Step 5: Wire store into runtime deps**

In `desktop/electron/services/agent-runtime/types.ts`, add to the router deps type imports if needed:

```ts
export type { AgentArtifactStore } from "./artifact-store"
```

In `desktop/electron/services/agent-runtime/conversation-router.ts`, add dependency:

```ts
import type { AgentArtifactStore } from "./artifact-store"

export interface ConversationRouterDeps {
  readonly agentArtifactStore?: AgentArtifactStore
}
```

In `desktop/electron/services/agent-runtime/index.ts`, construct the store where DataRepository namespaces are wired:

```ts
import { AgentArtifactStore } from "./artifact-store"
import type { AgentArtifactEntryV1 } from "../../runtime/data-repo"

const agentArtifactStore = new AgentArtifactStore({
  rootDirectory: path.join(ctx.appPaths.userData, "agent-artifacts"),
  artifacts: ctx.dataRepo.namespace<AgentArtifactEntryV1>("agent.artifacts"),
})
```

Pass `agentArtifactStore` into `ConversationRouter`.

- [ ] **Step 6: Materialize before emit/persist/history**

Add helper to `desktop/electron/services/agent-runtime/conversation-router.ts`:

```ts
private async prepareEventForStorageAndDisplay(
  conversationId: string,
  turnId: string,
  event: AgentEvent,
): Promise<AgentEvent> {
  if (event.type !== "toolResult" || !event.imageBlocks?.length || !this.deps.agentArtifactStore) {
    return stripTransientImageBlocks(event)
  }
  const imageArtifacts = await this.deps.agentArtifactStore.materializeToolResultImages({
    projectId: this.deps.projectId,
    conversationId,
    turnId,
    toolUseId: event.toolUseId,
    toolName: event.toolName,
    imageBlocks: event.imageBlocks,
  })
  return stripTransientImageBlocks({
    ...event,
    ...(imageArtifacts.length > 0 ? { imageArtifacts } : {}),
  })
}

function stripTransientImageBlocks<T extends AgentEvent>(event: T): T {
  if (event.type !== "toolResult" || !event.imageBlocks) return event
  const { imageBlocks: _imageBlocks, ...rest } = event
  return rest as T
}
```

Use this helper immediately after receiving any SDK/tool event and before `events.push`, `emitEvent`, `persistAgentEvent`, and `saveEventHistory`:

```ts
const preparedEvent = await this.prepareEventForStorageAndDisplay(conversation.id, turnId, event)
events.push(preparedEvent)
this.emitEvent(message, conversation.id, preparedEvent)
await this.persistAgentEvent(conversation.id, turnId, events.length, preparedEvent)
await this.saveEventSdkSession(conversation.id, preparedEvent, liveSession)
assistantHistoryPersisted = await this.saveEventHistory(conversation.id, preparedEvent) || assistantHistoryPersisted
```

Apply the same pattern in relay mode and command-result event paths that already call `persistAgentEvent`.

- [ ] **Step 7: Add router safety test**

Add to `desktop/electron/services/agent-runtime/__tests__/conversation-router.test.ts`:

```ts
it("materializes imageBlocks before broadcasting and persisting tool results", async () => {
  const agentEvents = new MemoryNamespace<AgentEventEntryV1>("agent.events")
  const artifacts = new MemoryNamespace<AgentArtifactEntryV1>("agent.artifacts")
  const artifactRoot = await fs.mkdtemp(path.join(await fs.realpath(tmpdir()), "synapse-agent-artifacts-"))
  const emitted: AgentEvent[] = []
  const artifactStore = new AgentArtifactStore({
    rootDirectory: artifactRoot,
    artifacts,
    now: () => new Date("2026-07-03T00:00:00.000Z"),
    randomId: () => "artifact_1",
  })
  const { router, session } = createRouter({
    agentEvents,
    agentArtifactStore: artifactStore,
    onEvent: (event) => emitted.push(event),
  })

  session.queueEvent({
    type: "toolResult",
    toolUseId: "toolu_1",
    toolName: "Read",
    imageBlocks: [{
      kind: "image",
      mimeType: "image/png",
      base64: Buffer.from([137, 80, 78, 71]).toString("base64"),
    }],
    status: "success",
    success: true,
  })
  session.queueEvent({ type: "result", content: "", done: true })

  await router.handleMessage(messageForExistingConversation())

  expect(emitted.some((event) => event.type === "toolResult" && "imageBlocks" in event)).toBe(false)
  expect(emitted).toContainEqual(expect.objectContaining({
    type: "toolResult",
    imageArtifacts: [expect.objectContaining({ id: "artifact_1", mimeType: "image/png" })],
  }))
  const persisted = await agentEvents.list()
  expect(JSON.stringify(persisted)).not.toContain("base64")
  expect(JSON.stringify(persisted)).not.toContain("iVBOR")
  expect(await artifacts.list()).toHaveLength(1)
})
```

- [ ] **Step 8: Run router tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/agent-runtime/__tests__/conversation-router.test.ts
```

Expected: PASS.

## Task 4: Carry Artifacts Through Timeline and History

**Files:**
- Modify: `desktop/src/types/agent.ts`
- Modify: `desktop/src/lib/agent-timeline.ts`
- Modify: `desktop/electron/services/agent-runtime/conversation-router.ts`
- Test: `desktop/src/lib/__tests__/agent-timeline.test.ts`
- Test: `desktop/electron/services/agent-runtime/__tests__/conversation-router.test.ts`

- [ ] **Step 1: Write failing timeline tests**

Add to `desktop/src/lib/__tests__/agent-timeline.test.ts`:

```ts
it("preserves image artifacts on live tool result timeline items", () => {
  const item = agentEventToTimelineItem({
    type: "toolResult",
    toolName: "Read",
    toolUseId: "toolu_1",
    imageArtifacts: [{
      id: "artifact_1",
      kind: "image",
      mimeType: "image/png",
      byteSize: 4,
      url: "/tmp/artifact_1.png",
      sha256: "a".repeat(64),
    }],
    status: "success",
    success: true,
  }, {
    id: "event:1",
    timestamp: "2026-07-03T00:00:00.000Z",
  })

  expect(item).toEqual(expect.objectContaining({
    kind: "toolResult",
    imageArtifacts: [expect.objectContaining({ id: "artifact_1" })],
  }))
})

it("restores image artifacts from tool result history metadata", () => {
  const item = historyRecordToTimelineItem("conversation_1", {
    role: "tool",
    content: "Read",
    timestamp: "2026-07-03T00:00:00.000Z",
    metadata: {
      agentEventType: "toolResult",
      toolUseId: "toolu_1",
      toolName: "Read",
      imageArtifacts: [{
        id: "artifact_1",
        kind: "image",
        mimeType: "image/png",
        byteSize: 4,
        url: "/tmp/artifact_1.png",
      }],
    },
  }, 0)

  expect(item).toEqual(expect.objectContaining({
    kind: "toolResult",
    imageArtifacts: [expect.objectContaining({ id: "artifact_1" })],
  }))
})
```

- [ ] **Step 2: Run timeline tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/lib/__tests__/agent-timeline.test.ts
```

Expected: FAIL because `imageArtifacts` is not present on renderer timeline items.

- [ ] **Step 3: Add renderer types**

In `desktop/src/types/agent.ts`, add:

```ts
export type SynapseAgentArtifactImageMimeType =
  | "image/png"
  | "image/jpeg"
  | "image/gif"
  | "image/webp"

export interface SynapseAgentImageArtifact {
  readonly id: string
  readonly kind: "image"
  readonly mimeType: SynapseAgentArtifactImageMimeType
  readonly byteSize: number
  readonly url: string
  readonly sha256?: string
}
```

Add `imageArtifacts?: readonly SynapseAgentImageArtifact[]` to the `toolResult` event branch and `SynapseAgentToolResultTimelineItem`.

- [ ] **Step 4: Carry artifacts through timeline conversion**

In `desktop/src/lib/agent-timeline.ts`, add on live event conversion:

```ts
imageArtifacts: event.imageArtifacts,
```

Add metadata reader:

```ts
function imageArtifactsMetadata(
  metadata: Record<string, unknown> | undefined,
  key: string,
): SynapseAgentToolResultTimelineItem["imageArtifacts"] | undefined {
  const value = metadata?.[key]
  if (!Array.isArray(value)) return undefined
  const artifacts = value.filter((item): item is SynapseAgentToolResultTimelineItem["imageArtifacts"][number] => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false
    const record = item as Record<string, unknown>
    return record.kind === "image"
      && typeof record.id === "string"
      && typeof record.mimeType === "string"
      && typeof record.byteSize === "number"
      && typeof record.url === "string"
  })
  return artifacts.length > 0 ? artifacts : undefined
}
```

Use it in `historyRecordToTimelineItem` for `agentEventType === "toolResult"`:

```ts
imageArtifacts: imageArtifactsMetadata(metadata, "imageArtifacts"),
```

- [ ] **Step 5: Persist artifact metadata in history**

In `desktop/electron/services/agent-runtime/conversation-router.ts`, add to `historyEntryForAgentEvent` tool result metadata:

```ts
imageArtifacts: event.imageArtifacts,
```

Also make content readable when the result only contains images:

```ts
const artifactLabel = event.imageArtifacts?.length
  ? `${event.toolName} (${event.imageArtifacts.length} image${event.imageArtifacts.length === 1 ? "" : "s"})`
  : event.toolName
```

Use `artifactLabel` as the fallback content.

- [ ] **Step 6: Run timeline and router tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/lib/__tests__/agent-timeline.test.ts electron/services/agent-runtime/__tests__/conversation-router.test.ts
```

Expected: PASS.

## Task 5: Render Image Artifacts in Tool Results

**Files:**
- Create: `desktop/src/modules/agent/components/agent-tool-image-artifacts.tsx`
- Modify: `desktop/src/modules/agent/components/agent-tool-event.tsx`
- Test: `desktop/src/modules/agent/components/__tests__/agent-tool-event.test.tsx`

- [ ] **Step 1: Write failing component test**

Add to `desktop/src/modules/agent/components/__tests__/agent-tool-event.test.tsx`:

```tsx
it("renders image artifact thumbnails for image tool results", () => {
  render(
    <AgentToolEvent
      item={{
        id: "event:1",
        kind: "toolResult",
        timestamp: "2026-07-03T00:00:00.000Z",
        toolName: "Read",
        toolUseId: "toolu_1",
        imageArtifacts: [{
          id: "artifact_1",
          kind: "image",
          mimeType: "image/png",
          byteSize: 4,
          url: "/tmp/artifact_1.png",
        }],
        status: "success",
        success: true,
      }}
      profile={profile}
    />,
  )

  fireEvent.click(screen.getByRole("button", { name: /Read/ }))
  expect(screen.getByRole("img", { name: "Read image 1" })).toHaveAttribute("src", "/tmp/artifact_1.png")
})
```

- [ ] **Step 2: Run component test and verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/agent/components/__tests__/agent-tool-event.test.tsx
```

Expected: FAIL because image artifacts are not rendered.

- [ ] **Step 3: Add focused image component**

Create `desktop/src/modules/agent/components/agent-tool-image-artifacts.tsx`:

```tsx
import type { SynapseAgentImageArtifact } from "@/types/agent"

interface AgentToolImageArtifactsProps {
  readonly toolName: string
  readonly artifacts: readonly SynapseAgentImageArtifact[]
}

function AgentToolImageArtifacts({ toolName, artifacts }: AgentToolImageArtifactsProps) {
  if (artifacts.length === 0) return null
  return (
    <div className="grid max-w-full grid-cols-2 gap-2 sm:grid-cols-3">
      {artifacts.map((artifact, index) => (
        <a
          key={artifact.id}
          href={artifact.url}
          target="_blank"
          rel="noreferrer"
          className="block overflow-hidden rounded border border-border bg-muted/30"
        >
          <img
            src={artifact.url}
            alt={`${toolName} image ${index + 1}`}
            className="aspect-video h-auto w-full object-contain"
            loading="lazy"
          />
        </a>
      ))}
    </div>
  )
}

export { AgentToolImageArtifacts }
```

- [ ] **Step 4: Render the component from tool event body**

In `desktop/src/modules/agent/components/agent-tool-event.tsx`, import:

```tsx
import { AgentToolImageArtifacts } from "./agent-tool-image-artifacts"
```

Inside `CollapsibleContent`, after the text body block:

```tsx
{effectiveResult?.imageArtifacts?.length ? (
  <AgentToolImageArtifacts
    toolName={effectiveResult.toolName}
    artifacts={effectiveResult.imageArtifacts}
  />
) : null}
```

Keep existing shadcn/Tailwind token styling. Do not add custom colors or inline styles.

- [ ] **Step 5: Run component test**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/agent/components/__tests__/agent-tool-event.test.tsx
```

Expected: PASS.

## Task 6: Export Artifact Metadata and Files

**Files:**
- Modify: `desktop/electron/services/agent-runtime/conversation-export-service.ts`
- Test: `desktop/electron/services/agent-runtime/__tests__/conversation-export-service.test.ts`

- [ ] **Step 1: Write failing export test**

Add to `desktop/electron/services/agent-runtime/__tests__/conversation-export-service.test.ts`:

```ts
it("exports agent image artifact metadata and copied files", async () => {
  const artifactRoot = await fs.mkdtemp(path.join(await fs.realpath(tmpdir()), "synapse-agent-artifact-export-"))
  const imagePath = path.join(artifactRoot, "artifact_1.png")
  await fs.writeFile(imagePath, Buffer.from([137, 80, 78, 71]))
  const artifacts = new MemoryNamespace<AgentArtifactEntryV1>("agent.artifacts")
  await artifacts.upsert({
    id: "artifact_1",
    schemaVersion: 1,
    projectId: "project_1",
    conversationId: "conversation_1",
    turnId: "turn_1",
    toolUseId: "toolu_1",
    toolName: "Read",
    kind: "image",
    mimeType: "image/png",
    byteSize: 4,
    sha256: "a".repeat(64),
    storagePath: imagePath,
    createdAt: "2026-07-03T00:00:00.000Z",
  })

  const { exportBundle, readPackageFile } = createExportHarness({ artifacts })
  await exportBundle()

  const manifest = JSON.parse(await readPackageFile("agent-artifacts.json")) as {
    artifacts: Array<{ id: string; relativePath: string }>
  }
  expect(manifest.artifacts).toEqual([expect.objectContaining({
    id: "artifact_1",
    relativePath: "artifacts/artifact_1.png",
  })])
  expect(await readPackageFile("artifacts/artifact_1.png", "buffer")).toEqual(Buffer.from([137, 80, 78, 71]))
})
```

- [ ] **Step 2: Run export test and verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/agent-runtime/__tests__/conversation-export-service.test.ts
```

Expected: FAIL because the export service has no `agent.artifacts` dependency.

- [ ] **Step 3: Add export dependency and manifest**

In `desktop/electron/services/agent-runtime/conversation-export-service.ts`, add dependency:

```ts
readonly agentArtifacts?: DataNamespace<AgentArtifactEntryV1>
```

Collect rows:

```ts
const agentArtifacts = await this.collectRows(
  "agent-artifacts.json",
  () => this.deps.agentArtifacts
    ? this.deps.agentArtifacts.list({
      projectId: request.projectId,
      conversationId: request.conversationId,
    } as Partial<AgentArtifactEntryV1>)
    : Promise.resolve([]),
  skipped,
)
```

Write metadata:

```ts
await this.writeJson(packageRoot, "agent-artifacts.json", {
  schemaVersion: 1,
  binaryIncluded: true,
  artifacts: agentArtifacts.map((artifact) => ({
    id: artifact.id,
    kind: artifact.kind,
    mimeType: artifact.mimeType,
    byteSize: artifact.byteSize,
    sha256: artifact.sha256,
    toolUseId: artifact.toolUseId,
    toolName: artifact.toolName,
    createdAt: artifact.createdAt,
    relativePath: `artifacts/${artifact.id}.${extensionForMimeType(artifact.mimeType)}`,
  })),
}, included)
```

Copy files:

```ts
for (const artifact of agentArtifacts) {
  const relativePath = `artifacts/${artifact.id}.${extensionForMimeType(artifact.mimeType)}`
  await this.copyBinaryFile(artifact.storagePath, path.join(packageRoot, relativePath))
  included.push(relativePath)
}
```

Add `copyBinaryFile` using `copyFile` from `node:fs/promises`; on copy failure, push `{ path: relativePath, reason: "artifact file copy failed" }` and continue.

Update manifest attachment wording:

```ts
attachments: {
  binaryIncluded: false,
  description: "User input attachment bytes are not exported. Agent output artifacts are listed in agent-artifacts.json; copied artifact files are under artifacts/ when available.",
},
```

- [ ] **Step 4: Run export tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/agent-runtime/__tests__/conversation-export-service.test.ts
```

Expected: PASS.

## Task 7: Transcript and Release Note

**Files:**
- Modify: `desktop/src/lib/agent-transcript.ts`
- Modify: `RELEASE_NOTES_PENDING.md`
- Test: `desktop/src/lib/__tests__/agent-transcript.test.ts`

- [ ] **Step 1: Write failing transcript test**

Add to `desktop/src/lib/__tests__/agent-transcript.test.ts`:

```ts
it("mentions image artifacts in tool result transcript text", () => {
  const transcript = formatAgentTranscript([{
    id: "event:1",
    kind: "toolResult",
    timestamp: "2026-07-03T00:00:00.000Z",
    toolName: "Read",
    toolUseId: "toolu_1",
    imageArtifacts: [{
      id: "artifact_1",
      kind: "image",
      mimeType: "image/png",
      byteSize: 4,
      url: "/tmp/artifact_1.png",
    }],
    status: "success",
    success: true,
  }])

  expect(transcript).toContain("Read")
  expect(transcript).toContain("image/png")
  expect(transcript).toContain("artifact_1")
})
```

- [ ] **Step 2: Implement transcript formatting**

In `desktop/src/lib/agent-transcript.ts`, update the `toolResult` case:

```ts
case "toolResult": {
  const content = entry.content?.trim()
  const artifactText = entry.imageArtifacts?.map((artifact, index) =>
    `Image ${index + 1}: ${artifact.id} ${artifact.mimeType} ${artifact.byteSize} B`,
  ).join("\n")
  return [content ? redactSensitiveText(content) : entry.toolName, artifactText]
    .filter((part): part is string => Boolean(part))
    .join("\n")
}
```

- [ ] **Step 3: Add release note**

Add one bullet to `RELEASE_NOTES_PENDING.md`:

```md
- Agent 对话现在可以显示 Claude Code SDK 工具返回的图片结果，例如 `Read` 读取 PNG 后会在工具结果中展示图片预览，并在导出会话时带上对应图片文件。
```

- [ ] **Step 4: Run transcript test**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/lib/__tests__/agent-transcript.test.ts
```

Expected: PASS.

## Task 8: End-to-End Verification

**Files:**
- Verify only.

- [ ] **Step 1: Run focused tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  electron/services/agent-runtime/__tests__/sdk-event-bridge.test.ts \
  electron/services/agent-runtime/__tests__/artifact-store.test.ts \
  electron/services/agent-runtime/__tests__/conversation-router.test.ts \
  electron/services/agent-runtime/__tests__/conversation-export-service.test.ts \
  src/lib/__tests__/agent-timeline.test.ts \
  src/lib/__tests__/agent-transcript.test.ts \
  src/modules/agent/components/__tests__/agent-tool-event.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```bash
pnpm --filter @synapse/desktop run typecheck
```

Expected: PASS.

- [ ] **Step 3: Manual validation with the existing probe**

Run Synapse Agent with this message:

```text
创建一个 1x1 PNG 文件，然后使用 Read 工具读取它。最后只用一句话说明是否读取成功。
```

Expected:

- The `Read` tool result shows an image preview.
- The tool result text can still be empty without leaving a blank-looking output.
- Exported bundle contains `agent-artifacts.json`.
- Exported bundle contains `artifacts/<artifactId>.png`.
- `agent-events.json`, `conversation.json`, `timeline.json`, and `transcript.md` do not contain the raw base64 image string.

## Self-Review

- Spec coverage: SDK image parsing is covered by Task 2. Artifact storage and no-base64 persistence are covered by Task 3. Timeline/history are covered by Task 4. Renderer display is covered by Task 5. Export and transcript are covered by Tasks 6 and 7. Verification is covered by Task 8.
- Placeholder scan: This plan has no unresolved placeholders and no unfilled implementation slots.
- Type consistency: `AgentToolResultImageBlock` is runtime-only, `AgentImageArtifact` is Electron-side metadata, and `SynapseAgentImageArtifact` is renderer-facing metadata. `imageBlocks` is stripped before persistence; `imageArtifacts` is persisted and rendered.

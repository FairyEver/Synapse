# Tools Module File Conversion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a top-level Tools module and a File Conversion tool window that converts selected `.docx`, `.xlsx`, `.pdf`, and `.pptx` files to Markdown without blocking the Electron main process.

**Architecture:** The renderer gets a new `tools` module and top-level `工具` tab. Electron gets a `tools` IPC module, a main-process tool registry, a generic tool window service, and a file conversion runner that delegates conversion to a `worker_threads` worker. Existing `desktop/electron/services/file-conversion/` remains the shared conversion service and stays independent from Knowledge Base.

**Tech Stack:** Electron, React, TypeScript, shadcn/Radix UI, Tailwind tokens, zod IPC schemas, `worker_threads`, existing file-conversion extractors.

---

## File Structure

Create:

- `desktop/src/types/tools.ts` - renderer/main shared Tools API types.
- `desktop/electron/services/tools/tool-registry.ts` - main-process tool definitions and validation.
- `desktop/electron/services/tools/tool-window-service.ts` - generic BrowserWindow manager for tool windows.
- `desktop/electron/services/tools/file-conversion-types.ts` - file conversion tool request/result types used by IPC, runner, and worker.
- `desktop/electron/services/tools/file-conversion-runner.ts` - starts and supervises the conversion worker.
- `desktop/electron/workers/file-conversion-worker.ts` - worker entry that converts files and writes Markdown.
- `desktop/electron/modules/tools/ipc.ts` - Tools IPC module.
- `desktop/electron/services/tools/__tests__/tool-registry.test.ts`
- `desktop/electron/services/tools/__tests__/tool-window-service.test.ts`
- `desktop/electron/services/tools/__tests__/file-conversion-runner.test.ts`
- `desktop/electron/modules/tools/__tests__/ipc.test.ts`
- `desktop/src/modules/tools/registry.ts`
- `desktop/src/modules/tools/index.tsx`
- `desktop/src/modules/tools/file-conversion/file-conversion-window.tsx`
- `desktop/src/modules/tools/file-conversion/utils.ts`
- `desktop/src/modules/tools/file-conversion/__tests__/file-conversion-window.test.tsx`
- `desktop/src/modules/tools/__tests__/tools-module.test.tsx`

Modify:

- `desktop/scripts/generate-ipc.mjs` - add Tools IPC module to codegen.
- `desktop/electron/bootstrap/ipc-registry.ts` - register Tools IPC module.
- `desktop/electron/bootstrap/descriptors.ts` - define Tools service descriptors.
- `desktop/electron/bootstrap/registry.ts` - register Tools descriptors with `ServiceRegistry`.
- `desktop/electron/generated/ipc-channels.generated.ts` - regenerate with `pnpm --filter @synapse/desktop run generate:ipc`.
- `desktop/electron/preload.ts` - expose `window.synapse.tools`.
- `desktop/src/types/bridge.ts` - add Tools bridge domain.
- `desktop/src/App.tsx` - add `tools` top-level tab.
- `desktop/src/main.tsx` - route `window=tool&toolId=file-conversion`.
- `desktop/package.json` - add file conversion worker to `asarUnpack`.

Leave unchanged:

- Knowledge Base upload path remains simple copy.
- `desktop/electron/services/file-conversion/` remains Knowledge Base and Tools agnostic.

---

### Task 1: Define Shared Tools Types And Main Tool Registry

**Files:**

- Create: `desktop/src/types/tools.ts`
- Create: `desktop/electron/services/tools/tool-registry.ts`
- Test: `desktop/electron/services/tools/__tests__/tool-registry.test.ts`

- [ ] **Step 1: Write the failing registry tests**

Create `desktop/electron/services/tools/__tests__/tool-registry.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import {
  getToolDefinition,
  listToolDefinitions,
  requireToolDefinition,
  TOOL_IDS,
} from "../tool-registry"

describe("tools tool registry", () => {
  it("lists the file conversion tool as the first supported tool", () => {
    expect(listToolDefinitions()).toEqual([{
      id: "file-conversion",
      label: "文件转换",
      windowTitle: "文件转换",
      route: "file-conversion",
      bounds: {
        width: 920,
        height: 680,
        minWidth: 720,
        minHeight: 520,
      },
    }])
  })

  it("resolves known tools and rejects unknown tools", () => {
    expect(TOOL_IDS).toEqual(["file-conversion"])
    expect(getToolDefinition("file-conversion")?.label).toBe("文件转换")
    expect(getToolDefinition("unknown")).toBeNull()
    expect(() => requireToolDefinition("unknown")).toThrow("Unknown tool: unknown")
  })
})
```

- [ ] **Step 2: Run the failing registry tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/tools/__tests__/tool-registry.test.ts
```

Expected: FAIL because `tool-registry.ts` does not exist.

- [ ] **Step 3: Add shared renderer/main Tools types**

Create `desktop/src/types/tools.ts`:

```ts
export type SynapseToolId = "file-conversion"

export type SynapseToolSummary = {
  readonly id: SynapseToolId
  readonly label: string
}

export type SynapseToolsOpenToolPayload = {
  readonly toolId: SynapseToolId
}

export type SynapseToolsFileConversionSelectInputFilesResult = {
  readonly filePaths: readonly string[]
}

export type SynapseToolsFileConversionSelectOutputDirectoryResult = {
  readonly directoryPath: string | null
}

export type SynapseToolsFileConversionPayload = {
  readonly filePaths: readonly string[]
  readonly outputDirectory: string
}

export type SynapseToolsFileConversionSuccess = {
  readonly sourcePath: string
  readonly outputPath: string
  readonly warningCount: number
}

export type SynapseToolsFileConversionFailureReason =
  | "unsupported-format"
  | "read-failed"
  | "conversion-failed"
  | "write-failed"
  | "invalid-output-path"

export type SynapseToolsFileConversionFailure = {
  readonly sourcePath: string
  readonly reason: SynapseToolsFileConversionFailureReason
  readonly message: string
}

export type SynapseToolsFileConversionResult = {
  readonly successes: readonly SynapseToolsFileConversionSuccess[]
  readonly failures: readonly SynapseToolsFileConversionFailure[]
}
```

- [ ] **Step 4: Add main-process tool registry**

Create `desktop/electron/services/tools/tool-registry.ts`:

```ts
import type { SynapseToolId, SynapseToolSummary } from "../../../src/types/tools"

export type ToolWindowBounds = {
  readonly width: number
  readonly height: number
  readonly minWidth: number
  readonly minHeight: number
}

export type ToolDefinition = SynapseToolSummary & {
  readonly windowTitle: string
  readonly route: string
  readonly bounds: ToolWindowBounds
}

const TOOL_DEFINITIONS = [{
  id: "file-conversion",
  label: "文件转换",
  windowTitle: "文件转换",
  route: "file-conversion",
  bounds: {
    width: 920,
    height: 680,
    minWidth: 720,
    minHeight: 520,
  },
}] as const satisfies readonly ToolDefinition[]

export const TOOL_IDS = TOOL_DEFINITIONS.map((tool) => tool.id)

export function listToolDefinitions(): readonly ToolDefinition[] {
  return TOOL_DEFINITIONS
}

export function listToolSummaries(): readonly SynapseToolSummary[] {
  return TOOL_DEFINITIONS.map(({ id, label }) => ({ id, label }))
}

export function getToolDefinition(toolId: string): ToolDefinition | null {
  return TOOL_DEFINITIONS.find((tool) => tool.id === toolId) ?? null
}

export function requireToolDefinition(toolId: string): ToolDefinition {
  const tool = getToolDefinition(toolId)
  if (!tool) throw new Error(`Unknown tool: ${toolId}`)
  return tool
}

export function isToolId(value: string): value is SynapseToolId {
  return getToolDefinition(value) !== null
}
```

- [ ] **Step 5: Run registry tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/tools/__tests__/tool-registry.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit registry foundation**

```bash
git add desktop/src/types/tools.ts desktop/electron/services/tools/tool-registry.ts desktop/electron/services/tools/__tests__/tool-registry.test.ts
git commit -m "feat(tools): add tool registry"
```

---

### Task 2: Add Generic Tool Window Service

**Files:**

- Create: `desktop/electron/services/tools/tool-window-service.ts`
- Test: `desktop/electron/services/tools/__tests__/tool-window-service.test.ts`
- Modify: `desktop/electron/bootstrap/descriptors.ts`
- Modify: `desktop/electron/bootstrap/registry.ts`

- [ ] **Step 1: Write the failing window service tests**

Create `desktop/electron/services/tools/__tests__/tool-window-service.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"
import { createToolWindowService } from "../tool-window-service"

function createWindowMock() {
  return {
    webContents: { on: vi.fn() },
    isDestroyed: vi.fn(() => false),
    isMinimized: vi.fn(() => false),
    restore: vi.fn(),
    focus: vi.fn(),
    once: vi.fn(),
    on: vi.fn(),
    show: vi.fn(),
    loadURL: vi.fn(async () => undefined),
    loadFile: vi.fn(async () => undefined),
  }
}

describe("createToolWindowService", () => {
  it("opens a generic tool window with the tool route", async () => {
    const window = createWindowMock()
    const createWindow = vi.fn(() => window as never)
    const service = createToolWindowService({
      createWindow,
      getIconPath: () => null,
      getPreloadPath: () => "/preload.js",
      loadWindow: vi.fn(async () => undefined),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    })

    await service.open("file-conversion")

    expect(createWindow).toHaveBeenCalledWith(expect.objectContaining({
      width: 920,
      height: 680,
      minWidth: 720,
      minHeight: 520,
      resizable: true,
      title: "文件转换",
      webPreferences: expect.objectContaining({
        preload: "/preload.js",
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      }),
    }))
  })

  it("focuses the existing window for repeated opens", async () => {
    const window = createWindowMock()
    const createWindow = vi.fn(() => window as never)
    const loadWindow = vi.fn(async () => undefined)
    const service = createToolWindowService({
      createWindow,
      getIconPath: () => null,
      getPreloadPath: () => "/preload.js",
      loadWindow,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    })

    await service.open("file-conversion")
    await service.open("file-conversion")

    expect(createWindow).toHaveBeenCalledTimes(1)
    expect(loadWindow).toHaveBeenCalledTimes(1)
    expect(window.focus).toHaveBeenCalledTimes(1)
  })

  it("builds the tool window query parameters", async () => {
    const window = createWindowMock()
    const loadWindow = vi.fn(async () => undefined)
    const service = createToolWindowService({
      createWindow: vi.fn(() => window as never),
      getIconPath: () => null,
      getPreloadPath: () => "/preload.js",
      loadWindow,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    })

    await service.open("file-conversion")

    expect(loadWindow).toHaveBeenCalledWith(window, expect.objectContaining({
      id: "file-conversion",
      route: "file-conversion",
    }))
  })

  it("rejects unknown tool ids", async () => {
    const service = createToolWindowService({
      createWindow: vi.fn(),
      getIconPath: () => null,
      getPreloadPath: () => "/preload.js",
      loadWindow: vi.fn(async () => undefined),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    })

    await expect(service.open("unknown")).rejects.toThrow("Unknown tool: unknown")
  })
})
```

- [ ] **Step 2: Run the failing window service tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/tools/__tests__/tool-window-service.test.ts
```

Expected: FAIL because `tool-window-service.ts` does not exist.

- [ ] **Step 3: Implement the generic tool window service**

Create `desktop/electron/services/tools/tool-window-service.ts`:

```ts
import { app, BrowserWindow } from "electron"
import path from "node:path"
import { getWindowIconPath } from "../app-icon-service"
import { createMainLogger } from "../log-store"
import { requireToolDefinition, type ToolDefinition } from "./tool-registry"

type ToolWindowLogger = {
  info(message: string, meta?: unknown): void
  warn(message: string, meta?: unknown): void
  error(message: string, meta?: unknown): void
}

export type ToolWindowService = {
  open(toolId: string): Promise<void>
}

type ToolWindowServiceDeps = {
  createWindow: (options: Electron.BrowserWindowConstructorOptions) => BrowserWindow
  getIconPath: () => string | null
  getPreloadPath: () => string
  logger: ToolWindowLogger
  loadWindow?: (window: BrowserWindow, tool: ToolDefinition) => Promise<void>
}

async function loadToolWindow(window: BrowserWindow, tool: ToolDefinition): Promise<void> {
  const searchParams = new URLSearchParams()
  searchParams.set("window", "tool")
  searchParams.set("toolId", tool.id)

  const devServerUrl = process.env.VITE_DEV_SERVER_URL
  if (devServerUrl) {
    const url = new URL(devServerUrl)
    for (const [key, value] of searchParams.entries()) {
      url.searchParams.set(key, value)
    }
    await window.loadURL(url.toString())
    return
  }

  await window.loadFile(path.join(app.getAppPath(), "dist/index.html"), {
    query: Object.fromEntries(searchParams.entries()),
  })
}

export function createToolWindowService(deps: ToolWindowServiceDeps): ToolWindowService {
  const windowsByToolId = new Map<string, BrowserWindow>()

  return {
    async open(toolId: string): Promise<void> {
      const tool = requireToolDefinition(toolId)
      const existingWindow = windowsByToolId.get(tool.id)
      if (existingWindow && !existingWindow.isDestroyed()) {
        if (existingWindow.isMinimized()) existingWindow.restore()
        existingWindow.focus()
        deps.logger.info("Focused existing tool window.", { toolId: tool.id })
        return
      }

      const icon = deps.getIconPath()
      const window = deps.createWindow({
        ...tool.bounds,
        resizable: true,
        show: false,
        title: tool.windowTitle,
        ...(icon ? { icon } : {}),
        webPreferences: {
          preload: deps.getPreloadPath(),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      })

      windowsByToolId.set(tool.id, window)

      window.webContents.on("preload-error", (_event, _preloadPath, error) => {
        deps.logger.error("Tool window preload script failed.", { toolId: tool.id, error })
      })

      window.once("ready-to-show", () => {
        window.show()
      })

      window.on("closed", () => {
        windowsByToolId.delete(tool.id)
      })

      await (deps.loadWindow ?? loadToolWindow)(window, tool)
    },
  }
}

const logger = createMainLogger("tools.window")

export const toolWindowService = createToolWindowService({
  createWindow: (options) => new BrowserWindow(options),
  getIconPath: () => getWindowIconPath() ?? null,
  getPreloadPath: () => path.join(__dirname, "../../preload.js"),
  logger,
})
```

- [ ] **Step 4: Define and register the tool window service descriptor**

Modify `desktop/electron/bootstrap/descriptors.ts`.

Add import near existing service imports:

```ts
import { toolWindowService, type ToolWindowService } from "../services/tools/tool-window-service"
```

Add descriptor near `coreKnowledgeBaseDescriptor`:

```ts
export const coreToolsWindowDescriptor: ServiceDescriptor<ToolWindowService> = {
  id: "tools.window-service",
  criticality: "degraded",
  create() {
    return toolWindowService
  },
}
```

Modify `desktop/electron/bootstrap/registry.ts`.

Add `coreToolsWindowDescriptor` to the existing descriptor import list from `./descriptors`:

```ts
  coreKnowledgeBaseDescriptor,
  coreToolsWindowDescriptor,
  coreUpdateDescriptor,
```

Register it after `coreKnowledgeBaseDescriptor`:

```ts
  registry.register(coreKnowledgeBaseDescriptor)
  registry.register(coreToolsWindowDescriptor)
  registry.register(coreWorkflowServiceDescriptor)
```

- [ ] **Step 5: Run window service tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/tools/__tests__/tool-window-service.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit window service**

```bash
git add desktop/electron/services/tools/tool-window-service.ts desktop/electron/services/tools/__tests__/tool-window-service.test.ts desktop/electron/bootstrap/descriptors.ts desktop/electron/bootstrap/registry.ts
git commit -m "feat(tools): add generic tool windows"
```

---

### Task 3: Add Tools IPC And Preload Bridge

**Files:**

- Create: `desktop/electron/modules/tools/ipc.ts`
- Test: `desktop/electron/modules/tools/__tests__/ipc.test.ts`
- Modify: `desktop/scripts/generate-ipc.mjs`
- Modify: `desktop/electron/bootstrap/ipc-registry.ts`
- Modify: `desktop/electron/generated/ipc-channels.generated.ts`
- Modify: `desktop/electron/preload.ts`
- Modify: `desktop/src/types/bridge.ts`

- [ ] **Step 1: Write failing Tools IPC tests**

Create `desktop/electron/modules/tools/__tests__/ipc.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"
import { createInMemoryHarness } from "../../../runtime/ipc"
import type { AuditSink, PermissionGuard } from "../../../runtime/security"
import { toolsIpcModule } from "../ipc"

describe("toolsIpcModule", () => {
  it("lists available tools", async () => {
    const { harness } = createHarness()

    const result = await harness.invoke("synapse:tools:list-tools", {})

    expect(result).toEqual([{ id: "file-conversion", label: "文件转换" }])
  })

  it("opens a known tool through the window service", async () => {
    const open = vi.fn(async () => undefined)
    const { harness } = createHarness({ windowService: { open } })

    await harness.invoke("synapse:tools:open-tool", { toolId: "file-conversion" })

    expect(open).toHaveBeenCalledWith("file-conversion")
  })

  it("rejects unknown tools before opening windows", async () => {
    const open = vi.fn(async () => undefined)
    const { harness } = createHarness({ windowService: { open } })

    await expect(harness.invoke("synapse:tools:open-tool", { toolId: "unknown" }))
      .rejects.toThrow()
    expect(open).not.toHaveBeenCalled()
  })
})

function createHarness(options: {
  readonly windowService?: { open(toolId: string): Promise<void> }
} = {}) {
  const permissionGuard: PermissionGuard = {
    check: vi.fn(async () => ({ allowed: true })),
  } as never
  const auditSink: AuditSink = {
    record: vi.fn(),
  } as never
  const windowService = options.windowService ?? { open: vi.fn(async () => undefined) }
  const harness = createInMemoryHarness({
    resolve: (id: string) => {
      if (id === "tools.window-service") return windowService
      if (id === "core.permission-guard") return permissionGuard
      if (id === "core.audit-sink") return auditSink
      throw new Error(`Unknown dependency: ${id}`)
    },
  })
  harness.registry.register(toolsIpcModule, harness.ctx)
  return { harness, permissionGuard, auditSink, windowService }
}
```

- [ ] **Step 2: Run the failing Tools IPC tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/modules/tools/__tests__/ipc.test.ts
```

Expected: FAIL because the IPC module does not exist.

- [ ] **Step 3: Implement Tools IPC list/open methods**

Create `desktop/electron/modules/tools/ipc.ts`:

```ts
import { z } from "zod"
import type { IpcModule } from "../../runtime/ipc/types"
import type { ToolWindowService } from "../../services/tools/tool-window-service"
import { isToolId, listToolSummaries } from "../../services/tools/tool-registry"

const openToolPayloadSchema = z.object({
  toolId: z.string().min(1),
})

const toolSummarySchema = z.object({
  id: z.literal("file-conversion"),
  label: z.string(),
})

export const toolsIpcModule: IpcModule = {
  id: "tools",
  methods: {
    listTools: {
      kind: "invoke",
      channel: "synapse:tools:list-tools",
      request: z.object({}),
      response: z.array(toolSummarySchema),
      handler: () => listToolSummaries(),
    },
    openTool: {
      kind: "invoke",
      channel: "synapse:tools:open-tool",
      request: openToolPayloadSchema,
      response: z.void(),
      handler: async (ctx, request: { toolId: string }) => {
        if (!isToolId(request.toolId)) {
          throw new Error(`Unknown tool: ${request.toolId}`)
        }
        const service = ctx.resolve<ToolWindowService>("tools.window-service")
        await service.open(request.toolId)
      },
    },
  },
  events: {},
}
```

- [ ] **Step 4: Register Tools IPC in runtime and codegen**

Modify `desktop/electron/bootstrap/ipc-registry.ts`:

```ts
import { toolsIpcModule } from "../modules/tools/ipc"
```

Add `registry.register(toolsIpcModule, ctx)` with the other migrated modules.

Add `toolsIpcModule` to `registeredIpcModules`.

Modify `desktop/scripts/generate-ipc.mjs` by adding:

```js
{ id: "tools", importPath: "../electron/modules/tools/ipc.ts" },
```

Then run:

```bash
pnpm --filter @synapse/desktop run generate:ipc
```

Expected: `desktop/electron/generated/ipc-channels.generated.ts` gains a `"tools"` channel map.

- [ ] **Step 5: Expose the Tools bridge**

Modify `desktop/src/types/bridge.ts`.

Add import:

```ts
import type {
  SynapseToolsFileConversionPayload,
  SynapseToolsFileConversionResult,
  SynapseToolsFileConversionSelectInputFilesResult,
  SynapseToolsFileConversionSelectOutputDirectoryResult,
  SynapseToolsOpenToolPayload,
  SynapseToolSummary,
} from "./tools"
```

Add a `tools` domain to `SynapseBridge`:

```ts
  tools: {
    listTools: () => Promise<SynapseToolSummary[]>
    openTool: (payload: SynapseToolsOpenToolPayload) => Promise<void>
    fileConversion: {
      selectInputFiles: () => Promise<SynapseToolsFileConversionSelectInputFilesResult>
      selectOutputDirectory: () => Promise<SynapseToolsFileConversionSelectOutputDirectoryResult>
      convert: (payload: SynapseToolsFileConversionPayload) => Promise<SynapseToolsFileConversionResult>
    }
  }
```

Temporarily wire only `listTools` and `openTool` in `desktop/electron/preload.ts`:

```ts
  tools: {
    listTools: () => invoke(IPC_CHANNELS.tools.listTools)({}),
    openTool: (payload) => invoke(IPC_CHANNELS.tools.openTool)(payload),
    fileConversion: {
      selectInputFiles: async () => ({ filePaths: [] }),
      selectOutputDirectory: async () => ({ directoryPath: null }),
      convert: async () => ({ successes: [], failures: [] }),
    },
  },
```

Task 6 replaces the temporary file conversion methods with real channels.

- [ ] **Step 6: Run Tools IPC tests and typecheck targeted files**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/modules/tools/__tests__/ipc.test.ts
pnpm --filter @synapse/desktop run check:ipc-codegen
```

Expected: PASS.

- [ ] **Step 7: Commit Tools IPC bridge**

```bash
git add desktop/electron/modules/tools/ipc.ts desktop/electron/modules/tools/__tests__/ipc.test.ts desktop/scripts/generate-ipc.mjs desktop/electron/bootstrap/ipc-registry.ts desktop/electron/generated/ipc-channels.generated.ts desktop/electron/preload.ts desktop/src/types/bridge.ts
git commit -m "feat(tools): expose tools ipc"
```

---

### Task 4: Add Top-Level Tools Tab And Landing Page

**Files:**

- Create: `desktop/src/modules/tools/registry.ts`
- Create: `desktop/src/modules/tools/index.tsx`
- Test: `desktop/src/modules/tools/__tests__/tools-module.test.tsx`
- Modify: `desktop/src/App.tsx`

- [ ] **Step 1: Write failing ToolsModule tests**

Create `desktop/src/modules/tools/__tests__/tools-module.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ToolsModule } from "../index"
import type { SynapseBridge } from "@/types/bridge"

const openTool = vi.fn(async () => undefined)

function installBridge() {
  vi.stubGlobal("window", {
    ...window,
    synapse: {
      tools: {
        listTools: vi.fn(async () => [{ id: "file-conversion", label: "文件转换" }]),
        openTool,
        fileConversion: {
          selectInputFiles: vi.fn(),
          selectOutputDirectory: vi.fn(),
          convert: vi.fn(),
        },
      },
    } satisfies Partial<SynapseBridge>,
  })
}

describe("ToolsModule", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    openTool.mockClear()
    installBridge()
  })

  it("renders the file conversion tool", async () => {
    render(<ToolsModule />)

    expect(await screen.findByRole("heading", { name: "工具" })).toBeInTheDocument()
    expect(await screen.findByRole("button", { name: "文件转换" })).toBeInTheDocument()
  })

  it("opens the selected tool", async () => {
    const user = userEvent.setup()
    render(<ToolsModule />)

    await user.click(await screen.findByRole("button", { name: "文件转换" }))

    expect(openTool).toHaveBeenCalledWith({ toolId: "file-conversion" })
  })
})
```

- [ ] **Step 2: Run the failing ToolsModule tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/tools/__tests__/tools-module.test.tsx
```

Expected: FAIL because the renderer module does not exist.

- [ ] **Step 3: Add renderer tool registry**

Create `desktop/src/modules/tools/registry.ts`:

```ts
import type { SynapseToolId } from "@/types/tools"

export type RendererToolDefinition = {
  readonly id: SynapseToolId
  readonly label: string
}

export const RENDERER_TOOLS: readonly RendererToolDefinition[] = [{
  id: "file-conversion",
  label: "文件转换",
}]
```

- [ ] **Step 4: Implement ToolsModule**

Create `desktop/src/modules/tools/index.tsx`:

```tsx
import { useEffect, useState } from "react"
import { Wrench } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { createRendererLogger } from "@/app-shell/logging"
import { requireBridgeDomain } from "@/lib/electron-bridge"
import type { SynapseToolSummary } from "@/types/tools"
import { RENDERER_TOOLS } from "./registry"

const logger = createRendererLogger("tools")

export function ToolsModule() {
  const [tools, setTools] = useState<readonly SynapseToolSummary[]>(RENDERER_TOOLS)

  useEffect(() => {
    let cancelled = false
    requireBridgeDomain("tools").listTools()
      .then((items) => {
        if (!cancelled) setTools(items)
      })
      .catch((error) => {
        logger.warn("Tools list failed.", {
          boundary: "renderer.tools.list",
          errorName: error instanceof Error ? error.name : typeof error,
          errorLength: String(error).length,
        })
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function openTool(toolId: SynapseToolSummary["id"]): Promise<void> {
    try {
      await requireBridgeDomain("tools").openTool({ toolId })
    } catch (error) {
      logger.warn("Tool open failed.", {
        boundary: "renderer.tools.open",
        toolId,
        errorName: error instanceof Error ? error.name : typeof error,
        errorLength: String(error).length,
      })
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="flex shrink-0 items-center justify-between px-2 py-2.5">
        <h2 className="text-sm font-semibold">工具</h2>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="grid gap-2 px-2 pb-2">
          {tools.map((tool) => (
            <Button
              key={tool.id}
              type="button"
              variant="outline"
              className="h-auto justify-start gap-2 px-3 py-3"
              onClick={() => void openTool(tool.id)}
            >
              <Wrench className="size-4" />
              <span>{tool.label}</span>
            </Button>
          ))}
        </div>
      </ScrollArea>
    </div>
  )
}
```

- [ ] **Step 5: Add the top-level Tools tab**

Modify `desktop/src/App.tsx`:

Add import:

```ts
import { ToolsModule } from "@/modules/tools"
```

Update `AppTabId`:

```ts
type AppTabId = SynapseContentType | "agent" | "database" | "task-scheduler" | "tools" | "editor-scan" | "usage-cc" | "usage-codex" | "workflow" | "settings"
```

Add tab entry near `task-scheduler`:

```ts
{ id: "tools" as const, label: "工具" },
```

Add render block near `task-scheduler`:

```tsx
{activeTab === "tools" ? (
  <ErrorBoundary fallbackTitle="工具模块出现问题">
    <ToolsModule />
  </ErrorBoundary>
) : null}
```

- [ ] **Step 6: Run renderer Tools tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/tools/__tests__/tools-module.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit top-level Tools UI**

```bash
git add desktop/src/modules/tools desktop/src/App.tsx
git commit -m "feat(tools): add top-level tools tab"
```

---

### Task 5: Add Tool Window Renderer Route

**Files:**

- Create: `desktop/src/modules/tools/file-conversion/file-conversion-window.tsx`
- Modify: `desktop/src/main.tsx`
- Test: `desktop/src/modules/tools/file-conversion/__tests__/file-conversion-window.test.tsx`

- [ ] **Step 1: Write failing initial window shell test**

Create `desktop/src/modules/tools/file-conversion/__tests__/file-conversion-window.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { FileConversionWindow } from "../file-conversion-window"

describe("FileConversionWindow", () => {
  it("renders the file conversion heading and disabled convert action", () => {
    render(<FileConversionWindow />)

    expect(screen.getByRole("heading", { name: "文件转换" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "开始转换" })).toBeDisabled()
  })
})
```

- [ ] **Step 2: Run failing initial window shell test**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/tools/file-conversion/__tests__/file-conversion-window.test.tsx
```

Expected: FAIL because the window component does not exist.

- [ ] **Step 3: Add initial File Conversion window**

Create `desktop/src/modules/tools/file-conversion/file-conversion-window.tsx`:

```tsx
import { Button } from "@/components/ui/button"

export function FileConversionWindow() {
  return (
    <div className="flex h-screen flex-col bg-background">
      <header className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
        <h1 className="text-sm font-semibold">文件转换</h1>
      </header>
      <main className="flex min-h-0 flex-1 flex-col gap-4 p-4">
        <section className="grid gap-2">
          <div className="text-sm font-medium">文件</div>
          <div className="text-sm text-muted-foreground">未选择文件</div>
        </section>
        <section className="grid gap-2">
          <div className="text-sm font-medium">输出目录</div>
          <div className="text-sm text-muted-foreground">未选择输出目录</div>
        </section>
        <div>
          <Button type="button" disabled>开始转换</Button>
        </div>
      </main>
    </div>
  )
}
```

- [ ] **Step 4: Route tool windows in renderer bootstrap**

Modify `desktop/src/main.tsx`.

Add a branch before the main app branch:

```tsx
  } else if (windowType === "tool") {
    const toolId = new URLSearchParams(window.location.search).get("toolId")
    if (toolId === "file-conversion") {
      const { FileConversionWindow } = await import("@/modules/tools/file-conversion/file-conversion-window")
      createRoot(document.getElementById("root")!).render(
        <StrictMode>
          <AppErrorBoundary>
            <AppNotificationsProvider>
              <FileConversionWindow />
            </AppNotificationsProvider>
          </AppErrorBoundary>
        </StrictMode>,
      )
    } else {
      throw new Error(`Unknown tool window: ${toolId ?? ""}`)
    }
```

Keep the existing `knowledge-source-manager` branch unchanged.

- [ ] **Step 5: Run initial window shell test**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/tools/file-conversion/__tests__/file-conversion-window.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit tool window route**

```bash
git add desktop/src/modules/tools/file-conversion/file-conversion-window.tsx desktop/src/modules/tools/file-conversion/__tests__/file-conversion-window.test.tsx desktop/src/main.tsx
git commit -m "feat(tools): route file conversion window"
```

---

### Task 6: Add File Conversion Worker And Runner

**Files:**

- Create: `desktop/electron/services/tools/file-conversion-types.ts`
- Create: `desktop/electron/services/tools/file-conversion-runner.ts`
- Create: `desktop/electron/workers/file-conversion-worker.ts`
- Test: `desktop/electron/services/tools/__tests__/file-conversion-runner.test.ts`
- Modify: `desktop/package.json`

- [ ] **Step 1: Write failing runner tests**

Create `desktop/electron/services/tools/__tests__/file-conversion-runner.test.ts`:

```ts
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { convertFilesWithInjectedWorker, resolveFileConversionWorkerPath } from "../file-conversion-runner"
import type { FileConversionWorkerMessage } from "../file-conversion-types"

const roots: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-tools-convert-"))
  roots.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("file conversion runner", () => {
  it("resolves unpacked worker paths for packaged asar builds", () => {
    expect(resolveFileConversionWorkerPath("/Applications/Synapse.app/Contents/Resources/app.asar/dist-electron/electron/services/tools"))
      .toContain("app.asar.unpacked")
    expect(resolveFileConversionWorkerPath("/repo/desktop/dist-electron/electron/services/tools"))
      .toBe(path.join("/repo/desktop/dist-electron/electron/workers", "file-conversion-worker.js"))
  })

  it("delegates conversion to an injected worker factory", async () => {
    const source = path.join(await tempDir(), "a.docx")
    const outputDirectory = await tempDir()
    await writeFile(source, "docx")
    const workerFactory = vi.fn((input, emit) => {
      emit({ type: "progress", completed: 0, total: 1, currentFile: source })
      return Promise.resolve({
        successes: [{ sourcePath: source, outputPath: path.join(outputDirectory, "a.md"), warningCount: 0 }],
        failures: [],
      })
    })

    const result = await convertFilesWithInjectedWorker({
      filePaths: [source],
      outputDirectory,
      workerFactory,
      onMessage: vi.fn(),
    })

    expect(workerFactory).toHaveBeenCalledWith({
      filePaths: [source],
      outputDirectory,
    }, expect.any(Function))
    expect(result.successes).toHaveLength(1)
  })

  it("converts a real file in process for worker unit coverage", async () => {
    const root = await tempDir()
    const outputDirectory = path.join(root, "out")
    await mkdir(outputDirectory)
    const sourcePath = path.join(root, "note.docx")
    await writeFile(sourcePath, "not a real docx")
    const result = await convertFilesWithInjectedWorker({
      filePaths: [sourcePath],
      outputDirectory,
      workerFactory: async () => ({
        successes: [],
        failures: [{
          sourcePath,
          reason: "conversion-failed",
          message: "Could not parse DOCX file.",
        }],
      }),
    })

    expect(result.failures).toEqual([expect.objectContaining({
      sourcePath,
      reason: "conversion-failed",
    })])
  })
})
```

- [ ] **Step 2: Run failing runner tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/tools/__tests__/file-conversion-runner.test.ts
```

Expected: FAIL because runner files do not exist.

- [ ] **Step 3: Add worker message/result types**

Create `desktop/electron/services/tools/file-conversion-types.ts`:

```ts
import type {
  SynapseToolsFileConversionFailure,
  SynapseToolsFileConversionPayload,
  SynapseToolsFileConversionResult,
} from "../../../src/types/tools"

export type FileConversionWorkerInput = SynapseToolsFileConversionPayload
export type FileConversionWorkerResult = SynapseToolsFileConversionResult
export type FileConversionWorkerFailure = SynapseToolsFileConversionFailure

export type FileConversionWorkerProgress = {
  readonly type: "progress"
  readonly completed: number
  readonly total: number
  readonly currentFile?: string
}

export type FileConversionWorkerMessage =
  | FileConversionWorkerProgress
  | { readonly type: "success"; readonly result: FileConversionWorkerResult }
  | { readonly type: "error"; readonly error: { readonly name?: string; readonly message?: string; readonly stack?: string } }
```

- [ ] **Step 4: Add runner with injectable worker boundary**

Create `desktop/electron/services/tools/file-conversion-runner.ts`:

```ts
import path from "node:path"
import { Worker } from "node:worker_threads"
import type {
  FileConversionWorkerInput,
  FileConversionWorkerMessage,
  FileConversionWorkerProgress,
  FileConversionWorkerResult,
} from "./file-conversion-types"

export type FileConversionWorkerFactory = (
  input: FileConversionWorkerInput,
  emit: (message: FileConversionWorkerProgress) => void,
) => Promise<FileConversionWorkerResult>

export type FileConversionRunnerOptions = FileConversionWorkerInput & {
  readonly onMessage?: (message: FileConversionWorkerProgress) => void
}

export async function convertFilesWithInjectedWorker(
  options: FileConversionRunnerOptions & { readonly workerFactory: FileConversionWorkerFactory },
): Promise<FileConversionWorkerResult> {
  return options.workerFactory({
    filePaths: [...options.filePaths],
    outputDirectory: options.outputDirectory,
  }, (message) => {
    options.onMessage?.(message)
  })
}

export function convertFilesInWorker(options: FileConversionRunnerOptions): Promise<FileConversionWorkerResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(resolveFileConversionWorkerPath(__dirname), {
      workerData: {
        filePaths: [...options.filePaths],
        outputDirectory: options.outputDirectory,
      } satisfies FileConversionWorkerInput,
    })
    let settled = false

    worker.on("message", (message: FileConversionWorkerMessage) => {
      if (message.type === "progress") {
        options.onMessage?.(message)
        return
      }
      if (settled) return
      settled = true
      if (message.type === "success") {
        resolve(message.result)
        return
      }
      reject(toWorkerError(message.error))
    })

    worker.once("error", (error) => {
      if (settled) return
      settled = true
      reject(error)
    })

    worker.once("exit", (code) => {
      if (settled || code === 0) return
      settled = true
      reject(new Error(`File conversion worker exited with code ${code}`))
    })
  })
}

export function resolveFileConversionWorkerPath(baseDir: string): string {
  const workerBaseDir = baseDir
    .replace(/([\\/])app\.asar(?=[\\/])/, "$1app.asar.unpacked")
    .replace(/[\\/]services[\\/]tools$/, "/workers")
  return path.join(workerBaseDir, "file-conversion-worker.js")
}

function toWorkerError(error: { readonly name?: string; readonly message?: string; readonly stack?: string }): Error {
  const next = new Error(error.message || "File conversion failed")
  next.name = error.name || "FileConversionWorkerError"
  if (error.stack) next.stack = error.stack
  return next
}
```

- [ ] **Step 5: Add worker implementation**

Create `desktop/electron/workers/file-conversion-worker.ts`:

```ts
import { constants } from "node:fs"
import { access, lstat, mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { parentPort, workerData } from "node:worker_threads"
import { createDefaultFileConversionService, FileConversionError } from "../services/file-conversion"
import type {
  FileConversionWorkerFailure,
  FileConversionWorkerInput,
  FileConversionWorkerResult,
} from "../services/tools/file-conversion-types"

const SUPPORTED_EXTENSIONS = new Set([".docx", ".xlsx", ".pdf", ".pptx"])

function parseInput(value: unknown): FileConversionWorkerInput {
  const input = value as Partial<FileConversionWorkerInput>
  if (!Array.isArray(input.filePaths) || typeof input.outputDirectory !== "string") {
    throw new Error("Invalid file conversion worker input")
  }
  return {
    filePaths: input.filePaths.filter((item): item is string => typeof item === "string"),
    outputDirectory: input.outputDirectory,
  }
}

async function run(): Promise<FileConversionWorkerResult> {
  const input = parseInput(workerData)
  const outputDirectory = path.resolve(input.outputDirectory)
  await mkdir(outputDirectory, { recursive: true })
  const outputStat = await lstat(outputDirectory)
  if (!outputStat.isDirectory()) {
    throw new Error("Output path is not a directory")
  }

  const converter = createDefaultFileConversionService()
  const successes: FileConversionWorkerResult["successes"] = []
  const failures: FileConversionWorkerFailure[] = []
  const total = input.filePaths.length

  for (const [index, filePath] of input.filePaths.entries()) {
    parentPort?.postMessage({
      type: "progress",
      completed: index,
      total,
      currentFile: filePath,
    })

    const sourcePath = path.resolve(filePath)
    const extension = path.extname(sourcePath).toLowerCase()
    if (!SUPPORTED_EXTENSIONS.has(extension)) {
      failures.push({ sourcePath, reason: "unsupported-format", message: "不支持的文件格式。" })
      continue
    }

    try {
      const sourceStat = await lstat(sourcePath)
      if (!sourceStat.isFile()) {
        failures.push({ sourcePath, reason: "read-failed", message: "源路径不是文件。" })
        continue
      }
      await access(sourcePath, constants.R_OK)
    } catch (error) {
      failures.push({ sourcePath, reason: "read-failed", message: error instanceof Error ? error.message : "读取失败。" })
      continue
    }

    try {
      const converted = await converter.convert({ filePath: sourcePath })
      const outputPath = await resolveCollisionPath(outputDirectory, `${path.parse(sourcePath).name}.md`)
      assertInside(outputDirectory, outputPath)
      await writeFile(outputPath, converted.markdown.trimEnd() + "\n", "utf8")
      successes.push({
        sourcePath,
        outputPath,
        warningCount: converted.warnings.length,
      })
    } catch (error) {
      failures.push({
        sourcePath,
        reason: error instanceof FileConversionError ? "conversion-failed" : "write-failed",
        message: error instanceof Error ? error.message : "转换失败。",
      })
    }
  }

  parentPort?.postMessage({
    type: "progress",
    completed: total,
    total,
  })

  return { successes, failures }
}

async function resolveCollisionPath(directoryPath: string, fileName: string): Promise<string> {
  const parsed = path.parse(fileName)
  let candidate = path.join(directoryPath, fileName)
  let index = 2
  while (await pathExists(candidate)) {
    candidate = path.join(directoryPath, `${parsed.name}-${index}${parsed.ext}`)
    index += 1
  }
  return candidate
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath, constants.F_OK)
    return true
  } catch {
    return false
  }
}

function assertInside(rootPath: string, targetPath: string): void {
  const root = path.resolve(rootPath)
  const target = path.resolve(targetPath)
  const relative = path.relative(root, target)
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("输出路径不在目标目录中。")
  }
}

void run()
  .then((result) => {
    parentPort?.postMessage({ type: "success", result })
  })
  .catch((error: unknown) => {
    parentPort?.postMessage({
      type: "error",
      error: error instanceof Error
        ? { name: error.name, message: error.message, stack: error.stack }
        : { message: String(error) },
    })
  })
```

- [ ] **Step 6: Add worker to packaged asarUnpack**

Modify `desktop/package.json`.

In `build.asarUnpack`, add:

```json
"dist-electron/electron/workers/file-conversion-worker.js"
```

Keep the existing usage-analysis worker entry.

- [ ] **Step 7: Run runner tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/tools/__tests__/file-conversion-runner.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit runner and worker**

```bash
git add desktop/electron/services/tools/file-conversion-types.ts desktop/electron/services/tools/file-conversion-runner.ts desktop/electron/workers/file-conversion-worker.ts desktop/electron/services/tools/__tests__/file-conversion-runner.test.ts desktop/package.json
git commit -m "feat(tools): run file conversion in worker"
```

---

### Task 7: Add File Conversion IPC Methods

**Files:**

- Modify: `desktop/electron/modules/tools/ipc.ts`
- Modify: `desktop/electron/modules/tools/__tests__/ipc.test.ts`
- Modify: `desktop/electron/bootstrap/descriptors.ts`
- Modify: `desktop/electron/bootstrap/registry.ts`
- Modify: `desktop/electron/generated/ipc-channels.generated.ts`
- Modify: `desktop/electron/preload.ts`

- [ ] **Step 1: Extend IPC tests for file conversion operations**

Append to `desktop/electron/modules/tools/__tests__/ipc.test.ts`:

```ts
import { dialog } from "electron"

vi.mock("electron", () => ({
  dialog: {
    showOpenDialog: vi.fn(),
  },
}))

it("selects supported input files through the native dialog", async () => {
  vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({
    canceled: false,
    filePaths: ["/tmp/report.docx"],
  } as never)
  const { harness } = createHarness()

  const result = await harness.invoke("synapse:tools:file-conversion:select-input-files", {})

  expect(result).toEqual({ filePaths: ["/tmp/report.docx"] })
  expect(dialog.showOpenDialog).toHaveBeenCalledWith(expect.objectContaining({
    properties: ["openFile", "multiSelections"],
    filters: [{ name: "支持的文档", extensions: ["docx", "xlsx", "pdf", "pptx"] }],
  }))
})

it("selects an output directory through the native dialog", async () => {
  vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({
    canceled: false,
    filePaths: ["/tmp/out"],
  } as never)
  const { harness } = createHarness()

  const result = await harness.invoke("synapse:tools:file-conversion:select-output-directory", {})

  expect(result).toEqual({ directoryPath: "/tmp/out" })
})

it("runs conversion through guarded read and write permissions", async () => {
  const runConversion = vi.fn(async () => ({ successes: [], failures: [] }))
  const { harness, permissionGuard } = createHarness({ runConversion })

  await harness.invoke("synapse:tools:file-conversion:convert", {
    filePaths: ["/tmp/report.docx"],
    outputDirectory: "/tmp/out",
  })

  expect(permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
    action: "fs.read.outside-userdata",
    resource: "/tmp/report.docx",
    context: { source: "tools.fileConversion.convert.read" },
  }))
  expect(permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
    action: "fs.write",
    resource: "/tmp/out",
    context: { source: "tools.fileConversion.convert.write" },
  }))
  expect(runConversion).toHaveBeenCalledWith({
    filePaths: ["/tmp/report.docx"],
    outputDirectory: "/tmp/out",
  })
})
```

Update `createHarness` to accept `runConversion` and return it from `resolve("tools.file-conversion-runner")`:

```ts
function createHarness(options: {
  readonly windowService?: { open(toolId: string): Promise<void> }
  readonly runConversion?: (payload: { readonly filePaths: readonly string[]; readonly outputDirectory: string }) => Promise<unknown>
} = {}) {
  const runConversion = options.runConversion ?? vi.fn(async () => ({ successes: [], failures: [] }))
  // existing setup...
  const harness = createInMemoryHarness({
    resolve: (id: string) => {
      if (id === "tools.file-conversion-runner") return runConversion
      // existing branches...
    },
  })
  // existing return...
}
```

- [ ] **Step 2: Run failing extended IPC tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/modules/tools/__tests__/ipc.test.ts
```

Expected: FAIL because file conversion methods do not exist.

- [ ] **Step 3: Add file conversion schemas and handlers**

Modify `desktop/electron/modules/tools/ipc.ts`:

Add imports:

```ts
import { dialog } from "electron"
import type { AuditSink, PermissionAction, PermissionGuard } from "../../runtime/security"
import { convertFilesInWorker } from "../../services/tools/file-conversion-runner"
```

Add schemas:

```ts
const fileConversionPayloadSchema = z.object({
  filePaths: z.array(z.string().min(1)).min(1),
  outputDirectory: z.string().min(1),
})

const fileConversionResultSchema = z.object({
  successes: z.array(z.object({
    sourcePath: z.string(),
    outputPath: z.string(),
    warningCount: z.number(),
  })),
  failures: z.array(z.object({
    sourcePath: z.string(),
    reason: z.enum(["unsupported-format", "read-failed", "conversion-failed", "write-failed", "invalid-output-path"]),
    message: z.string(),
  })),
})
```

Add helper:

```ts
async function checkPermission(ctx: Parameters<IpcModule["methods"][string]["handler"]>[0], options: {
  readonly action: PermissionAction
  readonly resource: string
  readonly source: string
}): Promise<void> {
  const permissionGuard = ctx.resolve<PermissionGuard>("core.permission-guard")
  const auditSink = ctx.resolve<AuditSink>("core.audit-sink")
  const actor = { kind: "user" } as const
  const permission = await permissionGuard.check({
    action: options.action,
    actor,
    resource: options.resource,
    context: { source: options.source },
  })
  auditSink.record({
    action: options.action,
    actor,
    resource: options.resource,
    outcome: permission.allowed ? "allowed" : "denied",
    metadata: permission.allowed ? { source: options.source } : { source: options.source, reason: permission.reason, policyId: permission.policyId },
  })
  if (!permission.allowed) throw new Error(permission.reason)
}
```

Add methods inside `methods`:

```ts
    selectFileConversionInputFiles: {
      kind: "invoke",
      channel: "synapse:tools:file-conversion:select-input-files",
      request: z.object({}),
      response: z.object({ filePaths: z.array(z.string()) }),
      handler: async () => {
        const result = await dialog.showOpenDialog({
          properties: ["openFile", "multiSelections"],
          filters: [{ name: "支持的文档", extensions: ["docx", "xlsx", "pdf", "pptx"] }],
        })
        return { filePaths: result.canceled ? [] : result.filePaths }
      },
    },
    selectFileConversionOutputDirectory: {
      kind: "invoke",
      channel: "synapse:tools:file-conversion:select-output-directory",
      request: z.object({}),
      response: z.object({ directoryPath: z.string().nullable() }),
      handler: async () => {
        const result = await dialog.showOpenDialog({ properties: ["openDirectory"] })
        return { directoryPath: result.canceled ? null : result.filePaths[0] ?? null }
      },
    },
    convertFiles: {
      kind: "invoke",
      channel: "synapse:tools:file-conversion:convert",
      request: fileConversionPayloadSchema,
      response: fileConversionResultSchema,
      handler: async (ctx, request: { filePaths: string[]; outputDirectory: string }) => {
        for (const filePath of request.filePaths) {
          await checkPermission(ctx, {
            action: "fs.read.outside-userdata",
            resource: filePath,
            source: "tools.fileConversion.convert.read",
          })
        }
        await checkPermission(ctx, {
          action: "fs.write",
          resource: request.outputDirectory,
          source: "tools.fileConversion.convert.write",
        })
        const runConversion = ctx.resolve<typeof convertFilesInWorker>("tools.file-conversion-runner")
        return runConversion({
          filePaths: request.filePaths,
          outputDirectory: request.outputDirectory,
        })
      },
    },
```

- [ ] **Step 4: Define and register runner dependency**

Modify `desktop/electron/bootstrap/descriptors.ts`.

Import:

```ts
import { convertFilesInWorker } from "../services/tools/file-conversion-runner"
```

Add descriptor:

```ts
export const coreToolsFileConversionRunnerDescriptor: ServiceDescriptor<typeof convertFilesInWorker> = {
  id: "tools.file-conversion-runner",
  criticality: "degraded",
  create() {
    return convertFilesInWorker
  },
}
```

Modify `desktop/electron/bootstrap/registry.ts`.

Add `coreToolsFileConversionRunnerDescriptor` to the existing descriptor import list from `./descriptors`:

```ts
  coreToolsFileConversionRunnerDescriptor,
  coreToolsWindowDescriptor,
```

Register it next to `coreToolsWindowDescriptor`:

```ts
  registry.register(coreKnowledgeBaseDescriptor)
  registry.register(coreToolsWindowDescriptor)
  registry.register(coreToolsFileConversionRunnerDescriptor)
  registry.register(coreWorkflowServiceDescriptor)
```

- [ ] **Step 5: Regenerate IPC and wire real preload methods**

Run:

```bash
pnpm --filter @synapse/desktop run generate:ipc
```

Modify `desktop/electron/preload.ts` `tools.fileConversion`:

```ts
    fileConversion: {
      selectInputFiles: () =>
        invoke(IPC_CHANNELS.tools.selectFileConversionInputFiles)({}),
      selectOutputDirectory: () =>
        invoke(IPC_CHANNELS.tools.selectFileConversionOutputDirectory)({}),
      convert: (payload) =>
        invoke(IPC_CHANNELS.tools.convertFiles)(payload),
    },
```

- [ ] **Step 6: Run IPC tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/modules/tools/__tests__/ipc.test.ts
pnpm --filter @synapse/desktop run check:ipc-codegen
```

Expected: PASS.

- [ ] **Step 7: Commit file conversion IPC**

```bash
git add desktop/electron/modules/tools/ipc.ts desktop/electron/modules/tools/__tests__/ipc.test.ts desktop/electron/bootstrap/descriptors.ts desktop/electron/bootstrap/registry.ts desktop/electron/generated/ipc-channels.generated.ts desktop/electron/preload.ts
git commit -m "feat(tools): add file conversion ipc"
```

---

### Task 8: Complete File Conversion Window UI

**Files:**

- Modify: `desktop/src/modules/tools/file-conversion/file-conversion-window.tsx`
- Create: `desktop/src/modules/tools/file-conversion/utils.ts`
- Modify: `desktop/src/modules/tools/file-conversion/__tests__/file-conversion-window.test.tsx`

- [ ] **Step 1: Extend renderer tests for user flow**

Replace `desktop/src/modules/tools/file-conversion/__tests__/file-conversion-window.test.tsx` with:

```tsx
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { FileConversionWindow } from "../file-conversion-window"
import type { SynapseBridge } from "@/types/bridge"

const selectInputFiles = vi.fn(async () => ({ filePaths: ["/tmp/report.docx"] }))
const selectOutputDirectory = vi.fn(async () => ({ directoryPath: "/tmp/out" }))
const convert = vi.fn(async () => ({
  successes: [{ sourcePath: "/tmp/report.docx", outputPath: "/tmp/out/report.md", warningCount: 0 }],
  failures: [],
}))

function installBridge() {
  vi.stubGlobal("window", {
    ...window,
    synapse: {
      tools: {
        listTools: vi.fn(),
        openTool: vi.fn(),
        fileConversion: {
          selectInputFiles,
          selectOutputDirectory,
          convert,
        },
      },
      shell: {
        showItemInFolder: vi.fn(),
      },
    } satisfies Partial<SynapseBridge>,
  })
}

describe("FileConversionWindow", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    selectInputFiles.mockClear()
    selectOutputDirectory.mockClear()
    convert.mockClear()
    installBridge()
  })

  it("disables conversion until files and output directory are selected", () => {
    render(<FileConversionWindow />)

    expect(screen.getByRole("button", { name: "开始转换" })).toBeDisabled()
  })

  it("selects files and output directory, then converts", async () => {
    const user = userEvent.setup()
    render(<FileConversionWindow />)

    await user.click(screen.getByRole("button", { name: "选择文件" }))
    await user.click(screen.getByRole("button", { name: "选择输出目录" }))
    await user.click(screen.getByRole("button", { name: "开始转换" }))

    expect(convert).toHaveBeenCalledWith({
      filePaths: ["/tmp/report.docx"],
      outputDirectory: "/tmp/out",
    })
    expect(await screen.findByText("成功 1 个，失败 0 个")).toBeInTheDocument()
    expect(screen.getByText("report.md")).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run failing renderer flow tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/tools/file-conversion/__tests__/file-conversion-window.test.tsx
```

Expected: FAIL because the current initial shell does not implement the flow.

- [ ] **Step 3: Add file conversion UI utils**

Create `desktop/src/modules/tools/file-conversion/utils.ts`:

```ts
export function basename(filePath: string): string {
  return filePath.split(/[\\/]/).filter(Boolean).at(-1) ?? filePath
}

export function formatFailureReason(reason: string): string {
  if (reason === "unsupported-format") return "格式不支持"
  if (reason === "read-failed") return "读取失败"
  if (reason === "conversion-failed") return "转换失败"
  if (reason === "write-failed") return "写入失败"
  if (reason === "invalid-output-path") return "输出路径不可用"
  return "失败"
}
```

- [ ] **Step 4: Implement File Conversion window UI**

Replace `desktop/src/modules/tools/file-conversion/file-conversion-window.tsx`:

```tsx
import { useMemo, useState } from "react"
import { FileText, FolderOpen, Trash2, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { createRendererLogger } from "@/app-shell/logging"
import { useAppNotifications } from "@/app-shell/notifications"
import { requireBridgeDomain, requireSynapseBridge } from "@/lib/electron-bridge"
import type { SynapseToolsFileConversionResult } from "@/types/tools"
import { basename, formatFailureReason } from "./utils"

const logger = createRendererLogger("tools.file-conversion")

export function FileConversionWindow() {
  const { promise } = useAppNotifications()
  const [filePaths, setFilePaths] = useState<string[]>([])
  const [outputDirectory, setOutputDirectory] = useState<string | null>(null)
  const [result, setResult] = useState<SynapseToolsFileConversionResult | null>(null)
  const [isConverting, setIsConverting] = useState(false)
  const canConvert = filePaths.length > 0 && Boolean(outputDirectory) && !isConverting
  const resultLabel = useMemo(() => {
    if (!result) return null
    return `成功 ${result.successes.length} 个，失败 ${result.failures.length} 个`
  }, [result])

  async function chooseFiles(): Promise<void> {
    try {
      const next = await requireBridgeDomain("tools").fileConversion.selectInputFiles()
      setFilePaths([...next.filePaths])
      setResult(null)
    } catch (error) {
      logger.warn("Select conversion files failed.", {
        boundary: "renderer.tools.file-conversion.select-files",
        errorName: error instanceof Error ? error.name : typeof error,
        errorLength: String(error).length,
      })
    }
  }

  async function chooseOutputDirectory(): Promise<void> {
    try {
      const next = await requireBridgeDomain("tools").fileConversion.selectOutputDirectory()
      setOutputDirectory(next.directoryPath)
      setResult(null)
    } catch (error) {
      logger.warn("Select conversion output directory failed.", {
        boundary: "renderer.tools.file-conversion.select-output",
        errorName: error instanceof Error ? error.name : typeof error,
        errorLength: String(error).length,
      })
    }
  }

  async function convertFiles(): Promise<void> {
    if (!outputDirectory || filePaths.length === 0) return
    setIsConverting(true)
    try {
      const next = await promise(
        () => requireBridgeDomain("tools").fileConversion.convert({ filePaths, outputDirectory }),
        {
          loading: "正在转换",
          success: "转换完成",
          error: "转换失败",
        },
      )
      setResult(next)
    } catch (error) {
      logger.warn("File conversion failed.", {
        boundary: "renderer.tools.file-conversion.convert",
        fileCount: filePaths.length,
        errorName: error instanceof Error ? error.name : typeof error,
        errorLength: String(error).length,
      })
    } finally {
      setIsConverting(false)
    }
  }

  async function openOutputDirectory(): Promise<void> {
    if (!outputDirectory) return
    await requireSynapseBridge().shell.showItemInFolder(outputDirectory)
  }

  return (
    <div className="flex h-screen flex-col bg-background">
      <header className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
        <h1 className="text-sm font-semibold">文件转换</h1>
      </header>
      <main className="flex min-h-0 flex-1 flex-col gap-4 p-4">
        <section className="grid gap-2">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-medium">文件</div>
            <div className="flex items-center gap-2">
              {filePaths.length > 0 ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => setFilePaths([])}>
                  <Trash2 className="size-4" />
                  清空
                </Button>
              ) : null}
              <Button type="button" variant="outline" size="sm" onClick={() => void chooseFiles()}>
                <Upload className="size-4" />
                选择文件
              </Button>
            </div>
          </div>
          <div className="rounded-md border border-border">
            {filePaths.length === 0 ? (
              <div className="px-3 py-6 text-sm text-muted-foreground">未选择文件</div>
            ) : (
              <ScrollArea className="max-h-48">
                <div className="divide-y divide-border">
                  {filePaths.map((filePath) => (
                    <div key={filePath} className="flex items-center gap-2 px-3 py-2 text-sm">
                      <FileText className="size-4 shrink-0 text-muted-foreground" />
                      <span className="truncate">{basename(filePath)}</span>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </div>
        </section>

        <section className="grid gap-2">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-medium">输出目录</div>
            <Button type="button" variant="outline" size="sm" onClick={() => void chooseOutputDirectory()}>
              <FolderOpen className="size-4" />
              选择输出目录
            </Button>
          </div>
          <div className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground">
            <span className="truncate">{outputDirectory ?? "未选择输出目录"}</span>
          </div>
        </section>

        <div className="flex items-center gap-2">
          <Button type="button" disabled={!canConvert} onClick={() => void convertFiles()}>
            开始转换
          </Button>
          {outputDirectory ? (
            <Button type="button" variant="outline" onClick={() => void openOutputDirectory()}>
              打开输出目录
            </Button>
          ) : null}
        </div>

        {result ? (
          <section className="grid min-h-0 gap-2">
            <div className="text-sm font-medium">{resultLabel}</div>
            <ScrollArea className="min-h-0 flex-1 rounded-md border border-border">
              <div className="divide-y divide-border">
                {result.successes.map((item) => (
                  <div key={item.outputPath} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <span className="truncate">{basename(item.outputPath)}</span>
                    <span className="shrink-0 text-muted-foreground">{item.warningCount > 0 ? `${item.warningCount} 条提示` : "完成"}</span>
                  </div>
                ))}
                {result.failures.map((item) => (
                  <div key={item.sourcePath} className="grid gap-1 px-3 py-2 text-sm">
                    <div className="font-medium">{basename(item.sourcePath)}</div>
                    <div className="text-muted-foreground">{formatFailureReason(item.reason)}：{item.message}</div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </section>
        ) : null}
      </main>
    </div>
  )
}
```

- [ ] **Step 5: Run renderer flow tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/tools/file-conversion/__tests__/file-conversion-window.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit file conversion UI**

```bash
git add desktop/src/modules/tools/file-conversion
git commit -m "feat(tools): build file conversion window"
```

---

### Task 9: Verify Knowledge Base Remains Simple Copy

**Files:**

- No production edits expected.
- Test: existing Knowledge Base tests.

- [ ] **Step 1: Run Knowledge Base source manager and raw upload tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/knowledge-base/__tests__/source-manager-window.test.tsx electron/services/knowledge-base/__tests__/knowledge-base-service.test.ts electron/services/knowledge-base/__tests__/source-staging.test.ts
```

Expected: PASS. Source manager tests should still call `uploadRawFiles`, not `uploadSources`.

- [ ] **Step 2: Inspect for accidental Knowledge Base coupling**

Run:

```bash
rg -n "tools|fileConversion|convertFilesInWorker|tools\\.fileConversion" desktop/electron/services/knowledge-base desktop/src/modules/knowledge-base
```

Expected: no matches.

- [ ] **Step 3: Confirm no Knowledge Base files changed**

Run:

```bash
git diff -- desktop/electron/services/knowledge-base desktop/src/modules/knowledge-base
```

Expected: no output. If this command prints a diff, stop and remove the accidental Knowledge Base change before continuing.

---

### Task 10: Final Verification

**Files:**

- No new files.

- [ ] **Step 1: Run focused Tools and conversion tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/tools/__tests__ electron/modules/tools/__tests__ src/modules/tools/__tests__ src/modules/tools/file-conversion/__tests__ electron/services/file-conversion/__tests__
```

Expected: PASS.

- [ ] **Step 2: Run hard constraints**

Run:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: PASS. In particular, no bare `ipcMain.handle/on`, no bare `webContents.send`, no business data `fs.writeFile` outside accepted boundaries. Worker writes user-selected output files, so if the checker flags it, document the sensitive-operation boundary and adjust through the approved runtime/security path rather than suppressing the rule.

- [ ] **Step 3: Run typecheck**

Run:

```bash
pnpm --filter @synapse/desktop run typecheck
```

Expected: PASS.

- [ ] **Step 4: Run Electron build**

Run:

```bash
pnpm --filter @synapse/desktop run build:electron
```

Expected: PASS and worker emits to `dist-electron/electron/workers/file-conversion-worker.js`.

- [ ] **Step 5: Final git status**

Run:

```bash
git status --short
```

Expected: clean, unless unrelated user changes existed before implementation.

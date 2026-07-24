import path from "node:path"
import { describe, expect, it, vi } from "vitest"

import type { TextExtractorService } from "../../../../app-capabilities/text-extractor/main/service"
import { TextExtractionError } from "../../../../app-capabilities/text-extractor/shared/errors"
import { textExtractNodeExecutor } from "../../../../app-capabilities/text-extractor/workflow-node/executor.main"
import { textExtractNodeManifest } from "../../../../app-capabilities/text-extractor/workflow-node/manifest"
import { javascriptRunNodeManifest } from "../../../../app-capabilities/javascript-run/workflow-node/manifest"
import type { JavascriptWorkflowConfig } from "../../../../app-capabilities/script-runtime/shared/schema"
import type { SystemNotifierService } from "../../../../app-capabilities/system-notifier/main/service"
import { systemNotifierNodeExecutor } from "../../../../app-capabilities/system-notifier/workflow-node/executor.main"
import { systemNotifierNodeManifest } from "../../../../app-capabilities/system-notifier/workflow-node/manifest"
import type { ClipboardService } from "../../../../app-capabilities/clipboard/main/service"
import {
  clipboardTextReadNodeExecutor,
  clipboardTextWriteNodeExecutor,
} from "../../../../app-capabilities/clipboard/workflow-node/executor.main"
import {
  clipboardTextReadNodeManifest,
  clipboardTextWriteNodeManifest,
} from "../../../../app-capabilities/clipboard/workflow-node/manifest"
import type { WorkflowDefinition, WorkflowEvent } from "../../../../src/types/workflow"
import type { NodeExecutor } from "../../../../workflow-nodes/types"
import { defaultCodexNodeConfig, type CodexNodeConfig } from "../../../../workflow-nodes/codex/schema"
import { defaultClaudeCodeNodeConfig, type ClaudeCodeNodeConfig } from "../../../../workflow-nodes/claude-code/schema"
import { codexNodeManifest } from "../../../../workflow-nodes/codex/manifest"
import { claudeCodeNodeManifest } from "../../../../workflow-nodes/claude-code/manifest"
import { endNodeExecutor } from "../../../../workflow-nodes/end/executor.main"
import { endNodeManifest } from "../../../../workflow-nodes/end/manifest"
import { nodeTypeRegistry } from "../../../../workflow-nodes/registry"
import { textNodeExecutor } from "../../../../workflow-nodes/text/executor.main"
import { textNodeManifest } from "../../../../workflow-nodes/text/manifest"
import { workflowCallNodeExecutor } from "../../../../workflow-nodes/workflow-call/executor.main"
import { workflowCallNodeManifest } from "../../../../workflow-nodes/workflow-call/manifest"
import { WorkflowEngine } from "../workflow-engine"

const logger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

vi.mock("../../log-store", () => ({
  createMainLogger: () => logger,
}))

describe("WorkflowEngine", () => {
  it.each([
    "missing",
    "invalid_json",
    "multiple_json_values",
    "unsupported_value",
  ])("preserves INVALID_RESULT/%s through node results and failure events", async (errorReason) => {
    const executor: NodeExecutor<JavascriptWorkflowConfig> = {
      execute: vi.fn(async () => ({
        status: "failed" as const,
        error: "INVALID_RESULT: Script result is invalid.",
        errorCode: "INVALID_RESULT",
        errorReason,
        durationMs: 2,
      })),
    }
    const events: WorkflowEvent[] = []
    nodeTypeRegistry.register(javascriptRunNodeManifest, executor)
    nodeTypeRegistry.register(endNodeManifest, endNodeExecutor)
    const engine = new WorkflowEngine({ sendToAgent: vi.fn() })

    const result = await engine.run(
      workflowWithJavascriptNode(),
      {},
      "run-invalid-result",
      (event) => events.push(event),
    )

    expect(result.nodeResults["javascript-1"]).toMatchObject({
      status: "failed",
      errorCode: "INVALID_RESULT",
      errorReason,
    })
    expect(events).toContainEqual(expect.objectContaining({
      type: "node:failed",
      nodeId: "javascript-1",
      result: expect.objectContaining({
        errorCode: "INVALID_RESULT",
        errorReason,
      }),
    }))
  })

  it("records text-node variables and output without labeling the template as a prompt", async () => {
    nodeTypeRegistry.register(textNodeManifest, textNodeExecutor)
    nodeTypeRegistry.register(endNodeManifest, endNodeExecutor)
    const engine = new WorkflowEngine({ sendToAgent: vi.fn() })
    const definition: WorkflowDefinition = {
      id: "workflow-text",
      name: "Text workflow",
      version: "v1",
      createdAt: 1,
      updatedAt: 1,
      layoutDirection: "horizontal" as const,
      params: [],
      nodes: [
        {
          id: "text-1",
          name: "文本",
          type: "text",
          position: { x: 0, y: 0 },
          config: {
            template: "{{value}}",
            variables: [{ name: "value", source: { type: "static", value: "fixed" } }],
          },
        },
        {
          id: "end",
          name: "End",
          type: "end",
          position: { x: 200, y: 0 },
          config: {
            outputType: "text",
            template: "{{result}}",
            variables: [{ name: "result", source: { type: "node_output", node: "text-1" } }],
          },
        },
      ],
      edges: [{ id: "edge-1", from: "text-1", to: "end" }],
    }

    const result = await engine.run(definition, {}, "run-1", vi.fn())

    expect(result.nodeResults["text-1"]).toMatchObject({
      status: "success",
      input: { variables: { value: "fixed" } },
      output: "fixed",
    })
    expect(result.nodeResults["text-1"]?.input).not.toHaveProperty("prompt")
  })

  it("uses resolved System Notifier content without retaining it in run results or events", async () => {
    const trigger = vi.fn(() => ({ success: true } as const))
    const events: unknown[] = []
    nodeTypeRegistry.register(systemNotifierNodeManifest, systemNotifierNodeExecutor)
    nodeTypeRegistry.register(endNodeManifest, endNodeExecutor)
    const engine = new WorkflowEngine(
      { sendToAgent: vi.fn() },
      undefined,
      {
        resolveService: vi.fn(() => ({ trigger } as unknown as SystemNotifierService)),
      } as never,
    )
    const definition: WorkflowDefinition = {
      id: "workflow-system-notifier",
      name: "System Notifier workflow",
      version: "v1",
      createdAt: 1,
      updatedAt: 1,
      layoutDirection: "horizontal" as const,
      params: [],
      nodes: [
        {
          id: "notify-1",
          name: "系统通知",
          type: "system_notifier_notification_trigger",
          position: { x: 0, y: 0 },
          config: {
            title: "Title {{secret}}",
            body: "Private body {{secret}}",
            variables: [{ name: "secret", source: { type: "static", value: "resolved-variable-canary" } }],
          },
        },
        {
          id: "end",
          name: "End",
          type: "end",
          position: { x: 200, y: 0 },
          config: {
            outputType: "text",
            template: "{{result}}",
            variables: [{ name: "result", source: { type: "node_output", node: "notify-1" } }],
          },
        },
      ],
      edges: [{ id: "edge-1", from: "notify-1", to: "end" }],
    }

    const result = await engine.run(
      definition,
      {},
      "run-1",
      (event) => events.push(event),
    )

    expect(trigger).toHaveBeenCalledWith(
      {
        title: "Title resolved-variable-canary",
        body: "Private body resolved-variable-canary",
      },
      expect.objectContaining({
        workflowId: "workflow-system-notifier",
        runId: "run-1",
        nodeId: "notify-1",
      }),
    )
    expect(result.nodeResults["notify-1"]).toMatchObject({
      status: "success",
      input: { variables: {} },
      output: "{\"success\":true}",
      outputs: { success: true },
    })
    expect(JSON.stringify(result.nodeResults["notify-1"])).not.toContain("Private body")
    expect(JSON.stringify(result.nodeResults["notify-1"])).not.toContain("resolved-variable-canary")
    expect(JSON.stringify(events)).not.toContain("Private body")
    expect(JSON.stringify(events)).not.toContain("resolved-variable-canary")
  })

  it("uses resolved Clipboard write text without retaining it in run results or events", async () => {
    const write = vi.fn(() => ({ success: true as const }))
    const events: unknown[] = []
    nodeTypeRegistry.register(clipboardTextWriteNodeManifest, clipboardTextWriteNodeExecutor)
    nodeTypeRegistry.register(endNodeManifest, endNodeExecutor)
    const engine = new WorkflowEngine(
      { sendToAgent: vi.fn() },
      undefined,
      {
        resolveService: vi.fn(() => ({ write } as unknown as ClipboardService)),
      } as never,
    )
    const definition: WorkflowDefinition = {
      id: "workflow-clipboard-write",
      name: "Clipboard write",
      version: "v1",
      createdAt: 1,
      updatedAt: 1,
      layoutDirection: "horizontal",
      params: [],
      nodes: [
        {
          id: "write",
          name: "写入剪贴板",
          type: "clipboard_text_write",
          position: { x: 0, y: 0 },
          config: {
            text: "Private {{value}}",
            variables: [{
              name: "value",
              source: { type: "static", value: "resolved-canary" },
            }],
          },
        },
        {
          id: "end",
          name: "End",
          type: "end",
          position: { x: 200, y: 0 },
          config: {
            outputType: "text",
            template: "",
            variables: [],
          },
        },
      ],
      edges: [{ id: "write-to-end", from: "write", to: "end" }],
    }

    const result = await engine.run(definition, {}, "run-1", (event) => events.push(event))

    expect(write).toHaveBeenCalledWith(
      "Private resolved-canary",
      expect.objectContaining({
        workflowId: definition.id,
        runId: "run-1",
        nodeId: "write",
      }),
    )
    expect(result.nodeResults.write).toMatchObject({
      status: "success",
      input: { variables: {} },
      output: "{\"success\":true}",
      outputs: { success: true },
    })
    expect(JSON.stringify(result.nodeResults.write)).not.toContain("resolved-canary")
    expect(JSON.stringify(events)).not.toContain("resolved-canary")
  })

  it("keeps the complete Clipboard read result in the active engine data flow", async () => {
    const text = "中".repeat(20_000)
    const read = vi.fn(() => ({ text }))
    nodeTypeRegistry.register(clipboardTextReadNodeManifest, clipboardTextReadNodeExecutor)
    nodeTypeRegistry.register(endNodeManifest, endNodeExecutor)
    const engine = new WorkflowEngine(
      { sendToAgent: vi.fn() },
      undefined,
      {
        resolveService: vi.fn(() => ({ read } as unknown as ClipboardService)),
      } as never,
    )
    const definition: WorkflowDefinition = {
      id: "workflow-clipboard-read",
      name: "Clipboard read",
      version: "v1",
      createdAt: 1,
      updatedAt: 1,
      layoutDirection: "horizontal",
      params: [],
      nodes: [
        {
          id: "read",
          name: "读取剪贴板",
          type: "clipboard_text_read",
          position: { x: 0, y: 0 },
          config: {},
        },
        {
          id: "end",
          name: "End",
          type: "end",
          position: { x: 200, y: 0 },
          config: {
            outputType: "text",
            template: "{{value}}",
            variables: [{
              name: "value",
              source: { type: "node_output", node: "read" },
            }],
          },
        },
      ],
      edges: [{ id: "read-to-end", from: "read", to: "end" }],
    }

    const result = await engine.run(definition, {}, "run-1", vi.fn())

    expect(result.nodeResults.read?.output).toBe(text)
    expect(result.nodeResults.read?.outputs).toEqual({ text })
    expect(result.nodeResults.end?.output).toBe(text)
  })

  it("applies workflow default timeout to codex nodes with blank timeout", async () => {
    const receivedConfigs: CodexNodeConfig[] = []
    const codexExecutor: NodeExecutor<CodexNodeConfig> = {
      execute: vi.fn(async (input) => {
        receivedConfigs.push(input.config)
        return { status: "success" as const, output: "codex done", durationMs: 1 }
      }),
    }
    nodeTypeRegistry.register(codexNodeManifest, codexExecutor)
    nodeTypeRegistry.register(endNodeManifest, endNodeExecutor)
    const engine = new WorkflowEngine({
      sendToAgent: vi.fn(),
    })

    const result = await engine.run(workflowWithCodexNode(), {}, "run-1", vi.fn(), undefined, "project-1")

    expect(result.status).toBe("completed")
    expect(receivedConfigs[0]?.timeoutMins).toBe(30)
  })

  it("preserves executor outputs when a codex node returns after cancellation", async () => {
    const abortController = new AbortController()
    const codexDebug = {
      command: "codex exec",
      cwd: "/tmp/project",
      stdoutPreview: "partial output",
      stderrPreview: "",
    }
    const codexExecutor: NodeExecutor<CodexNodeConfig> = {
      execute: vi.fn(async () => {
        abortController.abort()
        return {
          status: "cancelled" as const,
          output: "",
          error: "运行被取消",
          durationMs: 9,
          outputs: { codexDebug },
        }
      }),
    }
    nodeTypeRegistry.register(codexNodeManifest, codexExecutor)
    nodeTypeRegistry.register(endNodeManifest, endNodeExecutor)
    const engine = new WorkflowEngine({
      sendToAgent: vi.fn(),
    })

    const result = await engine.run(
      workflowWithCodexNode(),
      {},
      "run-1",
      vi.fn(),
      abortController.signal,
      "project-1",
    )

    expect(result.status).toBe("cancelled")
    expect(result.nodeResults["codex-1"]).toMatchObject({
      status: "cancelled",
      outputs: { codexDebug },
      durationMs: 9,
    })
  })

  it("preserves the document extraction cancellation code after engine cancellation", async () => {
    const abortController = new AbortController()
    let rejectTask!: (error: unknown) => void
    const result = new Promise<never>((_resolve, reject) => {
      rejectTask = reject
    })
    const cancel = vi.fn(() => {
      rejectTask(new TextExtractionError("EXTRACTION_CANCELLED"))
      return true
    })
    const service = {
      createTask: vi.fn(() => {
        queueMicrotask(() => abortController.abort())
        return {
          result,
          getState: () => ({ id: "task-1", status: "running" as const }),
          subscribe: () => () => undefined,
          cancel,
        }
      }),
    } as unknown as TextExtractorService
    nodeTypeRegistry.register(textExtractNodeManifest, textExtractNodeExecutor)
    nodeTypeRegistry.register(endNodeManifest, endNodeExecutor)
    const engine = new WorkflowEngine(
      { sendToAgent: vi.fn() },
      undefined,
      { resolveService: vi.fn(() => service) } as never,
    )
    const definition: WorkflowDefinition = {
      id: "workflow-text-extract",
      name: "Document extraction workflow",
      version: "v1",
      createdAt: 1,
      updatedAt: 1,
      layoutDirection: "horizontal" as const,
      params: [],
      nodes: [
        {
          id: "extract-1",
          name: "文本提取",
          type: "text_extract",
          position: { x: 0, y: 0 },
          config: { filePath: path.resolve("tmp", "report.pdf"), variables: [] },
        },
        {
          id: "end",
          name: "End",
          type: "end",
          position: { x: 200, y: 0 },
          config: {
            outputType: "text",
            template: "{{result}}",
            variables: [{ name: "result", source: { type: "node_output", node: "extract-1" } }],
          },
        },
      ],
      edges: [{ id: "edge-1", from: "extract-1", to: "end" }],
    }

    const runResult = await engine.run(
      definition,
      {},
      "run-1",
      vi.fn(),
      abortController.signal,
    )

    expect(runResult.nodeResults["extract-1"]).toMatchObject({
      status: "cancelled",
      error: "EXTRACTION_CANCELLED: 文本提取已取消。",
    })
    expect(runResult.status).toBe("cancelled")
    expect(cancel).toHaveBeenCalledOnce()
  })

  it("passes claude code final output to downstream node bindings", async () => {
    const claudeExecutor: NodeExecutor<ClaudeCodeNodeConfig> = {
      execute: vi.fn(async () => ({
        status: "success" as const,
        output: "claude done",
        outputs: {
          claudeCodeDebug: {
            command: "claude -p",
            args: ["-p", "[prompt]"],
            cwd: "/tmp",
            exitCode: 0,
            durationMs: 1,
          },
        },
        durationMs: 1,
      })),
    }
    nodeTypeRegistry.register(claudeCodeNodeManifest, claudeExecutor)
    nodeTypeRegistry.register(endNodeManifest, endNodeExecutor)
    const engine = new WorkflowEngine({
      sendToAgent: vi.fn(),
    })

    const result = await engine.run(workflowWithClaudeCodeNode(), {}, "run-1", vi.fn(), undefined, "project-1")

    expect(result.status).toBe("completed")
    expect(result.nodeResults.end?.output).toBe("claude done")
  })

  it("applies workflow default timeout to claude code nodes with blank timeout", async () => {
    const receivedConfigs: ClaudeCodeNodeConfig[] = []
    const claudeExecutor: NodeExecutor<ClaudeCodeNodeConfig> = {
      execute: vi.fn(async (input) => {
        receivedConfigs.push(input.config)
        return { status: "success" as const, output: "claude done", durationMs: 1 }
      }),
    }
    nodeTypeRegistry.register(claudeCodeNodeManifest, claudeExecutor)
    nodeTypeRegistry.register(endNodeManifest, endNodeExecutor)
    const engine = new WorkflowEngine({
      sendToAgent: vi.fn(),
    })

    const result = await engine.run(workflowWithClaudeCodeNode(), {}, "run-1", vi.fn(), undefined, "project-1")

    expect(result.status).toBe("completed")
    expect(receivedConfigs[0]?.timeoutMins).toBe(30)
  })

  it("passes upstream node outputs to workflow call value bindings", async () => {
    const codexExecutor: NodeExecutor<CodexNodeConfig> = {
      execute: vi.fn(async () => ({
        status: "success" as const,
        output: "/tmp/generated.txt",
        durationMs: 1,
      })),
    }
    const runWorkflow = vi.fn(async () => ({
      runId: "child-run",
      result: { status: "completed" as const, output: "child done", nodeResults: {}, durationMs: 1 },
    }))
    nodeTypeRegistry.register(codexNodeManifest, codexExecutor)
    nodeTypeRegistry.register(workflowCallNodeManifest, workflowCallNodeExecutor)
    nodeTypeRegistry.register(endNodeManifest, endNodeExecutor)
    const engine = new WorkflowEngine({ sendToAgent: vi.fn() }, undefined, {
      processRunner: { run: vi.fn() },
      sendHttpRequest: vi.fn(),
      workflowCall: {
        getWorkflowDefinition: vi.fn(async () => childWorkflowWithFileParam()),
        runWorkflow,
      },
    })

    const result = await engine.run(workflowWithNodeOutputCall(), {}, "run-1", vi.fn(), undefined, "project-1")

    expect(result.status).toBe("completed")
    expect(runWorkflow).toHaveBeenCalledWith(expect.objectContaining({
      params: { input_file: "/tmp/generated.txt" },
    }))
  })
})

function childWorkflowWithFileParam(): WorkflowDefinition {
  return {
    id: "child-1",
    name: "Child",
    version: "v1",
    createdAt: 1,
    updatedAt: 1,
    layoutDirection: "horizontal" as const,
    params: [{ name: "input_file", type: "file", default: null }],
    nodes: [],
    edges: [],
  }
}

function workflowWithNodeOutputCall(): WorkflowDefinition {
  return {
    id: "workflow-1",
    name: "Workflow call",
    version: "v1",
    createdAt: 1,
    updatedAt: 1,
    layoutDirection: "horizontal" as const,
    defaultProjectId: "project-1",
    params: [],
    nodes: [
      {
        id: "prepare",
        name: "Prepare",
        type: "codex",
        position: { x: 0, y: 0 },
        config: { ...defaultCodexNodeConfig, prompt: "Generate" },
      },
      {
        id: "call",
        name: "Call",
        type: "workflow_call",
        position: { x: 200, y: 0 },
        config: {
          workflowId: "child-1",
          variables: [],
          paramTemplates: {},
          paramBindings: {
            input_file: { mode: "value", source: { type: "node_output", node: "prepare" } },
          },
        },
      },
      {
        id: "end",
        name: "End",
        type: "end",
        position: { x: 400, y: 0 },
        config: {
          outputType: "text",
          template: "{{result}}",
          variables: [{ name: "result", source: { type: "node_output", node: "call" } }],
        },
      },
    ],
    edges: [
      { id: "edge-1", from: "prepare", to: "call" },
      { id: "edge-2", from: "call", to: "end" },
    ],
  }
}

function workflowWithJavascriptNode(): WorkflowDefinition {
  return {
    id: "workflow-javascript",
    name: "JavaScript workflow",
    version: "v1",
    createdAt: 1,
    updatedAt: 1,
    layoutDirection: "horizontal" as const,
    params: [],
    nodes: [
      {
        id: "javascript-1",
        name: "JavaScript",
        type: "javascript_run",
        position: { x: 0, y: 0 },
        config: {
          source: "return undefined",
          inputs: [],
          timeoutSeconds: 60,
          saveRunContent: true,
        },
      },
      {
        id: "end",
        name: "End",
        type: "end",
        position: { x: 200, y: 0 },
        config: {
          outputType: "text",
          template: "{{result}}",
          variables: [{ name: "result", source: { type: "node_output", node: "javascript-1" } }],
        },
      },
    ],
    edges: [{ id: "edge-1", from: "javascript-1", to: "end" }],
  }
}

function workflowWithCodexNode(): WorkflowDefinition {
  return {
    id: "workflow-1",
    name: "Codex workflow",
    version: "v1",
    createdAt: 1,
    updatedAt: 1,
    layoutDirection: "horizontal" as const,
    defaultProjectId: "project-1",
    defaultNodeTimeoutMins: 30,
    params: [],
    nodes: [
      {
        id: "codex-1",
        name: "Codex",
        type: "codex",
        position: { x: 0, y: 0 },
        config: {
          ...defaultCodexNodeConfig,
          prompt: "Run codex",
        },
      },
      {
        id: "end",
        name: "End",
        type: "end",
        position: { x: 200, y: 0 },
        config: { outputType: "text", template: "{{result}}", variables: [{ name: "result", source: { type: "node_output", node: "codex-1" } }] },
      },
    ],
    edges: [{ id: "edge-1", from: "codex-1", to: "end" }],
  }
}

function workflowWithClaudeCodeNode(): WorkflowDefinition {
  return {
    id: "workflow-1",
    name: "Claude Code workflow",
    version: "v1",
    createdAt: 1,
    updatedAt: 1,
    layoutDirection: "horizontal" as const,
    defaultProjectId: "project-1",
    defaultNodeTimeoutMins: 30,
    params: [],
    nodes: [
      {
        id: "claude-code-1",
        name: "Claude Code",
        type: "claude_code",
        position: { x: 0, y: 0 },
        config: {
          ...defaultClaudeCodeNodeConfig,
          prompt: "Run",
        },
      },
      {
        id: "end",
        name: "End",
        type: "end",
        position: { x: 200, y: 0 },
        config: { outputType: "text", template: "{{result}}", variables: [{ name: "result", source: { type: "node_output", node: "claude-code-1" } }] },
      },
    ],
    edges: [{ id: "edge-1", from: "claude-code-1", to: "end" }],
  }
}

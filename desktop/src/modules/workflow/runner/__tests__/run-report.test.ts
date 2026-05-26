import { describe, expect, it } from "vitest"
import type { NodeRunResult, WorkflowDefinition } from "@/types/workflow"
import { formatNodeRunReport, formatWorkflowRunReport } from "../run-report"

describe("workflow run reports", () => {
  it("formats a full workflow report with overview, ordering, and every node", () => {
    const report = formatWorkflowRunReport({
      definition: workflowDefinition(),
      runId: "run-1",
      runState: "running",
      runParams: { topic: "debug-token=secret-value" },
      nodeResults: {
        "node-2": nodeResult("node-2", {
          status: "success",
          startedAt: 2000,
          endedAt: 2500,
          durationMs: 500,
          output: "HTTP output token=secret-value",
          outputs: { status: 200, body: { ok: true } },
        }),
        "node-1": nodeResult("node-1", {
          status: "success",
          startedAt: 1000,
          endedAt: 1500,
          durationMs: 500,
          input: {
            variables: { input: "raw prompt variable token=secret-value" },
            prompt: "Resolved prompt token=secret-value",
          },
          output: "Prompt output",
          costUsd: 0.01,
        }),
      },
      runError: null,
    })

    expect(report).toContain("# 工作流运行报告：Debug workflow")
    expect(report).toContain("- 工作流 ID：workflow-1")
    expect(report).toContain("- 运行 ID：run-1")
    expect(report).toContain("- 状态：running")
    expect(report).toContain("- 快照：是")
    expect(report).toContain("- 总费用：$0.01")
    expect(report).toContain('"topic": "debug-token=[redacted]"')
    expect(report).toContain("- 节点数：3")
    expect(report).toContain("- 边数：2")
    expect(report).toContain("1. Prompt node（prompt）：success")
    expect(report).toContain("2. HTTP node（http_request）：success")
    expect(report).toContain("3. Never started（script）：pending")
    expect(report.indexOf("### 1. Prompt node")).toBeLessThan(report.indexOf("### 2. HTTP node"))
    expect(report.indexOf("### 2. HTTP node")).toBeLessThan(report.indexOf("### 3. Never started"))
    expect(report).toContain("Resolved prompt token=[redacted]")
    expect(report).toContain("HTTP output token=[redacted]")
    expect(report).not.toContain("secret-value")
    expect(report).toContain("## 设置")
  })

  it("formats a single node report with config, inputs, outputs, errors, and branch label", () => {
    const report = formatNodeRunReport({
      definition: workflowDefinition(),
      node: workflowDefinition().nodes[1],
      result: nodeResult("node-2", {
        status: "failed",
        startedAt: 3000,
        endedAt: 3600,
        durationMs: 600,
        input: { variables: { url: "https://example.test" } },
        output: "partial body",
        outputs: { response: { status: 500 } },
        activeBranch: "branch1",
        error: "backend failed token=secret-value",
      }),
      orderIndex: 2,
    })

    expect(report).toContain("# 节点运行报告：HTTP node")
    expect(report).toContain("- 节点 ID：node-2")
    expect(report).toContain("- 类型：http_request")
    expect(report).toContain("- 状态：failed")
    expect(report).toContain("- 定义顺序：2")
    expect(report).toContain("- 命中分支：branch1 (branch1)")
    expect(report).toContain("## 请求配置")
    expect(report).toContain('"Authorization": "[redacted]"')
    expect(report).toContain('"url": "https://example.test"')
    expect(report).toContain("partial body")
    expect(report).toContain('"status": 500')
    expect(report).toContain("backend failed token=[redacted]")
    expect(report).not.toContain("secret-value")
  })

  it("includes file conversion configuration in node reports", () => {
    const fileConversionNode: WorkflowDefinition["nodes"][number] = {
      id: "convert",
      name: "Convert document",
      type: "file_conversion",
      position: { x: 0, y: 0 },
      config: {
        inputPath: "/tmp/source.docx",
        outputMode: "markdown-file",
        outputDirectory: "/tmp/synapse-workflow-outputs/run-1",
        ocr: { enabled: true, languages: ["eng"], maxPages: 3 },
      },
    }
    const definition: WorkflowDefinition = {
      ...workflowDefinition(),
      nodes: [fileConversionNode],
      edges: [],
    }

    const report = formatNodeRunReport({
      definition,
      node: fileConversionNode,
      result: nodeResult("convert", { output: "# Source" }),
      orderIndex: 1,
    })

    expect(report).toContain("## 转换配置")
    expect(report).toContain('"inputPath": "[path]"')
    expect(report).toContain('"outputMode": "markdown-file"')
    expect(report).toContain('"enabled": true')
  })

  it("includes token usage in node reports", () => {
    const report = formatNodeRunReport({
      definition: workflowDefinition(),
      node: workflowDefinition().nodes[0],
      result: nodeResult("node-1", {
        usage: {
          input_tokens: 1234,
          output_tokens: 56,
          cache_read_input_tokens: 7890,
          cache_creation_input_tokens: 12,
        },
        costUsd: 0.01,
      }),
      orderIndex: 1,
    })

    expect(report).toContain("## Token 消耗")
    expect(report).toContain("- 输入：1,234")
    expect(report).toContain("- 输出：56")
    expect(report).toContain("- 缓存读：7,890")
    expect(report).toContain("- 缓存写：12")
    expect(report).toContain("- 费用：$0.01")
  })

  it("formats bigint and circular objects without throwing", () => {
    const cyclic: Record<string, unknown> = { label: "cycle" }
    cyclic.self = cyclic

    const report = formatNodeRunReport({
      definition: workflowDefinition(),
      node: workflowDefinition().nodes[0],
      result: nodeResult("node-1", {
        outputs: { count: BigInt(1), cyclic },
      }),
      orderIndex: 1,
    })

    expect(report).toContain('"count": "1"')
    expect(report).toContain('"self": "[Circular]"')
  })
})

function workflowDefinition(): WorkflowDefinition {
  return {
    id: "workflow-1",
    name: "Debug workflow",
    version: "1",
    createdAt: 0,
    updatedAt: 0,
    defaultProjectId: "project-1",
    defaultProviderId: "provider-1",
    defaultModelTier: "sonnet",
    defaultNodeTimeoutMins: 10,
    params: [{ name: "topic", type: "text", default: null }],
    nodes: [
      {
        id: "node-1",
        name: "Prompt node",
        type: "prompt",
        position: { x: 0, y: 0 },
        config: {
          providerId: "provider-1",
          modelTier: "sonnet",
          variables: [{ name: "input", source: { type: "param", param: "topic" } }],
          prompt: "Prompt template {{input}}",
        },
      },
      {
        id: "node-2",
        name: "HTTP node",
        type: "http_request",
        position: { x: 100, y: 0 },
        config: {
          method: "GET",
          url: "https://example.test",
          headers: { Authorization: "Bearer token=secret-value" },
          bodyType: "none",
          variables: [{ name: "url", source: { type: "node_output", node: "node-1" } }],
          branches: [{ id: "branch1", label: "分支 1" }],
        },
      },
      {
        id: "node-3",
        name: "Never started",
        type: "script",
        position: { x: 200, y: 0 },
        config: { shell: "posix", script: "echo $value", variables: [] },
      },
    ],
    edges: [
      { id: "edge-1", from: "node-1", to: "node-2" },
      { id: "edge-2", from: "node-2", to: "node-3", branch: "branch1" },
    ],
  }
}

function nodeResult(nodeId: string, patch: Partial<NodeRunResult> = {}): NodeRunResult {
  return {
    nodeId,
    status: "success",
    input: { variables: {} },
    ...patch,
  }
}

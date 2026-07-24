import { describe, expect, it } from "vitest"
import type { NodeRunResult, WorkflowDefinition, WorkflowNode } from "@/types/workflow"
import { formatNodeRunReport, formatWorkflowRunReport } from "../run-report"

describe("workflow run reports", () => {
  it("labels an empty-string node output explicitly", () => {
    const report = formatNodeRunReport({
      definition: workflowDefinition(),
      node: workflowDefinition().nodes[0],
      result: nodeResult("node-1", { output: "" }),
      orderIndex: 1,
    })

    expect(report).toContain("## 输出")
    expect(report).toContain("空字符串")
  })

  it("formats a full workflow report with overview, ordering, and every node", () => {
    const report = formatWorkflowRunReport({
      definition: workflowDefinition(),
      runId: "run-1",
      runState: "completed",
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
    expect(report).toContain("- 状态：completed")
    expect(report).toContain("- 快照：是")
    expect(report).not.toContain("总费用")
    expect(report).not.toContain("¥0.072")
    expect(report).not.toContain("$0.01")
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

  it("omits System Notifier bodies and variable values from node and workflow reports", () => {
    const node: WorkflowNode = {
      id: "notify-1",
      name: "系统通知",
      type: "system_notifier_notification_trigger",
      position: { x: 0, y: 0 },
      config: {
        title: "Safe title",
        body: "private-body-canary {{secret}}",
        variables: [{
          name: "secret",
          source: { type: "static", value: "binding-value-canary" },
        }],
      },
    }
    const definition: WorkflowDefinition = {
      ...workflowDefinition(),
      nodes: [node],
      edges: [],
    }
    const result = nodeResult("notify-1", {
      input: { variables: { secret: "resolved-variable-canary" } },
      output: "{\"success\":true}",
      outputs: { success: true },
    })
    const nodeReport = formatNodeRunReport({
      definition,
      node,
      result,
      orderIndex: 1,
    })
    const workflowReport = formatWorkflowRunReport({
      definition,
      runId: "run-1",
      runState: "completed",
      runParams: {},
      nodeResults: { "notify-1": result },
    })

    for (const report of [nodeReport, workflowReport]) {
      expect(report).toContain("Safe title")
      expect(report).toContain('"success": true')
      expect(report).not.toContain("private-body-canary")
      expect(report).not.toContain("binding-value-canary")
      expect(report).not.toContain("resolved-variable-canary")
      expect(report).not.toContain("变量绑定")
      expect(report).not.toContain("运行输入变量")
    }
  })

  it("omits JSON Repair text and variable values from node and workflow reports", () => {
    const node: WorkflowNode = {
      id: "repair-1",
      name: "JSON 修复",
      type: "json_repair_text_repair",
      position: { x: 0, y: 0 },
      config: {
        text: "private-json-canary {{secret}}",
        variables: [{
          name: "secret",
          source: { type: "static", value: "binding-value-canary" },
        }],
      },
    }
    const definition: WorkflowDefinition = {
      ...workflowDefinition(),
      nodes: [node],
      edges: [],
    }
    const result = nodeResult("repair-1", {
      input: {
        variables: { secret: "resolved-variable-canary" },
        prompt: "private-json-canary resolved-variable-canary",
      },
      output: "{\"ok\":true}",
      outputs: { json: "{\"ok\":true}" },
    })
    const nodeReport = formatNodeRunReport({
      definition,
      node,
      result,
      orderIndex: 1,
    })
    const workflowReport = formatWorkflowRunReport({
      definition,
      runId: "run-1",
      runState: "completed",
      runParams: {},
      nodeResults: { "repair-1": result },
    })

    for (const report of [nodeReport, workflowReport]) {
      expect(report).toContain("{\"ok\":true}")
      expect(report).not.toContain("private-json-canary")
      expect(report).not.toContain("binding-value-canary")
      expect(report).not.toContain("resolved-variable-canary")
      expect(report).not.toContain("变量绑定")
      expect(report).not.toContain("运行输入变量")
    }
  })

  it("marks running workflow reports as not snapshotted yet", () => {
    const report = formatWorkflowRunReport({
      definition: workflowDefinition(),
      runId: "run-1",
      runState: "running",
      runParams: {},
      nodeResults: {},
      runError: null,
    })

    expect(report).toContain("- 状态：running")
    expect(report).toContain("- 快照：否")
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
        outputs: {
          response: {
            status: 500,
            headers: {
              "x-api-key": "raw-prefixed-api-key",
              openai_api_key: "raw-openai-api-key",
            },
          },
        },
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
    expect(report).toContain('"x-api-key": "[redacted]"')
    expect(report).toContain('"openai_api_key": "[redacted]"')
    expect(report).toContain("backend failed token=[redacted]")
    expect(report).not.toContain("secret-value")
    expect(report).not.toContain("raw-prefixed-api-key")
    expect(report).not.toContain("raw-openai-api-key")
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
    expect(report).not.toContain("费用")
    expect(report).not.toContain("¥0.072")
    expect(report).not.toContain("$0.01")
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

  it("redacts Code X config override values in copied reports", () => {
    const definition = workflowDefinition()
    const codexNode: WorkflowNode = {
      id: "codex-1",
      name: "Code X",
      type: "codex",
      position: { x: 300, y: 0 },
      config: {
        prompt: "Run task",
        model: "gpt-5-codex",
        configOverrides: [
          { key: "model_reasoning_effort", value: "customer-alpha" },
          { key: "sandbox_workspace_write.network_access", value: "true" },
        ],
        variables: [],
      },
    }
    const nextDefinition: WorkflowDefinition = {
      ...definition,
      nodes: [...definition.nodes, codexNode],
    }
    const result = nodeResult("codex-1", {
      status: "failed",
      error: "Codex failed",
    })

    const nodeReport = formatNodeRunReport({
      definition: nextDefinition,
      node: codexNode,
      result,
      orderIndex: 4,
    })
    const workflowReport = formatWorkflowRunReport({
      definition: nextDefinition,
      runId: "run-1",
      runState: "failed",
      runParams: {},
      nodeResults: { "codex-1": result },
    })

    for (const report of [nodeReport, workflowReport]) {
      expect(report).toContain('"key": "model_reasoning_effort"')
      expect(report).toContain('"key": "sandbox_workspace_write.network_access"')
      expect(report).toContain('"value": "[redacted]"')
      expect(report).not.toContain("customer-alpha")
      expect(report).not.toContain('"value": "true"')
    }
  })

  it("preserves Code X debug artifact paths in copied reports", () => {
    const definition = workflowDefinition()
    const codexNode: WorkflowNode = {
      id: "codex-1",
      name: "Code X",
      type: "codex",
      position: { x: 300, y: 0 },
      config: {
        prompt: "Run task",
        variables: [],
      },
    }
    const nextDefinition: WorkflowDefinition = {
      ...definition,
      nodes: [...definition.nodes, codexNode],
    }
    const result = nodeResult("codex-1", {
      outputs: {
        codexDebug: {
          command: "codex exec",
          cwd: "/Users/liyang/project",
          stdoutPath: "/Users/liyang/Library/Application Support/Synapse/workflow-runs/run-1/nodes/codex-1/codex/stdout.log",
          stderrPath: "/Users/liyang/Library/Application Support/Synapse/workflow-runs/run-1/nodes/codex-1/codex/stderr.log",
          lastMessagePath: "/Users/liyang/Library/Application Support/Synapse/workflow-runs/run-1/nodes/codex-1/codex/last-message.txt",
          stderrPreview: "Authorization: Bearer raw-secret at /Users/liyang/project",
        },
      },
    })

    const report = formatNodeRunReport({
      definition: nextDefinition,
      node: codexNode,
      result,
      orderIndex: 4,
    })

    expect(report).toContain('"cwd": "/Users/liyang/project"')
    expect(report).toContain('"stdoutPath": "/Users/liyang/Library/Application Support/Synapse/workflow-runs/run-1/nodes/codex-1/codex/stdout.log"')
    expect(report).toContain('"stderrPath": "/Users/liyang/Library/Application Support/Synapse/workflow-runs/run-1/nodes/codex-1/codex/stderr.log"')
    expect(report).toContain('"lastMessagePath": "/Users/liyang/Library/Application Support/Synapse/workflow-runs/run-1/nodes/codex-1/codex/last-message.txt"')
    expect(report).toContain("Authorization=[redacted] [redacted]")
    expect(report).toContain("[path]")
    expect(report).not.toContain("raw-secret")
  })

  it("includes Claude Code prompt and debug artifact paths in copied reports", () => {
    const definition = workflowDefinition()
    const claudeCodeNode: WorkflowNode = {
      id: "claude-code-1",
      name: "Claude Code",
      type: "claude_code",
      position: { x: 300, y: 0 },
      config: {
        prompt: "Run Claude Code",
        variables: [],
      },
    }
    const nextDefinition: WorkflowDefinition = {
      ...definition,
      nodes: [...definition.nodes, claudeCodeNode],
    }
    const result = nodeResult("claude-code-1", {
      input: {
        variables: {},
        prompt: "Run Claude with token=secret-value",
      },
      outputs: {
        claudeCodeDebug: {
          command: "claude -p",
          cwd: "/Users/liyang/project",
          stdoutPath: "/Users/liyang/Library/Application Support/Synapse/workflow-runs/run-1/nodes/claude-code-1/claude-code/stdout.log",
          stderrPath: "/Users/liyang/Library/Application Support/Synapse/workflow-runs/run-1/nodes/claude-code-1/claude-code/stderr.log",
          lastMessagePath: "/Users/liyang/Library/Application Support/Synapse/workflow-runs/run-1/nodes/claude-code-1/claude-code/last-message.txt",
          stderrPreview: "Authorization: Bearer raw-secret at /Users/liyang/project",
        },
      },
    })

    const report = formatNodeRunReport({
      definition: nextDefinition,
      node: claudeCodeNode,
      result,
      orderIndex: 4,
    })

    expect(report).toContain("## 完整 Prompt")
    expect(report).toContain("Run Claude with token=[redacted]")
    expect(report).toContain('"command": "claude -p"')
    expect(report).toContain('"cwd": "/Users/liyang/project"')
    expect(report).toContain('"stdoutPath": "/Users/liyang/Library/Application Support/Synapse/workflow-runs/run-1/nodes/claude-code-1/claude-code/stdout.log"')
    expect(report).toContain('"stderrPath": "/Users/liyang/Library/Application Support/Synapse/workflow-runs/run-1/nodes/claude-code-1/claude-code/stderr.log"')
    expect(report).toContain('"lastMessagePath": "/Users/liyang/Library/Application Support/Synapse/workflow-runs/run-1/nodes/claude-code-1/claude-code/last-message.txt"')
    expect(report).toContain("Authorization=[redacted] [redacted]")
    expect(report).toContain("[path]")
    expect(report).not.toContain("secret-value")
    expect(report).not.toContain("raw-secret")
  })

  it("does not include agent conversation session keys in copied reports", () => {
    const result = nodeResult("node-1", {
      outputs: {
        agentConversation: {
          projectId: "project-1",
          conversationId: "conversation-1",
          sessionKey: "raw-agent-session-key",
          platform: "workflow",
        },
        nested: { sessionKey: "nested-session-key" },
        status: "ok",
      },
    })

    const nodeReport = formatNodeRunReport({
      definition: workflowDefinition(),
      node: workflowDefinition().nodes[0],
      result,
      orderIndex: 1,
    })
    const workflowReport = formatWorkflowRunReport({
      definition: workflowDefinition(),
      runId: "run-1",
      runState: "completed",
      runParams: {},
      nodeResults: { "node-1": result },
    })

    for (const report of [nodeReport, workflowReport]) {
      expect(report).not.toContain("agentConversation")
      expect(report).not.toContain("raw-agent-session-key")
      expect(report).not.toContain("nested-session-key")
      expect(report).toContain('"sessionKey": "[redacted]"')
      expect(report).toContain('"status": "ok"')
    }
  })
})

function workflowDefinition(): WorkflowDefinition {
  return {
    id: "workflow-1",
    name: "Debug workflow",
    version: "1",
    createdAt: 0,
    updatedAt: 0,
    layoutDirection: "horizontal" as const,
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

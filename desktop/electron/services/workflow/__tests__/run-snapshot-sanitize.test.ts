import { describe, expect, it } from "vitest"

import { sanitizeNodeResultsForSnapshot, sanitizeWorkflowDefinitionForSnapshot, sanitizeWorkflowEventForRenderer, sanitizeWorkflowOutputForHistory, sanitizeWorkflowRunSnapshot } from "../run-snapshot-sanitize"
import type { NodeRunResult, WorkflowDefinition, WorkflowRunSnapshot } from "../../../../src/types/workflow"

describe("sanitizeNodeResultsForSnapshot", () => {
  it("preserves script result diagnostics when run content is omitted", () => {
    const result: NodeRunResult = {
      nodeId: "script-1",
      status: "failed",
      input: { variables: {}, inputs: { secret: "not-retained" } },
      error: "INVALID_RESULT: Script result is invalid.",
      errorCode: "INVALID_RESULT",
      errorReason: "unsupported_value",
      logs: [{ label: "stdout", value: "not-retained" }],
    }
    const definition: WorkflowDefinition = {
      id: "workflow-1",
      name: "Script workflow",
      version: "v1",
      createdAt: 1,
      updatedAt: 1,
      layoutDirection: "horizontal" as const,
      params: [],
      nodes: [{
        id: "script-1",
        name: "JavaScript",
        type: "javascript_run",
        position: { x: 0, y: 0 },
        config: {
          source: "return undefined",
          inputs: [],
          timeoutSeconds: 60,
          saveRunContent: false,
        },
      }],
      edges: [],
    }

    const sanitized = sanitizeNodeResultsForSnapshot({ "script-1": result }, definition)

    expect(sanitized["script-1"]).toMatchObject({
      errorCode: "INVALID_RESULT",
      errorReason: "unsupported_value",
    })
    expect(sanitized["script-1"]?.input).toEqual({ variables: {} })
    expect(sanitized["script-1"]?.logs).toBeUndefined()
  })

  it("bounds large node outputs without mutating engine results", () => {
    const largeOutput = "中".repeat(40_000)
    const result: NodeRunResult = {
      nodeId: "script-1",
      status: "success",
      input: { variables: {} },
      output: largeOutput,
      outputs: { stdout: largeOutput },
    }

    const sanitized = sanitizeNodeResultsForSnapshot({ "script-1": result })["script-1"]

    expect(sanitized?.output?.endsWith("[truncated]")).toBe(true)
    expect((sanitized?.outputs?.stdout as string).endsWith("[truncated]")).toBe(true)
    expect(Buffer.byteLength(sanitized?.output ?? "", "utf8")).toBeLessThanOrEqual(10_000)
    expect(Buffer.byteLength(JSON.stringify(sanitized?.outputs), "utf8")).toBeLessThan(11_000)
    expect(result.output).toBe(largeOutput)
    expect(result.outputs?.stdout).toBe(largeOutput)
  })

  it("bounds output collection size and depth", () => {
    const items = Array.from({ length: 500 }, (_, index) => ({ index }))
    const deep: Record<string, unknown> = {}
    let cursor = deep
    for (let depth = 0; depth < 20; depth += 1) {
      cursor.next = {}
      cursor = cursor.next as Record<string, unknown>
    }

    const sanitizedItems = sanitizeWorkflowOutputForHistory(items) as unknown[]
    const sanitizedDeep = sanitizeWorkflowOutputForHistory(deep)

    expect(sanitizedItems).toHaveLength(201)
    expect(sanitizedItems.at(-1)).toBe("[truncated]")
    expect(JSON.stringify(sanitizedDeep)).toContain("[truncated]")
    expect(items).toHaveLength(500)
  })

  it("bounds node completion event output before renderer delivery", () => {
    const output = "x".repeat(100_000)

    const sanitized = sanitizeWorkflowEventForRenderer({
      type: "node:completed",
      runId: "run-1",
      nodeId: "script-1",
      output,
      result: {
        nodeId: "script-1",
        status: "success",
        input: { variables: {} },
        output,
      },
    })

    expect(sanitized.type).toBe("node:completed")
    if (sanitized.type !== "node:completed") return
    expect((sanitized.output as string).endsWith("[truncated]")).toBe(true)
    expect(sanitized.result?.output?.endsWith("[truncated]")).toBe(true)
  })

  it("removes agent conversation session keys from persisted outputs", () => {
    const result: NodeRunResult = {
      nodeId: "prompt-1",
      status: "success",
      input: { variables: {}, prompt: "hello" },
      outputs: {
        value: "done",
        agentConversation: {
          projectId: "project-1",
          conversationId: "conversation-1",
          sessionKey: "raw-agent-session-key",
          platform: "workflow",
        },
      },
    }

    const sanitized = sanitizeNodeResultsForSnapshot({ "prompt-1": result })

    expect(sanitized["prompt-1"]?.outputs).toEqual({
      value: "done",
      agentConversation: {
        projectId: "project-1",
        conversationId: "conversation-1",
        platform: "workflow",
      },
    })
    expect(JSON.stringify(sanitized)).not.toContain("raw-agent-session-key")
    expect(result.outputs?.agentConversation?.sessionKey).toBe("raw-agent-session-key")
  })

  it("preserves declared file-result paths while still redacting arbitrary output paths", () => {
    const declaredPath = "/tmp/generated/report.html"
    const sanitized = sanitizeNodeResultsForSnapshot({
      "file-1": {
        nodeId: "file-1",
        status: "success",
        input: { variables: {} },
        output: declaredPath,
        outputs: { path: declaredPath, format: "html" },
      },
      "text-1": {
        nodeId: "text-1",
        status: "success",
        input: { variables: {} },
        output: "/Users/liyang/private.txt",
      },
    })

    expect(sanitized["file-1"]?.output).toBe(declaredPath)
    expect(sanitized["file-1"]?.outputs?.path).toBe(declaredPath)
    expect(sanitized["text-1"]?.output).toBe("[path]")
  })

  it("sanitizes persisted node output, structured outputs, and errors", () => {
    const result: NodeRunResult = {
      nodeId: "http-1",
      status: "failed",
      input: { variables: {}, prompt: "call API" },
      output: "body includes Authorization: Bearer response-token and sk-live-secret",
      outputs: {
        status: 500,
        headers: {
          authorization: "Bearer response-token",
          "set-cookie": "session_token=abc123; Path=/",
          "x-api-key": "sk-live-secret",
        },
        body: {
          message: "token: abc123",
          nested: {
            cookie: "session=secret-cookie",
          },
        },
      },
      error: "Request failed with cookie=session-secret and /Users/liyang/private.txt",
    }

    const sanitized = sanitizeNodeResultsForSnapshot({ "http-1": result })
    const raw = JSON.stringify(sanitized)

    expect(sanitized["http-1"]?.output).not.toContain("response-token")
    expect(sanitized["http-1"]?.outputs?.headers).toEqual({
      authorization: "[redacted]",
      "set-cookie": "[redacted]",
      "x-api-key": "[redacted]",
    })
    expect(sanitized["http-1"]?.outputs?.body).toEqual({
      message: "token=[redacted]",
      nested: {
        cookie: "[redacted]",
      },
    })
    expect(sanitized["http-1"]?.error).toContain("[path]")
    expect(raw).not.toContain("response-token")
    expect(raw).not.toContain("sk-live-secret")
    expect(raw).not.toContain("abc123")
    expect(raw).not.toContain("secret-cookie")
    expect(raw).not.toContain("/Users/liyang/private.txt")
  })

  it("sanitizes codex debug previews consistently with snapshot string redaction", () => {
    const result: NodeRunResult = {
      nodeId: "codex-1",
      status: "failed",
      input: { variables: {}, prompt: "run codex" },
      outputs: {
        codexDebug: {
          cwd: "/Users/liyang/project",
          stdoutPath: "/Users/liyang/Library/Application Support/Synapse/workflow-runs/run-1/nodes/codex-1/codex/stdout.log",
          stderrPath: "/Users/liyang/Library/Application Support/Synapse/workflow-runs/run-1/nodes/codex-1/codex/stderr.log",
          promptPath: "/Users/liyang/Library/Application Support/Synapse/workflow-runs/run-1/nodes/codex-1/codex/prompt.txt",
          lastMessagePath: "/Users/liyang/Library/Application Support/Synapse/workflow-runs/run-1/nodes/codex-1/codex/last-message.txt",
          stdoutPreview: "Authorization: Bearer secret\ntoken=abc123\n/Users/liyang/project",
          stderrPreview: "Authorization: Bearer secret\ntoken=abc123\n/Users/liyang/project",
        },
      },
    }

    const sanitized = sanitizeNodeResultsForSnapshot({ "codex-1": result })
    const codexDebug = sanitized["codex-1"]?.outputs?.codexDebug as Record<string, string>
    const raw = JSON.stringify(sanitized)

    expect(codexDebug.stdoutPreview).toContain("[redacted]")
    expect(codexDebug.stderrPreview).toContain("[redacted]")
    expect(codexDebug.stdoutPreview).toContain("[path]")
    expect(codexDebug.stderrPreview).toContain("[path]")
    expect(codexDebug.cwd).toBe("/Users/liyang/project")
    expect(codexDebug.stdoutPath).toContain("/workflow-runs/run-1/nodes/codex-1/codex/stdout.log")
    expect(codexDebug.stderrPath).toContain("/workflow-runs/run-1/nodes/codex-1/codex/stderr.log")
    expect(codexDebug.promptPath).toContain("/workflow-runs/run-1/nodes/codex-1/codex/prompt.txt")
    expect(codexDebug.lastMessagePath).toContain("/workflow-runs/run-1/nodes/codex-1/codex/last-message.txt")
    expect(raw).not.toContain("Bearer secret")
    expect(raw).not.toContain("abc123")
    expect(codexDebug.stdoutPreview).not.toContain("/Users/liyang/project")
  })

  it("sanitizes claude code debug previews while preserving artifact paths", () => {
    const result: NodeRunResult = {
      nodeId: "claude-code-1",
      status: "failed",
      input: { variables: {}, prompt: "run claude" },
      outputs: {
        claudeCodeDebug: {
          cwd: "/Users/liyang/project",
          stdoutPath: "/Users/liyang/Library/Application Support/Synapse/workflow-runs/run-1/nodes/claude-code-1/claude-code/stdout.log",
          stderrPath: "/Users/liyang/Library/Application Support/Synapse/workflow-runs/run-1/nodes/claude-code-1/claude-code/stderr.log",
          promptPath: "/Users/liyang/Library/Application Support/Synapse/workflow-runs/run-1/nodes/claude-code-1/claude-code/prompt.txt",
          lastMessagePath: "/Users/liyang/Library/Application Support/Synapse/workflow-runs/run-1/nodes/claude-code-1/claude-code/last-message.txt",
          stdoutPreview: "Authorization: Bearer secret\nCookie: sid=abc123\n/Users/liyang/project",
          stderrPreview: "ANTHROPIC_API_KEY=sk-raw-secret\n/Users/liyang/project",
        },
      },
    }

    const sanitized = sanitizeNodeResultsForSnapshot({ "claude-code-1": result })
    const claudeCodeDebug = sanitized["claude-code-1"]?.outputs?.claudeCodeDebug as Record<string, string>
    const raw = JSON.stringify(sanitized)

    expect(claudeCodeDebug.stdoutPreview).toContain("[redacted]")
    expect(claudeCodeDebug.stderrPreview).toContain("[redacted]")
    expect(claudeCodeDebug.stdoutPreview).toContain("[path]")
    expect(claudeCodeDebug.stderrPreview).toContain("[path]")
    expect(claudeCodeDebug.cwd).toBe("/Users/liyang/project")
    expect(claudeCodeDebug.stdoutPath).toContain("/workflow-runs/run-1/nodes/claude-code-1/claude-code/stdout.log")
    expect(claudeCodeDebug.stderrPath).toContain("/workflow-runs/run-1/nodes/claude-code-1/claude-code/stderr.log")
    expect(claudeCodeDebug.promptPath).toContain("/workflow-runs/run-1/nodes/claude-code-1/claude-code/prompt.txt")
    expect(claudeCodeDebug.lastMessagePath).toContain("/workflow-runs/run-1/nodes/claude-code-1/claude-code/last-message.txt")
    expect(raw).not.toContain("Bearer secret")
    expect(raw).not.toContain("sid=abc123")
    expect(raw).not.toContain("sk-raw-secret")
    expect(claudeCodeDebug.stdoutPreview).not.toContain("/Users/liyang/project")
  })
})

describe("sanitizeWorkflowDefinitionForSnapshot", () => {
  it("redacts text and resource defaults while preserving parameter structure", () => {
    const definition: WorkflowDefinition = {
      id: "workflow-1",
      name: "Parameter defaults",
      version: "1.0.0",
      createdAt: 1,
      updatedAt: 2,
      layoutDirection: "horizontal" as const,
      params: [
        {
          name: "token",
          type: "text",
          description: "Access token",
          default: "Authorization: Bearer raw-default-token from /Users/liyang/private.txt",
        },
        {
          name: "input",
          type: "file",
          default: { kind: "local_path", entryType: "file", path: "/Users/liyang/input.txt" },
        },
        {
          name: "inputs",
          type: "file",
          allowMultiple: true,
          default: [
            { kind: "local_path", entryType: "file", path: "/Users/liyang/first.txt" },
            { kind: "local_path", entryType: "file", path: "/Users/liyang/second.txt" },
          ],
        },
        { name: "count", type: "number", default: 3 },
      ],
      edges: [],
      nodes: [],
    }

    const sanitized = sanitizeWorkflowDefinitionForSnapshot(definition)
    const raw = JSON.stringify(sanitized)

    expect(sanitized.params).toEqual([
      {
        name: "token",
        type: "text",
        description: "Access token",
        default: "Authorization=[redacted] [redacted] from [path]",
      },
      {
        name: "input",
        type: "file",
        default: { kind: "local_path", entryType: "file", path: "[path]" },
      },
      {
        name: "inputs",
        type: "file",
        allowMultiple: true,
        default: [
          { kind: "local_path", entryType: "file", path: "[path]" },
          { kind: "local_path", entryType: "file", path: "[path]" },
        ],
      },
      { name: "count", type: "number", default: 3 },
    ])
    expect(raw).not.toContain("raw-default-token")
    expect(raw).not.toContain("/Users/liyang")
    expect(definition.params[0]?.default).toContain("raw-default-token")
    expect((definition.params[2]?.default as Array<{ path: string }>)[0]?.path).toBe("/Users/liyang/first.txt")
  })

  it("redacts Code X config override values from persisted definitions", () => {
    const definition: WorkflowDefinition = {
      id: "workflow-1",
      name: "Secret workflow",
      version: "1.0.0",
      createdAt: 1,
      updatedAt: 2,
      layoutDirection: "horizontal" as const,
      params: [],
      edges: [],
      nodes: [
        {
          id: "codex-1",
          name: "Code X",
          type: "codex",
          position: { x: 0, y: 0 },
          config: {
            prompt: "ship it with Authorization: Bearer raw-token, Cookie: sid=abc123, ANTHROPIC_API_KEY=sk-raw-secret, /Users/liyang/private.txt",
            configOverrides: [
              { key: "ANTHROPIC_API_KEY", value: "sk-raw-secret" },
              { key: "model_reasoning_effort", value: "high" },
            ],
          },
        },
        {
          id: "http-1",
          name: "HTTP",
          type: "http",
          position: { x: 100, y: 0 },
          config: {
            configOverrides: [{ key: "not-codex", value: "preserved" }],
          },
        },
      ],
    }

    const sanitized = sanitizeWorkflowDefinitionForSnapshot(definition)
    const codexNode = sanitized.nodes[0]
    const httpNode = sanitized.nodes[1]

    expect(codexNode?.config.configOverrides).toEqual([
      { key: "ANTHROPIC_API_KEY", value: "[redacted]" },
      { key: "model_reasoning_effort", value: "[redacted]" },
    ])
    expect(codexNode?.config.prompt).toContain("ship it")
    expect(codexNode?.config.prompt).toContain("[redacted]")
    expect(codexNode?.config.prompt).toContain("[path]")
    expect(httpNode?.config.configOverrides).toEqual([{ key: "not-codex", value: "preserved" }])
    expect(JSON.stringify(sanitized)).not.toContain("sk-raw-secret")
    expect(JSON.stringify(sanitized)).not.toContain("high")
    expect(JSON.stringify(sanitized)).not.toContain("raw-token")
    expect(JSON.stringify(sanitized)).not.toContain("sid=abc123")
    expect(JSON.stringify(sanitized)).not.toContain("/Users/liyang/private.txt")
    expect(definition.nodes[0]?.config.prompt).toContain("raw-token")
    expect(definition.nodes[0]?.config.configOverrides).toEqual([
      { key: "ANTHROPIC_API_KEY", value: "sk-raw-secret" },
      { key: "model_reasoning_effort", value: "high" },
    ])
  })

  it("sanitizes Code X prompts even when no config overrides are present", () => {
    const definition: WorkflowDefinition = {
      id: "workflow-1",
      name: "Prompt workflow",
      version: "1.0.0",
      createdAt: 1,
      updatedAt: 2,
      layoutDirection: "horizontal" as const,
      params: [],
      edges: [],
      nodes: [
        {
          id: "codex-1",
          name: "Code X",
          type: "codex",
          position: { x: 0, y: 0 },
          config: {
            prompt: "Use token=abc123 from /Users/liyang/private.txt",
          },
        },
      ],
    }

    const sanitized = sanitizeWorkflowDefinitionForSnapshot(definition)
    const raw = JSON.stringify(sanitized)

    expect(sanitized.nodes[0]?.config.prompt).toContain("token=[redacted]")
    expect(sanitized.nodes[0]?.config.prompt).toContain("[path]")
    expect(raw).not.toContain("abc123")
    expect(raw).not.toContain("/Users/liyang/private.txt")
  })

  it("redacts HTTP auth and script env from persisted definitions", () => {
    const definition: WorkflowDefinition = {
      id: "workflow-1",
      name: "Secret workflow",
      version: "1.0.0",
      createdAt: 1,
      updatedAt: 2,
      layoutDirection: "horizontal" as const,
      params: [],
      edges: [],
      nodes: [
        {
          id: "http-1",
          name: "HTTP",
          type: "http_request",
          position: { x: 0, y: 0 },
          config: {
            method: "POST",
            url: "https://example.com",
            headers: {
              authorization: "Bearer raw-header-token",
              accept: "application/json",
              "x-api-key": "sk-header-secret",
            },
            auth: {
              type: "bearer",
              bearerToken: "raw-bearer-token",
              basicPassword: "raw-basic-password",
            },
            bodyType: "json",
            body: "{\"message\":\"ok\"}",
            variables: [],
          },
        },
        {
          id: "script-1",
          name: "Script",
          type: "script",
          position: { x: 100, y: 0 },
          config: {
            shell: "posix",
            script: "echo ok",
            env: {
              API_TOKEN: "raw-script-token",
              SAFE_FLAG: "plain-env-value",
            },
            variables: [],
          },
        },
      ],
    }

    const sanitized = sanitizeWorkflowDefinitionForSnapshot(definition)
    const httpNode = sanitized.nodes[0]
    const scriptNode = sanitized.nodes[1]
    const raw = JSON.stringify(sanitized)

    expect(httpNode?.config.headers).toEqual({
      authorization: "[redacted]",
      accept: "application/json",
      "x-api-key": "[redacted]",
    })
    expect(httpNode?.config.auth).toEqual({
      type: "bearer",
      bearerToken: "[redacted]",
      basicPassword: "[redacted]",
    })
    expect(httpNode?.config.body).toBe("{\"message\":\"ok\"}")
    expect(scriptNode?.config.env).toEqual({
      API_TOKEN: "[redacted]",
      SAFE_FLAG: "[redacted]",
    })
    expect(raw).not.toContain("raw-header-token")
    expect(raw).not.toContain("sk-header-secret")
    expect(raw).not.toContain("raw-bearer-token")
    expect(raw).not.toContain("raw-basic-password")
    expect(raw).not.toContain("raw-script-token")
    expect(raw).not.toContain("plain-env-value")
    expect(definition.nodes[1]?.config.env).toEqual({
      API_TOKEN: "raw-script-token",
      SAFE_FLAG: "plain-env-value",
    })
  })

  it("sanitizes Claude Code prompts in persisted definitions", () => {
    const definition: WorkflowDefinition = {
      id: "workflow-1",
      name: "Claude Code workflow",
      version: "1.0.0",
      createdAt: 1,
      updatedAt: 2,
      layoutDirection: "horizontal" as const,
      params: [],
      edges: [],
      nodes: [
        {
          id: "claude-code-1",
          name: "Claude Code",
          type: "claude_code",
          position: { x: 0, y: 0 },
          config: {
            prompt: "Use Authorization: Bearer raw-token and /Users/liyang/private.txt",
            projectId: "project-1",
          },
        },
      ],
    }

    const sanitized = sanitizeWorkflowDefinitionForSnapshot(definition)
    const raw = JSON.stringify(sanitized)

    expect(sanitized.nodes[0]?.config.prompt).toContain("Authorization=[redacted]")
    expect(sanitized.nodes[0]?.config.prompt).toContain("[path]")
    expect(raw).not.toContain("raw-token")
    expect(raw).not.toContain("/Users/liyang/private.txt")
  })
})

describe("sanitizeWorkflowRunSnapshot", () => {
  it("sanitizes top-level run params before persistence", () => {
    const snapshot: WorkflowRunSnapshot = {
      runId: "run-1",
      workflowId: "workflow-1",
      version: "v1",
      startedAt: 1,
      status: "completed",
      params: {
        apiToken: "sk-raw-secret",
        nested: {
          password: "plain-password",
          note: "Authorization: Bearer raw-token at /Users/liyang/private.txt",
        },
      },
      nodeResults: {},
    }

    const sanitized = sanitizeWorkflowRunSnapshot(snapshot)
    const raw = JSON.stringify(sanitized)

    expect(sanitized.params).toEqual({
      apiToken: "[redacted]",
      nested: {
        password: "[redacted]",
          note: "Authorization=[redacted] [redacted] at [path]",
      },
    })
    expect(raw).not.toContain("sk-raw-secret")
    expect(raw).not.toContain("plain-password")
    expect(raw).not.toContain("raw-token")
    expect(raw).not.toContain("/Users/liyang/private.txt")
    expect(snapshot.params.apiToken).toBe("sk-raw-secret")
  })

  it("does not persist System Notifier content, bindings, or resolved variable values", () => {
    const snapshot: WorkflowRunSnapshot = {
      runId: "run-1",
      workflowId: "workflow-system-notifier",
      version: "v1",
      startedAt: 1,
      status: "completed",
      params: {},
      definition: {
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
              title: "private-title-canary",
              body: "private-body-canary {{secret}}",
              variables: [{
                name: "secret",
                source: { type: "static", value: "resolved-variable-canary" },
              }],
            },
          },
        ],
        edges: [],
      },
      nodeResults: {
        "notify-1": {
          nodeId: "notify-1",
          status: "success",
          input: {
            variables: { secret: "resolved-variable-canary" },
          },
          output: "{\"success\":true}",
          outputs: { success: true },
        },
      },
    }

    const sanitized = sanitizeWorkflowRunSnapshot(snapshot)
    const raw = JSON.stringify(sanitized)

    expect(sanitized.definition?.nodes[0]?.config).toEqual({
      title: "[redacted]",
      body: "[redacted]",
      variables: [],
    })
    expect(sanitized.nodeResults["notify-1"]?.input).toEqual({ variables: {} })
    expect(raw).not.toContain("private-body-canary")
    expect(raw).not.toContain("private-title-canary")
    expect(raw).not.toContain("resolved-variable-canary")
  })

  it("does not persist JSON Repair text, bindings, or resolved variable values", () => {
    const snapshot: WorkflowRunSnapshot = {
      runId: "run-1",
      workflowId: "workflow-json-repair",
      version: "v1",
      startedAt: 1,
      status: "completed",
      params: {},
      definition: {
        id: "workflow-json-repair",
        name: "JSON Repair workflow",
        version: "v1",
        createdAt: 1,
        updatedAt: 1,
        layoutDirection: "horizontal" as const,
        params: [],
        nodes: [
          {
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
          },
        ],
        edges: [],
      },
      nodeResults: {
        "repair-1": {
          nodeId: "repair-1",
          status: "success",
          input: {
            variables: { secret: "resolved-variable-canary" },
            prompt: "private-json-canary resolved-variable-canary",
          },
          output: "{\"ok\":true}",
          outputs: { json: "{\"ok\":true}" },
        },
      },
    }

    const sanitized = sanitizeWorkflowRunSnapshot(snapshot)
    const raw = JSON.stringify(sanitized)

    expect(sanitized.definition?.nodes[0]?.config).toEqual({
      text: "[redacted]",
      variables: [],
    })
    expect(sanitized.nodeResults["repair-1"]?.input).toEqual({ variables: {} })
    expect(raw).not.toContain("private-json-canary")
    expect(raw).not.toContain("binding-value-canary")
    expect(raw).not.toContain("resolved-variable-canary")
    expect(raw).toContain("{\\\"ok\\\":true}")
  })
})

import { describe, expect, it, vi } from "vitest"

import type { WorkflowDefinition } from "../../../../src/types/workflow"
import { validateWorkflow } from "../workflow-validator"
import "../../../../workflow-nodes/register.main"
import { defaultCodexNodeConfig } from "../../../../workflow-nodes/codex/schema"
import { defaultClaudeCodeNodeConfig } from "../../../../workflow-nodes/claude-code/schema"

const logger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

vi.mock("electron", () => ({ app: { getPath: () => "/tmp", getAppPath: () => "/tmp" } }))
vi.mock("../../log-store", () => ({
  createMainLogger: () => logger,
}))

describe("validateWorkflow", () => {
  it("rejects disconnected nodes as validation errors", () => {
    const result = validateWorkflow(definitionWithDisconnectedNode())

    expect(result.valid).toBe(false)
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "disconnected_node",
        nodeId: "orphan",
        message: '节点 "Orphan" 未连接',
      }),
    ]))
    expect(result.warnings).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "disconnected_node" }),
    ]))
  })

  it("requires a project for codex nodes when workflow default is missing", () => {
    const result = validateWorkflow(definitionWithCodexNode())

    expect(result.valid).toBe(false)
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "invalid_config",
        nodeId: "codex-1",
        field: "defaultProjectId",
        details: expect.objectContaining({
          missingField: "defaultProjectId",
          nodeField: "projectId",
        }),
      }),
    ]))
    expect(result.errors).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "defaultProviderId" }),
      expect.objectContaining({ field: "defaultModelTier" }),
    ]))
  })

  it("accepts codex nodes with workflow default project and without provider/model defaults", () => {
    const result = validateWorkflow(definitionWithCodexNode({
      defaultProjectId: "project-1",
    }))

    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
  })

  it("requires a project for claude code nodes when workflow default is missing", () => {
    const result = validateWorkflow(definitionWithClaudeCodeNode())

    expect(result.valid).toBe(false)
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "invalid_config",
        nodeId: "claude-code-1",
        field: "defaultProjectId",
        details: expect.objectContaining({
          missingField: "defaultProjectId",
          nodeField: "projectId",
        }),
      }),
    ]))
    expect(result.errors).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "defaultProviderId" }),
      expect.objectContaining({ field: "defaultModelTier" }),
    ]))
  })

  it("accepts claude code nodes with workflow default project and without provider/model defaults", () => {
    const result = validateWorkflow(definitionWithClaudeCodeNode({
      defaultProjectId: "project-1",
    }))

    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
  })

  it("rejects unsafe workflow node ids", () => {
    const result = validateWorkflow(definitionWithCodexNode({
      defaultProjectId: "project-1",
      nodes: [
        { ...codexNode(), id: "../codex" },
        endNode(),
      ],
      edges: [{ id: "edge-1", from: "../codex", to: "end" }],
    }))

    expect(result.valid).toBe(false)
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "invalid_config",
        nodeId: "../codex",
        message: expect.stringContaining("节点 ID"),
      }),
    ]))
  })

  it("requires a workflow default project for script nodes", () => {
    const result = validateWorkflow(definitionWithScriptNode())

    expect(result.valid).toBe(false)
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "invalid_config",
        nodeId: "script-1",
        field: "defaultProjectId",
        details: expect.objectContaining({
          missingField: "defaultProjectId",
          nodeField: "projectId",
        }),
      }),
    ]))
  })

  it("accepts script nodes with workflow default project", () => {
    const result = validateWorkflow(definitionWithScriptNode({
      defaultProjectId: "project-1",
    }))

    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
  })

  it("rejects template syntax in script content because bindings use environment variables", () => {
    const result = validateWorkflow(definitionWithScriptNode({
      defaultProjectId: "project-1",
      params: [{ name: "input_file", type: "file", default: null }],
      nodes: [
        {
          id: "script-1",
          name: "Script",
          type: "script",
          position: { x: 0, y: 0 },
          config: {
            shell: "posix",
            script: "printf '%s\\n' '{{input_file}}'",
            variables: [{ name: "input_file", source: { type: "param", param: "input_file" } }],
          },
        },
        endNode(),
      ],
    }))

    expect(result.valid).toBe(false)
    expect(result.errors).toContainEqual(expect.objectContaining({
      nodeId: "script-1",
      field: "script",
      message: expect.stringContaining("环境变量语法"),
    }))
  })

  it("accepts resource bindings in script environment variable syntax", () => {
    const result = validateWorkflow(definitionWithScriptNode({
      defaultProjectId: "project-1",
      params: [{ name: "input_files", type: "file", default: null, allowMultiple: true }],
      nodes: [
        {
          id: "script-1",
          name: "Script",
          type: "script",
          position: { x: 0, y: 0 },
          config: {
            shell: "posix",
            script: "printf '%s\\n' \"$input_files\"",
            variables: [{ name: "input_files", source: { type: "param", param: "input_files" } }],
          },
        },
        endNode(),
      ],
    }))

    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
  })

  it("rejects workflow_call resource bindings with mismatched cardinality", () => {
    const result = validateWorkflow(definitionWithWorkflowCall({
      name: "input_files",
      type: "file",
      default: null,
      allowMultiple: true,
    }), {
      availableWorkflowIds: ["child"],
      workflowParamsById: new Map([["child", [
        { name: "input_file", type: "file", default: null },
      ]]]),
    })

    expect(result.valid).toBe(false)
    expect(result.errors).toContainEqual(expect.objectContaining({
      nodeId: "call",
      field: "paramBindings",
      message: expect.stringContaining("资源类型或多选设置不一致"),
    }))
  })

  it("rejects workflow_call resource bindings with mismatched resource types", () => {
    const result = validateWorkflow(definitionWithWorkflowCall({
      name: "input_file",
      type: "directory",
      default: null,
    }), {
      availableWorkflowIds: ["child"],
      workflowParamsById: new Map([["child", [
        { name: "input_file", type: "file", default: null },
      ]]]),
    })

    expect(result.valid).toBe(false)
    expect(result.errors).toContainEqual(expect.objectContaining({
      nodeId: "call",
      field: "paramBindings",
      message: expect.stringContaining("资源类型或多选设置不一致"),
    }))
  })

  it("accepts workflow_call resource bindings with matching type and cardinality", () => {
    const result = validateWorkflow(definitionWithWorkflowCall({
      name: "input_files",
      type: "file",
      default: null,
      allowMultiple: true,
    }), {
      availableWorkflowIds: ["child"],
      workflowParamsById: new Map([["child", [
        { name: "input_file", type: "file", default: null, allowMultiple: true },
      ]]]),
    })

    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
  })

  it("accepts legacy static value bindings for single-resource child params", () => {
    const result = validateWorkflow(definitionWithWorkflowCall({
      name: "input_file",
      type: "file",
      default: null,
    }, {
      paramBindings: {
        input_file: { mode: "value", source: { type: "static", value: "/tmp/input.txt" } },
      },
    }), {
      availableWorkflowIds: ["child"],
      workflowParamsById: new Map([["child", [
        { name: "input_file", type: "file", default: null },
      ]]]),
    })

    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
  })

  it("rejects string value bindings for multi-resource child params", () => {
    const result = validateWorkflow(definitionWithWorkflowCall({
      name: "input_files",
      type: "file",
      default: null,
      allowMultiple: true,
    }, {
      paramBindings: {
        input_file: { mode: "value", source: { type: "node_output", node: "prepare" } },
      },
    }), {
      availableWorkflowIds: ["child"],
      workflowParamsById: new Map([["child", [
        { name: "input_file", type: "file", default: null, allowMultiple: true },
      ]]]),
    })

    expect(result.valid).toBe(false)
    expect(result.errors).toContainEqual(expect.objectContaining({
      nodeId: "call",
      field: "paramBindings",
      message: expect.stringContaining("不能绑定 node_output 字符串来源"),
    }))
  })

  it("rejects paramTemplates for multi-resource child params", () => {
    const result = validateWorkflow(definitionWithWorkflowCall({
      name: "input_files",
      type: "file",
      default: null,
      allowMultiple: true,
    }, {
      variables: [{ name: "files", source: { type: "static", value: "[]" } }],
      paramTemplates: { input_file: "{{files}}" },
      paramBindings: {},
    }), {
      availableWorkflowIds: ["child"],
      workflowParamsById: new Map([["child", [
        { name: "input_file", type: "file", default: null, allowMultiple: true },
      ]]]),
    })

    expect(result.valid).toBe(false)
    expect(result.errors).toContainEqual(expect.objectContaining({
      nodeId: "call",
      field: "paramTemplates",
      message: expect.stringContaining("多选资源参数「input_file」不能使用 paramTemplates"),
    }))
  })

  it("accepts paramTemplates for legacy single-resource child params", () => {
    const result = validateWorkflow(definitionWithWorkflowCall({
      name: "input_file",
      type: "file",
      default: null,
    }, {
      variables: [{ name: "file", source: { type: "static", value: "/tmp/input.txt" } }],
      paramTemplates: { input_file: "{{file}}" },
      paramBindings: {},
    }), {
      availableWorkflowIds: ["child"],
      workflowParamsById: new Map([["child", [
        { name: "input_file", type: "file", default: null },
      ]]]),
    })

    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
  })

  it("rejects unbound template variables in workflow_call paramBindings", () => {
    const result = validateWorkflow(definitionWithWorkflowCall({
      name: "parent_topic",
      type: "text",
      default: null,
    }, {
      paramBindings: {
        topic: { mode: "template", template: "{{missing}}" },
      },
    }), {
      availableWorkflowIds: ["child"],
      workflowParamsById: new Map([["child", [
        { name: "topic", type: "text", default: null },
      ]]]),
    })

    expect(result.valid).toBe(false)
    expect(result.errors).toContainEqual(expect.objectContaining({
      nodeId: "call",
      field: "paramBindings",
      message: expect.stringContaining("模板变量「missing」未绑定"),
    }))
  })

  it("accepts bound template variables in workflow_call paramBindings", () => {
    const result = validateWorkflow(definitionWithWorkflowCall({
      name: "parent_topic",
      type: "text",
      default: null,
    }, {
      variables: [{ name: "topic", source: { type: "param", param: "parent_topic" } }],
      paramBindings: {
        topic: { mode: "template", template: "{{topic}}" },
      },
    }), {
      availableWorkflowIds: ["child"],
      workflowParamsById: new Map([["child", [
        { name: "topic", type: "text", default: null },
      ]]]),
    })

    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
  })

  it.each([
    { name: "topic", type: "text" as const, default: null },
    { name: "limit", type: "number" as const, default: null },
    { name: "format", type: "option" as const, default: null, options: ["json"] },
    { name: "input_file", type: "file" as const, default: null },
    { name: "input_directories", type: "directory" as const, default: null, allowMultiple: true },
  ])("rejects workflow_call missing required child param $name", (childParam) => {
    const result = validateWorkflow(definitionWithWorkflowCall({
      name: "parent_value",
      type: "text",
      default: null,
    }, {
      paramTemplates: {},
      paramBindings: {},
    }), {
      availableWorkflowIds: ["child"],
      workflowParamsById: new Map([["child", [childParam]]]),
    })

    expect(result.valid).toBe(false)
    expect(result.errors).toContainEqual(expect.objectContaining({
      nodeId: "call",
      field: "paramBindings",
      message: expect.stringContaining(`必填参数「${childParam.name}」未配置`),
    }))
  })

  it("accepts workflow_call child params with defaults without mappings", () => {
    const result = validateWorkflow(definitionWithWorkflowCall({
      name: "parent_value",
      type: "text",
      default: null,
    }, {
      paramTemplates: {},
      paramBindings: {},
    }), {
      availableWorkflowIds: ["child"],
      workflowParamsById: new Map([["child", [{
        name: "input_files",
        type: "file",
        allowMultiple: true,
        default: [{ kind: "local_path", entryType: "file", path: "/tmp/input.txt" }],
      }]]]),
    })

    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
  })

  it("rejects blank workflow_call templates for required child params", () => {
    const result = validateWorkflow(definitionWithWorkflowCall({
      name: "parent_value",
      type: "text",
      default: null,
    }, {
      paramTemplates: { topic: "   " },
      paramBindings: {},
    }), {
      availableWorkflowIds: ["child"],
      workflowParamsById: new Map([["child", [{ name: "topic", type: "text", default: null }]]]),
    })

    expect(result.valid).toBe(false)
    expect(result.errors).toContainEqual(expect.objectContaining({
      nodeId: "call",
      field: "paramBindings",
      message: expect.stringContaining("必填参数「topic」未配置"),
    }))
  })

  it("rejects script nodes that inherit a stale workflow default project", () => {
    const result = validateWorkflow(definitionWithScriptNode({
      defaultProjectId: "deleted-default-project",
    }), { configuredProjectIds: ["project-1"] })

    expect(result.valid).toBe(false)
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        nodeId: "script-1",
        field: "defaultProjectId",
        message: expect.stringContaining("deleted-default-project"),
      }),
    ]))
  })

  it("checks template placeholders inside codex prompts", () => {
    const result = validateWorkflow(definitionWithCodexNode({
      nodes: [
        codexNode({ prompt: "Use {{missingVar}}" }),
        endNode(),
      ],
    }))

    expect(result.valid).toBe(false)
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "invalid_config",
        nodeId: "codex-1",
        message: expect.stringContaining("模板变量「missingVar」未绑定"),
      }),
    ]))
  })

  it("checks template placeholders inside codex working directories", () => {
    const result = validateWorkflow(definitionWithCodexNode({
      defaultProjectId: "project-1",
      nodes: [
        codexNode({
          prompt: "Run codex",
          workingDirectory: "/Users/liyang/worktrees/{{missingDir}}",
        }),
        endNode(),
      ],
    }))

    expect(result.valid).toBe(false)
    expect(result.errors).toContainEqual(expect.objectContaining({
      nodeId: "codex-1",
      type: "invalid_config",
      message: expect.stringContaining("missingDir"),
    }))
  })

  it("rejects codex nodes with stale configured project references", () => {
    const result = validateWorkflow(definitionWithCodexNode({
      defaultProjectId: "project-1",
      nodes: [
        codexNode({
          prompt: "Run codex",
          projectId: "deleted-project",
        }),
        endNode(),
      ],
    }), { configuredProjectIds: ["project-1"] })

    expect(result.valid).toBe(false)
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        nodeId: "codex-1",
        field: "projectId",
        message: expect.stringContaining("deleted-project"),
      }),
    ]))
  })

  it("rejects codex nodes that inherit a stale workflow default project", () => {
    const result = validateWorkflow(definitionWithCodexNode({
      defaultProjectId: "deleted-default-project",
    }), { configuredProjectIds: ["project-1"] })

    expect(result.valid).toBe(false)
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        nodeId: "codex-1",
        field: "defaultProjectId",
        message: expect.stringContaining("deleted-default-project"),
      }),
    ]))
  })

  it("checks template placeholders inside codex advanced paths", () => {
    const result = validateWorkflow(definitionWithCodexNode({
      defaultProjectId: "project-1",
      nodes: [
        codexNode({
          prompt: "Run codex",
          additionalWritableDirs: ["/Users/liyang/worktrees/{{missingWritableDir}}"],
          images: ["/Users/liyang/screenshots/{{missingImage}}.png"],
        }),
        endNode(),
      ],
    }))

    expect(result.valid).toBe(false)
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        nodeId: "codex-1",
        type: "invalid_config",
        message: expect.stringContaining("模板变量「missingWritableDir」未绑定"),
      }),
      expect.objectContaining({
        nodeId: "codex-1",
        type: "invalid_config",
        message: expect.stringContaining("模板变量「missingImage」未绑定"),
      }),
    ]))
  })

  it("checks template placeholders inside claude code prompts and paths", () => {
    const result = validateWorkflow(definitionWithClaudeCodeNode({
      defaultProjectId: "project-1",
      nodes: [
        claudeCodeNode({
          prompt: "Use {{missingVar}}",
          workingDirectory: "/Users/liyang/worktrees/{{missingDir}}",
          settingsPath: "/Users/liyang/settings/{{missingSettings}}.json",
          mcpConfigPath: "/Users/liyang/mcp/{{missingMcp}}.json",
          additionalDirectories: ["/Users/liyang/worktrees/{{missingExtra}}"],
        }),
        endNode(),
      ],
    }))

    expect(result.valid).toBe(false)
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        nodeId: "claude-code-1",
        type: "invalid_config",
        message: expect.stringContaining("模板变量「missingVar」未绑定"),
      }),
      expect.objectContaining({
        nodeId: "claude-code-1",
        type: "invalid_config",
        message: expect.stringContaining("模板变量「missingDir」未绑定"),
      }),
      expect.objectContaining({
        nodeId: "claude-code-1",
        type: "invalid_config",
        message: expect.stringContaining("模板变量「missingSettings」未绑定"),
      }),
      expect.objectContaining({
        nodeId: "claude-code-1",
        type: "invalid_config",
        message: expect.stringContaining("模板变量「missingMcp」未绑定"),
      }),
      expect.objectContaining({
        nodeId: "claude-code-1",
        type: "invalid_config",
        message: expect.stringContaining("模板变量「missingExtra」未绑定"),
      }),
    ]))
  })

  it("rejects claude code nodes with stale configured project references", () => {
    const result = validateWorkflow(definitionWithClaudeCodeNode({
      defaultProjectId: "project-1",
      nodes: [
        claudeCodeNode({
          prompt: "Run Claude Code",
          projectId: "deleted-project",
        }),
        endNode(),
      ],
    }), { configuredProjectIds: ["project-1"] })

    expect(result.valid).toBe(false)
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        nodeId: "claude-code-1",
        field: "projectId",
        message: expect.stringContaining("deleted-project"),
      }),
    ]))
  })

  it("rejects claude code nodes that inherit a stale workflow default project", () => {
    const result = validateWorkflow(definitionWithClaudeCodeNode({
      defaultProjectId: "deleted-default-project",
    }), { configuredProjectIds: ["project-1"] })

    expect(result.valid).toBe(false)
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        nodeId: "claude-code-1",
        field: "defaultProjectId",
        message: expect.stringContaining("deleted-default-project"),
      }),
    ]))
  })

  it("rejects prompt nodes with stale configured project references", () => {
    const result = validateWorkflow(definitionWithPromptNode({
      defaultProjectId: "project-1",
      nodes: [
        promptNode({ projectId: "deleted-project" }),
        endNode(),
      ],
    }), { configuredProjectIds: ["project-1"] })

    expect(result.valid).toBe(false)
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        nodeId: "prompt-1",
        field: "projectId",
        message: expect.stringContaining("deleted-project"),
      }),
    ]))
  })

  it("rejects switch nodes that inherit a stale workflow default project", () => {
    const result = validateWorkflow(definitionWithSwitchNode({
      defaultProjectId: "deleted-default-project",
    }), { configuredProjectIds: ["project-1"] })

    expect(result.valid).toBe(false)
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        nodeId: "switch-1",
        field: "defaultProjectId",
        message: expect.stringContaining("deleted-default-project"),
      }),
    ]))
  })

  it("rejects http request nodes with empty URLs before save", () => {
    const result = validateWorkflow(definitionWithHttpRequestNode({ url: "   " }))

    expect(result.valid).toBe(false)
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "invalid_config",
        nodeId: "http-1",
        message: "节点「HTTP」的 URL 不能为空",
      }),
    ]))
  })
})

function definitionWithDisconnectedNode(): WorkflowDefinition {
  return {
    id: "workflow-1",
    name: "Workflow",
    version: "v1",
    createdAt: 0,
    updatedAt: 0,
    params: [],
    nodes: [
      {
        id: "script-1",
        name: "Run",
        type: "script",
        position: { x: 0, y: 0 },
        config: { shell: "posix", script: "echo ok", variables: [] },
      },
      {
        id: "end",
        name: "End",
        type: "end",
        position: { x: 200, y: 0 },
        config: { outputType: "text", template: "", variables: [] },
      },
      {
        id: "orphan",
        name: "Orphan",
        type: "script",
        position: { x: 0, y: 120 },
        config: { shell: "posix", script: "echo skipped", variables: [] },
      },
    ],
    edges: [{ id: "edge-1", from: "script-1", to: "end" }],
  }
}

function definitionWithScriptNode(overrides: Partial<WorkflowDefinition> = {}): WorkflowDefinition {
  return {
    id: "workflow-script",
    name: "Workflow",
    version: "v1",
    createdAt: 0,
    updatedAt: 0,
    params: [],
    nodes: [
      {
        id: "script-1",
        name: "Script",
        type: "script",
        position: { x: 0, y: 0 },
        config: { shell: "posix", script: "pwd", variables: [] },
      },
      endNode(),
    ],
    edges: [{ id: "edge-1", from: "script-1", to: "end" }],
    ...overrides,
  }
}

function definitionWithWorkflowCall(
  parentParam: WorkflowDefinition["params"][number],
  configPatch: Record<string, unknown> = {},
): WorkflowDefinition {
  return {
    id: "parent",
    name: "Parent",
    version: "v1",
    createdAt: 0,
    updatedAt: 0,
    params: [parentParam],
    nodes: [
      {
        id: "call",
        name: "Call",
        type: "workflow_call",
        position: { x: 0, y: 0 },
        config: {
          workflowId: "child",
          variables: [],
          paramTemplates: {},
          paramBindings: {
            input_file: { mode: "value", source: { type: "param", param: parentParam.name } },
          },
          ...configPatch,
        },
      },
      endNode(),
    ],
    edges: [{ id: "edge-1", from: "call", to: "end" }],
  }
}

function definitionWithCodexNode(overrides: Partial<WorkflowDefinition> = {}): WorkflowDefinition {
  return {
    id: "workflow-codex",
    name: "Workflow",
    version: "v1",
    createdAt: 0,
    updatedAt: 0,
    params: [],
    nodes: [
      codexNode(),
      endNode(),
    ],
    edges: [{ id: "edge-1", from: "codex-1", to: "end" }],
    ...overrides,
  }
}

function definitionWithClaudeCodeNode(overrides: Partial<WorkflowDefinition> = {}): WorkflowDefinition {
  return {
    id: "workflow-claude-code",
    name: "Workflow",
    version: "v1",
    createdAt: 0,
    updatedAt: 0,
    params: [],
    nodes: [
      claudeCodeNode(),
      endNode(),
    ],
    edges: [{ id: "edge-1", from: "claude-code-1", to: "end" }],
    ...overrides,
  }
}

function definitionWithPromptNode(overrides: Partial<WorkflowDefinition> = {}): WorkflowDefinition {
  return {
    id: "workflow-prompt",
    name: "Workflow",
    version: "v1",
    createdAt: 0,
    updatedAt: 0,
    params: [],
    defaultProviderId: "provider-1",
    defaultModelTier: "sonnet",
    nodes: [
      promptNode(),
      endNode(),
    ],
    edges: [{ id: "edge-1", from: "prompt-1", to: "end" }],
    ...overrides,
  }
}

function definitionWithSwitchNode(overrides: Partial<WorkflowDefinition> = {}): WorkflowDefinition {
  return {
    id: "workflow-switch",
    name: "Workflow",
    version: "v1",
    createdAt: 0,
    updatedAt: 0,
    params: [],
    defaultProviderId: "provider-1",
    defaultModelTier: "sonnet",
    nodes: [
      switchNode(),
      endNode(),
    ],
    edges: [{ id: "edge-1", from: "switch-1", to: "end", branch: "done" }],
    ...overrides,
  }
}

function definitionWithHttpRequestNode(config: { readonly url: string }): WorkflowDefinition {
  return {
    id: "workflow-http",
    name: "Workflow",
    version: "v1",
    createdAt: 0,
    updatedAt: 0,
    params: [],
    nodes: [
      {
        id: "http-1",
        name: "HTTP",
        type: "http_request",
        position: { x: 0, y: 0 },
        config: { method: "GET", url: config.url, bodyType: "none", variables: [] },
      },
      endNode(),
    ],
    edges: [{ id: "edge-1", from: "http-1", to: "end" }],
  }
}

function promptNode(config: Record<string, unknown> = {}): WorkflowDefinition["nodes"][number] {
  return {
    id: "prompt-1",
    name: "Prompt",
    type: "prompt",
    position: { x: 0, y: 0 },
    config: {
      variables: [],
      prompt: "Run prompt",
      ...config,
    },
  }
}

function switchNode(config: Record<string, unknown> = {}): WorkflowDefinition["nodes"][number] {
  return {
    id: "switch-1",
    name: "Switch",
    type: "switch",
    position: { x: 0, y: 0 },
    config: {
      variables: [],
      prompt: "Choose branch",
      branches: [{ id: "done", label: "Done" }],
      defaultBranch: "done",
      ...config,
    },
  }
}

function codexNode(config: Partial<typeof defaultCodexNodeConfig> = {}): WorkflowDefinition["nodes"][number] {
  return {
    id: "codex-1",
    name: "Codex",
    type: "codex",
    position: { x: 0, y: 0 },
    config: {
      ...defaultCodexNodeConfig,
      prompt: "Run codex",
      ...config,
    },
  }
}

function claudeCodeNode(config: Partial<typeof defaultClaudeCodeNodeConfig> = {}): WorkflowDefinition["nodes"][number] {
  return {
    id: "claude-code-1",
    name: "Claude Code",
    type: "claude_code",
    position: { x: 0, y: 0 },
    config: {
      ...defaultClaudeCodeNodeConfig,
      prompt: "Run Claude Code",
      ...config,
    },
  }
}

function endNode(): WorkflowDefinition["nodes"][number] {
  return {
    id: "end",
    name: "End",
    type: "end",
    position: { x: 200, y: 0 },
    config: { outputType: "text", template: "", variables: [] },
  }
}

import { describe, expect, it } from "vitest"
import type { WorkflowDefinition } from "../../../../src/types/workflow"
import "../../../../workflow-nodes/register.renderer"
import { collectWorkflowShareDependencies, workflowShareGitRemoteFingerprint } from "../workflow-share-dependency-collector"
import { stableWorkflowReference } from "../workflow-share-graph"

function workflow(): WorkflowDefinition {
  return {
    id: "root",
    name: "Root",
    version: "v-root",
    meta: { schemaVersion: "2.0.0" },
    createdAt: 1,
    updatedAt: 2,
    defaultProviderId: "provider-a",
    defaultModelTier: "default",
    defaultProjectId: "project-a",
    params: [{
      name: "source",
      type: "file",
      default: { kind: "local_path", entryType: "file", path: "/tmp/source.json" },
    }],
    nodes: [
      { id: "prompt", name: "Prompt", type: "prompt", position: { x: 0, y: 0 }, config: { providerId: "provider-a", modelTier: "sonnet", projectId: "project-b", prompt: "p", variables: [] } },
      { id: "switch", name: "Switch", type: "switch", position: { x: 100, y: 0 }, config: { prompt: "s", variables: [], branches: [{ id: "yes", label: "Yes" }] } },
      { id: "script", name: "Script", type: "script", position: { x: 200, y: 0 }, config: { script: "echo ok", shell: "posix", env: { TOKEN: "secret" }, variables: [] } },
      { id: "http", name: "HTTP", type: "http_request", position: { x: 300, y: 0 }, config: { method: "GET", url: "https://example.com", headers: { Authorization: "secret" }, bodyType: "none", variables: [] } },
      { id: "call", name: "Call", type: "workflow_call", position: { x: 400, y: 0 }, config: { workflowId: "child", variables: [], paramTemplates: {}, paramBindings: {} } },
      { id: "end", name: "End", type: "end", position: { x: 500, y: 0 }, config: { outputType: "text", template: "", variables: [] } },
    ],
    edges: [],
  }
}

describe("collectWorkflowShareDependencies", () => {
  it("groups the same resolved model across tiers and collects declared dependencies", () => {
    const definition = workflow()
    const workflowRef = stableWorkflowReference(definition.id)
    const result = collectWorkflowShareDependencies({
      workflows: [definition],
      workflowRefs: new Map([[definition.id, workflowRef]]),
      providers: [{
        id: "provider-a",
        name: "Provider A",
        model: "same-model",
        sonnetModel: "same-model",
      }],
      projects: [
        { id: "project-a", name: "Project A" },
        { id: "project-b", name: "Project B" },
      ],
    })

    expect(result.references.models).toHaveLength(1)
    expect(result.references.models[0].sourceModelName).toBe("same-model")
    expect(result.references.models[0].occurrences).toHaveLength(3)
    expect(result.references.projects.map((ref) => ref.sourceProjectName).sort()).toEqual(["Project A", "Project B"])
    expect(JSON.stringify(result.references)).not.toContain("project-a")
    expect(JSON.stringify(result.references)).not.toContain("provider-a")
    expect(result.references.resources).toEqual([
      expect.objectContaining({ kind: "local_path", entryType: "file", displayName: "source.json" }),
    ])
    expect(result.references.resources[0].sourceIdentity).toMatch(/^local-resource_[a-f0-9]{20}$/)
    expect(JSON.stringify(result.references.resources)).not.toContain("/tmp/source.json")
    expect(result.references.runtimes).toEqual([
      expect.objectContaining({ id: "runtime.shell.posix", minVersion: "1.0.0" }),
    ])
    expect(result.requiredCapabilities.map((capability) => capability.id)).toEqual(expect.arrayContaining([
      "workflow.node.end",
      "workflow.node.http_request",
      "workflow.node.prompt",
      "workflow.node.script",
      "workflow.node.switch",
      "workflow.node.workflow_call",
      "runtime.shell.posix",
    ]))
    expect(result.childWorkflowIds).toEqual(["child"])
    expect(result.risks.sensitiveLocations).toEqual(expect.arrayContaining([
      expect.objectContaining({ nodeId: "script", fieldPath: ["env", "TOKEN"] }),
      expect.objectContaining({ nodeId: "http", fieldPath: ["headers", "Authorization"] }),
    ]))
    expect(JSON.stringify(result.risks)).not.toContain("secret")
    expect(result.blockers).toEqual([])
  })

  it("blocks inline parameter files without copying their bytes into diagnostics", () => {
    const definition = workflow()
    definition.params[0].default = {
      kind: "inline_file",
      entryType: "file",
      name: "secret.txt",
      base64: "c2VjcmV0",
    }
    const workflowRef = stableWorkflowReference(definition.id)
    const result = collectWorkflowShareDependencies({
      workflows: [definition],
      workflowRefs: new Map([[definition.id, workflowRef]]),
      providers: [],
    })

    expect(result.blockers).toEqual(["Root / 参数 source：内联文件不能导出"])
    expect(JSON.stringify(result)).not.toContain("c2VjcmV0")
  })

  it("ignores resource paths derived from runtime variables", () => {
    const definition = workflow()
    definition.params[0].default = null
    definition.nodes = [1, 2, 3].map((index) => ({
      id: `docx-${index}`,
      name: `DOCX ${index}`,
      type: "document_template_docx_generate",
      position: { x: index * 100, y: 0 },
      config: {
        templatePath: "{{runDir}}/_data/模板.docx",
        outputPath: `{{runDir}}/方案${index}.docx`,
        dataSource: "dataPath",
        dataPath: "{{jsonPath}}",
        overwrite: false,
        variables: [
          { name: "runDir", source: { type: "node_output", node: "prepare" } },
          { name: "jsonPath", source: { type: "node_output", node: `write-${index}` } },
        ],
      },
    }))
    const workflowRef = stableWorkflowReference(definition.id)
    const result = collectWorkflowShareDependencies({
      workflows: [definition],
      workflowRefs: new Map([[definition.id, workflowRef]]),
      providers: [],
    })

    expect(result.references.resources).toEqual([])
  })

  it("keeps literal and static-variable resource paths as external dependencies", () => {
    const definition = workflow()
    definition.params[0].default = null
    definition.nodes = [{
      id: "docx",
      name: "DOCX",
      type: "document_template_docx_generate",
      position: { x: 0, y: 0 },
      config: {
        templatePath: "/tmp/template.docx",
        outputPath: "/tmp/{{name}}.docx",
        dataSource: "dataPath",
        dataPath: "{{jsonPath}}",
        overwrite: false,
        variables: [
          { name: "name", source: { type: "static", value: "output" } },
          { name: "jsonPath", source: { type: "static", value: "/tmp/data.json" } },
        ],
      },
    }]
    const workflowRef = stableWorkflowReference(definition.id)
    const result = collectWorkflowShareDependencies({
      workflows: [definition],
      workflowRefs: new Map([[definition.id, workflowRef]]),
      providers: [],
    })

    expect(result.references.resources.map((resource) => resource.displayName).sort()).toEqual([
      "template.docx",
      "{{jsonPath}}",
      "{{name}}.docx",
    ])
  })

  it("declares document extraction as one read-only local file dependency", () => {
    const definition = workflow()
    definition.params = []
    definition.defaultProviderId = undefined
    definition.defaultProjectId = undefined
    definition.nodes = [{
      id: "extract",
      name: "提取文档",
      type: "text_extract",
      position: { x: 0, y: 0 },
      config: { filePath: "/tmp/report.pdf", variables: [] },
    }]
    const workflowRef = stableWorkflowReference(definition.id)
    const result = collectWorkflowShareDependencies({
      workflows: [definition],
      workflowRefs: new Map([[definition.id, workflowRef]]),
      providers: [],
    })

    expect(result.requiredCapabilities).toContainEqual({
      id: "app.text_extractor.document.extract",
      minVersion: "1.0.0",
      installSourceId: "synapse.builtin",
    })
    expect(result.references.resources).toEqual([
      expect.objectContaining({
        kind: "local_path",
        entryType: "file",
        cardinality: "one",
        access: "read",
        displayName: "report.pdf",
      }),
    ])
    expect(result.references.models).toEqual([])
    expect(result.references.projects).toEqual([])
    expect(result.references.runtimes).toEqual([])
    expect(result.risks.sensitiveLocations).toEqual([])
  })

  it("does not export a document path supplied by a runtime binding", () => {
    const definition = workflow()
    definition.params[0].default = null
    definition.nodes = [{
      id: "extract",
      name: "提取文档",
      type: "text_extract",
      position: { x: 0, y: 0 },
      config: {
        filePath: "{{source}}",
        variables: [{ name: "source", source: { type: "param", param: "source" } }],
      },
    }]
    const workflowRef = stableWorkflowReference(definition.id)
    const result = collectWorkflowShareDependencies({
      workflows: [definition],
      workflowRefs: new Map([[definition.id, workflowRef]]),
      providers: [],
    })

    expect(result.references.resources).toEqual([])
  })

  it("declares default-app opening as one read-only file dependency and a shell risk", () => {
    const definition = workflow()
    definition.params = []
    definition.defaultProviderId = undefined
    definition.defaultProjectId = undefined
    definition.nodes = [{
      id: "open",
      name: "默认应用打开",
      type: "file_opener_file_open",
      position: { x: 0, y: 0 },
      config: { path: "/tmp/report.html", variables: [] },
    }]
    const workflowRef = stableWorkflowReference(definition.id)
    const result = collectWorkflowShareDependencies({
      workflows: [definition],
      workflowRefs: new Map([[definition.id, workflowRef]]),
      providers: [],
    })

    expect(result.requiredCapabilities).toContainEqual({
      id: "app.file_opener.file.open",
      minVersion: "1.0.0",
      installSourceId: "synapse.builtin",
    })
    expect(result.references.resources).toEqual([
      expect.objectContaining({
        kind: "local_path",
        entryType: "file",
        cardinality: "one",
        access: "read",
        displayName: "report.html",
      }),
    ])
    expect(result.risks.highRiskLocations).toEqual([
      expect.objectContaining({ nodeType: "file_opener_file_open", code: "shell.execute" }),
    ])
    expect(result.risks.portabilityWarnings).toEqual([])
  })

  it("does not export an open-file path supplied by a runtime binding", () => {
    const definition = workflow()
    definition.params[0].default = null
    definition.nodes = [{
      id: "open",
      name: "默认应用打开",
      type: "file_opener_file_open",
      position: { x: 0, y: 0 },
      config: {
        path: "{{source}}",
        variables: [{ name: "source", source: { type: "param", param: "source" } }],
      },
    }]
    const workflowRef = stableWorkflowReference(definition.id)
    const result = collectWorkflowShareDependencies({
      workflows: [definition],
      workflowRefs: new Map([[definition.id, workflowRef]]),
      providers: [],
    })

    expect(result.references.resources).toEqual([])
  })

  it("matches equivalent Git remotes without exposing credentials or URLs", () => {
    const https = workflowShareGitRemoteFingerprint("https://token:secret@github.com/Team/Repo.git?token=secret")
    const ssh = workflowShareGitRemoteFingerprint("git@github.com:Team/Repo.git")

    expect(https).toBe(ssh)
    expect(https).toMatch(/^[a-f0-9]{64}$/)
    expect(https).not.toContain("secret")
  })
})

import { mkdtemp, mkdir, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import type { WorkflowDefinition } from "../../../src/types/workflow"
import { normalizeWorkflowRunParams } from "../workflow/workflow-param-normalizer"

function def(params: WorkflowDefinition["params"]): WorkflowDefinition {
  return {
    id: "wf",
    name: "Workflow",
    version: "v1",
    createdAt: 0,
    updatedAt: 0,
    params,
    nodes: [{ id: "end", name: "结束", type: "end", position: { x: 0, y: 0 }, config: { outputType: "text", template: "", variables: [] } }],
    edges: [],
  }
}

describe("normalizeWorkflowRunParams", () => {
  it("normalizes file and directory shorthand strings to local path refs", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-workflow-params-"))
    const filePath = path.join(root, "input.txt")
    const dirPath = path.join(root, "workspace")
    await writeFile(filePath, "hello")
    await mkdir(dirPath)

    const result = await normalizeWorkflowRunParams(def([
      { name: "input_file", type: "file", default: null },
      { name: "workspace_dir", type: "directory", default: null },
    ]), {
      input_file: filePath,
      workspace_dir: dirPath,
    })

    expect(result.errors).toEqual([])
    expect(result.params.input_file).toEqual({ kind: "local_path", entryType: "file", path: filePath })
    expect(result.params.workspace_dir).toEqual({ kind: "local_path", entryType: "directory", path: dirPath })
    expect(result.stringValues).toEqual({ input_file: filePath, workspace_dir: dirPath })
  })

  it("rejects a directory passed to a file parameter", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-workflow-params-"))
    const result = await normalizeWorkflowRunParams(def([{ name: "input", type: "file", default: null }]), { input: root })

    expect(result.errors[0]).toMatchObject({ type: "invalid_config", message: "参数「input」必须是文件" })
  })

  it("returns unsupported errors for unresolved remote resource refs", async () => {
    const result = await normalizeWorkflowRunParams(def([{ name: "input", type: "file", default: null }]), {
      input: { kind: "drive", entryType: "file", id: "drive-file-1" },
    })

    expect(result.errors[0]).toMatchObject({ type: "invalid_config", message: "参数「input」暂不支持 drive 文件引用" })
  })

  it("keeps explicit empty text values and applies defaults", async () => {
    const result = await normalizeWorkflowRunParams(def([
      { name: "text", type: "text", default: "fallback" },
      { name: "count", type: "number", default: 2 },
    ]), { text: "" })

    expect(result.errors).toEqual([])
    expect(result.params).toEqual({ text: "", count: 2 })
    expect(result.stringValues).toEqual({ text: "", count: "2" })
  })
})

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

  it("normalizes ordered multi-file inputs and serializes paths as JSON", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-workflow-params-"))
    const firstPath = path.join(root, "first.txt")
    const secondPath = path.join(root, "second.txt")
    await writeFile(firstPath, "first")
    await writeFile(secondPath, "second")

    const result = await normalizeWorkflowRunParams(def([
      { name: "inputs", type: "file", default: null, allowMultiple: true },
    ]), {
      inputs: [
        firstPath,
        { kind: "local_path", entryType: "file", path: secondPath },
      ],
    })

    expect(result.errors).toEqual([])
    expect(result.params.inputs).toEqual([
      { kind: "local_path", entryType: "file", path: firstPath },
      { kind: "local_path", entryType: "file", path: secondPath },
    ])
    expect(result.stringValues.inputs).toBe(JSON.stringify([firstPath, secondPath]))
    expect(result.snapshotParams.inputs).toEqual(result.params.inputs)
  })

  it("treats an empty multi-resource array as missing", async () => {
    const result = await normalizeWorkflowRunParams(def([
      { name: "inputs", type: "file", default: null, allowMultiple: true },
    ]), { inputs: [] })

    expect(result.errors[0]).toMatchObject({ type: "missing_param", message: "缺少必填参数「inputs」" })
  })

  it("rejects duplicate resources in a multi-resource parameter", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-workflow-params-"))
    const filePath = path.join(root, "input.txt")
    await writeFile(filePath, "hello")

    const result = await normalizeWorkflowRunParams(def([
      { name: "inputs", type: "file", default: null, allowMultiple: true },
    ]), { inputs: [filePath, { kind: "local_path", entryType: "file", path: filePath }] })

    expect(result.errors[0]).toMatchObject({ type: "invalid_config", message: "参数「inputs」第 2 项与前面的资源重复" })
  })

  it("rejects mismatched single and multi resource shapes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-workflow-params-"))
    const filePath = path.join(root, "input.txt")
    await writeFile(filePath, "hello")

    const multiResult = await normalizeWorkflowRunParams(def([
      { name: "inputs", type: "file", default: null, allowMultiple: true },
    ]), { inputs: filePath })
    const singleResult = await normalizeWorkflowRunParams(def([
      { name: "input", type: "file", default: null },
    ]), { input: [filePath] })

    expect(multiResult.errors[0]).toMatchObject({ type: "invalid_config", message: "参数「inputs」必须是资源引用数组" })
    expect(singleResult.errors[0]).toMatchObject({ type: "invalid_config", message: "参数「input」必须是单个资源引用" })
  })

  it("rejects the whole multi-resource value when one item is invalid", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-workflow-params-"))
    const filePath = path.join(root, "input.txt")
    await writeFile(filePath, "hello")

    const result = await normalizeWorkflowRunParams(def([
      { name: "inputs", type: "file", default: null, allowMultiple: true },
    ]), { inputs: [filePath, root] })

    expect(result.errors[0]).toMatchObject({ type: "invalid_config", message: "参数「inputs」第 2 项必须是文件" })
    expect(result.params.inputs).toEqual([filePath, root])
  })

  it("normalizes option params as strings and rejects values outside a closed option list", async () => {
    const result = await normalizeWorkflowRunParams(def([
      { name: "report_type", type: "option", default: "周报", options: ["日报", "周报"], allowCustomOption: false },
    ]), { report_type: "月报" })

    expect(result.errors[0]).toMatchObject({
      type: "invalid_config",
      message: "参数「report_type」必须是预设选项之一",
    })
  })

  it("accepts option params from the configured list", async () => {
    const result = await normalizeWorkflowRunParams(def([
      { name: "report_type", type: "option", default: null, options: ["日报", "周报"], allowCustomOption: false },
    ]), { report_type: "周报" })

    expect(result.errors).toEqual([])
    expect(result.params).toEqual({ report_type: "周报" })
    expect(result.stringValues).toEqual({ report_type: "周报" })
    expect(result.snapshotParams).toEqual({ report_type: "周报" })
  })

  it("rejects non-string option values", async () => {
    const result = await normalizeWorkflowRunParams(def([
      { name: "report_type", type: "option", default: null, options: ["日报", "周报"], allowCustomOption: false },
    ]), { report_type: 1 })

    expect(result.errors[0]).toMatchObject({
      type: "invalid_config",
      message: "参数「report_type」必须是文本",
    })
  })

  it("trims option values before storing normalized params", async () => {
    const result = await normalizeWorkflowRunParams(def([
      { name: "report_type", type: "option", default: null, options: ["日报", "周报"], allowCustomOption: false },
    ]), { report_type: " 周报 " })

    expect(result.errors).toEqual([])
    expect(result.params).toEqual({ report_type: "周报" })
    expect(result.stringValues).toEqual({ report_type: "周报" })
    expect(result.snapshotParams).toEqual({ report_type: "周报" })
  })

  it("trims option lists and ignores empty options for closed option params", async () => {
    const result = await normalizeWorkflowRunParams(def([
      { name: "report_type", type: "option", default: null, options: ["", " 周报 "], allowCustomOption: false },
    ]), { report_type: "周报" })

    expect(result.errors).toEqual([])
    expect(result.params.report_type).toBe("周报")
  })

  it("treats omitted allowCustomOption as a closed option list", async () => {
    const result = await normalizeWorkflowRunParams(def([
      { name: "report_type", type: "option", default: null, options: ["日报"] },
    ]), { report_type: "周报" })

    expect(result.errors[0]).toMatchObject({
      type: "invalid_config",
      message: "参数「report_type」必须是预设选项之一",
    })
  })

  it("treats non-array option metadata as no valid closed options", async () => {
    const result = await normalizeWorkflowRunParams(def([
      { name: "report_type", type: "option", default: null, options: "日报" as unknown as string[], allowCustomOption: false },
    ]), { report_type: "日报" })

    expect(result.errors[0]).toMatchObject({
      type: "invalid_config",
      message: "参数「report_type」必须是预设选项之一",
    })
  })

  it("ignores non-string option entries during closed option normalization", async () => {
    const result = await normalizeWorkflowRunParams(def([
      { name: "report_type", type: "option", default: null, options: [1] as unknown as string[], allowCustomOption: false },
    ]), { report_type: "日报" })

    expect(result.errors[0]).toMatchObject({
      type: "invalid_config",
      message: "参数「report_type」必须是预设选项之一",
    })
  })

  it("accepts custom option values when enabled", async () => {
    const result = await normalizeWorkflowRunParams(def([
      { name: "report_type", type: "option", default: null, options: ["日报"], allowCustomOption: true },
    ]), { report_type: "季度复盘" })

    expect(result.errors).toEqual([])
    expect(result.params.report_type).toBe("季度复盘")
  })

  it("rejects empty custom option values for required params", async () => {
    const result = await normalizeWorkflowRunParams(def([
      { name: "report_type", type: "option", default: null, options: ["日报"], allowCustomOption: true },
    ]), { report_type: "" })

    expect(result.errors[0]).toMatchObject({
      type: "missing_param",
      message: "缺少必填参数「report_type」",
    })
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

import PizZip from "pizzip"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import type { WorkflowDefinition } from "../../../../src/types/workflow"
import {
  SYNAPSE_WORKFLOW_PACKAGE_FORMAT,
  SYNAPSE_WORKFLOW_PACKAGE_FORMAT_VERSION,
  type WorkflowShareManifestV4,
} from "../../../../src/types/workflow-package"
import { buildWorkflowShareArchive, readWorkflowShareArchive } from "../workflow-share-package-v4"
import { stableWorkflowReference } from "../workflow-share-graph"

const workflow: WorkflowDefinition = {
  id: "root",
  name: "Root",
  version: "v-root",
  meta: { schemaVersion: "2.0.0" },
  createdAt: 1,
  updatedAt: 2,
  layoutDirection: "vertical" as const,
  params: [],
  nodes: [{ id: "end", name: "End", type: "end", position: { x: 15, y: 35 }, config: { outputType: "text", template: "", variables: [] } }],
  edges: [],
}
const workflowRef = stableWorkflowReference(workflow.id)

function manifest(): Omit<WorkflowShareManifestV4, "files"> {
  return {
    format: SYNAPSE_WORKFLOW_PACKAGE_FORMAT,
    formatVersion: SYNAPSE_WORKFLOW_PACKAGE_FORMAT_VERSION,
    artifactId: "artifact-1",
    lineageId: "lineage-1",
    exportedAt: "2026-07-19T00:00:00.000Z",
    createdWith: { appVersion: "0.2.349", platform: "darwin" },
    entrypoints: [workflowRef],
    workflows: [{
      ref: workflowRef,
      sourceWorkflowId: workflow.id,
      sourceRevision: workflow.version,
      schemaVersion: workflow.meta!.schemaVersion,
      path: `workflows/${workflowRef}.json`,
    }],
    references: { models: [], projects: [], resources: [], environments: [], runtimes: [] },
    requiredCapabilities: [{ id: "workflow.node.end", minVersion: "1.0.0" }],
    risks: { sensitiveLocations: [], highRiskLocations: [], portabilityWarnings: [], excludedAutomationCount: 0 },
  }
}

describe("workflow share package V4", () => {
  it("keeps the committed V4 fixture readable", () => {
    const fixtureRoot = new URL("../__fixtures__/workflow-package/4.0.0/", import.meta.url)
    const fixtureManifest = readFileSync(new URL("manifest.json", fixtureRoot))
    const fixtureWorkflowPath = "workflows/workflow_c705423de65cc67b4578.json"
    const fixtureWorkflow = readFileSync(new URL(fixtureWorkflowPath, fixtureRoot))
    const zip = new PizZip()
    zip.file("manifest.json", fixtureManifest, { binary: true, createFolders: false })
    zip.file(fixtureWorkflowPath, fixtureWorkflow, { binary: true, createFolders: false })

    const parsed = readWorkflowShareArchive(zip.generate({ type: "nodebuffer", compression: "DEFLATE" }))

    expect(parsed.manifest.formatVersion).toBe("4.0.0")
    expect(parsed.workflows.workflow_c705423de65cc67b4578.name).toBe("V4 Fixture")
  })

  it("round-trips a strict single-file ZIP package", () => {
    const built = buildWorkflowShareArchive({ manifest: manifest(), workflows: new Map([[workflowRef, workflow]]) })
    const read = readWorkflowShareArchive(built.bytes)

    expect(read.manifest).toEqual(built.manifest)
    expect(read.workflows[workflowRef]).toEqual(workflow)
    expect(read.workflows[workflowRef]).toMatchObject({
      layoutDirection: "vertical",
      nodes: [expect.objectContaining({ position: { x: 15, y: 35 } })],
    })
    expect(read.manifest.files).toEqual([
      expect.objectContaining({ path: `workflows/${workflowRef}.json`, mediaType: "application/vnd.synapse.workflow+json" }),
    ])
  })

  it("accepts a compatible higher minor and rejects another major", () => {
    const higherMinor = buildWorkflowShareArchive({
      manifest: { ...manifest(), formatVersion: "4.2.0" },
      workflows: new Map([[workflowRef, workflow]]),
    })
    expect(readWorkflowShareArchive(higherMinor.bytes).manifest.formatVersion).toBe("4.2.0")

    expect(() => buildWorkflowShareArchive({
      manifest: { ...manifest(), formatVersion: "5.0.0" },
      workflows: new Map([[workflowRef, workflow]]),
    })).toThrow("不支持工作流分享包版本")
  })

  it("rejects undeclared entries and manifest or workflow mismatches", () => {
    const built = buildWorkflowShareArchive({ manifest: manifest(), workflows: new Map([[workflowRef, workflow]]) })
    const zip = new PizZip(built.bytes)
    zip.file("unexpected.txt", "unexpected", { createFolders: false })
    const withUnexpected = zip.generate({ type: "nodebuffer", compression: "DEFLATE" })
    expect(() => readWorkflowShareArchive(withUnexpected)).toThrow("未声明文件")

    const extraBytes = Buffer.from("extra")
    const manifestWithDeclaredExtra = {
      ...built.manifest,
      files: [...built.manifest.files, {
        path: "extra.txt",
        size: extraBytes.length,
        sha256: createHash("sha256").update(extraBytes).digest("hex"),
        mediaType: "text/plain",
      }],
    }
    const declaredExtraZip = new PizZip(built.bytes)
    declaredExtraZip.file("manifest.json", `${JSON.stringify(manifestWithDeclaredExtra)}\n`)
    declaredExtraZip.file("extra.txt", extraBytes)
    expect(() => readWorkflowShareArchive(declaredExtraZip.generate({ type: "nodebuffer", compression: "DEFLATE" })))
      .toThrow("只能包含工作流文档")

    expect(() => buildWorkflowShareArchive({
      manifest: {
        ...manifest(),
        workflows: [{ ...manifest().workflows[0], sourceRevision: "wrong" }],
      },
      workflows: new Map([[workflowRef, workflow]]),
    })).toThrow("身份或修订不一致")
  })
})

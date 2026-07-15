import { readFileSync } from "node:fs"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

const readFileMock = vi.hoisted(() => vi.fn())
vi.mock("node:fs/promises", async (importOriginal) => ({
  ...await importOriginal<typeof import("node:fs/promises")>(),
  readFile: readFileMock,
}))

import {
  listLegacyWorkflowSources,
  type LegacyWorkflowScanIssue,
} from "../workflow-migration-storage"

const roots: string[] = []

afterEach(async () => {
  readFileMock.mockReset()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("legacy workflow migration storage", () => {
  it("selects the newest numeric legacy version before older parseable files", async () => {
    const repositoryPath = await mkdtemp(path.join(os.tmpdir(), "workflow-legacy-order-"))
    roots.push(repositoryPath)
    const workflowDirectory = path.join(repositoryPath, "workflows", "legacy-workflow")
    await mkdir(workflowDirectory, { recursive: true })
    await writeFile(path.join(workflowDirectory, "v_9.json"), JSON.stringify({
      id: "legacy-workflow",
      name: "older",
    }), "utf8")
    await writeFile(path.join(workflowDirectory, "v_10.json"), JSON.stringify({
      id: "legacy-workflow",
      name: "newer",
    }), "utf8")
    readFileMock.mockImplementation(async (filePath) => readFileSync(filePath))

    await expect(listLegacyWorkflowSources([repositoryPath])).resolves.toEqual([
      expect.objectContaining({
        workflowId: "legacy-workflow",
        fileName: "v_10.json",
        document: expect.objectContaining({ name: "newer" }),
      }),
    ])
  })

  it("isolates a version file read error and continues scanning", async () => {
    const repositoryPath = await mkdtemp(path.join(os.tmpdir(), "workflow-legacy-scan-"))
    roots.push(repositoryPath)
    const workflowDirectory = path.join(repositoryPath, "workflows", "legacy-workflow")
    await mkdir(workflowDirectory, { recursive: true })
    await writeFile(path.join(workflowDirectory, "v_100.json"), "{}", "utf8")
    const readError = Object.assign(new Error("denied"), { code: "EACCES" })
    readFileMock.mockRejectedValueOnce(readError)
    const issues: LegacyWorkflowScanIssue[] = []

    await expect(listLegacyWorkflowSources([repositoryPath], (issue) => issues.push(issue)))
      .resolves.toEqual([])
    expect(issues).toEqual([
      expect.objectContaining({
        operation: "read_version",
        workflowId: "legacy-workflow",
        error: readError,
      }),
    ])
  })
})

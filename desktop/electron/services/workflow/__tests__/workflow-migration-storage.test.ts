import { readFileSync } from "node:fs"
import type { Dir } from "node:fs"
import { mkdir, mkdtemp, rm, symlink, truncate, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const readFileMock = vi.hoisted(() => vi.fn())
const opendirMock = vi.hoisted(() => vi.fn())
vi.mock("node:fs/promises", async (importOriginal) => ({
  ...await importOriginal<typeof import("node:fs/promises")>(),
  opendir: opendirMock,
  readFile: readFileMock,
}))

import {
  listLegacyWorkflowSources,
  type LegacyWorkflowScanIssue,
} from "../workflow-migration-storage"

const roots: string[] = []

beforeEach(async () => {
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises")
  opendirMock.mockImplementation((...args: unknown[]) => (
    actual.opendir as unknown as (...openArgs: unknown[]) => unknown
  )(...args))
})

afterEach(async () => {
  opendirMock.mockReset()
  readFileMock.mockReset()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("legacy workflow migration storage", () => {
  it("preserves both validation and directory handle close failures", async () => {
    const repositoryPath = await mkdtemp(path.join(os.tmpdir(), "workflow-legacy-close-failure-"))
    roots.push(repositoryPath)
    const workflowsRoot = path.join(repositoryPath, "workflows")
    await mkdir(workflowsRoot, { recursive: true })
    const closeError = new Error("directory close failed")
    opendirMock.mockImplementationOnce(async (directoryPath: string) => {
      await rm(directoryPath, { recursive: true, force: true })
      await mkdir(directoryPath, { recursive: true })
      return {
        close: vi.fn().mockRejectedValue(closeError),
      } as unknown as Dir
    })
    const issues: LegacyWorkflowScanIssue[] = []

    await expect(listLegacyWorkflowSources([repositoryPath], (issue) => issues.push(issue)))
      .resolves.toEqual([])

    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ operation: "read_repository" })
    expect(issues[0]?.error).toBeInstanceOf(AggregateError)
    expect((issues[0]?.error as AggregateError).errors).toEqual([
      expect.any(Error),
      closeError,
    ])
  })

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

  it("skips an oversized newest version without reading it and recovers an older version", async () => {
    const repositoryPath = await mkdtemp(path.join(os.tmpdir(), "workflow-legacy-size-"))
    roots.push(repositoryPath)
    const workflowDirectory = path.join(repositoryPath, "workflows", "legacy-workflow")
    await mkdir(workflowDirectory, { recursive: true })
    const oversizedPath = path.join(workflowDirectory, "v_200.json")
    await writeFile(path.join(workflowDirectory, "v_100.json"), JSON.stringify({
      id: "legacy-workflow",
      name: "valid",
    }), "utf8")
    await writeFile(oversizedPath, "{}", "utf8")
    await truncate(oversizedPath, 65)
    readFileMock.mockImplementation(async (filePath) => readFileSync(filePath))
    const issues: LegacyWorkflowScanIssue[] = []

    await expect(listLegacyWorkflowSources(
      [repositoryPath],
      (issue) => issues.push(issue),
      { maxVersionBytes: 64 },
    )).resolves.toEqual([
      expect.objectContaining({ fileName: "v_100.json", workflowId: "legacy-workflow" }),
    ])
    expect(readFileMock).not.toHaveBeenCalledWith(oversizedPath)
    expect(issues).toContainEqual(expect.objectContaining({
      operation: "scan_limit",
      limit: "version_bytes",
      workflowId: "legacy-workflow",
    }))
  })

  it("checks only the configured number of newest versions", async () => {
    const repositoryPath = await mkdtemp(path.join(os.tmpdir(), "workflow-legacy-versions-"))
    roots.push(repositoryPath)
    const workflowDirectory = path.join(repositoryPath, "workflows", "legacy-workflow")
    await mkdir(workflowDirectory, { recursive: true })
    await writeFile(path.join(workflowDirectory, "v_100.json"), JSON.stringify({
      id: "legacy-workflow",
    }), "utf8")
    await writeFile(path.join(workflowDirectory, "v_200.json"), "{", "utf8")
    readFileMock.mockImplementation(async (filePath) => readFileSync(filePath))
    const issues: LegacyWorkflowScanIssue[] = []

    await expect(listLegacyWorkflowSources(
      [repositoryPath],
      (issue) => issues.push(issue),
      { maxVersionsPerWorkflow: 1 },
    )).resolves.toEqual([])
    expect(readFileMock).toHaveBeenCalledTimes(1)
    expect(issues).toContainEqual(expect.objectContaining({
      operation: "scan_limit",
      limit: "versions",
      workflowId: "legacy-workflow",
    }))
  })

  it("stops scanning after the total time budget is reached", async () => {
    const repositoryPath = await mkdtemp(path.join(os.tmpdir(), "workflow-legacy-time-"))
    roots.push(repositoryPath)
    const workflowDirectory = path.join(repositoryPath, "workflows", "legacy-workflow")
    await mkdir(workflowDirectory, { recursive: true })
    await writeFile(path.join(workflowDirectory, "v_100.json"), "{}", "utf8")
    const issues: LegacyWorkflowScanIssue[] = []
    let now = 0

    await expect(listLegacyWorkflowSources(
      [repositoryPath],
      (issue) => issues.push(issue),
      { timeoutMs: 2, now: () => now++ },
    )).resolves.toEqual([])
    expect(readFileMock).not.toHaveBeenCalled()
    expect(issues).toContainEqual(expect.objectContaining({
      operation: "scan_limit",
      limit: "timeout",
    }))
  })

  it("does not enter workflow directories after the directory budget is reached", async () => {
    const repositoryPath = await mkdtemp(path.join(os.tmpdir(), "workflow-legacy-directories-"))
    roots.push(repositoryPath)
    const workflowDirectory = path.join(repositoryPath, "workflows", "legacy-workflow")
    await mkdir(workflowDirectory, { recursive: true })
    await writeFile(path.join(workflowDirectory, "v_100.json"), "{}", "utf8")
    const issues: LegacyWorkflowScanIssue[] = []

    await expect(listLegacyWorkflowSources(
      [repositoryPath],
      (issue) => issues.push(issue),
      { maxWorkflowDirectories: 0 },
    )).resolves.toEqual([])
    expect(readFileMock).not.toHaveBeenCalled()
    expect(issues).toContainEqual(expect.objectContaining({
      operation: "scan_limit",
      limit: "workflow_directories",
      observed: 1,
      maximum: 0,
    }))
  })

  it("scans only the configured number of repositories", async () => {
    const firstRepositoryPath = await mkdtemp(path.join(os.tmpdir(), "workflow-legacy-repository-first-"))
    const secondRepositoryPath = await mkdtemp(path.join(os.tmpdir(), "workflow-legacy-repository-second-"))
    roots.push(firstRepositoryPath, secondRepositoryPath)
    for (const [repositoryPath, workflowId] of [
      [firstRepositoryPath, "first-workflow"],
      [secondRepositoryPath, "second-workflow"],
    ] as const) {
      const workflowDirectory = path.join(repositoryPath, "workflows", workflowId)
      await mkdir(workflowDirectory, { recursive: true })
      await writeFile(path.join(workflowDirectory, "v_100.json"), JSON.stringify({ id: workflowId }), "utf8")
    }
    readFileMock.mockImplementation(async (filePath) => readFileSync(filePath))
    const issues: LegacyWorkflowScanIssue[] = []

    await expect(listLegacyWorkflowSources(
      [firstRepositoryPath, secondRepositoryPath],
      (issue) => issues.push(issue),
      { maxRepositories: 1 },
    )).resolves.toEqual([
      expect.objectContaining({ workflowId: "first-workflow" }),
    ])
    expect(issues).toContainEqual(expect.objectContaining({
      operation: "scan_limit",
      limit: "repositories",
      observed: 2,
      maximum: 1,
    }))
  })

  it("rejects a symlinked workflows root without reading external versions", async () => {
    const repositoryPath = await mkdtemp(path.join(os.tmpdir(), "workflow-legacy-linked-root-"))
    const externalPath = await mkdtemp(path.join(os.tmpdir(), "workflow-legacy-external-root-"))
    roots.push(repositoryPath, externalPath)
    const externalWorkflowDirectory = path.join(externalPath, "legacy-workflow")
    await mkdir(externalWorkflowDirectory, { recursive: true })
    await writeFile(
      path.join(externalWorkflowDirectory, "v_100.json"),
      JSON.stringify({ id: "external-workflow" }),
      "utf8",
    )
    await symlink(externalPath, path.join(repositoryPath, "workflows"), "dir")
    const issues: LegacyWorkflowScanIssue[] = []

    await expect(listLegacyWorkflowSources([repositoryPath], (issue) => issues.push(issue)))
      .resolves.toEqual([])

    expect(readFileMock).not.toHaveBeenCalled()
    expect(issues).toEqual([
      expect.objectContaining({
        operation: "read_repository",
        error: expect.objectContaining({
          message: "Legacy workflows root must be a stable regular directory inside its configured repository.",
        }),
      }),
    ])
    expect(issues.map((issue) => issue.error.message).join(" ")).not.toContain(externalPath)
  })

  it("uses a configured repository symlink target as the fixed scan boundary", async () => {
    const realRepositoryPath = await mkdtemp(path.join(os.tmpdir(), "workflow-legacy-real-repository-"))
    const configuredParent = await mkdtemp(path.join(os.tmpdir(), "workflow-legacy-linked-repository-"))
    roots.push(realRepositoryPath, configuredParent)
    const configuredRepositoryPath = path.join(configuredParent, "repository")
    const workflowDirectory = path.join(realRepositoryPath, "workflows", "legacy-workflow")
    await mkdir(workflowDirectory, { recursive: true })
    await writeFile(
      path.join(workflowDirectory, "v_100.json"),
      JSON.stringify({ id: "legacy-workflow" }),
      "utf8",
    )
    await symlink(realRepositoryPath, configuredRepositoryPath, "dir")
    readFileMock.mockImplementation(async (filePath) => readFileSync(filePath))

    await expect(listLegacyWorkflowSources([configuredRepositoryPath])).resolves.toEqual([
      expect.objectContaining({
        repositoryPath: configuredRepositoryPath,
        workflowId: "legacy-workflow",
      }),
    ])
  })

  it("rejects a symlinked workflow directory without reading external versions", async () => {
    const repositoryPath = await mkdtemp(path.join(os.tmpdir(), "workflow-legacy-linked-directory-"))
    const externalPath = await mkdtemp(path.join(os.tmpdir(), "workflow-legacy-external-directory-"))
    roots.push(repositoryPath, externalPath)
    const workflowsRoot = path.join(repositoryPath, "workflows")
    await mkdir(workflowsRoot, { recursive: true })
    await writeFile(
      path.join(externalPath, "v_100.json"),
      JSON.stringify({ id: "external-workflow" }),
      "utf8",
    )
    await symlink(externalPath, path.join(workflowsRoot, "linked-workflow"), "dir")
    const issues: LegacyWorkflowScanIssue[] = []

    await expect(listLegacyWorkflowSources([repositoryPath], (issue) => issues.push(issue)))
      .resolves.toEqual([])

    expect(readFileMock).not.toHaveBeenCalled()
    expect(issues).toEqual([
      expect.objectContaining({
        operation: "read_workflow",
        workflowId: "linked-workflow",
        error: expect.objectContaining({
          message: "Legacy workflow directory cannot be a symbolic link.",
        }),
      }),
    ])
  })
})

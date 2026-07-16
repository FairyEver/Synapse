import { createHash } from "node:crypto"
import type { Dir, Stats } from "node:fs"
import { lstat, opendir, readFile, realpath } from "node:fs/promises"
import path from "node:path"
import {
  WORKFLOW_LEGACY_RECOVERY_MAX_DIRECTORIES,
  WORKFLOW_LEGACY_RECOVERY_MAX_REPOSITORIES,
  WORKFLOW_LEGACY_RECOVERY_MAX_VERSION_BYTES,
  WORKFLOW_LEGACY_RECOVERY_MAX_VERSIONS_PER_WORKFLOW,
  WORKFLOW_LEGACY_RECOVERY_TIMEOUT_MS,
} from "../../../config"
import {
  fileExists,
  readBinaryFile,
  writeBinaryFileAtomic,
} from "../../runtime/data-repo"
import { isPathInside } from "../fs-utils"
import {
  WORKFLOW_LEGACY_BASELINE_VERSION,
  WORKFLOW_SCHEMA_VERSION,
} from "./workflow-document-migration"

const legacyVersionFileCollator = new Intl.Collator("en", {
  numeric: true,
  sensitivity: "base",
})

export interface LegacyWorkflowSource {
  readonly repositoryPath: string
  readonly workflowId: string
  readonly fileName: string
  readonly digest: string
  readonly document: Record<string, unknown>
}

export interface LegacyWorkflowScanIssue {
  readonly operation: "read_repository" | "read_workflow" | "read_version" | "parse_version" | "scan_limit"
  readonly workflowId?: string
  readonly limit?: "repositories" | "workflow_directories" | "versions" | "version_bytes" | "timeout"
  readonly observed?: number
  readonly maximum?: number
  readonly error: Error
}

export interface LegacyWorkflowScanOptions {
  readonly maxRepositories?: number
  readonly maxWorkflowDirectories?: number
  readonly maxVersionsPerWorkflow?: number
  readonly maxVersionBytes?: number
  readonly timeoutMs?: number
  readonly now?: () => number
}

interface TrustedLegacyDirectory {
  readonly directoryPath: string
  readonly realPath: string
  readonly stats: Stats
}

export class WorkflowMigrationStorage {
  private readonly backupPromises = new Map<string, Promise<void>>()

  constructor(
    private readonly currentStoreFilePath?: string,
    private readonly backupDirectoryPath?: string,
  ) {}

  async ensureCurrentStoreBackup(): Promise<Uint8Array | null | undefined> {
    if (!this.currentStoreFilePath || !this.backupDirectoryPath) return undefined
    const source = await readBinaryFile(this.currentStoreFilePath)
    if (source === null) return null
    const sourceDigest = digestBytes(source)
    let backup = this.backupPromises.get(sourceDigest)
    if (!backup) {
      backup = this.createAndVerifyBackup(source, sourceDigest)
      this.backupPromises.set(sourceDigest, backup)
    }
    await backup
    return source
  }

  private async createAndVerifyBackup(source: Uint8Array, sourceDigest: string): Promise<void> {
    const sourcePath = this.currentStoreFilePath!
    const backupName = [
      "workflows",
      WORKFLOW_LEGACY_BASELINE_VERSION,
      "to",
      WORKFLOW_SCHEMA_VERSION,
      sourceDigest,
      "json",
    ].join(".")
    const target = path.join(this.backupDirectoryPath!, backupName)
    if (!(await fileExists(target))) {
      await writeBinaryFileAtomic(target, source)
    }

    const backup = await readBinaryFile(target)
    if (backup === null || backup.byteLength !== source.byteLength || digestBytes(backup) !== sourceDigest) {
      throw new Error("Workflow migration backup verification failed.")
    }
    const current = await readBinaryFile(sourcePath)
    if (current === null || current.byteLength !== source.byteLength || digestBytes(current) !== sourceDigest) {
      throw new Error("Workflow store changed while preparing its migration backup.")
    }
  }
}

export async function listLegacyWorkflowSources(
  repositoryPaths: readonly string[],
  onIssue?: (issue: LegacyWorkflowScanIssue) => void,
  options: LegacyWorkflowScanOptions = {},
): Promise<LegacyWorkflowSource[]> {
  const limits = resolveLegacyWorkflowScanOptions(options)
  const startedAt = limits.now()
  const deadline = startedAt + limits.timeoutMs
  const results: LegacyWorkflowSource[] = []
  const reportedLimits = new Set<string>()
  const reportLimit = (
    limit: NonNullable<LegacyWorkflowScanIssue["limit"]>,
    message: string,
    observed: number,
    maximum: number,
    workflowId?: string,
  ) => {
    const key = `${limit}:${workflowId ?? "global"}`
    if (reportedLimits.has(key)) return
    reportedLimits.add(key)
    onIssue?.({
      operation: "scan_limit",
      limit,
      workflowId,
      observed,
      maximum,
      error: new Error(message),
    })
  }
  const timedOut = () => {
    const now = limits.now()
    if (now < deadline) return false
    reportLimit(
      "timeout",
      "Legacy workflow recovery scan reached its time limit.",
      now - startedAt,
      limits.timeoutMs,
    )
    return true
  }
  const uniqueRepositoryPaths = [...new Set(repositoryPaths.filter(Boolean))]
  if (uniqueRepositoryPaths.length > limits.maxRepositories) {
    reportLimit(
      "repositories",
      "Legacy workflow recovery scan reached its repository limit.",
      uniqueRepositoryPaths.length,
      limits.maxRepositories,
    )
  }

  let scannedWorkflowDirectories = 0
  for (const repositoryPath of uniqueRepositoryPaths.slice(0, limits.maxRepositories)) {
    if (timedOut()) break
    let repositoryDirectory: TrustedLegacyDirectory
    try {
      const repositoryRealPath = await realpath(repositoryPath)
      repositoryDirectory = await inspectTrustedLegacyDirectory(
        repositoryRealPath,
        undefined,
        "Configured legacy workflow repository must be a stable regular directory.",
      )
    } catch (error) {
      if (errorCode(error) === "ENOENT") continue
      onIssue?.({ operation: "read_repository", error: normalizeError(error) })
      continue
    }
    const root = path.join(repositoryDirectory.realPath, "workflows")
    let workflowDirectories
    let workflowsDirectory: TrustedLegacyDirectory
    try {
      workflowsDirectory = await inspectTrustedLegacyDirectory(
        root,
        repositoryDirectory.realPath,
        "Legacy workflows root must be a stable regular directory inside its configured repository.",
      )
      workflowDirectories = await openTrustedLegacyDirectory(
        workflowsDirectory,
        repositoryDirectory.realPath,
      )
    } catch (error) {
      if (errorCode(error) === "ENOENT") continue
      onIssue?.({ operation: "read_repository", error: normalizeError(error) })
      continue
    }

    try {
      for await (const directory of workflowDirectories) {
        await assertTrustedLegacyDirectoryUnchanged(repositoryDirectory)
        await assertTrustedLegacyDirectoryUnchanged(workflowsDirectory, repositoryDirectory.realPath)
        if (directory.isSymbolicLink()) {
          onIssue?.({
            operation: "read_workflow",
            workflowId: directory.name,
            error: new Error("Legacy workflow directory cannot be a symbolic link."),
          })
          continue
        }
        if (!directory.isDirectory()) continue
        if (timedOut()) return results
        if (scannedWorkflowDirectories >= limits.maxWorkflowDirectories) {
          reportLimit(
            "workflow_directories",
            "Legacy workflow recovery scan reached its workflow directory limit.",
            scannedWorkflowDirectories + 1,
            limits.maxWorkflowDirectories,
          )
          return results
        }
        scannedWorkflowDirectories += 1
        const workflowDirectory = path.join(root, directory.name)
        let versionFiles
        let trustedWorkflowDirectory: TrustedLegacyDirectory
        try {
          trustedWorkflowDirectory = await inspectTrustedLegacyDirectory(
            workflowDirectory,
            workflowsDirectory.realPath,
            "Legacy workflow source must be a stable regular directory inside the workflows root.",
          )
          versionFiles = await listNewestLegacyVersionFiles(
            trustedWorkflowDirectory,
            limits.maxVersionsPerWorkflow,
            timedOut,
          )
        } catch (error) {
          if (errorCode(error) === "ENOENT") continue
          onIssue?.({
            operation: "read_workflow",
            workflowId: directory.name,
            error: normalizeError(error),
          })
          continue
        }
        if (versionFiles.timedOut) return results
        if (versionFiles.observed > limits.maxVersionsPerWorkflow) {
          reportLimit(
            "versions",
            "Legacy workflow recovery scan reached the version limit for a workflow.",
            versionFiles.observed,
            limits.maxVersionsPerWorkflow,
            directory.name,
          )
        }

        for (const fileName of versionFiles.files) {
          if (timedOut()) return results
          try {
            await assertTrustedLegacyDirectoryUnchanged(
              trustedWorkflowDirectory,
              workflowsDirectory.realPath,
            )
          } catch (error) {
            onIssue?.({
              operation: "read_workflow",
              workflowId: directory.name,
              error: normalizeError(error),
            })
            break
          }
          const versionPath = path.join(workflowDirectory, fileName)
          let bytes
          try {
            const fileStats = await lstat(versionPath)
            if (!fileStats.isFile()) {
              onIssue?.({
                operation: "read_version",
                workflowId: directory.name,
                error: new Error("Legacy workflow version is no longer a regular file."),
              })
              continue
            }
            if (fileStats.size > limits.maxVersionBytes) {
              reportLimit(
                "version_bytes",
                "Legacy workflow recovery skipped a version file that exceeded the size limit.",
                fileStats.size,
                limits.maxVersionBytes,
                directory.name,
              )
              continue
            }
            if (timedOut()) return results
            bytes = await readFile(versionPath)
            if (bytes.byteLength > limits.maxVersionBytes) {
              reportLimit(
                "version_bytes",
                "Legacy workflow recovery skipped a version file that exceeded the size limit.",
                bytes.byteLength,
                limits.maxVersionBytes,
                directory.name,
              )
              continue
            }
          } catch (error) {
            onIssue?.({
              operation: "read_version",
              workflowId: directory.name,
              error: normalizeError(error),
            })
            continue
          }
          try {
            const document = JSON.parse(bytes.toString("utf8")) as unknown
            if (!isRecord(document)) continue
            results.push({
              repositoryPath,
              workflowId: typeof document.id === "string" && document.id ? document.id : directory.name,
              fileName,
              digest: createHash("sha256").update(bytes).digest("hex"),
              document,
            })
            break
          } catch (error) {
            if (!(error instanceof SyntaxError)) throw error
            onIssue?.({
              operation: "parse_version",
              workflowId: directory.name,
              error,
            })
            // Older valid versions remain eligible when the newest file is partial/corrupt.
          }
        }
      }
    } catch (error) {
      onIssue?.({ operation: "read_repository", error: normalizeError(error) })
    }
  }
  return results
}

async function listNewestLegacyVersionFiles(
  workflowDirectory: TrustedLegacyDirectory,
  maximum: number,
  timedOut: () => boolean,
): Promise<{ readonly files: string[]; readonly observed: number; readonly timedOut: boolean }> {
  const directory = await openTrustedLegacyDirectory(workflowDirectory)
  const files: string[] = []
  let observed = 0
  for await (const entry of directory) {
    await assertTrustedLegacyDirectoryUnchanged(workflowDirectory)
    if (timedOut()) return { files, observed, timedOut: true }
    if (!entry.isFile() || !/^v_.+\.json$/i.test(entry.name)) continue
    observed += 1
    files.push(entry.name)
    files.sort(compareLegacyVersionFileNamesNewestFirst)
    if (files.length > maximum) files.pop()
  }
  return { files, observed, timedOut: false }
}

async function openTrustedLegacyDirectory(
  directory: TrustedLegacyDirectory,
  boundaryRealPath?: string,
): Promise<Dir> {
  const handle = await opendir(directory.directoryPath)
  try {
    await assertTrustedLegacyDirectoryUnchanged(directory, boundaryRealPath)
    return handle
  } catch (error) {
    try {
      await handle.close()
    } catch (closeError) {
      const validationError = normalizeError(error)
      throw new AggregateError(
        [validationError, normalizeError(closeError)],
        validationError.message,
        { cause: closeError },
      )
    }
    throw error
  }
}

async function inspectTrustedLegacyDirectory(
  directoryPath: string,
  boundaryRealPath: string | undefined,
  errorMessage: string,
): Promise<TrustedLegacyDirectory> {
  const stats = await lstat(directoryPath)
  if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error(errorMessage)
  const realPath = await realpath(directoryPath)
  if (boundaryRealPath && !isPathInside(boundaryRealPath, realPath)) throw new Error(errorMessage)
  const trusted = { directoryPath, realPath, stats }
  await assertTrustedLegacyDirectoryUnchanged(trusted, boundaryRealPath)
  return trusted
}

async function assertTrustedLegacyDirectoryUnchanged(
  directory: TrustedLegacyDirectory,
  boundaryRealPath?: string,
): Promise<void> {
  const [currentStats, currentRealPath] = await Promise.all([
    lstat(directory.directoryPath),
    realpath(directory.directoryPath),
  ])
  if (
    currentStats.isSymbolicLink()
    || !currentStats.isDirectory()
    || currentStats.dev !== directory.stats.dev
    || currentStats.ino !== directory.stats.ino
    || currentRealPath !== directory.realPath
    || (boundaryRealPath !== undefined && !isPathInside(boundaryRealPath, currentRealPath))
  ) {
    throw new Error("Legacy workflow recovery directory changed or escaped its configured repository.")
  }
}

function resolveLegacyWorkflowScanOptions(options: LegacyWorkflowScanOptions) {
  return {
    maxRepositories: options.maxRepositories ?? WORKFLOW_LEGACY_RECOVERY_MAX_REPOSITORIES,
    maxWorkflowDirectories: options.maxWorkflowDirectories ?? WORKFLOW_LEGACY_RECOVERY_MAX_DIRECTORIES,
    maxVersionsPerWorkflow: options.maxVersionsPerWorkflow ?? WORKFLOW_LEGACY_RECOVERY_MAX_VERSIONS_PER_WORKFLOW,
    maxVersionBytes: options.maxVersionBytes ?? WORKFLOW_LEGACY_RECOVERY_MAX_VERSION_BYTES,
    timeoutMs: options.timeoutMs ?? WORKFLOW_LEGACY_RECOVERY_TIMEOUT_MS,
    now: options.now ?? Date.now,
  }
}

function compareLegacyVersionFileNamesNewestFirst(left: string, right: string): number {
  const naturalOrder = legacyVersionFileCollator.compare(right, left)
  return naturalOrder || right.localeCompare(left)
}

function digestBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null
    ? (error as { code?: string }).code
    : undefined
}

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

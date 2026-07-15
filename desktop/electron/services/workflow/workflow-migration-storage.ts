import { createHash } from "node:crypto"
import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import {
  fileExists,
  readBinaryFile,
  writeBinaryFileAtomic,
} from "../../runtime/data-repo"
import {
  WORKFLOW_LEGACY_BASELINE_VERSION,
  WORKFLOW_SCHEMA_VERSION,
} from "./workflow-document-migration"

export interface LegacyWorkflowSource {
  readonly repositoryPath: string
  readonly workflowId: string
  readonly fileName: string
  readonly digest: string
  readonly document: Record<string, unknown>
}

export interface LegacyWorkflowScanIssue {
  readonly operation: "read_repository" | "read_workflow" | "read_version" | "parse_version"
  readonly workflowId?: string
  readonly error: Error
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
): Promise<LegacyWorkflowSource[]> {
  const results: LegacyWorkflowSource[] = []
  for (const repositoryPath of [...new Set(repositoryPaths.filter(Boolean))]) {
    const root = path.join(repositoryPath, "workflows")
    let workflowDirectories
    try {
      workflowDirectories = await readdir(root, { withFileTypes: true })
    } catch (error) {
      if (errorCode(error) === "ENOENT") continue
      onIssue?.({ operation: "read_repository", error: normalizeError(error) })
      continue
    }

    for (const directory of workflowDirectories) {
      if (!directory.isDirectory()) continue
      const workflowDirectory = path.join(root, directory.name)
      let files
      try {
        files = (await readdir(workflowDirectory, { withFileTypes: true }))
          .filter((entry) => entry.isFile() && /^v_.+\.json$/i.test(entry.name))
          .map((entry) => entry.name)
          .sort((left, right) => right.localeCompare(left))
      } catch (error) {
        if (errorCode(error) === "ENOENT") continue
        onIssue?.({
          operation: "read_workflow",
          workflowId: directory.name,
          error: normalizeError(error),
        })
        continue
      }

      for (const fileName of files) {
        let bytes
        try {
          bytes = await readFile(path.join(workflowDirectory, fileName))
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
  }
  return results
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

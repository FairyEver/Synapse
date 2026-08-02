import { randomUUID } from "node:crypto"
import { copyFile, mkdir, rename, rm } from "node:fs/promises"
import path from "node:path"
import { isPathInsideDirectory } from "../../src/lib/path-compare"
import { runGitCommand } from "./git-command"
import { pathExists } from "./fs-utils"
import { createMainLogger } from "./log-store"
import { withRepositoryCacheDatabase } from "./repository-cache-database"
import { toRepositoryGitPaths } from "./git-paths"

const logger = createMainLogger("service.content-write-transaction")

type ContentWriteRollbackAction =
  | { readonly kind: "remove-created"; readonly targetPath: string }
  | { readonly backupPath: string; readonly kind: "restore-file" | "restore-directory"; readonly targetPath: string }

type ContentWriteJournal = {
  readonly actions: ContentWriteRollbackAction[]
  readonly commitHash: string | null
  readonly createdAt: string
  readonly gitRootPath: string
  readonly headBefore: string
  readonly phase: "applying" | "committing" | "committed"
  readonly recoveryRootPath: string
  readonly transactionId: string
  readonly updatedAt: string
}

type ContentWriteTransaction = {
  readonly id: string | null
  finalize(): Promise<void>
  markCommitted(commitHash: string): Promise<void>
  markCommitting(): Promise<void>
  moveDirectoryToRecovery(targetPath: string): Promise<void>
  recordCreatedPath(targetPath: string): Promise<void>
  replaceFile(targetPath: string, stagedPath: string): Promise<void>
  rollback(): Promise<void>
}

const noopTransaction: ContentWriteTransaction = {
  id: null,
  finalize: async () => undefined,
  markCommitted: async () => undefined,
  markCommitting: async () => undefined,
  moveDirectoryToRecovery: async (targetPath) => {
    await rm(targetPath, { recursive: true, force: true })
  },
  recordCreatedPath: async () => undefined,
  replaceFile: async (_targetPath, stagedPath) => {
    await rename(stagedPath, _targetPath)
  },
  rollback: async () => undefined,
}

function assertManagedTarget(gitRootPath: string, targetPath: string): void {
  if (!isPathInsideDirectory(gitRootPath, targetPath, { resolvePath: path.resolve })) {
    throw new Error("内容事务路径越过了当前 Git 仓库边界。")
  }
}

function assertRecoveryPath(recoveryRootPath: string, backupPath: string): void {
  if (!isPathInsideDirectory(recoveryRootPath, backupPath, { resolvePath: path.resolve })) {
    throw new Error("内容事务恢复材料路径无效。")
  }
}

async function readHead(gitRootPath: string): Promise<string> {
  const result = await runGitCommand({
    args: ["rev-parse", "HEAD"],
    cwd: gitRootPath,
    fallbackMessage: "无法读取内容仓库当前提交。",
  })
  return result.stdout.trim()
}

async function resolveRecoveryBasePath(gitRootPath: string): Promise<string> {
  const result = await runGitCommand({
    args: ["rev-parse", "--git-path", "synapse/content-transactions"],
    cwd: gitRootPath,
    fallbackMessage: "无法准备内容恢复事务。",
  })
  const value = result.stdout.trim()
  return path.isAbsolute(value) ? value : path.resolve(gitRootPath, value)
}

function parseActions(value: unknown): ContentWriteRollbackAction[] {
  if (typeof value !== "string") throw new Error("内容恢复 journal 缺少操作记录。")
  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) throw new Error("内容恢复 journal 操作记录格式无效。")
    const actions = parsed.filter((action): action is ContentWriteRollbackAction => {
      if (!action || typeof action !== "object") return false
      const candidate = action as Record<string, unknown>
      if (candidate.kind === "remove-created") return typeof candidate.targetPath === "string"
      return (candidate.kind === "restore-file" || candidate.kind === "restore-directory")
        && typeof candidate.targetPath === "string"
        && typeof candidate.backupPath === "string"
    })
    if (actions.length !== parsed.length) throw new Error("内容恢复 journal 包含无效操作。")
    return actions
  } catch {
    throw new Error("内容恢复 journal 无法解析。")
  }
}

function mapJournal(row: Record<string, unknown>): ContentWriteJournal | null {
  if (
    typeof row.transaction_id !== "string"
    || typeof row.phase !== "string"
    || typeof row.git_root_path !== "string"
    || typeof row.recovery_root_path !== "string"
    || typeof row.head_before !== "string"
    || typeof row.created_at !== "string"
    || typeof row.updated_at !== "string"
  ) return null
  if (row.phase !== "applying" && row.phase !== "committing" && row.phase !== "committed") return null

  return {
    transactionId: row.transaction_id,
    phase: row.phase,
    gitRootPath: row.git_root_path,
    recoveryRootPath: row.recovery_root_path,
    headBefore: row.head_before,
    commitHash: typeof row.commit_hash === "string" ? row.commit_hash : null,
    actions: parseActions(row.actions_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

class ContentRecoveryNeededError extends Error {
  constructor(message = "内容变更未能自动恢复，请保留当前仓库并重试；Synapse 将在下次启动时继续恢复。", options?: ErrorOptions) {
    super(message, options)
    this.name = "ContentRecoveryNeededError"
  }
}

class ContentWriteTransactionService {
  async begin(repositoryUuid: string, gitRootPath: string): Promise<ContentWriteTransaction> {
    await this.recover(repositoryUuid, gitRootPath)
    const transactionId = randomUUID()
    const recoveryBasePath = await resolveRecoveryBasePath(gitRootPath)
    const recoveryRootPath = path.join(recoveryBasePath, transactionId)
    const timestamp = new Date().toISOString()
    const journal: ContentWriteJournal = {
      transactionId,
      phase: "applying",
      gitRootPath: path.resolve(gitRootPath),
      recoveryRootPath,
      headBefore: await readHead(gitRootPath),
      commitHash: null,
      actions: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    await mkdir(recoveryRootPath, { recursive: true })
    try {
      await this.writeJournal(repositoryUuid, journal)
    } catch (error) {
      await rm(recoveryRootPath, { recursive: true, force: true })
      throw error
    }
    return this.createTransaction(repositoryUuid, journal)
  }

  createLocalTransaction(): ContentWriteTransaction {
    return noopTransaction
  }

  async recover(repositoryUuid: string, gitRootPath: string): Promise<void> {
    let journals: ContentWriteJournal[]
    try {
      journals = await this.readJournals(repositoryUuid)
    } catch (error) {
      throw new ContentRecoveryNeededError(undefined, { cause: error })
    }
    if (journals.length === 0) return
    const recoveryBasePath = await resolveRecoveryBasePath(gitRootPath)
    for (const journal of journals) {
      try {
        if (path.resolve(journal.gitRootPath) !== path.resolve(gitRootPath)) {
          throw new Error("内容事务所属仓库路径已变化，无法自动恢复。")
        }
        if (!isPathInsideDirectory(recoveryBasePath, journal.recoveryRootPath, { resolvePath: path.resolve })) {
          throw new Error("内容事务恢复目录不属于当前 Git 仓库。")
        }
        const committed = journal.phase === "committed"
          || (journal.phase === "committing" && await this.didCommitTransaction(journal))
        if (committed) {
          await this.finalizeJournal(repositoryUuid, journal)
        } else {
          await this.rollbackJournal(repositoryUuid, journal)
        }
      } catch (error) {
        logger.error("Content transaction recovery failed.", {
          error,
          repositoryUuid,
          transactionId: journal.transactionId,
        })
        throw new ContentRecoveryNeededError(undefined, { cause: error })
      }
    }
  }

  private async didCommitTransaction(journal: ContentWriteJournal): Promise<boolean> {
    if (await readHead(journal.gitRootPath) === journal.headBefore) return false
    const relativePaths = toRepositoryGitPaths(
      journal.gitRootPath,
      journal.actions.map((action) => action.targetPath),
    )
    if (relativePaths.length === 0) return false
    const result = await runGitCommand({
      args: ["--literal-pathspecs", "diff", "--name-only", journal.headBefore, "HEAD", "--", ...relativePaths],
      cwd: journal.gitRootPath,
      fallbackMessage: "无法确认内容事务是否已提交。",
    })
    return result.stdout.trim().length > 0
  }

  private createTransaction(repositoryUuid: string, initialJournal: ContentWriteJournal): ContentWriteTransaction {
    let journal = initialJournal
    const update = async (next: ContentWriteJournal) => {
      await this.writeJournal(repositoryUuid, next)
      journal = next
    }
    return {
      id: journal.transactionId,
      recordCreatedPath: async (targetPath) => {
        assertManagedTarget(journal.gitRootPath, targetPath)
        await update({
          ...journal,
          actions: [...journal.actions, { kind: "remove-created", targetPath }],
          updatedAt: new Date().toISOString(),
        })
      },
      replaceFile: async (targetPath, stagedPath) => {
        assertManagedTarget(journal.gitRootPath, targetPath)
        assertManagedTarget(journal.gitRootPath, stagedPath)
        if (await pathExists(targetPath)) {
          const backupPath = path.join(journal.recoveryRootPath, `file-${journal.actions.length}`)
          assertRecoveryPath(journal.recoveryRootPath, backupPath)
          await copyFile(targetPath, backupPath)
          await update({
            ...journal,
            actions: [...journal.actions, { backupPath, kind: "restore-file", targetPath }],
            updatedAt: new Date().toISOString(),
          })
        } else {
          await update({
            ...journal,
            actions: [...journal.actions, { kind: "remove-created", targetPath }],
            updatedAt: new Date().toISOString(),
          })
        }
        await rename(stagedPath, targetPath)
      },
      moveDirectoryToRecovery: async (targetPath) => {
        assertManagedTarget(journal.gitRootPath, targetPath)
        const backupPath = path.join(journal.recoveryRootPath, `directory-${journal.actions.length}`)
        assertRecoveryPath(journal.recoveryRootPath, backupPath)
        await update({
          ...journal,
          actions: [...journal.actions, { backupPath, kind: "restore-directory", targetPath }],
          updatedAt: new Date().toISOString(),
        })
        await rename(targetPath, backupPath)
      },
      markCommitting: async () => update({
        ...journal,
        phase: "committing",
        updatedAt: new Date().toISOString(),
      }),
      markCommitted: async (commitHash) => update({
        ...journal,
        phase: "committed",
        commitHash,
        updatedAt: new Date().toISOString(),
      }),
      finalize: async () => this.finalizeJournal(repositoryUuid, journal),
      rollback: async () => this.rollbackJournal(repositoryUuid, journal),
    }
  }

  private async readJournals(repositoryUuid: string): Promise<ContentWriteJournal[]> {
    return withRepositoryCacheDatabase(repositoryUuid, (database) => {
      const rows = database.prepare("SELECT * FROM content_write_transactions ORDER BY created_at ASC").all() as Record<string, unknown>[]
      return rows.map(mapJournal).filter((journal): journal is ContentWriteJournal => journal !== null)
    }, { includeContentWriteTransactions: true })
  }

  private async writeJournal(repositoryUuid: string, journal: ContentWriteJournal): Promise<void> {
    await withRepositoryCacheDatabase(repositoryUuid, (database) => {
      database.prepare(`
        INSERT OR REPLACE INTO content_write_transactions (
          transaction_id, phase, git_root_path, recovery_root_path, head_before,
          commit_hash, actions_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        journal.transactionId,
        journal.phase,
        journal.gitRootPath,
        journal.recoveryRootPath,
        journal.headBefore,
        journal.commitHash,
        JSON.stringify(journal.actions),
        journal.createdAt,
        journal.updatedAt,
      )
    }, { includeContentWriteTransactions: true })
  }

  private async finalizeJournal(repositoryUuid: string, journal: ContentWriteJournal): Promise<void> {
    await rm(journal.recoveryRootPath, { recursive: true, force: true })
    await this.deleteJournal(repositoryUuid, journal.transactionId)
  }

  private async rollbackJournal(repositoryUuid: string, journal: ContentWriteJournal): Promise<void> {
    for (const action of [...journal.actions].reverse()) {
      assertManagedTarget(journal.gitRootPath, action.targetPath)
      if (action.kind === "remove-created") {
        await rm(action.targetPath, { recursive: true, force: true })
        continue
      }
      assertRecoveryPath(journal.recoveryRootPath, action.backupPath)
      if (!(await pathExists(action.backupPath))) continue
      await rm(action.targetPath, { recursive: true, force: true })
      await mkdir(path.dirname(action.targetPath), { recursive: true })
      await rename(action.backupPath, action.targetPath)
    }
    await this.finalizeJournal(repositoryUuid, journal)
  }

  private async deleteJournal(repositoryUuid: string, transactionId: string): Promise<void> {
    await withRepositoryCacheDatabase(repositoryUuid, (database) => {
      database.prepare("DELETE FROM content_write_transactions WHERE transaction_id = ?").run(transactionId)
    }, { includeContentWriteTransactions: true })
  }
}

const contentWriteTransactionService = new ContentWriteTransactionService()

export {
  ContentRecoveryNeededError,
  contentWriteTransactionService,
  type ContentWriteTransaction,
}

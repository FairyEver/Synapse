import type { WorkflowShareImportSelections } from "../../../src/types/workflow-package"
import type {
  DataNamespace,
  DataRepository,
  WorkflowShareOriginEntryV1,
  WorkflowShareExportEntryV1,
  WorkflowShareStateEntryV1,
  WorkflowShareTransactionEntryV1,
  WorkflowShareUndoEntryV1,
} from "../../runtime/data-repo"
import type { WorkflowAtomicBatchSnapshot, WorkflowService } from "./workflow-service"
import { createMainLogger } from "../log-store"
import { errorLogMeta } from "../error-sanitize"

const logger = createMainLogger("service.workflow.share-state")

interface PrepareImportInput {
  readonly lineageId: string
  readonly artifactId: string
  readonly packageDigest: string
  readonly sourceRevisions: Record<string, string>
  readonly workflowIds: Record<string, string>
  readonly entrypointRefs?: readonly string[]
  readonly selections: WorkflowShareImportSelections
  readonly nextRemoveIds: readonly string[]
  readonly automationChanges?: readonly { id: string; enabled: boolean }[]
}

interface WorkflowShareAutomationAdapter {
  readonly getEnabled: (id: string) => Promise<boolean | null>
  readonly setEnabled: (id: string, enabled: boolean) => Promise<void>
}

export class WorkflowShareStateService {
  private readonly namespace: DataNamespace<WorkflowShareStateEntryV1>
  private readonly workflowService: Pick<WorkflowService, "restoreAtomicSnapshot">
  private readonly now: () => number
  private readonly automation?: WorkflowShareAutomationAdapter
  private initialization: Promise<void> | null = null
  private mutationQueue: Promise<void> = Promise.resolve()

  constructor(
    dataRepository: DataRepository,
    workflowService: Pick<WorkflowService, "restoreAtomicSnapshot">,
    now: () => number = Date.now,
    automation?: WorkflowShareAutomationAdapter,
  ) {
    this.namespace = dataRepository.namespace<WorkflowShareStateEntryV1>("workflow.share-state")
    this.workflowService = workflowService
    this.now = now
    this.automation = automation
  }

  initialize(): Promise<void> {
    this.initialization ??= this.recoverPendingTransactions().catch((error) => {
      this.initialization = null
      throw error
    })
    return this.initialization
  }

  async getOrigin(lineageId: string): Promise<WorkflowShareOriginEntryV1 | null> {
    await this.initialize()
    const entry = await this.namespace.get(originId(lineageId))
    return entry?.recordType === "origin" ? entry : null
  }

  async getUndoPlan(lineageId: string): Promise<WorkflowShareUndoEntryV1 | null> {
    await this.initialize()
    return this.getUndo(lineageId)
  }

  async findOriginByWorkflowId(workflowId: string): Promise<WorkflowShareOriginEntryV1 | null> {
    await this.initialize()
    const entries = await this.namespace.list()
    return entries.find((entry): entry is WorkflowShareOriginEntryV1 => (
      entry.recordType === "origin" && Object.values(entry.workflowIds).includes(workflowId)
    )) ?? null
  }

  async getOrCreateExportLineage(input: {
    workflowId: string
    createLineageId: () => string
    derivedFrom?: { lineageId: string; artifactId?: string }
  }): Promise<WorkflowShareExportEntryV1> {
    await this.initialize()
    return this.withMutationLock(async () => {
      const id = `export:${input.workflowId}`
      const existing = await this.namespace.get(id)
      if (existing?.recordType === "export") return existing
      const entry: WorkflowShareExportEntryV1 = {
        id,
        schemaVersion: 1,
        recordType: "export",
        sourceWorkflowId: input.workflowId,
        lineageId: input.createLineageId(),
        ...(input.derivedFrom ? { derivedFrom: input.derivedFrom } : {}),
        updatedAt: this.now(),
      }
      await this.namespace.upsert(entry)
      return entry
    })
  }

  async prepareImport(
    input: PrepareImportInput,
    snapshot: WorkflowAtomicBatchSnapshot,
  ): Promise<WorkflowShareTransactionEntryV1> {
    await this.initialize()
    const [previousOrigin, previousUndo] = await Promise.all([
      this.getOrigin(input.lineageId),
      this.getUndo(input.lineageId),
    ])
    const previousAutomationStates = (await Promise.all((input.automationChanges ?? []).map(async (change) => {
      const enabled = await this.automation?.getEnabled(change.id)
      return enabled === null || enabled === undefined ? null : { id: change.id, enabled }
    }))).filter((state): state is { id: string; enabled: boolean } => state !== null)
    const nextOrigin: WorkflowShareOriginEntryV1 = {
      id: originId(input.lineageId),
      schemaVersion: 1,
      recordType: "origin",
      lineageId: input.lineageId,
      artifactId: input.artifactId,
      packageDigest: input.packageDigest,
      sourceRevisions: input.sourceRevisions,
      workflowIds: input.workflowIds,
      entrypointRefs: [...(input.entrypointRefs ?? Object.keys(input.workflowIds).slice(0, 1))],
      selections: structuredClone(input.selections),
      importedAt: this.now(),
    }
    const nextUndo: WorkflowShareUndoEntryV1 = {
      id: undoId(input.lineageId),
      schemaVersion: 1,
      recordType: "undo",
      lineageId: input.lineageId,
      expectedRevisions: Object.fromEntries(snapshot.next.map((workflow) => [workflow.id, workflow.version])),
      previousWorkflows: structuredClone(snapshot.previous),
      removeOnUndoIds: snapshot.newlyCreatedIds,
      ...(previousOrigin ? { previousOrigin } : {}),
      previousAutomationStates,
      createdAt: this.now(),
    }
    const transaction: WorkflowShareTransactionEntryV1 = {
      id: transactionId(input.lineageId),
      schemaVersion: 1,
      recordType: "transaction",
      lineageId: input.lineageId,
      phase: "prepared",
      previousWorkflows: structuredClone(snapshot.previous),
      nextWorkflows: structuredClone(snapshot.next),
      rollbackRemoveIds: snapshot.newlyCreatedIds,
      nextRemoveIds: [...input.nextRemoveIds],
      nextOrigin,
      nextUndo,
      ...(previousOrigin ? { previousOrigin } : {}),
      ...(previousUndo ? { previousUndo } : {}),
      previousAutomationStates,
      nextAutomationStates: [...(input.automationChanges ?? [])],
      createdAt: this.now(),
    }
    await this.namespace.upsert(transaction)
    return transaction
  }

  async commitImport(transaction: WorkflowShareTransactionEntryV1): Promise<void> {
    await this.namespace.upsert({ ...transaction, phase: "workflows_committed" })
    await this.applyAutomationStates(transaction.nextAutomationStates)
    await this.restoreOptional(transaction.nextOrigin, originId(transaction.lineageId))
    await this.restoreOptional(transaction.nextUndo, undoId(transaction.lineageId))
    await this.namespace.remove(transaction.id)
  }

  async prepareDelete(
    lineageId: string,
    deletedWorkflowIds: readonly string[],
    detachAllMembers: boolean,
    snapshot: WorkflowAtomicBatchSnapshot,
  ): Promise<WorkflowShareTransactionEntryV1> {
    await this.initialize()
    const [previousOrigin, previousUndo] = await Promise.all([
      this.getOrigin(lineageId),
      this.getUndo(lineageId),
    ])
    if (!previousOrigin) throw new Error("工作流分享来源记录不存在。")
    const deletedIds = new Set(deletedWorkflowIds)
    const remainingWorkflowIds = detachAllMembers
      ? {}
      : Object.fromEntries(Object.entries(previousOrigin.workflowIds).filter(([, id]) => !deletedIds.has(id)))
    const remainingRefs = new Set(Object.keys(remainingWorkflowIds))
    const nextOrigin = Object.keys(remainingWorkflowIds).length > 0 ? {
      ...previousOrigin,
      workflowIds: remainingWorkflowIds,
      sourceRevisions: Object.fromEntries(
        Object.entries(previousOrigin.sourceRevisions).filter(([ref]) => remainingRefs.has(ref)),
      ),
      entrypointRefs: previousOrigin.entrypointRefs?.filter((ref) => remainingRefs.has(ref)),
      importedAt: this.now(),
    } satisfies WorkflowShareOriginEntryV1 : undefined
    const transaction: WorkflowShareTransactionEntryV1 = {
      id: transactionId(lineageId),
      schemaVersion: 1,
      recordType: "transaction",
      lineageId,
      phase: "prepared",
      previousWorkflows: structuredClone(snapshot.previous),
      nextWorkflows: structuredClone(snapshot.next),
      rollbackRemoveIds: snapshot.newlyCreatedIds,
      nextRemoveIds: [...deletedWorkflowIds],
      ...(nextOrigin ? { nextOrigin } : {}),
      ...(previousOrigin ? { previousOrigin } : {}),
      ...(previousUndo ? { previousUndo } : {}),
      previousAutomationStates: [],
      nextAutomationStates: [],
      createdAt: this.now(),
    }
    await this.namespace.upsert(transaction)
    return transaction
  }

  async prepareUndo(
    lineageId: string,
    undo: WorkflowShareUndoEntryV1,
    snapshot: WorkflowAtomicBatchSnapshot,
  ): Promise<WorkflowShareTransactionEntryV1> {
    await this.initialize()
    const previousOrigin = await this.getOrigin(lineageId)
    const previousAutomationStates = (await Promise.all(undo.previousAutomationStates.map(async (state) => {
      const enabled = await this.automation?.getEnabled(state.id)
      return enabled === null || enabled === undefined ? null : { id: state.id, enabled }
    }))).filter((state): state is { id: string; enabled: boolean } => state !== null)
    const transaction: WorkflowShareTransactionEntryV1 = {
      id: transactionId(lineageId),
      schemaVersion: 1,
      recordType: "transaction",
      lineageId,
      phase: "prepared",
      previousWorkflows: structuredClone(snapshot.previous),
      nextWorkflows: structuredClone(snapshot.next),
      rollbackRemoveIds: snapshot.newlyCreatedIds,
      nextRemoveIds: [...undo.removeOnUndoIds],
      ...(undo.previousOrigin ? { nextOrigin: undo.previousOrigin } : {}),
      ...(previousOrigin ? { previousOrigin } : {}),
      previousUndo: undo,
      previousAutomationStates,
      nextAutomationStates: structuredClone(undo.previousAutomationStates),
      createdAt: this.now(),
    }
    await this.namespace.upsert(transaction)
    return transaction
  }

  async rollbackImport(transaction: WorkflowShareTransactionEntryV1): Promise<void> {
    await this.applyAutomationStates(transaction.previousAutomationStates)
    await this.restoreOptional(transaction.previousOrigin, originId(transaction.lineageId))
    await this.restoreOptional(transaction.previousUndo, undoId(transaction.lineageId))
    await this.namespace.remove(transaction.id)
  }

  private async getUndo(lineageId: string): Promise<WorkflowShareUndoEntryV1 | null> {
    const entry = await this.namespace.get(undoId(lineageId))
    return entry?.recordType === "undo" ? entry : null
  }

  private async recoverPendingTransactions(): Promise<void> {
    const transactions = (await this.namespace.list()).filter(
      (entry): entry is WorkflowShareTransactionEntryV1 => entry.recordType === "transaction",
    )
    for (const transaction of transactions) {
      try {
        await this.workflowService.restoreAtomicSnapshot(transaction.nextWorkflows, transaction.nextRemoveIds)
        await this.applyAutomationStates(transaction.nextAutomationStates)
        await this.commitImport(transaction)
        logger.info("workflow share transaction recovered", { lineageId: transaction.lineageId, phase: transaction.phase })
      } catch (error) {
        logger.error("workflow share transaction recovery failed", {
          lineageId: transaction.lineageId,
          phase: transaction.phase,
          ...errorLogMeta(error),
        })
        throw error
      }
    }
  }

  private async restoreOptional(
    entry: WorkflowShareOriginEntryV1 | WorkflowShareUndoEntryV1 | undefined,
    id: string,
  ): Promise<void> {
    if (entry) await this.namespace.upsert(entry)
    else await this.namespace.remove(id)
  }

  private async applyAutomationStates(states: readonly { id: string; enabled: boolean }[]): Promise<void> {
    if (!this.automation) {
      if (states.length > 0) throw new Error("Automation 状态适配器不可用。")
      return
    }
    for (const state of states) await this.automation.setEnabled(state.id, state.enabled)
  }

  private async withMutationLock<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.mutationQueue.then(operation, operation)
    this.mutationQueue = run.then(() => undefined, () => undefined)
    return run
  }
}

function originId(lineageId: string): string {
  return `origin:${lineageId}`
}

function undoId(lineageId: string): string {
  return `undo:${lineageId}`
}

function transactionId(lineageId: string): string {
  return `transaction:${lineageId}`
}

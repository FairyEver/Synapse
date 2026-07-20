import type { WorkflowDefinition } from "../../../../src/types/workflow"
import type { WorkflowShareImportSelections } from "../../../../src/types/workflow-package"
import type { Migration, NamespaceSchema } from "../types"

export interface WorkflowShareOriginEntryV1 extends Record<string, unknown> {
  id: string
  schemaVersion: 1
  recordType: "origin"
  lineageId: string
  artifactId: string
  packageDigest: string
  sourceRevisions: Record<string, string>
  workflowIds: Record<string, string>
  entrypointRefs?: string[]
  selections: WorkflowShareImportSelections
  importedAt: number
}

export interface WorkflowShareUndoEntryV1 extends Record<string, unknown> {
  id: string
  schemaVersion: 1
  recordType: "undo"
  lineageId: string
  expectedRevisions: Record<string, string>
  previousWorkflows: WorkflowDefinition[]
  removeOnUndoIds: string[]
  previousOrigin?: WorkflowShareOriginEntryV1
  previousAutomationStates: Array<{ id: string; enabled: boolean }>
  createdAt: number
}

export interface WorkflowShareTransactionEntryV1 extends Record<string, unknown> {
  id: string
  schemaVersion: 1
  recordType: "transaction"
  lineageId: string
  phase: "prepared" | "workflows_committed"
  previousWorkflows: WorkflowDefinition[]
  nextWorkflows: WorkflowDefinition[]
  rollbackRemoveIds: string[]
  nextRemoveIds: string[]
  nextOrigin?: WorkflowShareOriginEntryV1
  nextUndo?: WorkflowShareUndoEntryV1
  previousOrigin?: WorkflowShareOriginEntryV1
  previousUndo?: WorkflowShareUndoEntryV1
  previousAutomationStates: Array<{ id: string; enabled: boolean }>
  nextAutomationStates: Array<{ id: string; enabled: boolean }>
  createdAt: number
}

export interface WorkflowShareExportEntryV1 extends Record<string, unknown> {
  id: string
  schemaVersion: 1
  recordType: "export"
  sourceWorkflowId: string
  lineageId: string
  derivedFrom?: { lineageId: string; artifactId?: string }
  updatedAt: number
}

export type WorkflowShareStateEntryV1 =
  | WorkflowShareOriginEntryV1
  | WorkflowShareUndoEntryV1
  | WorkflowShareTransactionEntryV1
  | WorkflowShareExportEntryV1

const noMigrations: readonly Migration[] = []

export const workflowShareStateSchema: NamespaceSchema<WorkflowShareStateEntryV1> = {
  name: "workflow.share-state",
  backend: "json",
  currentVersion: 1,
  migrations: noMigrations,
  validate: (value): value is WorkflowShareStateEntryV1 => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false
    const entry = value as Record<string, unknown>
    if (entry.schemaVersion !== 1 || typeof entry.id !== "string" || typeof entry.lineageId !== "string") return false
    if (entry.recordType === "origin") {
      return typeof entry.artifactId === "string"
        && typeof entry.packageDigest === "string"
        && isRecord(entry.sourceRevisions)
        && isRecord(entry.workflowIds)
        && isRecord(entry.selections)
        && typeof entry.importedAt === "number"
    }
    if (entry.recordType === "undo") {
      return isRecord(entry.expectedRevisions)
        && Array.isArray(entry.previousWorkflows)
        && Array.isArray(entry.removeOnUndoIds)
        && Array.isArray(entry.previousAutomationStates)
        && typeof entry.createdAt === "number"
    }
    if (entry.recordType === "transaction") {
      return (entry.phase === "prepared" || entry.phase === "workflows_committed")
        && Array.isArray(entry.previousWorkflows)
        && Array.isArray(entry.nextWorkflows)
        && Array.isArray(entry.rollbackRemoveIds)
        && Array.isArray(entry.nextRemoveIds)
        && (entry.nextOrigin === undefined || isRecord(entry.nextOrigin))
        && (entry.nextUndo === undefined || isRecord(entry.nextUndo))
        && Array.isArray(entry.previousAutomationStates)
        && Array.isArray(entry.nextAutomationStates)
        && typeof entry.createdAt === "number"
    }
    if (entry.recordType === "export") {
      return typeof entry.sourceWorkflowId === "string" && typeof entry.updatedAt === "number"
    }
    return false
  },
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

import type { WorkflowDefinition, WorkflowRunStatus } from "../../../src/types/workflow"
import type { WorkflowShareResourceReference, WorkflowShareResourceTarget } from "../../../src/types/workflow-package"
import type { SynapseConfig } from "../../../src/types/config"
import type { EventBus } from "../../runtime/event-bus"
import type { AutomationService } from "../automation"
import type { GitClientCommandRunner } from "../git-client/git-command-runner"
import type { RunSnapshotService } from "./run-snapshot-service"
import type { WorkflowParamPresetService } from "./workflow-param-preset-service"
import type { WorkflowService } from "./workflow-service"
import type { WorkflowWindowManager } from "./window-manager"
import { workflowCallTargetIds } from "./workflow-validator"
import { workflowShareGitRemoteFingerprint } from "./workflow-share-dependency-collector"

interface WorkflowShareIntegrationDeps {
  readonly workflowService: Pick<WorkflowService, "listCurrentDefinitions">
  readonly automationService: Pick<AutomationService, "automationList">
  readonly workflowWindowManager: Pick<WorkflowWindowManager, "getEditorMutationStates">
  readonly runStatuses: ReadonlyMap<string, WorkflowRunStatus>
  readonly snapshots: Pick<RunSnapshotService, "list">
  readonly paramPresets: Pick<WorkflowParamPresetService, "list" | "deleteForWorkflow">
  readonly eventBus: Pick<EventBus, "emit">
  readonly gitCommandRunner: GitClientCommandRunner
  readonly loadConfig: () => Promise<Pick<SynapseConfig, "repositories" | "global">>
  readonly drive: {
    getDriveItem: (itemId: string) => Promise<{
      id: string
      name: string
      type: "file" | "folder"
      storageStatus: "pending" | "active" | "delete_pending" | "deleted" | "failed"
    }>
    listDriveFileVersions: (
      itemId: string,
      input?: { offset?: number; limit?: number },
    ) => Promise<{
      items: readonly { id: string; deletePending: boolean }[]
      total: number
    }>
  }
}

export function createWorkflowShareIntegration(deps: WorkflowShareIntegrationDeps) {
  return {
    loadProjects: async () => {
      const config = await deps.loadConfig()
      const repositories = await Promise.all(config.repositories.map(async (repository) => {
        let gitRemoteFingerprint: string | undefined
        try {
          const result = await deps.gitCommandRunner.run({
            cwd: repository.localPath,
            args: ["config", "--get", "remote.origin.url"],
            operation: "workflow.share.project-fingerprint",
            repositoryId: repository.uuid,
            logFailure: false,
            timeoutMs: 2_000,
          })
          gitRemoteFingerprint = workflowShareGitRemoteFingerprint(result.stdout)
        } catch {
          // 不是 Git 仓库或没有 origin 时仍可按名称和项目类型匹配。
        }
        return { id: repository.uuid, name: repository.name, type: "repository", gitRemoteFingerprint }
      }))
      return [
        ...repositories,
        ...config.global.projects.map((project) => ({
          id: project.id,
          name: project.name,
          type: project.capabilities?.knowledgeBase ? "knowledge-base" : "project",
        })),
      ]
    },
    countLinkedAutomations: async (workflowIds: readonly string[]) => {
      const ids = new Set(workflowIds)
      return (await deps.automationService.automationList()).filter((item) => (
        item.executor.type === "builtin.workflow"
        && ids.has(String(item.executor.config.workflowId ?? ""))
      )).length
    },
    assertCanCommit: async (workflowIds: readonly string[]) => {
      const ids = new Set(workflowIds)
      const currentDefinitions = await deps.workflowService.listCurrentDefinitions()
      const definitionsById = new Map(currentDefinitions.map((definition) => [definition.id, definition]))
      const blockedEditors = deps.workflowWindowManager.getEditorMutationStates().filter((state) => (
        ids.has(state.workflowId) && (state.dirty || state.saving)
      ))
      if (blockedEditors.length > 0) {
        throw new Error("相关工作流正在编辑或保存，请先完成编辑后再导入。")
      }
      const runningWorkflows = Array.from(deps.runStatuses.values()).filter((status) => {
        if (status.status !== "running") return false
        const definition = status.definition ?? definitionsById.get(status.workflowId)
        return ids.has(status.workflowId)
          || Boolean(definition && workflowDefinitionTouchesTargets(definition, definitionsById, ids))
      })
      if (runningWorkflows.length > 0) throw new Error("相关工作流正在运行，请等待运行结束后再导入。")
      const runningAutomations = (await deps.automationService.automationList()).filter((item) => {
        if (item.activeRun?.status !== "running" || item.executor.type !== "builtin.workflow") return false
        const workflowId = String(item.executor.config.workflowId ?? "")
        const definition = definitionsById.get(workflowId)
        return ids.has(workflowId)
          || Boolean(definition && workflowDefinitionTouchesTargets(definition, definitionsById, ids))
      })
      if (runningAutomations.length > 0) throw new Error("相关 Automation 正在运行，请等待运行结束后再导入。")
    },
    assertCanExport: async (workflowIds: readonly string[]) => {
      const ids = new Set(workflowIds)
      const blockedEditors = deps.workflowWindowManager.getEditorMutationStates().filter((state) => (
        ids.has(state.workflowId) && (state.dirty || state.saving)
      ))
      if (blockedEditors.length > 0) {
        throw new Error("相关工作流有未保存的编辑，请先保存后再导出。")
      }
    },
    onCommitted: (workflowIds: readonly string[]) => {
      for (const workflowId of workflowIds) {
        deps.eventBus.emit({
          domain: "workflow",
          type: "workflow:definition-updated",
          payload: { workflowId, source: "share-import" },
          timestamp: new Date().toISOString(),
        })
      }
    },
    inspectAutomationCompatibility: async (definitions: readonly WorkflowDefinition[]) => {
      const byId = new Map(definitions.map((definition) => [definition.id, definition]))
      return (await deps.automationService.automationList()).flatMap((item) => {
        if (!item.enabled || item.executor.type !== "builtin.workflow") return []
        const workflowId = String(item.executor.config.workflowId ?? "")
        const definition = byId.get(workflowId)
        if (!definition) return []
        const templates = isPlainRecord(item.executor.config.paramTemplates)
          ? item.executor.config.paramTemplates
          : {}
        const missingParams = definition.params.filter((param) => (
          param.default === null && typeof templates[param.name] !== "string"
        ))
        return missingParams.length > 0 ? [{
          id: item.id,
          name: item.name,
          action: "disable" as const,
          reason: `缺少参数：${missingParams.map((param) => param.name).join("、")}`,
        }] : []
      })
    },
    classifyRemovedWorkflows: async (workflowIds: readonly string[], lineageWorkflowIds: readonly string[]) => {
      const removedIds = new Set(workflowIds)
      const lineageIds = new Set(lineageWorkflowIds)
      const externalReferences = new Set<string>()
      for (const definition of await deps.workflowService.listCurrentDefinitions()) {
        if (lineageIds.has(definition.id)) continue
        for (const targetId of workflowCallTargetIds(definition)) {
          if (removedIds.has(targetId)) externalReferences.add(targetId)
        }
      }
      const result = new Map<string, "delete" | "detach">()
      for (const workflowId of workflowIds) {
        const hasHistory = (await deps.snapshots.list(workflowId, 1)).length > 0
        result.set(workflowId, hasHistory || externalReferences.has(workflowId) ? "detach" : "delete")
      }
      return result
    },
    countIncompatiblePresets: async (definitions: readonly WorkflowDefinition[]) => {
      let count = 0
      for (const definition of definitions) {
        for (const preset of await deps.paramPresets.list(definition.id)) {
          if (!isWorkflowPresetCompatible(definition, preset.values)) count += 1
        }
      }
      return count
    },
    inspectDeleteCandidates: async (workflowIds: readonly string[], ignoredCallerIds: readonly string[]) => {
      const targetIds = new Set(workflowIds)
      const ignoredIds = new Set(ignoredCallerIds)
      const definitions = await deps.workflowService.listCurrentDefinitions()
      const names = new Map(definitions.map((definition) => [definition.id, definition.name]))
      const referencedIds = new Set<string>()
      for (const definition of definitions) {
        if (ignoredIds.has(definition.id)) continue
        for (const targetId of workflowCallTargetIds(definition)) {
          if (targetIds.has(targetId)) referencedIds.add(targetId)
        }
      }
      const result = new Map<string, { name: string; hasReference: boolean; hasHistory: boolean }>()
      for (const workflowId of workflowIds) {
        result.set(workflowId, {
          name: names.get(workflowId) ?? workflowId,
          hasReference: referencedIds.has(workflowId),
          hasHistory: (await deps.snapshots.list(workflowId, 1)).length > 0,
        })
      }
      return result
    },
    cleanupParamPresets: async (workflowIds: readonly string[]) => {
      for (const workflowId of workflowIds) await deps.paramPresets.deleteForWorkflow(workflowId)
    },
    validateDriveResource: async (
      target: Extract<WorkflowShareResourceTarget, { kind: "drive" }>,
      reference: WorkflowShareResourceReference,
    ) => {
      const item = await deps.drive.getDriveItem(target.id)
      const expectedType = reference.entryType === "file" ? "file" : "folder"
      if (item.type !== expectedType) throw new Error(`Drive 资源类型不匹配：${item.name}`)
      if (item.storageStatus !== "active") throw new Error(`Drive 资源当前不可用：${item.name}`)
      if (!target.versionId) return
      if (item.type !== "file") throw new Error("Drive 目录不能指定文件版本。")
      let offset = 0
      const limit = 100
      while (true) {
        const page = await deps.drive.listDriveFileVersions(item.id, { offset, limit })
        if (page.items.some((version) => version.id === target.versionId && !version.deletePending)) return
        offset += page.items.length
        if (page.items.length === 0 || offset >= page.total) break
      }
      throw new Error(`Drive 文件版本不可用：${item.name}`)
    },
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isWorkflowPresetCompatible(
  definition: WorkflowDefinition,
  values: Readonly<Record<string, string | string[]>>,
): boolean {
  return definition.params.every((param) => {
    const value = values[param.name]
    if (value === undefined) return param.default !== null
    if (param.type === "file" || param.type === "directory") {
      return param.allowMultiple ? Array.isArray(value) : typeof value === "string"
    }
    if (Array.isArray(value)) return false
    if (param.type === "number") return value.trim() !== "" && Number.isFinite(Number(value))
    if (param.type === "option" && !param.allowCustomOption) return (param.options ?? []).includes(value)
    return true
  })
}

function workflowDefinitionTouchesTargets(
  definition: WorkflowDefinition,
  definitionsById: ReadonlyMap<string, WorkflowDefinition>,
  targetIds: ReadonlySet<string>,
  visited = new Set<string>(),
): boolean {
  if (targetIds.has(definition.id)) return true
  if (visited.has(definition.id)) return false
  visited.add(definition.id)
  return workflowCallTargetIds(definition).some((childId) => {
    if (targetIds.has(childId)) return true
    const child = definitionsById.get(childId)
    return child ? workflowDefinitionTouchesTargets(child, definitionsById, targetIds, visited) : false
  })
}

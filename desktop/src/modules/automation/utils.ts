import { createRendererLogger } from "@/app-shell/logging"
import { rendererActionRegistry } from "@/action-runtime/builtin-actions"
import { rendererAutomationTriggerRegistry } from "@/automation-triggers/builtin-triggers"
import type { AutomationCreateInput, AutomationItem, AutomationRun, AutomationRunStatus, AutomationUpdateInput } from "@/types/automation"
import type { SynapseProjectConfig } from "@/types/config"
import type { AutomationEditorDraft } from "./types"

const AUTOMATION_DRAFT_NAME_PREFIX = "自动化"
const AUTOMATION_DRAFT_SUFFIX_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
const logger = createRendererLogger("automation.utils")

function createDefaultAutomationDraft(name = ""): AutomationEditorDraft {
  return {
    name,
    description: "",
    cwd: "",
    enabled: false,
    triggerType: null,
    triggerConfig: {},
    executorType: null,
    executorConfig: {},
    missedRunPolicy: "skip",
  }
}

function generateAutomationDraftName(
  existingNames: Iterable<string>,
  rng: () => number = Math.random,
): string {
  const names = new Set(Array.from(existingNames, (name) => name.trim()).filter(Boolean))
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const suffix = Array.from({ length: 4 }, () => {
      const index = Math.min(
        AUTOMATION_DRAFT_SUFFIX_CHARS.length - 1,
        Math.max(0, Math.floor(rng() * AUTOMATION_DRAFT_SUFFIX_CHARS.length)),
      )
      return AUTOMATION_DRAFT_SUFFIX_CHARS[index]
    }).join("")
    const candidate = `${AUTOMATION_DRAFT_NAME_PREFIX} #${suffix}`
    if (!names.has(candidate)) return candidate
  }

  for (let index = 1; index < 36 ** 4; index += 1) {
    const suffix = index.toString(36).toUpperCase().padStart(4, "0").slice(-4)
    const candidate = `${AUTOMATION_DRAFT_NAME_PREFIX} #${suffix}`
    if (!names.has(candidate)) return candidate
  }

  return `${AUTOMATION_DRAFT_NAME_PREFIX} #${Date.now().toString(36).toUpperCase().slice(-4)}`
}

function createAutomationDraftFromItem(item: AutomationItem): AutomationEditorDraft {
  return {
    name: item.name,
    description: item.description ?? "",
    cwd: item.cwd ?? "",
    enabled: item.enabled,
    triggerType: item.trigger.type,
    triggerConfig: item.trigger.config,
    executorType: item.executor.type,
    executorConfig: item.executor.config,
    missedRunPolicy: item.policy.missedRunPolicy,
  }
}

function buildAutomationCreateInputFromDraft(
  draft: AutomationEditorDraft,
  enabled: boolean,
): AutomationCreateInput {
  return buildAutomationPayloadFromDraft(draft, enabled)
}

function buildAutomationUpdateInputFromDraft(
  draft: AutomationEditorDraft,
  enabled?: boolean,
): AutomationUpdateInput {
  const payload = buildAutomationPayloadFromDraft(draft, enabled ?? false)
  if (enabled !== undefined) return payload
  return {
    name: payload.name,
    description: payload.description,
    scope: payload.scope,
    cwd: payload.cwd,
    trigger: payload.trigger,
    executor: payload.executor,
    policy: payload.policy,
  }
}

function buildAutomationPayloadFromDraft(
  draft: AutomationEditorDraft,
  enabled: boolean,
): AutomationCreateInput {
  const name = requireTrimmed(draft.name, "名称")
  if (!draft.triggerType) throw new Error("请选择触发器")
  if (!draft.executorType) throw new Error("请选择执行器")
  const triggerConfig = rendererAutomationTriggerRegistry.parseConfig(draft.triggerType, draft.triggerConfig)
  const executorConfig = rendererActionRegistry.parseConfig(draft.executorType, draft.executorConfig)
  const projectId = (executorConfig as Record<string, unknown>).projectId
  const scope = typeof projectId === "string" && projectId.trim()
    ? { type: "project" as const, projectId: projectId.trim() }
    : { type: "global" as const }

  return {
    name,
    description: optionalTrimmed(draft.description),
    enabled,
    scope,
    cwd: optionalTrimmed(draft.cwd),
    trigger: {
      type: draft.triggerType,
      config: triggerConfig,
    },
    executor: {
      type: draft.executorType,
      config: executorConfig,
    },
    policy: {
      missedRunPolicy: draft.missedRunPolicy,
      overlapPolicy: "skip",
    },
  }
}

function formatAutomationScope(item: AutomationItem, projects: readonly SynapseProjectConfig[]): string {
  const projectId = item.scope.type === "project"
    ? item.scope.projectId
    : (item.executor.config as Record<string, unknown>).projectId as string | undefined
  if (!projectId) return "全局"
  return projects.find((project) => project.id === projectId)?.name ?? projectId
}

function formatAutomationTrigger(item: Pick<AutomationItem, "trigger">): string {
  try {
    return rendererAutomationTriggerRegistry.summarize(item.trigger.type, item.trigger.config)
  } catch (error) {
    logger.warn("Automation trigger summary render failed.", {
      boundary: "automation.trigger-summary",
      triggerType: item.trigger.type,
      configKeys: Object.keys(item.trigger.config).sort(),
      errorName: error instanceof Error ? error.name : typeof error,
      errorLength: error instanceof Error ? error.message.length : String(error).length,
    })
    return item.trigger.type
  }
}

function formatAutomationTriggerType(item: Pick<AutomationItem, "trigger">): string {
  try {
    return rendererAutomationTriggerRegistry.get(item.trigger.type).manifest.title
  } catch (error) {
    logger.warn("Automation trigger type title render failed.", {
      boundary: "automation.trigger-type-title",
      triggerType: item.trigger.type,
      errorName: error instanceof Error ? error.name : typeof error,
      errorLength: error instanceof Error ? error.message.length : String(error).length,
    })
    return item.trigger.type
  }
}

function formatAutomationNextRun(item: Pick<AutomationItem, "activeRun" | "enabled" | "nextRunAt" | "trigger">, now = new Date()): string {
  if (!item.enabled) return "停用中"
  if (isCompletionAnchoredInterval(item) && item.activeRun?.status === "running") return "未知"
  if (!item.nextRunAt) return "未知"
  const nextRunAt = new Date(item.nextRunAt)
  if (!Number.isFinite(nextRunAt.getTime())) return "未知"
  if (nextRunAt.getTime() <= now.getTime()) return "未知"
  return formatAutomationDate(item.nextRunAt, "未知")
}

function formatAutomationExecutor(item: AutomationItem): string {
  try {
    return rendererActionRegistry.summarize(item.executor.type, item.executor.config)
  } catch (error) {
    logger.warn("Automation executor summary render failed.", {
      boundary: "automation.executor-summary",
      automationId: item.id,
      executorType: item.executor.type,
      configKeys: Object.keys(item.executor.config).sort(),
      errorName: error instanceof Error ? error.name : typeof error,
      errorLength: error instanceof Error ? error.message.length : String(error).length,
    })
    return item.executor.type
  }
}

function formatAutomationExecutorType(item: Pick<AutomationItem, "id" | "executor">): string {
  try {
    return rendererActionRegistry.get(item.executor.type).manifest.title
  } catch (error) {
    logger.warn("Automation executor type title render failed.", {
      boundary: "automation.executor-type-title",
      automationId: item.id,
      executorType: item.executor.type,
      errorName: error instanceof Error ? error.name : typeof error,
      errorLength: error instanceof Error ? error.message.length : String(error).length,
    })
    return item.executor.type
  }
}

function formatAutomationDate(value: string | undefined, fallback: string): string {
  if (!value) return fallback
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

function formatAutomationStatus(status: AutomationRunStatus | undefined): string {
  if (!status) return "未运行"
  const labels: Record<AutomationRunStatus, string> = {
    success: "成功",
    failed: "失败",
    timeout: "超时",
    cancelled: "已停止",
    skipped: "已跳过",
  }
  return labels[status]
}

function formatAutomationRunStatus(run: AutomationRun): string {
  if (run.status === "running") return "运行中"
  return formatAutomationStatus(run.status)
}

function isCompletionAnchoredInterval(item: Pick<AutomationItem, "trigger">): boolean {
  return item.trigger.type === "builtin.interval" &&
    item.trigger.config.anchor === "last_completed_at"
}

function requireTrimmed(value: string, label: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new Error(`${label}不能为空`)
  return trimmed
}

function optionalTrimmed(value: string): string | undefined {
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

export {
  buildAutomationCreateInputFromDraft,
  buildAutomationUpdateInputFromDraft,
  createAutomationDraftFromItem,
  createDefaultAutomationDraft,
  generateAutomationDraftName,
  formatAutomationDate,
  formatAutomationExecutor,
  formatAutomationExecutorType,
  formatAutomationNextRun,
  formatAutomationRunStatus,
  formatAutomationScope,
  formatAutomationStatus,
  formatAutomationTrigger,
  formatAutomationTriggerType,
}

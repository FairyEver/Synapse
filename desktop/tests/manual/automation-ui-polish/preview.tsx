import { useState } from "react"
import { createRoot } from "react-dom/client"
import { AutomationModule } from "@/modules/automation"
import { AutomationDetail } from "@/modules/automation/detail/automation-detail"
import { AutomationEditorForm } from "@/modules/automation/editor/editor-form"
import { TooltipProvider } from "@/components/ui/tooltip"
import type { AutomationChangedEvent, AutomationItem, AutomationRun } from "@/types/automation"

// This fixture has no native bridge or live network. Every mutation stays in memory.
const params = new URLSearchParams(location.search)
const listeners = new Set<(event: AutomationChangedEvent) => void>()
const emit = (event: AutomationChangedEvent) => listeners.forEach(listener => listener(event))
const onChanged = (listener: (event: AutomationChangedEvent) => void) => { listeners.add(listener); return () => listeners.delete(listener) }
const projectId = "preview-project"
const trigger = params.get("trigger") ?? "cron"
const executor = params.get("executor") === "agent" ? "agent" : "claude-code"
const prompt = params.has("long") ? "检查项目变更与运行结果。".repeat(80) : "检查项目并整理结果 {{trigger.automationName}}"
const triggerConfigs: Record<string, Record<string, unknown>> = {
  cron: { expr: "0 9 * * *", timezone: "Asia/Shanghai" }, interval: { everyMinutes: 30, anchor: "created_at" },
  webhook: { webhookPublicId: "hook-public", webhookName: "项目构建回调" }, "mail-received": { accountId: "mail-preview" }, "mail-internal-received": {},
}
const item: AutomationItem = {
  id: "preview", schemaVersion: 2, name: params.has("long") ? "项目巡检与自动化运行结果检查".repeat(12) : "每日项目巡检", enabled: true,
  scope: { type: "project", projectId }, trigger: { type: `builtin.${trigger}`, config: triggerConfigs[trigger] ?? {} },
  executor: { type: `builtin.${executor}`, config: executor === "agent" ? { projectId, agentType: "claude-code", providerId: "preview-provider", providerName: "用于验证长名称的默认模型供应商", modelTier: "default", mode: "default", prompt, sessionPolicy: "fresh", timeoutMins: 30 } : { projectId, prompt, singleRun: false } },
  conditions: params.has("conditions") ? { operator: "or", items: [{ type: "weekdays", days: [1, 2, 3, 4, 5] }, { type: "daily-time-range", start: "08:00", end: "17:00" }] } : undefined,
  policy: { missedRunPolicy: "skip", overlapPolicy: "skip" }, createdAt: "2026-11-05T00:00:00Z", updatedAt: "2026-11-05T00:00:00Z", runCount: 3, configVersion: 1,
}
let items = params.has("empty") ? [] : [item, { ...item, id: "preview-mail", name: "收到站内信", trigger: { type: "builtin.mail-internal-received", config: {} } }]
let runs: AutomationRun[] = [
  { id: "r1", schemaVersion: 1, automationId: "preview", status: params.has("running") ? "running" : "success", triggeredBy: "trigger", startedAt: "2026-11-05T11:21:04Z", finishedAt: "2026-11-05T11:21:05Z", executorType: "builtin.claude-code", triggerType: "builtin.cron", result: { status: "success", summary: "已提交提示词", metrics: { durationMs: 1355 }, outputs: { projectId, sessionId: "preview-session" } } },
  { id: "r2", schemaVersion: 1, automationId: "preview", status: "failed", triggeredBy: "manual", startedAt: "2026-11-05T10:53:05Z", finishedAt: "2026-11-05T10:53:06Z", executorType: "builtin.claude-code", triggerType: "builtin.cron", error: params.has("long") ? "无法启动。".repeat(200) : "无法启动，请检查项目配置" },
]
const persist = (value: AutomationItem) => { items = [...items.filter(candidate => candidate.id !== value.id), value]; emit({ automationId: value.id, reason: "updated" }); return structuredClone(value) }
Object.assign(window, { synapse: {
  platform: "darwin", automation: {
    item: { onChanged, list: async () => structuredClone(items), get: async (id: string) => structuredClone(items.find(candidate => candidate.id === id) ?? item),
      create: async (input: Partial<AutomationItem>) => { if (params.has("failSave")) throw Error("模拟保存失败"); return persist({ ...item, ...input, id: "new-preview" }) },
      update: async ({ id, patch }: { id: string; patch: Partial<AutomationItem> }) => { if (params.has("failSave")) throw Error("模拟保存失败"); return persist({ ...item, ...patch, id }) },
      setEnabled: async ({ id, enabled }: { id: string; enabled: boolean }) => persist({ ...items.find(candidate => candidate.id === id)!, enabled }),
      delete: async (id: string) => { items = items.filter(candidate => candidate.id !== id); emit({ automationId: id, reason: "deleted" }); return { deleted: true } },
    }, run: { list: async () => { if (params.has("failHistory")) throw Error("模拟读取失败"); return structuredClone(runs) }, execute: async () => runs[0], disable: async (id: string) => { if (params.has("failStop")) throw Error("模拟停止失败"); runs = runs.map(run => run.id === id ? { ...run, status: "cancelled" } : run); emit({ automationId: "preview", reason: "run-stopped" }); return { stopped: true } } },
  },
  account: { listWebhooks: async () => params.has("emptySources") ? [] : [{ id: "hook", publicId: "hook-public", name: "项目构建回调", enabled: true }], state: { onChanged: () => () => undefined, get: async () => ({ status: "authenticated", user: { id: "preview-user" } }) }, webhooks: { list: async () => params.has("emptySources") ? [] : [{ id: "hook", publicId: "hook-public", name: "项目构建回调", enabled: true }] } },
  mail: { uiScope: async () => ({ ownerId: "preview-user", generation: 1 }), accountList: async () => ({ items: params.has("emptySources") ? [] : [{ id: "mail-preview", name: "项目邮箱", email: "preview@example.test" }], nextCursor: null }), onChanged: () => () => undefined, accountOpen: async () => undefined },
  settings: { repository: { chooseDirectory: async () => "/preview/project" } }, shell: { openExternal: async () => undefined },
} })
if (params.has("dark")) document.documentElement.classList.add("dark")
if (params.has("zoom")) document.documentElement.style.fontSize = "200%"

function Preview() {
  const [view, setView] = useState(params.get("view") ?? "list")
  const [selected, setSelected] = useState(item)
  return <TooltipProvider><div className="h-full min-w-0">
    {view === "detail" ? <AutomationDetail item={selected} initialTab={params.has("history") ? "history" : "config"} busy={false} error={null} onBack={() => setView("list")} onCreate={() => setView("new")} onEdit={() => setView("editor")} onToggleEnabled={enabled => setSelected({ ...selected, enabled })} onStopRun={async runId => { await window.synapse!.automation.run.disable(runId) }} onRefresh={() => undefined} />
      : view === "editor" || view === "new" ? <AutomationEditorForm mode={view === "new" ? { mode: "create" } : { mode: "edit", automationId: selected.id }} onBack={() => setView("list")} onSaved={saved => { setSelected(saved); setView("detail") }} />
      : <AutomationModule />}
  </div></TooltipProvider>
}
createRoot(document.getElementById("root")!).render(<Preview />)

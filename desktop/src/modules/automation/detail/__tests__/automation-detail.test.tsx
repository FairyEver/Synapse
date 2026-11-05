// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { TooltipProvider } from "@/components/ui/tooltip"
import type { AutomationItem } from "@/types/automation"
import { AutomationDetail } from "../automation-detail"

const bridge = vi.hoisted(() => ({ listProviders: vi.fn() }))
vi.mock("@/lib/electron-bridge", async () => ({
  ...await vi.importActual<typeof import("@/lib/electron-bridge")>("@/lib/electron-bridge"),
  requireSynapseBridge: () => ({ agent: { listProviders: bridge.listProviders } }),
}))
vi.mock("@/app-shell/config", () => ({ useAppConfig: () => ({ config: { global: { projects: [] } } }) }))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: Root | undefined
afterEach(async () => {
  await act(async () => { root?.unmount() })
  root = undefined
  document.body.innerHTML = ""
  vi.clearAllMocks()
})

describe("automation detail provider display", () => {
  it.each([false, true])("resolves a readable provider and model without mutating config (snapshots: %s)", async (snapshots) => {
    bridge.listProviders.mockResolvedValue([{ id: "provider-1", name: "当前供应商", haikuModel: "current-haiku" }])
    const config = Object.freeze({
      projectId: "project-1", agentType: "claude-code", providerId: "provider-1", modelTier: "haiku", mode: "dontAsk", prompt: "Reply OK", sessionPolicy: "fresh",
      ...(snapshots ? { providerName: "保存的供应商", modelName: "saved-model" } : {}),
    })
    const item = createItem({ type: "builtin.agent", config })
    const before = JSON.stringify(item)
    const onEdit = vi.fn()
    await renderDetail(item, onEdit)
    const row = [...document.querySelectorAll("dt")].find(field => field.textContent === "供应商和模型")
    expect(row?.nextElementSibling?.textContent).toBe(snapshots ? "保存的供应商 saved-model" : "当前供应商 current-haiku")
    expect(document.querySelector('[aria-label="执行操作"]')?.textContent).not.toContain("provider-1")
    expect([...document.querySelectorAll("dt")].some(field => field.textContent === "模型档位")).toBe(false)
    expect(JSON.stringify(item)).toBe(before)
    expect(onEdit).not.toHaveBeenCalled()
    expect(bridge.listProviders).toHaveBeenCalledTimes(snapshots ? 0 : 1)
  })

  it("keeps executors without a provider free of provider requests", async () => {
    await renderDetail(createItem({ type: "builtin.claude-code", config: { projectId: "project-1", prompt: "Reply OK", singleRun: true } }), vi.fn())
    expect(document.body.textContent).toContain("完成后退出")
    expect(bridge.listProviders).not.toHaveBeenCalled()
  })
})

async function renderDetail(item: AutomationItem, onEdit: () => void) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(<TooltipProvider><AutomationDetail item={item} busy={false} error={null} onBack={vi.fn()} onEdit={onEdit} onToggleEnabled={vi.fn()} onStopRun={vi.fn()} onRefresh={vi.fn()} /></TooltipProvider>)
  })
}

function createItem(executor: AutomationItem["executor"]): AutomationItem {
  return {
    id: "automation:detail-test", schemaVersion: 2, name: "Detail test", enabled: false, scope: { type: "global" },
    trigger: { type: "builtin.interval", config: { everyMinutes: 10, anchor: "created_at" } }, executor,
    policy: { missedRunPolicy: "skip", overlapPolicy: "skip" }, createdAt: "2026-11-06T00:00:00Z", updatedAt: "2026-11-06T00:00:00Z", runCount: 0, configVersion: 0,
  }
}

/**
 * Phase 0.6 — DebugPanel skeleton (dev-only).
 * SPEC §15.12.
 *
 * Renders a tabbed view of runtime state. Phase 0 lands the component shell
 * with stub data sources; future commits wire actual `inspect()` calls from
 * ServiceRegistry, DataRepository, EventBus, etc.
 *
 * The component is dev-only — production bundles can tree-shake it via
 * `process.env.NODE_ENV !== "production"` checks at the call site (the
 * component itself is unconditional so unit tests can still mount it).
 */

import { useState } from "react"

export type DebugPanelTab =
  | "services"
  | "data"
  | "events"
  | "network"
  | "projects"
  | "health"
  | "ipc"
  | "diagnostics"

export interface DebugPanelDataSources {
  readonly services?: () => unknown
  readonly data?: () => unknown
  readonly events?: () => unknown
  readonly network?: () => unknown
  readonly projects?: () => unknown
  readonly health?: () => unknown
  readonly ipc?: () => unknown
  readonly diagnostics?: () => Promise<unknown>
}

export interface DebugPanelProps {
  readonly sources?: DebugPanelDataSources
  readonly initialTab?: DebugPanelTab
}

const TABS: DebugPanelTab[] = [
  "services",
  "data",
  "events",
  "network",
  "projects",
  "health",
  "ipc",
  "diagnostics",
]

export function DebugPanel({ sources = {}, initialTab = "services" }: DebugPanelProps) {
  const [tab, setTab] = useState<DebugPanelTab>(initialTab)

  const renderTabContent = () => {
    const source = sources[tab]
    if (!source) return <span data-testid="debug-empty">No data source registered</span>
    let data: unknown
    try {
      data = source()
    } catch (err) {
      return <pre data-testid="debug-error">{(err as Error).message}</pre>
    }
    return (
      <pre data-testid="debug-content" style={{ whiteSpace: "pre-wrap" }}>
        {safeStringify(data)}
      </pre>
    )
  }

  return (
    <div data-testid="debug-panel" style={{ fontFamily: "monospace", padding: 8 }}>
      <div role="tablist" data-testid="debug-tabs">
        {TABS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            data-active={id === tab}
            onClick={() => setTab(id)}
          >
            {id}
          </button>
        ))}
      </div>
      <section role="tabpanel" data-testid="debug-tabpanel" data-tab={tab}>
        {renderTabContent()}
      </section>
    </div>
  )
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

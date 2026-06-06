import { useEffect, useState } from "react"
import { Wifi, WifiOff } from "lucide-react"

import { SettingsFieldRow } from "@/modules/settings/components/settings-field-row"
import { StatusPill } from "@/modules/settings/components/status-pill"
import { getSynapseBridge } from "@/lib/electron-bridge"
import type { SynapseLiveState, SynapseLiveStatus } from "@/types/live"

const DEFAULT_LIVE_STATE: SynapseLiveState = {
  status: "unauthenticated",
  clientInstanceId: null,
  connectedAt: null,
  lastSeenAt: null,
  lastError: null,
}

const LIVE_STATUS_LABELS: Record<SynapseLiveStatus, string> = {
  connected: "已连接",
  reconnecting: "重连中",
  disconnected: "未连接",
  unauthenticated: "未登录",
}

type LiveConnectionPanelProps = {
  initialState?: SynapseLiveState
}

function LiveConnectionPanel({ initialState = DEFAULT_LIVE_STATE }: LiveConnectionPanelProps) {
  const [state, setState] = useState<SynapseLiveState>(initialState)

  useEffect(() => {
    const bridge = getSynapseBridge()?.live
    if (!bridge) return undefined

    let mounted = true
    void bridge.getState()
      .then((nextState) => {
        if (mounted) {
          setState(nextState)
        }
      })
      .catch(() => {
        if (mounted) {
          setState((current) => ({ ...current, lastError: "未连接" }))
        }
      })

    const unsubscribe = bridge.onStateChanged((event) => {
      setState(event.state)
    })

    return () => {
      mounted = false
      unsubscribe()
    }
  }, [])

  const Icon = state.status === "connected" ? Wifi : WifiOff
  const label = LIVE_STATUS_LABELS[state.status]

  return (
    <SettingsFieldRow label="服务器连接" error={state.lastError}>
      <div className="flex items-center gap-2">
        <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
        <StatusPill
          active={state.status === "connected"}
          activeLabel={label}
          inactiveLabel={label}
          variant={state.status === "reconnecting" ? "warning" : "default"}
        />
      </div>
    </SettingsFieldRow>
  )
}

export { LiveConnectionPanel }

import { RefreshCw, Wifi, WifiOff } from "lucide-react"

import { Button } from "@/components/ui/button"
import { SettingsFieldRow } from "@/modules/settings/components/settings-field-row"
import { StatusPill } from "@/modules/settings/components/status-pill"
import { useLiveConnection } from "@/modules/settings/hooks/use-live-connection"
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

function LiveConnectionPanel({ initialState }: LiveConnectionPanelProps) {
  const { isLoading, isRetrying, retry, state } = useLiveConnection(
    initialState ?? DEFAULT_LIVE_STATE,
    initialState === undefined,
  )

  const Icon = isLoading ? RefreshCw : state.status === "connected" ? Wifi : WifiOff
  const label = isLoading ? "正在读取" : LIVE_STATUS_LABELS[state.status]
  const canRetry = !isLoading && (state.status === "reconnecting" || state.status === "disconnected")

  return (
    <SettingsFieldRow
      label="服务器连接"
      contentClassName="@md/field-group:max-w-md"
      controlClassName="w-full"
    >
      <div className="flex items-center justify-end gap-3">
        <div className="flex min-w-0 items-center gap-3" aria-live="polite">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <Icon className={isLoading ? "size-4 animate-spin" : "size-4"} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <StatusPill
              active={!isLoading && state.status === "connected"}
              activeLabel={label}
              inactiveLabel={label}
              variant={!isLoading && state.status === "reconnecting" ? "warning" : "default"}
            />
            {!isLoading && state.lastError ? (
              <p className="mt-1 text-xs text-muted-foreground">{state.lastError}</p>
            ) : null}
          </div>
        </div>
        {canRetry ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isRetrying}
            data-track="live-connection-retry"
            onClick={() => void retry()}
          >
            <RefreshCw data-icon="inline-start" className={isRetrying ? "animate-spin" : undefined} />
            {isRetrying ? "连接中" : "立即重试"}
          </Button>
        ) : null}
      </div>
    </SettingsFieldRow>
  )
}

export { LiveConnectionPanel }

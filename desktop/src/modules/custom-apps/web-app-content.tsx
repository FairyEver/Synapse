import { useEffect, useState } from "react"
import { AlertCircle, AppWindow } from "lucide-react"
import type {
  CustomAppDto,
  CustomAppId,
  CustomWebAppViewState,
} from "@synapse/shared"

import { Button } from "@/components/ui/button"
import { SystemAppWindowShell } from "@/modules/apps/components/system-app-window-shell"
import { SystemAppTopBarActionButton } from "@/modules/apps/components/system-app-top-bar"
import { getSynapseBridge } from "@/lib/electron-bridge"
import { WebAppViewport } from "./web-app-viewport"
import { WebAppToolbarActions } from "./web-app-toolbar-actions"

const INITIAL_STATE: CustomWebAppViewState = {
  canGoBack: false,
  canGoForward: false,
  isLoading: false,
  currentUrl: null,
  error: "none",
}

type CustomWebAppContentProps = {
  readonly app: CustomAppDto
  readonly appId: CustomAppId
  readonly windowMode?: boolean
  readonly onOpenWindow?: () => void
}

export function CustomWebAppContent({
  app,
  appId,
  windowMode = false,
  onOpenWindow,
}: CustomWebAppContentProps) {
  const bridge = getSynapseBridge()?.customApps
  const [state, setState] = useState<CustomWebAppViewState>(INITIAL_STATE)

  useEffect(() => {
    if (!bridge) return undefined
    let cancelled = false
    void bridge.navigation.getState().then((next) => {
      if (!cancelled) setState(next)
    }).catch(() => undefined)
    const unsubscribe = bridge.navigation.onStateChanged((event) => {
      if (!cancelled && event.appId === appId) setState(event.state)
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [appId, bridge])

  return (
    <SystemAppWindowShell
      left={<h2 className="truncate text-sm font-semibold">{app.name}</h2>}
      embeddedLeftAddon={<h2 className="truncate text-sm font-semibold">{app.name}</h2>}
      actions={(
        <>
          <WebAppToolbarActions state={state} />
          {!windowMode && onOpenWindow ? (
            <SystemAppTopBarActionButton
              iconOnly
              type="button"
              aria-label="新窗口打开"
              tooltip="新窗口打开"
              onClick={onOpenWindow}
            >
              <AppWindow />
            </SystemAppTopBarActionButton>
          ) : null}
        </>
      )}
    >
      <div className="relative h-full min-h-0 bg-background">
        {state.error !== "none" && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background p-6">
            <div className="flex max-w-sm flex-col items-center gap-3 text-center">
              <AlertCircle aria-hidden="true" className="size-5 text-destructive" />
              <p className="text-sm">{state.error === "certificate" ? "网站证书无法验证" : "网页加载失败"}</p>
              <Button type="button" variant="outline" onClick={() => { void bridge?.navigation.perform("reload") }}>
                重新加载
              </Button>
            </div>
          </div>
        )}
        <WebAppViewport appId={appId} />
        <span className="sr-only">{app.name}</span>
      </div>
    </SystemAppWindowShell>
  )
}

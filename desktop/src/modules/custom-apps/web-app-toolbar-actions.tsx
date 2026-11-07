import { ArrowLeft, ArrowRight, ExternalLink, RotateCw } from "lucide-react"
import type {
  CustomWebAppNavigationAction,
  CustomWebAppViewState,
} from "@synapse/shared"

import { SystemAppTopBarActionButton } from "@/modules/apps/components/system-app-top-bar"
import { getSynapseBridge } from "@/lib/electron-bridge"

type WebAppToolbarActionsProps = {
  readonly state: CustomWebAppViewState
  readonly onAction?: (action: CustomWebAppNavigationAction) => Promise<void>
  readonly showTooltips?: boolean
}

export function WebAppToolbarActions({
  state,
  onAction,
  showTooltips = true,
}: WebAppToolbarActionsProps) {
  const perform = (action: CustomWebAppNavigationAction) => {
    void (onAction
      ? onAction(action)
      : getSynapseBridge()?.customApps.navigation.perform(action))
  }

  return (
    <>
      <SystemAppTopBarActionButton
        iconOnly
        type="button"
        aria-label="后退"
        tooltip={showTooltips ? "后退" : undefined}
        disabled={!state.canGoBack}
        onClick={() => perform("back")}
      >
        <ArrowLeft />
      </SystemAppTopBarActionButton>
      <SystemAppTopBarActionButton
        iconOnly
        type="button"
        aria-label="前进"
        tooltip={showTooltips ? "前进" : undefined}
        disabled={!state.canGoForward}
        onClick={() => perform("forward")}
      >
        <ArrowRight />
      </SystemAppTopBarActionButton>
      <SystemAppTopBarActionButton
        iconOnly
        type="button"
        aria-label="刷新"
        tooltip={showTooltips ? "刷新" : undefined}
        onClick={() => perform("reload")}
      >
        <RotateCw className={state.isLoading ? "animate-spin" : undefined} />
      </SystemAppTopBarActionButton>
      <SystemAppTopBarActionButton
        iconOnly
        type="button"
        aria-label="在浏览器打开"
        tooltip={showTooltips ? "在浏览器打开" : undefined}
        disabled={!state.currentUrl}
        onClick={() => perform("open-external")}
      >
        <ExternalLink />
      </SystemAppTopBarActionButton>
    </>
  )
}

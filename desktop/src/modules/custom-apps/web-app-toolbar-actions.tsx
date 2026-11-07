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
}

export function WebAppToolbarActions({ state, onAction }: WebAppToolbarActionsProps) {
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
        tooltip="后退"
        disabled={!state.canGoBack}
        onClick={() => perform("back")}
      >
        <ArrowLeft />
      </SystemAppTopBarActionButton>
      <SystemAppTopBarActionButton
        iconOnly
        type="button"
        aria-label="前进"
        tooltip="前进"
        disabled={!state.canGoForward}
        onClick={() => perform("forward")}
      >
        <ArrowRight />
      </SystemAppTopBarActionButton>
      <SystemAppTopBarActionButton
        iconOnly
        type="button"
        aria-label="刷新"
        tooltip="刷新"
        onClick={() => perform("reload")}
      >
        <RotateCw className={state.isLoading ? "animate-spin" : undefined} />
      </SystemAppTopBarActionButton>
      <SystemAppTopBarActionButton
        iconOnly
        type="button"
        aria-label="在浏览器打开"
        tooltip="在浏览器打开"
        disabled={!state.currentUrl}
        onClick={() => perform("open-external")}
      >
        <ExternalLink />
      </SystemAppTopBarActionButton>
    </>
  )
}

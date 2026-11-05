import type { MainNavigationTarget } from "@/modules/apps/main-navigation"
import type { MessageCenterOpenRequest } from "@/app-shell/hooks/use-message-center"
import { AccountUserControl } from "@/app-shell/components/account-user-control"
import { MessageCenter } from "@/app-shell/components/message-center"
import { isAccountUiVisible } from "@/app-shell/account-ui-visibility"

type AppShellActionsProps = {
  onOpenAccountSettings?: () => void
  onOpenTarget?: (target: MainNavigationTarget) => Promise<boolean>
  notificationOpenRequest?: MessageCenterOpenRequest | null
  onNotificationOpenRequestConsumed?: () => void
}

function AppShellActions({ onOpenAccountSettings, onOpenTarget, notificationOpenRequest, onNotificationOpenRequestConsumed }: AppShellActionsProps) {
  if (!isAccountUiVisible()) {
    return null
  }

  return (
    <div className="flex flex-col items-center gap-1.5">
      <MessageCenter onOpenTarget={onOpenTarget} openRequest={notificationOpenRequest} onOpenRequestConsumed={onNotificationOpenRequestConsumed} />
      <AccountUserControl onOpenSettings={onOpenAccountSettings} />
    </div>
  )
}

export { AppShellActions }

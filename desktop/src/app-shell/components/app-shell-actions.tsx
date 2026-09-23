import { AccountUserControl } from "@/app-shell/components/account-user-control"
import { MessageCenter } from "@/app-shell/components/message-center"
import { isAccountUiVisible } from "@/app-shell/account-ui-visibility"

type AppShellActionsProps = {
  onOpenAccountSettings?: () => void
  onOpenMeeting?: (meetingId: string) => void
}

function AppShellActions({ onOpenAccountSettings, onOpenMeeting }: AppShellActionsProps) {
  if (!isAccountUiVisible()) {
    return null
  }

  return (
    <div className="flex items-center gap-1.5">
      <MessageCenter onOpenMeeting={onOpenMeeting} />
      <AccountUserControl onOpenSettings={onOpenAccountSettings} />
    </div>
  )
}

export { AppShellActions }

import { AccountUserControl } from "@/app-shell/components/account-user-control"
import { isAccountUiVisible } from "@/app-shell/account-ui-visibility"

type AppShellActionsProps = {
  onOpenAccountSettings?: () => void
}

function AppShellActions({ onOpenAccountSettings }: AppShellActionsProps) {
  if (!isAccountUiVisible()) {
    return null
  }

  return (
    <div className="flex items-center gap-1.5">
      <AccountUserControl onOpenSettings={onOpenAccountSettings} />
    </div>
  )
}

export { AppShellActions }

import { AccountUserControl } from "@/app-shell/components/account-user-control"

type AppShellActionsProps = {
  onOpenAccountSettings?: () => void
}

function AppShellActions({ onOpenAccountSettings }: AppShellActionsProps) {
  return (
    <div className="flex items-center gap-1.5">
      <AccountUserControl onOpenSettings={onOpenAccountSettings} />
    </div>
  )
}

export { AppShellActions }

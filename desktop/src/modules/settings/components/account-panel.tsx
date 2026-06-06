import { AccountUserControl } from "@/app-shell/components/account-user-control"
import { LiveConnectionPanel } from "@/modules/settings/components/live-connection-panel"
import { SettingsGroup } from "@/modules/settings/components/settings-group"

function AccountPanel() {
  return (
    <SettingsGroup>
      <AccountUserControl variant="panel" />
      <LiveConnectionPanel />
    </SettingsGroup>
  )
}

export { AccountPanel }

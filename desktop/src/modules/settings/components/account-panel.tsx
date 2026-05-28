import { AccountUserControl } from "@/app-shell/components/account-user-control"
import { SettingsGroup } from "@/modules/settings/components/settings-group"

function AccountPanel() {
  return (
    <SettingsGroup>
      <AccountUserControl variant="panel" />
    </SettingsGroup>
  )
}

export { AccountPanel }

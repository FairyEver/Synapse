import { SettingsSectionHeading } from "@/modules/settings/components/settings-section-heading"
import { DatabaseSettingsPanel } from "@/modules/settings/components/database-settings-panel"

function ServicesPanel() {
  return (
    <div className="flex flex-col">
      <SettingsSectionHeading>数据库</SettingsSectionHeading>
      <DatabaseSettingsPanel />
    </div>
  )
}

export { ServicesPanel }

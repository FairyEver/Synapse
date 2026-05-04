import { SettingsSectionHeading } from "@/modules/settings/components/settings-section-heading"
import { DatabaseSettingsPanel } from "@/modules/settings/components/database-settings-panel"
import { McpSettingsPanel } from "@/modules/settings/components/mcp-settings-panel"

function ServicesPanel() {
  return (
    <div className="flex flex-col">
      <SettingsSectionHeading>数据库</SettingsSectionHeading>
      <DatabaseSettingsPanel />

      <SettingsSectionHeading>MCP Server</SettingsSectionHeading>
      <McpSettingsPanel />
    </div>
  )
}

export { ServicesPanel }

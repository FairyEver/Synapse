import { SettingsSectionHeading } from "@/modules/settings/components/settings-section-heading"
import { DiagnosticsPanel } from "@/modules/settings/components/diagnostics-panel"
import { LogExportPanel } from "@/modules/settings/components/log-export-panel"

function TroubleshootingPanel() {
  return (
    <div className="flex flex-col">
      <SettingsSectionHeading>诊断</SettingsSectionHeading>
      <DiagnosticsPanel />

      <SettingsSectionHeading>日志</SettingsSectionHeading>
      <LogExportPanel />
    </div>
  )
}

export { TroubleshootingPanel }

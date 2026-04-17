import { Button } from "@/components/ui/button"
import { SettingsGroup } from "@/modules/settings/components/settings-group"

type AboutPanelProps = {
  version: string
}

function AboutPanel({ version }: AboutPanelProps) {
  return (
    <SettingsGroup>
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium">当前版本</p>
          <p className="text-sm text-muted-foreground">v{version}</p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium">软件更新</p>
          <p className="text-sm text-muted-foreground">暂不可用</p>
        </div>
        <Button variant="outline" disabled>
          检查更新
        </Button>
      </div>
    </SettingsGroup>
  )
}

export { AboutPanel }

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { SettingsFieldRow } from "./settings-field-row"
import { SettingsGroup } from "./settings-group"
import { useDeviceName } from "../hooks/use-device-name"

export function DeviceNamePanel() {
  const name = useDeviceName()
  return (
    <SettingsGroup>
      <SettingsFieldRow label="设备名称" error={name.error}>
        <form className="flex items-center gap-2" onSubmit={(event) => { event.preventDefault(); void name.save() }}>
          <Input
            aria-label="设备名称"
            value={name.draft}
            maxLength={120}
            disabled={name.loading || name.saving || name.loadFailed}
            aria-invalid={Boolean(name.error)}
            onChange={(event) => name.change(event.target.value)}
          />
          {name.loadFailed ? (
            <Button type="button" variant="outline" onClick={name.retry}>重试</Button>
          ) : (
            <Button type="submit" variant="outline" disabled={!name.canSave}>
              {name.loading ? "读取中" : name.saving ? "保存中" : "保存"}
            </Button>
          )}
        </form>
      </SettingsFieldRow>
    </SettingsGroup>
  )
}

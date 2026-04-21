import { useState } from "react"
import { createRendererLogger } from "@/app-shell/logging"
import { Button } from "@/components/ui/button"
import { DelayedConfirmAlertDialog } from "@/components/delayed-confirm-alert-dialog"
import { SettingsFieldRow } from "@/modules/settings/components/settings-field-row"
import { SettingsGroup } from "@/modules/settings/components/settings-group"

const logger = createRendererLogger("settings.reset")

function AppResetPanel() {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <>
      <SettingsGroup>
        <SettingsFieldRow
          label="重置应用"
          description="清除所有本地数据，恢复到初始状态。"
          controlClassName="flex w-full justify-start md:w-fit"
        >
          <Button
            type="button"
            variant="destructive"
            onClick={() => {
              logger.info("App reset dialog opened.")
              setIsOpen(true)
            }}
          >
            重置
          </Button>
        </SettingsFieldRow>
      </SettingsGroup>

      <DelayedConfirmAlertDialog
        open={isOpen}
        onOpenChange={setIsOpen}
        title="重置应用"
        description={
          <div className="flex flex-col gap-3 text-sm text-muted-foreground">
            <p>
              此操作将清除以下本地数据，使应用恢复至首次启动时的状态：
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li>应用配置与偏好设置</li>
              <li>已导入的仓库目录列表</li>
              <li>用户身份信息</li>
              <li>本地缓存与日志</li>
            </ul>
            <p>
              重置不会删除或修改你的仓库文件。仓库中的内容仍保留在原始目录中，重新导入即可恢复访问。
            </p>
            <p className="font-medium text-destructive">
              此操作不可撤销。应用将自动重启。
            </p>
          </div>
        }
        confirmLabel="确认重置"
        delaySeconds={5}
        onConfirm={() => {
          logger.info("App reset confirmed. Initiating full reset.")
          void window.synapse?.config.resetApp()
        }}
      />
    </>
  )
}

export { AppResetPanel }

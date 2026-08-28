import { useRef, useState } from "react"
import { useLocalIdentity } from "@/app-shell/identity-context"
import { createRendererLogger } from "@/app-shell/logging"
import { useAppNotifications } from "@/app-shell/notifications"
import { Button } from "@/components/ui/button"
import { DelayedConfirmAlertDialog } from "@/components/delayed-confirm-alert-dialog"
import { SettingsFieldRow } from "@/modules/settings/components/settings-field-row"
import { SettingsGroup } from "@/modules/settings/components/settings-group"

const logger = createRendererLogger("settings.reset")

function AppResetPanel() {
  const [isOpen, setIsOpen] = useState(false)
  const resetButtonRef = useRef<HTMLButtonElement>(null)
  const { localIdentityState } = useLocalIdentity()
  const notifications = useAppNotifications()

  const userId =
    localIdentityState?.status === "ready" ? localIdentityState.identity.userId : null
  const confirmLabel = userId ? "复制 ID 并重置" : "确认重置"

  return (
    <>
      <SettingsGroup>
        <SettingsFieldRow
          label="重置应用"
          description="清除所有本地数据，恢复到初始状态。"
          controlClassName="flex w-full justify-end"
        >
          <Button
            ref={resetButtonRef}
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
          <div className="flex flex-col gap-2 text-sm text-muted-foreground">
            {userId ? (
              <div className="rounded-md border border-border bg-muted/50 p-3">
                <p className="text-sm font-medium text-foreground">
                  请先备份你的用户 ID
                </p>
                <p className="mt-1 break-all font-mono text-xs text-foreground">
                  {userId}
                </p>
                <p className="mt-2 text-xs">
                  点击“{confirmLabel}”会自动把此 ID 复制到剪贴板。丢失后将无法接续身份。
                </p>
              </div>
            ) : null}

            <div>
              <p className="mb-1 text-foreground">会清空：</p>
              <ol className="list-decimal pl-5 space-y-1">
                <li>应用配置与偏好设置</li>
                <li>已导入的仓库目录列表</li>
                <li>用户身份信息</li>
                <li>仓库内容索引缓存</li>
                <li>应用日志与浏览器缓存</li>
              </ol>
            </div>
            <div>
              <p className="mb-1 text-foreground">不会清空：</p>
              <ol className="list-decimal pl-5 space-y-1">
                <li>数据库中的表结构与数据</li>
                <li>仓库目录中的实际文件（仍保留在原位置，重新导入即可访问）</li>
              </ol>
            </div>
            <p className="font-medium text-destructive">
              此操作不可撤销，应用将自动重启。
            </p>
          </div>
        }
        confirmLabel={confirmLabel}
        delaySeconds={3}
        returnFocusRef={resetButtonRef}
        onConfirm={() => {
          if (!userId) {
            logger.info("App reset confirmed without user ID. Initiating full reset.")
            void window.synapse?.config.resetApp()
            return
          }

          void (async () => {
            try {
              await navigator.clipboard.writeText(userId)
              logger.info("User ID copied to clipboard before reset.")
              logger.info("App reset confirmed after copying user ID. Initiating full reset.")
              void window.synapse?.config.resetApp()
            } catch (error) {
              logger.error("Failed to copy user ID before reset.", error)
              notifications.warning("复制用户 ID 失败，请手动复制后重新操作。")
            }
          })()
        }}
      />
    </>
  )
}

export { AppResetPanel }

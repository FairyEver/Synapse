import { useState } from "react"
import { Copy } from "lucide-react"
import { useLocalIdentity } from "@/app-shell/identity-context"
import { createRendererLogger } from "@/app-shell/logging"
import { useAppNotifications } from "@/app-shell/notifications"
import { Button } from "@/components/ui/button"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { AdoptIdentityDialog } from "@/modules/settings/components/adopt-identity-dialog"
import { SettingsGroup } from "@/modules/settings/components/settings-group"

function IdentityPanel() {
  const { promise } = useAppNotifications()
  const { localIdentityState } = useLocalIdentity()
  const logger = createRendererLogger("settings.identity")
  const [isAdoptDialogOpen, setIsAdoptDialogOpen] = useState(false)

  if (!localIdentityState || localIdentityState.status !== "ready") {
    return (
      <SettingsGroup>
        <div className="flex flex-col gap-2">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-32" />
        </div>
      </SettingsGroup>
    )
  }

  return (
    <>
      <SettingsGroup>
        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="identity-user-id">用户 ID（本地）</Label>
            <InputGroup>
              <InputGroupInput
                id="identity-user-id"
                readOnly
                value={localIdentityState.identity.userId}
                className="font-mono"
              />
              <InputGroupAddon align="inline-end">
                <InputGroupButton
                  type="button"
                  onClick={() => {
                    logger.info("User ID copied to clipboard.")
                    void promise(
                      () => navigator.clipboard.writeText(localIdentityState.identity.userId),
                      {
                        trackingName: "settings.identity.user-id.copy",
                        loading: "正在复制用户 ID...",
                        success: "已复制到剪贴板。",
                        error: (error) => error instanceof Error ? error.message : "复制失败。",
                      },
                    ).catch(() => undefined)
                  }}
                >
                  <Copy data-icon="inline-start" />
                  复制
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
          </div>

          <div className="flex justify-start">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                logger.info("Adopt identity dialog opened.")
                setIsAdoptDialogOpen(true)
              }}
            >
              接续已有身份
            </Button>
          </div>
        </div>
      </SettingsGroup>

      <AdoptIdentityDialog
        open={isAdoptDialogOpen}
        onOpenChange={setIsAdoptDialogOpen}
      />
    </>
  )
}

export { IdentityPanel }

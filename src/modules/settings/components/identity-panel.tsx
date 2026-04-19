import { useState } from "react"
import { Copy } from "lucide-react"
import { useLocalIdentity } from "@/app-shell/identity-context"
import { useAppNotifications } from "@/app-shell/notifications"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { AdoptIdentityDialog } from "@/modules/settings/components/adopt-identity-dialog"
import { SettingsGroup } from "@/modules/settings/components/settings-group"

function IdentityPanel() {
  const { promise } = useAppNotifications()
  const { localIdentityState } = useLocalIdentity()
  const [isAdoptDialogOpen, setIsAdoptDialogOpen] = useState(false)

  if (!localIdentityState || localIdentityState.status !== "ready") {
    return null
  }

  return (
    <>
      <SettingsGroup>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="identity-user-id">用户 ID（本地）</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  void promise(
                    () => navigator.clipboard.writeText(localIdentityState.identity.userId),
                    {
                      loading: "正在复制用户 ID...",
                      success: "已复制到剪贴板。",
                      error: (error) => error instanceof Error ? error.message : "复制失败。",
                    },
                  ).catch(() => {})
                }}
              >
                <Copy />
                复制
              </Button>
            </div>
            <Input
              id="identity-user-id"
              readOnly
              value={localIdentityState.identity.userId}
              className="font-mono"
            />
            <p className="text-sm text-muted-foreground">
              这是你在 Synapse 里的唯一身份凭证。请尽快备份到安全位置。在各个仓库里的显示名可以在下方“仓库”板块里分别设置。
            </p>
          </div>

          <div className="flex justify-start">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsAdoptDialogOpen(true)}
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

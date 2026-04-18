import { useEffect, useMemo, useRef, useState } from "react"
import { Copy } from "lucide-react"
import { useIdentity } from "@/app-shell/identity-context"
import { useAppNotifications } from "@/app-shell/notifications"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { SettingsFieldRow } from "@/modules/settings/components/settings-field-row"
import { SettingsGroup } from "@/modules/settings/components/settings-group"

function normalizeUserIdInput(value: string): string {
  return value.trim().toLowerCase().replace(/-/g, "")
}

function validateUserIdInput(value: string): string | null {
  const normalizedValue = normalizeUserIdInput(value)

  if (!normalizedValue) {
    return "ID 格式不对，应为 32 位十六进制字符。"
  }

  return /^[0-9a-f]{32}$/.test(normalizedValue)
    ? null
    : "ID 格式不对，应为 32 位十六进制字符。"
}

function IdentityPanel() {
  const { identityState, replaceUserId, updateDisplayName } = useIdentity()
  const { promise } = useAppNotifications()
  const [draftDisplayName, setDraftDisplayName] = useState("")
  const [restoreValue, setRestoreValue] = useState("")
  const [restoreError, setRestoreError] = useState<string | null>(null)
  const [isRestoreOpen, setIsRestoreOpen] = useState(false)
  const [isSavingDisplayName, setIsSavingDisplayName] = useState(false)
  const lastSavedDisplayNameRef = useRef("")

  const userId = identityState?.status === "needs-recovery" ? "" : identityState?.identity.userId ?? ""

  useEffect(() => {
    if (identityState?.status === "needs-recovery") {
      setDraftDisplayName("")
      return
    }

    setDraftDisplayName(identityState?.identity.displayName ?? "")
    lastSavedDisplayNameRef.current = identityState?.identity.displayName ?? ""
  }, [identityState])

  const normalizedRestoreValue = useMemo(
    () => normalizeUserIdInput(restoreValue),
    [restoreValue],
  )

  useEffect(() => {
    if (!identityState || identityState.status === "needs-recovery") {
      return
    }

    const normalizedDisplayName = draftDisplayName.trim()

    if (normalizedDisplayName === lastSavedDisplayNameRef.current) {
      return
    }

    setIsSavingDisplayName(true)
    const timer = window.setTimeout(() => {
      void updateDisplayName(draftDisplayName)
        .then((nextState) => {
          if (nextState.status !== "needs-recovery") {
            lastSavedDisplayNameRef.current = nextState.identity.displayName
          }
        })
        .finally(() => {
          setIsSavingDisplayName(false)
        })
    }, 500)

    return () => {
      window.clearTimeout(timer)
      setIsSavingDisplayName(false)
    }
  }, [draftDisplayName, identityState, updateDisplayName])

  if (!identityState || identityState.status === "needs-recovery") {
    return null
  }

  return (
    <>
      <SettingsGroup>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="identity-user-id">用户 ID</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  void promise(
                    () => navigator.clipboard.writeText(identityState.identity.userId),
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
              value={userId}
              className="font-mono"
            />
            <p className="text-sm text-muted-foreground">
              这是当前身份 ID。请及时备份；本地数据丢失后无法恢复。
            </p>
          </div>

          <SettingsFieldRow
            label="恢复已有身份"
            description="切换后，新的提交会归属到该身份。"
            controlClassName="flex w-full justify-start md:w-[200px] md:justify-end"
          >
            <Button type="button" variant="outline" onClick={() => setIsRestoreOpen(true)}>
              恢复已有身份
            </Button>
          </SettingsFieldRow>

          <SettingsFieldRow label="显示名称">
            <Input
              id="identity-display-name"
              value={draftDisplayName}
              disabled={isSavingDisplayName}
              onChange={(event) => {
                setDraftDisplayName(event.target.value)
              }}
            />
          </SettingsFieldRow>
        </div>
      </SettingsGroup>

      <Dialog open={isRestoreOpen} onOpenChange={setIsRestoreOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>恢复已有身份</DialogTitle>
            <DialogDescription>
              切换 ID 后，新提交的内容会被认作来自另一个人。
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-2">
            <Label htmlFor="restore-user-id">用户 ID</Label>
            <Input
              id="restore-user-id"
              value={restoreValue}
              className="font-mono"
              aria-invalid={restoreError ? true : undefined}
              onChange={(event) => {
                setRestoreValue(event.target.value)
                setRestoreError(validateUserIdInput(event.target.value))
              }}
            />
            {restoreError ? (
              <p className="text-sm text-destructive">{restoreError}</p>
            ) : null}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setIsRestoreOpen(false)}>
              取消
            </Button>
            <Button
              type="button"
              disabled={Boolean(validateUserIdInput(restoreValue))}
              onClick={() => {
                void promise(
                  () => replaceUserId(normalizedRestoreValue),
                  {
                    loading: "正在恢复身份...",
                    success: () => {
                      setIsRestoreOpen(false)
                      setRestoreValue("")
                      setRestoreError(null)
                      return "身份已切换。"
                    },
                    error: (error) => error instanceof Error ? error.message : "恢复身份失败。",
                  },
                )
                  .catch((error) => {
                    setRestoreError(error instanceof Error ? error.message : "恢复身份失败。")
                  })
              }}
            >
              确认切换
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

export { IdentityPanel }

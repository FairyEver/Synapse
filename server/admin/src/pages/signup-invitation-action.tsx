import * as React from "react"
import { Copy } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { adminApi } from "@/lib/api"

type SignupInvitationActionProps = {
  readonly onCreated: () => void
}

function SignupInvitationAction({ onCreated }: SignupInvitationActionProps) {
  const [inviteUrl, setInviteUrl] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [copyError, setCopyError] = React.useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [isCreating, setIsCreating] = React.useState(false)
  const shouldReloadOnClose = React.useRef(false)

  async function copyInviteUrl(value: string) {
    if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable")
    await navigator.clipboard.writeText(value)
  }

  async function copyCurrentInviteUrl() {
    if (!inviteUrl) return
    setCopyError(null)
    try {
      await copyInviteUrl(inviteUrl)
    } catch {
      setCopyError("复制失败")
    }
  }

  async function createInvitation() {
    setIsCreating(true)
    setError(null)
    setCopyError(null)
    try {
      const invitation = await adminApi.createSignupInvitation()
      setInviteUrl(invitation.inviteUrl)
      shouldReloadOnClose.current = true
      setDialogOpen(true)
      try {
        await copyInviteUrl(invitation.inviteUrl)
      } catch {
        setCopyError("复制失败")
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "创建失败")
    } finally {
      setIsCreating(false)
    }
  }

  function handleDialogOpenChange(open: boolean) {
    setDialogOpen(open)
    if (!open && shouldReloadOnClose.current) {
      shouldReloadOnClose.current = false
      onCreated()
    }
  }

  return (
    <>
      <Button disabled={isCreating} onClick={() => void createInvitation()}>
        {isCreating ? "创建中" : "创建用户邀请"}
      </Button>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <Dialog open={dialogOpen} onOpenChange={handleDialogOpenChange}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>用户邀请链接</DialogTitle>
          </DialogHeader>
          <Input aria-label="邀请链接" readOnly value={inviteUrl} className="font-mono text-xs" />
          {copyError ? <p className="text-sm text-destructive">{copyError}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" aria-label="复制邀请链接" onClick={() => void copyCurrentInviteUrl()}>
              <Copy data-icon="inline-start" />
              复制
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

export { SignupInvitationAction }

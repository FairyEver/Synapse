import * as React from "react"
import { Copy } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { adminApi } from "@/lib/api"

type SignupInvitationActionProps = {
  readonly onCreated: () => void
}

function SignupInvitationAction({ onCreated }: SignupInvitationActionProps) {
  const [inviteUrl, setInviteUrl] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [isCreating, setIsCreating] = React.useState(false)

  async function copyInviteUrl(value: string) {
    if (!navigator.clipboard) return
    await navigator.clipboard.writeText(value)
  }

  async function createInvitation() {
    setIsCreating(true)
    setError(null)
    try {
      const invitation = await adminApi.createSignupInvitation()
      setInviteUrl(invitation.inviteUrl)
      onCreated()
      try {
        await copyInviteUrl(invitation.inviteUrl)
      } catch {
        setError("复制失败")
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "创建失败")
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Button disabled={isCreating} onClick={() => void createInvitation()}>
          {isCreating ? "创建中" : "创建邀请"}
        </Button>
        {inviteUrl ? (
          <>
            <Input readOnly value={inviteUrl} className="max-w-xl font-mono text-xs" />
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="复制邀请链接"
              onClick={() => void copyInviteUrl(inviteUrl)}
            >
              <Copy />
            </Button>
          </>
        ) : null}
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  )
}

export { SignupInvitationAction }

import { useState } from "react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Separator } from "@/components/ui/separator"
import { RefreshCw, Plus, Unlink } from "lucide-react"
import { useCursorAccounts } from "../hooks/use-cursor-accounts"

export function CursorConnectBadge({ onConnected }: { onConnected?: () => void }) {
  const { accounts, loading, syncing, login, remove, setActive, sync } = useCursorAccounts()
  const [loginInProgress, setLoginInProgress] = useState(false)
  const [open, setOpen] = useState(false)

  const connected = accounts.length > 0

  async function handleLogin() {
    setLoginInProgress(true)
    try {
      const result = await login()
      if (result.success) {
        onConnected?.()
      } else if (result.error) {
        toast.error(result.error)
      }
    } catch {
      toast.error("连接失败，请重试")
    } finally {
      setLoginInProgress(false)
    }
  }

  if (loading) return null

  if (!connected) {
    return (
      <button
        type="button"
        onClick={handleLogin}
        disabled={loginInProgress}
        className="border-dashed border-border text-muted-foreground hover:text-foreground hover:border-foreground/50 inline-flex items-center rounded-md border px-2 py-0.5 text-xs transition-colors"
      >
        {loginInProgress ? "连接中…" : "Cursor · 未连接"}
      </button>
    )
  }

  const activeAccount = accounts.find((a) => a.active) ?? accounts[0]

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Badge variant="secondary" className="cursor-pointer gap-1">
          Cursor
          {activeAccount?.userId && (
            <span className="text-muted-foreground font-normal">· {activeAccount.userId}</span>
          )}
        </Badge>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3" align="end">
        <div className="space-y-2">
          {accounts.map((account) => (
            <div key={account.id} className="flex items-center justify-between text-sm">
              <span className={account.active ? "font-medium" : "text-muted-foreground"}>
                {account.userId ?? account.label ?? account.id.slice(0, 8)}
              </span>
              <div className="flex items-center gap-1">
                {!account.active && accounts.length > 1 && (
                  <Button variant="ghost" size="sm" className="h-6 px-1.5 text-xs" onClick={() => setActive(account.id)}>
                    激活
                  </Button>
                )}
                <Button variant="ghost" size="sm" className="text-destructive h-6 w-6 p-0" onClick={() => remove(account.id)}>
                  <Unlink className="h-3 w-3" />
                </Button>
              </div>
            </div>
          ))}
        </div>
        <Separator className="my-2" />
        <div className="flex gap-1.5">
          <Button variant="outline" size="sm" className="h-7 flex-1 gap-1 text-xs" onClick={sync} disabled={syncing}>
            <RefreshCw className={`h-3 w-3 ${syncing ? "animate-spin" : ""}`} />
            同步
          </Button>
          <Button variant="outline" size="sm" className="h-7 flex-1 gap-1 text-xs" onClick={handleLogin} disabled={loginInProgress}>
            <Plus className="h-3 w-3" />
            添加账号
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

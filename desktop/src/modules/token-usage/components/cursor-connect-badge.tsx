import { useState } from "react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import { RefreshCw, Plus, Unlink, Copy } from "lucide-react"
import { useCursorAccounts } from "../hooks/use-cursor-accounts"

const EXTRACT_SCRIPT = `document.cookie.split(';').map(c=>c.trim()).find(c=>c.startsWith('WorkosCursorSessionToken='))?.split('=').slice(1).join('=')`

export function CursorConnectBadge({ onConnected }: { onConnected?: () => void }) {
  const { accounts, loading, syncing, addWithToken, remove, setActive, sync } = useCursorAccounts()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [tokenInput, setTokenInput] = useState("")
  const [submitting, setSubmitting] = useState(false)

  const connected = accounts.length > 0

  async function handleSubmitToken() {
    const token = tokenInput.trim()
    if (!token) return
    setSubmitting(true)
    try {
      const result = await addWithToken(token)
      if (result.success) {
        setDialogOpen(false)
        setTokenInput("")
        onConnected?.()
      } else {
        toast.error(result.error || "连接失败")
      }
    } catch {
      toast.error("连接失败，请重试")
    } finally {
      setSubmitting(false)
    }
  }

  function handleCopyScript() {
    navigator.clipboard.writeText(EXTRACT_SCRIPT)
    toast.success("已复制到剪贴板")
  }

  if (loading) return null

  if (!connected) {
    return (
      <>
        <button
          type="button"
          onClick={() => setDialogOpen(true)}
          className="border-dashed border-border text-muted-foreground hover:text-foreground hover:border-foreground/50 inline-flex items-center rounded-md border px-2 py-0.5 text-xs transition-colors"
        >
          Cursor · 未连接
        </button>
        <CursorConnectDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          tokenInput={tokenInput}
          onTokenChange={setTokenInput}
          onSubmit={handleSubmitToken}
          onCopyScript={handleCopyScript}
          submitting={submitting}
        />
      </>
    )
  }

  const activeAccount = accounts.find((a) => a.active) ?? accounts[0]

  return (
    <>
      <Popover>
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
            <Button variant="outline" size="sm" className="h-7 flex-1 gap-1 text-xs" onClick={() => setDialogOpen(true)}>
              <Plus className="h-3 w-3" />
              添加账号
            </Button>
          </div>
        </PopoverContent>
      </Popover>
      <CursorConnectDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        tokenInput={tokenInput}
        onTokenChange={setTokenInput}
        onSubmit={handleSubmitToken}
        onCopyScript={handleCopyScript}
        submitting={submitting}
      />
    </>
  )
}

function CursorConnectDialog({
  open, onOpenChange, tokenInput, onTokenChange, onSubmit, onCopyScript, submitting,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  tokenInput: string
  onTokenChange: (value: string) => void
  onSubmit: () => void
  onCopyScript: () => void
  submitting: boolean
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>连接 Cursor 账号</DialogTitle>
          <DialogDescription>通过浏览器控制台获取登录凭证</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <ol className="text-sm space-y-2 list-decimal list-inside">
            <li>在浏览器中打开 <code className="bg-muted rounded px-1 py-0.5 text-xs">cursor.com/settings</code>（确保已登录）</li>
            <li>按 F12 打开开发者工具，切换到 Console 标签</li>
            <li>
              粘贴以下代码并回车运行：
              <div className="bg-muted mt-1.5 flex items-start gap-2 rounded-md p-2">
                <code className="flex-1 break-all text-xs">{EXTRACT_SCRIPT}</code>
                <Button variant="ghost" size="sm" className="h-6 w-6 shrink-0 p-0" onClick={onCopyScript}>
                  <Copy className="h-3 w-3" />
                </Button>
              </div>
            </li>
            <li>复制输出结果，粘贴到下方输入框</li>
          </ol>
          <Textarea
            placeholder="粘贴 token 值..."
            value={tokenInput}
            onChange={(e) => onTokenChange(e.target.value)}
            rows={3}
            className="font-mono text-xs"
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button size="sm" onClick={onSubmit} disabled={!tokenInput.trim() || submitting}>
              {submitting ? "验证中…" : "连接"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

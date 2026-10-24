import { ChevronDown, Copy, Download, Eye, LoaderCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import type { AgentShareController } from "./use-agent-share"

const actionHitArea = "relative after:absolute after:inset-x-0 after:-inset-y-1"

export function AgentShareSelectionBar({ share }: { readonly share: AgentShareController }) {
  const busy = share.preparing || share.exportAction !== null || share.output.busy !== null
  const disabled = !share.selected.size || busy
  return (
    <div className="mx-auto my-2 w-full max-w-2xl shrink-0 px-4" data-agent-share-selection-bar>
      <div role="toolbar" aria-label="分享消息操作" aria-busy={busy} className="flex flex-wrap items-center gap-x-1 gap-y-2 rounded-xl border border-border bg-card p-2">
        <span className="px-2 text-sm font-medium whitespace-nowrap tabular-nums" aria-live="polite">已选 {share.selected.size} 条</span>
        {(share.loading || share.preparing) && <LoaderCircle className="size-4 animate-spin text-muted-foreground" aria-label={share.preparing ? "正在准备图片" : "正在加载历史消息"} />}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" className={actionHitArea} disabled={busy}>选择范围<ChevronDown data-icon="inline-end" /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start">
            <DropdownMenuItem disabled={share.loading || !share.complete} onSelect={() => share.preset("all")}>全选</DropdownMenuItem>
            <DropdownMenuItem disabled={share.loading || !share.complete} onSelect={() => share.preset("ai")}>仅 AI</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => share.preset("latest")}>最近一轮</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => share.preset("clear")}>清空</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="ml-auto flex items-center gap-1">
          <Button type="button" variant="ghost" className={actionHitArea} disabled={busy} onClick={share.exit}>取消</Button>
          <Button type="button" variant="outline" className={actionHitArea} disabled={disabled} onClick={() => void share.openPreview()}><Eye />预览</Button>
          <Button type="button" variant="outline" className={actionHitArea} disabled={disabled} onClick={() => void share.openPreview("copy")}>
            {share.exportAction === "copy" ? <LoaderCircle className="animate-spin" /> : <Copy />}复制
          </Button>
          <Button type="button" className={actionHitArea} disabled={disabled} onClick={() => void share.openPreview("save")}>
            {share.exportAction === "save" ? <LoaderCircle className="animate-spin" /> : <Download />}下载
          </Button>
        </div>
        {share.error && <div role="alert" className="flex w-full items-center justify-between gap-2 border-t px-2 pt-2 text-sm text-destructive">
          <span>{share.error}</span>
          {!share.complete && <Button type="button" variant="ghost" className={actionHitArea} disabled={share.loading} onClick={share.retryHistory}>重试</Button>}
        </div>}
      </div>
    </div>
  )
}
